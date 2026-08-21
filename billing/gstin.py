"""GSTIN validation, derivation, and taxpayer lookup.

Three layers, degrading gracefully:

1. **Structure + checksum** (always available, offline): a GSTIN is
   `SS PPPPPPPPPP E Z C` — state code, the holder's PAN, entity number, the
   literal 'Z', and a mod-36 check digit. Validated against known-real GSTINs
   (the firm's own, and GSTN's documented example).
2. **Derivation** (offline): state name via the GST_CODE table, PAN by slicing.
3. **Taxpayer lookup** (keyless): legal/trade name, address, constitution and
   registration status via Tally's free public GSTIN verifier — the same
   endpoint their search page uses. Unofficial but unauthenticated, and the
   180-day cache keeps our traffic to a handful of requests a month. If it is
   ever unreachable (or vanishes), lookups quietly degrade to layer 2.

A checksum failure is reported, never enforced: the caller decides. Forms warn
and skip autofill; nothing blocks a save (the paper world contains typos we
must still be able to record).
"""

import logging
import re

import requests
from django.conf import settings
from django.core.cache import cache

from billing.constants import GST_CODE

logger = logging.getLogger(__name__)

GSTIN_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$")
_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
_CACHE_PREFIX = "gstin_lookup:"
# Cached long on purpose. A taxpayer's legal name, trade name and address
# essentially never change, and every provider meters lookups — a long TTL is
# what turns a 20-50 request free tier into "free forever" at the volume a
# single shop actually onboards new parties. Registration STATUS can change
# (active → cancelled), so anything that must be current for ITC decisions
# should be re-checked at filing time rather than trusted from this cache.
_CACHE_TTL_DEFAULT = 60 * 60 * 24 * 180


def check_digit(first14: str) -> str:
    """Mod-36 check digit over the first 14 characters (weights alternate 1,2)."""
    total = 0
    for i, ch in enumerate(first14):
        product = _CHARS.index(ch) * (2 if i % 2 else 1)
        total += product // 36 + product % 36
    return _CHARS[(36 - total % 36) % 36]


def validate(gstin: str) -> tuple[bool, str]:
    """(ok, reason). Reason is empty when ok."""
    g = (gstin or "").strip().upper()
    if len(g) != 15:
        return False, "A GSTIN is exactly 15 characters."
    if not GSTIN_RE.match(g):
        return False, "That doesn't match the GSTIN format (e.g. 08AAGPL3375F1ZO)."
    if g[:2] not in GST_CODE:
        return False, f"'{g[:2]}' is not a GST state code."
    if check_digit(g[:14]) != g[14]:
        return False, "Check digit doesn't match — likely a typo."
    return True, ""


def derive(gstin: str) -> dict:
    """Fields knowable from the number itself. Assumes format already checked."""
    g = gstin.strip().upper()
    return {
        "state_code": g[:2],
        "state_name": GST_CODE.get(g[:2], ""),
        "pan": g[2:12],
    }


def _compose_address(pradr: dict) -> str:
    addr = (pradr or {}).get("addr") or {}
    parts = [addr.get(k, "") for k in ("bno", "bnm", "flno", "st", "loc", "dst")]
    line = ", ".join(p.strip() for p in parts if p and p.strip())
    pncd = addr.get("pncd", "")
    return f"{line} - {pncd}" if line and pncd else line


def _map_gstn_payload(d: dict) -> dict:
    """GSTN-standard taxpayer fields → our response shape. Both providers
    return the portal's own field names (lgnm / tradeNam / sts / pradr)."""
    return {
        "legal_name": d.get("lgnm", "") or "",
        "trade_name": d.get("tradeNam", "") or "",
        "status": d.get("sts", "") or "",
        "taxpayer_type": d.get("dty", "") or "",
        "registered_on": d.get("rgdt", "") or "",
        "address": _compose_address(d.get("pradr")),
    }


def _fetch_tally(gstin: str) -> dict | None:
    """Tally Solutions' free public GSTIN verifier — the endpoint behind
    https://tallysolutions.com/business-tools-templates/gstin-verification-search/.

    Unofficial (a WordPress theme API, note the 'serach' typo in the path) but
    completely unauthenticated: no key, no captcha, plain form POST. Treated
    with courtesy — one POST per lookup, short timeout, results cached for
    ~180 days — and with zero trust in its availability: any failure returns
    None and the caller degrades to derived fields.
    """
    url = getattr(settings, "GSTIN_TALLY_URL",
                  "https://tallysolutions.com/wp-content/themes/tally/api/gstin-serach-api.php")
    try:
        resp = requests.post(url, data={"gstin": gstin}, timeout=8)
        d = resp.json()
    except Exception as exc:  # noqa: BLE001 — any transport/parse issue = no enrichment
        logger.warning("Tally GSTIN lookup failed for %s: %s", gstin, exc)
        return None
    if not isinstance(d, dict) or d.get("status") != 1 or d.get("validation_status") != "VALID":
        return None
    address = (d.get("address") or "").strip()
    pincode = (d.get("pincode") or "").strip()
    if address and pincode and pincode not in address:
        address = f"{address} - {pincode}"
    return {
        "legal_name": (d.get("legal_name") or "").strip(),
        "trade_name": (d.get("trade_name") or "").strip(),
        "status": (d.get("gstin_status") or "").strip(),
        "taxpayer_type": (d.get("registration_type") or "").strip(),
        "constitution": (d.get("business_constitution") or "").strip(),
        "registration_date": (d.get("registration_date") or "").strip(),
        "address": address[:255],
    }


def lookup(gstin: str) -> dict:
    """Validation + derivation always; provider details when possible.
    `source` tells the UI how much to trust: checksum | cache | provider.
    """
    g = (gstin or "").strip().upper()
    ok, reason = validate(g)
    if not ok:
        return {"gstin": g, "valid": False, "reason": reason}

    result = {"gstin": g, "valid": True, "source": "checksum", **derive(g)}

    cached = cache.get(_CACHE_PREFIX + g)
    if cached is not None:
        return {**result, **cached, "source": "cache"}

    fetched = _fetch_tally(g)
    if fetched is not None:
        ttl = int(getattr(settings, "GSTIN_CACHE_SECONDS", _CACHE_TTL_DEFAULT))
        cache.set(_CACHE_PREFIX + g, fetched, ttl)
        return {**result, **fetched, "source": "provider"}

    result["hint"] = (
        "Registry lookup unreachable right now — state and PAN were derived "
        "from the number itself."
    )
    return result


def enrich_customer(customer, save: bool = True) -> bool:
    """Fill a customer's EMPTY address / state_name / pan_number from the
    registry. Never overwrites anything a human typed, never raises — every
    party-creation path (manual form, inward capture, GSTR-2A import, AI
    import) calls this so new records arrive complete regardless of entry
    point. Returns True when something was filled.
    """
    g = (customer.gst_number or "").strip().upper()
    if not g or not validate(g)[0]:
        return False
    needs_address = not (customer.address or "").strip()
    needs_state = not (customer.state_name or "").strip()
    needs_pan = not (customer.pan_number or "").strip()
    if not (needs_address or needs_state or needs_pan):
        return False
    try:
        data = lookup(g)
    except Exception:  # noqa: BLE001 — enrichment must never break a save
        return False
    changed = []
    if needs_address and data.get("address"):
        customer.address = data["address"][:255]
        changed.append("address")
    if needs_state and data.get("state_name"):
        customer.state_name = data["state_name"]
        changed.append("state_name")
    if needs_pan and data.get("pan"):
        customer.pan_number = data["pan"][:10]
        changed.append("pan_number")
    if changed and save:
        customer.save(update_fields=changed + ["updated_at"])
    return bool(changed)
