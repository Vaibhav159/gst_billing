"""GSTIN validation, derivation, and taxpayer lookup.

Three layers, degrading gracefully:

1. **Structure + checksum** (always available, offline): a GSTIN is
   `SS PPPPPPPPPP E Z C` — state code, the holder's PAN, entity number, the
   literal 'Z', and a mod-36 check digit. Validated against known-real GSTINs
   (the firm's own, and GSTN's documented example).
2. **Derivation** (offline): state name via the GST_CODE table, PAN by slicing.
3. **Taxpayer lookup** (needs GSTIN_API_KEY): legal/trade name, address and
   registration status from gstincheck.co.in (free keys; GSTN-standard payload
   shape). Results cached for 30 days — registrations change rarely and the
   free tier is small.

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


def _fetch_gstincheck(gstin: str) -> dict | None:
    """gstincheck.co.in: GET {base}/{key}/{gstin} → {flag, message, data}."""
    key = getattr(settings, "GSTIN_API_KEY", "")
    if not key:
        return None
    base = getattr(settings, "GSTIN_API_URL", "https://sheet.gstincheck.co.in/check")
    try:
        payload = requests.get(f"{base}/{key}/{gstin}", timeout=6).json()
    except Exception as e:
        logger.warning("gstincheck unreachable for %s: %s", gstin, e)
        return None
    if not payload.get("flag") or not isinstance(payload.get("data"), dict):
        logger.info("gstincheck returned no data for %s: %s",
                    gstin, str(payload.get("message"))[:120])
        return None
    return _map_gstn_payload(payload["data"])


def _fetch_cleartax(gstin: str) -> dict | None:
    """ClearTax GST API (docs.cleartax.in): taxpayer profile by GSTIN.

    GET {host}/gst/api/v0.2/taxable_entities/{entity_id}/gstin_verification
        ?gstin=... with X-Cleartax-Auth-Token. Effectively unmetered within a
    ClearTax subscription — the right provider when the firm/CA already files
    through ClearTax. Response carries the GSTN field names at the top level.
    """
    host = getattr(settings, "CLEARTAX_HOST", "")
    token = getattr(settings, "CLEARTAX_AUTH_TOKEN", "")
    entity = getattr(settings, "CLEARTAX_ENTITY_ID", "")
    if not (host and token and entity):
        return None
    url = f"{host.rstrip('/')}/gst/api/v0.2/taxable_entities/{entity}/gstin_verification"
    try:
        resp = requests.get(url, params={"gstin": gstin},
                            headers={"X-Cleartax-Auth-Token": token}, timeout=8)
        payload = resp.json()
    except Exception as e:
        logger.warning("cleartax unreachable for %s: %s", gstin, e)
        return None
    if resp.status_code != 200 or not isinstance(payload, dict):
        logger.info("cleartax returned %s for %s", resp.status_code, gstin)
        return None
    # Some deployments wrap the taxpayer object; accept both shapes.
    d = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    if not (d.get("lgnm") or d.get("tradeNam")):
        return None
    return _map_gstn_payload(d)


def _fetch_knowyourgst(gstin: str) -> dict | None:
    """KnowYourGST: GET /developers/gstincall/ with a `passthrough` API key.

    Flat-fee plan with unlimited calls (no per-lookup metering), which suits a
    shop that occasionally onboards many parties at once. Unlike the other two
    it does NOT use GSTN's field names — it returns hyphenated keys and a
    structured address object — so it needs its own mapping.
    """
    key = getattr(settings, "KNOWYOURGST_API_KEY", "")
    if not key:
        return None
    url = getattr(settings, "KNOWYOURGST_API_URL",
                  "https://www.knowyourgst.com/developers/gstincall/")
    try:
        resp = requests.get(url, params={"gstin": gstin},
                            headers={"passthrough": key}, timeout=8)
        d = resp.json()
    except Exception as e:
        logger.warning("knowyourgst unreachable for %s: %s", gstin, e)
        return None
    if resp.status_code != 200 or not isinstance(d, dict):
        logger.info("knowyourgst returned %s for %s", resp.status_code, gstin)
        return None
    if not (d.get("legal-name") or d.get("trade-name")):
        logger.info("knowyourgst had no taxpayer for %s: %s", gstin, str(d)[:120])
        return None

    # Address arrives as an object whose exact keys vary by record; compose
    # from whatever is present rather than assuming a fixed set.
    addr = d.get("address") or {}
    if isinstance(addr, dict):
        ordered = ["bno", "building", "floor", "street", "location", "city",
                   "district", "state", "pincode"]
        seen, parts = set(), []
        for k in ordered:
            v = str(addr.get(k, "") or "").strip()
            if v and v.lower() not in seen:
                seen.add(v.lower())
                parts.append(v)
        for k, v in addr.items():           # anything unexpected, appended once
            v = str(v or "").strip()
            if k not in ordered and v and v.lower() not in seen:
                seen.add(v.lower())
                parts.append(v)
        address = ", ".join(parts)
    else:
        address = str(addr or "")

    return {
        "legal_name": d.get("legal-name", "") or "",
        "trade_name": d.get("trade-name", "") or "",
        "status": d.get("status", "") or "",
        "taxpayer_type": d.get("dealer-type", "") or d.get("entity-type", "") or "",
        "registered_on": d.get("registration-date", "") or "",
        "address": address,
    }


def _fetch_appyflow(gstin: str) -> dict | None:
    """AppyFlow: GET /api/verifyGST?gstNo=&key_secret=.

    50 free lookups on signup — the largest free tier of the lot, which with
    our cache is what makes this feature genuinely free at personal volume.
    Returns taxpayer fields under GSTN-ish names inside a `taxpayerInfo` object.
    """
    key = getattr(settings, "APPYFLOW_KEY_SECRET", "")
    if not key:
        return None
    url = getattr(settings, "APPYFLOW_API_URL", "https://appyflow.in/api/verifyGST")
    try:
        resp = requests.get(url, params={"gstNo": gstin, "key_secret": key}, timeout=8)
        payload = resp.json()
    except Exception as e:
        logger.warning("appyflow unreachable for %s: %s", gstin, e)
        return None
    if resp.status_code != 200 or not isinstance(payload, dict) or payload.get("error"):
        logger.info("appyflow error for %s: %s", gstin, str(payload)[:120])
        return None
    d = payload.get("taxpayerInfo") if isinstance(payload.get("taxpayerInfo"), dict) else payload
    if not (d.get("lgnm") or d.get("tradeNam")):
        return None
    return _map_gstn_payload(d)


_PROVIDERS = {
    "gstincheck": _fetch_gstincheck,
    "cleartax": _fetch_cleartax,
    "knowyourgst": _fetch_knowyourgst,
    "appyflow": _fetch_appyflow,
}


def _fetch_provider(gstin: str) -> dict | None:
    name = (getattr(settings, "GSTIN_PROVIDER", "gstincheck") or "gstincheck").lower()
    fetch = _PROVIDERS.get(name)
    if fetch is None:
        logger.warning("Unknown GSTIN_PROVIDER %r — falling back to derived fields.", name)
        return None
    return fetch(gstin)


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

    fetched = _fetch_provider(g)
    if fetched is not None:
        ttl = int(getattr(settings, "GSTIN_CACHE_SECONDS", _CACHE_TTL_DEFAULT))
        cache.set(_CACHE_PREFIX + g, fetched, ttl)
        return {**result, **fetched, "source": "provider"}

    provider = (getattr(settings, "GSTIN_PROVIDER", "gstincheck") or "gstincheck").lower()
    configured = {
        "gstincheck": getattr(settings, "GSTIN_API_KEY", ""),
        "cleartax": getattr(settings, "CLEARTAX_AUTH_TOKEN", ""),
        "knowyourgst": getattr(settings, "KNOWYOURGST_API_KEY", ""),
        "appyflow": getattr(settings, "APPYFLOW_KEY_SECRET", ""),
    }.get(provider, "")
    if not configured:
        result["hint"] = (
            "State and PAN were derived from the number. For name and address "
            "autofill, set GSTIN_API_KEY (free key: gstincheck.co.in) — or, if "
            "the firm files through ClearTax, set GSTIN_PROVIDER=cleartax with "
            "CLEARTAX_HOST, CLEARTAX_AUTH_TOKEN and CLEARTAX_ENTITY_ID; or "
            "GSTIN_PROVIDER=knowyourgst with KNOWYOURGST_API_KEY for a flat-fee "
            "unlimited plan; or GSTIN_PROVIDER=appyflow with APPYFLOW_KEY_SECRET, "
            "whose 50 free lookups go a long way against the cache."
        )
    return result
