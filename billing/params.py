"""Query parameters v3's endpoints share, read once, with the words of their 400s."""

import re
from datetime import date

from django.utils import timezone
from rest_framework.exceptions import ValidationError

from billing.fy import parse_fy
from billing.models import Business


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
    the calendar's last year (9999), so a date the books can't hold is refused, never a 500 (Ruling 1A-5).
    """
    if not params.get(key):
        return timezone.localdate() if today else None
    try:
        day = date.fromisoformat(params[key])
    except ValueError:
        day = None
    if day is None or not 2000 <= day.year <= 2099:
        raise ValidationError({key: ["Type the date like 2026-09-30."]})
    return day


def firm_param(params):
    """`business_id` as a firm (required). Plain digits only: "²" passes isdigit() but not int() (Ruling 1A-5)."""
    raw = params.get("business_id") or ""
    found = Business.objects.filter(pk=raw).first() if raw.isascii() and raw.isdigit() else None
    if found is None:
        raise ValidationError({"business_id": ["Pick the firm."]})
    return found
