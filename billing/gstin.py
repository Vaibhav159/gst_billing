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
_CACHE_TTL = 60 * 60 * 24 * 30


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


def _fetch_provider(gstin: str) -> dict | None:
    """gstincheck.co.in: GET {base}/{key}/{gstin} → GSTN-standard payload.
    Returns the mapped dict, or None when unavailable (no key, timeout, error).
    """
    key = getattr(settings, "GSTIN_API_KEY", "")
    if not key:
        return None
    base = getattr(settings, "GSTIN_API_URL", "https://sheet.gstincheck.co.in/check")
    try:
        resp = requests.get(f"{base}/{key}/{gstin}", timeout=6)
        payload = resp.json()
    except Exception as e:
        logger.warning("GSTIN provider unreachable for %s: %s", gstin, e)
        return None
    if not payload.get("flag") or not isinstance(payload.get("data"), dict):
        logger.info("GSTIN provider returned no data for %s: %s",
                    gstin, str(payload.get("message"))[:120])
        return None
    d = payload["data"]
    return {
        "legal_name": d.get("lgnm", "") or "",
        "trade_name": d.get("tradeNam", "") or "",
        "status": d.get("sts", "") or "",
        "taxpayer_type": d.get("dty", "") or "",
        "registered_on": d.get("rgdt", "") or "",
        "address": _compose_address(d.get("pradr")),
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

    fetched = _fetch_provider(g)
    if fetched is not None:
        cache.set(_CACHE_PREFIX + g, fetched, _CACHE_TTL)
        return {**result, **fetched, "source": "provider"}

    if not getattr(settings, "GSTIN_API_KEY", ""):
        result["hint"] = (
            "State and PAN were derived from the number. For name and address "
            "autofill, add GSTIN_API_KEY to .env (free key: gstincheck.co.in)."
        )
    return result
