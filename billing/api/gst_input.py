"""GST query and opening-credit inputs, with the contract's field errors."""

import re
from datetime import date
from decimal import Decimal, InvalidOperation

from rest_framework.exceptions import NotFound, ValidationError

from billing.cache import uncached
from billing.models import Business
from billing.tax_rules import to_paise

FIRM_FIELDS = ("id", "name", "gst_number", "state_name", "invoice_prefix")
MONTH_WORDS = "Give the month like 2026-09."


def month_input(data, key="month"):
    raw = data.get(key) if isinstance(data, dict) else None
    match = re.fullmatch(r"(20[0-9]{2})-(0[1-9]|1[0-2])", raw) if isinstance(raw, str) else None
    if not match:
        raise ValidationError({key: [MONTH_WORDS]})
    value = date(int(match[1]), int(match[2]), 1)
    if value < date(2025, 4, 1):
        raise ValidationError({key: ["The app's GST records start in April 2025."]})
    return value


def firm_input(data, key="business_id"):
    raw = data.get(key) if isinstance(data, dict) else None
    if isinstance(raw, int) and not isinstance(raw, bool):
        raw = str(raw)
    if not (isinstance(raw, str) and raw.isascii() and raw.isdigit() and len(raw) <= 18):
        raise ValidationError({key: ["Pick a firm from the list."]})
    business = uncached(Business).only(*FIRM_FIELDS).filter(pk=int(raw)).first()
    if business is None:
        raise NotFound("No such firm.")
    return business


def opening_heads(data):
    values, errors = {}, {}
    for key in ("igst", "cgst", "sgst"):
        raw = data.get(key) if isinstance(data, dict) else None
        try:
            value = Decimal(str(raw)) if isinstance(raw, (str, int, float)) and not isinstance(raw, bool) else None
        except InvalidOperation:
            value = None
        if value is None or not value.is_finite() or value.copy_abs() > Decimal("999999999999.99") or value != to_paise(value):
            errors[key] = [f"Type the {key.upper()} balance, or 0."]
        elif value < 0:
            errors[key] = ["A credit balance can't be below zero."]
        else:
            values[key] = to_paise(value)
    if errors:
        raise ValidationError(errors)
    return values
