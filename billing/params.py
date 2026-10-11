"""Query parameters v3's endpoints share, read once, with the words of their 400s."""

import re
from datetime import date

from django.utils import timezone
from rest_framework.exceptions import ValidationError

from billing.fy import parse_fy
from billing.models import Business

# A firm or customer filter that isn't an id (contract 3.1's words for the firm).
PICK_A_FIRM = "Pick a firm from the list."
PICK_A_CUSTOMER = "Pick a customer from the list."


def fy_param(params):
    """`fy` ("2026-27") as the year it starts; None when absent."""
    if not params.get("fy"):
        return None
    fy = parse_fy(params["fy"])
    if fy is None:
        raise ValidationError({"fy": ["Give the financial year like 2026-27."]})
    return fy


def month_param(params):
    """`month` ("2026-09") as (2026, 9); None when absent."""
    if not params.get("month"):
        return None
    m = re.fullmatch(r"(20\d{2})-(0[1-9]|1[0-2])", params["month"])
    if not m:
        raise ValidationError({"month": ["Give the month like 2026-09."]})
    return int(m.group(1)), int(m.group(2))


def date_param(params, key, today=False):
    """An ISO date parameter; when absent, today in IST if `today`, else None.

    Years 2000 to 2099 only, as `fy` and `month` read them: a financial year can't be worked out for
    the calendar's last year (9999), so a date the books can't hold is refused, never a 500 (Ruling
    1A-5), in words that say which dates it takes (Ruling 1A-28).
    """
    if not params.get(key):
        return timezone.localdate() if today else None
    try:
        day = date.fromisoformat(params[key])
    except ValueError:
        raise ValidationError({key: ["Type the date like 2026-09-30."]}) from None
    if not 2000 <= day.year <= 2099:
        raise ValidationError({key: ["Pick a date from 2000 to 2099."]})
    return day


def text_param(params, key):
    """A text parameter, trimmed, without null characters: psycopg refuses one in a query (Ruling 1A-5)."""
    return (params.get(key) or "").replace("\x00", "").strip()


def id_param(params, key, words):
    """An optional id parameter ("12") as an int; None when absent.

    Plain digits an id column can hold, else a 400 in `words` (Ruling 1A-5): text was a 500 on the
    integer column, and so was a number past its range ("9" * 19 on SQLite).
    """
    raw = params.get(key) or ""
    if not raw:
        return None
    if not (raw.isascii() and raw.isdigit() and len(raw) <= 18):
        raise ValidationError({key: [words]})
    return int(raw)


def firm_param(params):
    """`business_id` as a firm (required). Plain digits only: "²" passes isdigit() but not int() (Ruling 1A-5)."""
    raw = params.get("business_id") or ""
    found = Business.objects.filter(pk=raw).first() if raw.isascii() and raw.isdigit() else None
    if found is None:
        raise ValidationError({"business_id": ["Pick the firm."]})
    return found
