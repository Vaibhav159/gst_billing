"""The GST/report filters, with part 3's exact refusal words."""

import re
from datetime import date

from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from billing.cache import uncached
from billing.fy import fy_of
from billing.models import Business
from billing.params import PICK_A_FIRM, fy_param, id_param
from billing.text import day_text


def report_firm(params, *, required=False):
    identifier = id_param(params, "business_id", PICK_A_FIRM)
    if identifier is None:
        if required or "business_id" in params:
            raise ValidationError({"business_id": [PICK_A_FIRM]})
        return None
    business = uncached(Business).only("id", "name", "gst_number", "state_name", "invoice_prefix").filter(pk=identifier).first()
    if business is None:
        raise NotFound("No such firm.")
    return business


def report_fy(params, *, today=None):
    selected = fy_param(params)
    return selected if selected is not None else fy_of(today or timezone.localdate())


def report_split(params):
    raw = params.get("split", "0")
    if raw not in ("0", "1"):
        raise ValidationError({"split": ["Choose 0 or 1 for split."]})
    return raw == "1"


def report_side(params):
    """Only the HSN report reads it, but every kind refuses an odd value rather than ignoring it."""
    side = params.get("side", "sales")
    if side not in ("sales", "purchases"):
        raise ValidationError({"side": ["Choose sales or purchases."]})
    return side


def report_range(params, *, today=None):
    today = today or timezone.localdate()
    start = date(2022, 4, 1)
    days, errors = {}, {}
    for key, order in (("from", "first"), ("to", "last")):
        raw = params.get(key, "")
        try:
            if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", raw):
                raise ValueError
            days[key] = date.fromisoformat(raw)
        except (TypeError, ValueError):
            errors[key] = [f"Pick the {order} day of the range."]
            continue
        if days[key] < start:
            errors[key] = [f"The app goes back to {day_text(start)}. Pick that day or later."]
        elif days[key] > today:
            errors[key] = [f"That's after today. Pick {day_text(today)} or earlier."]
    if not errors and days["from"] > days["to"]:
        errors["to"] = [f"The range ends before it starts ({day_text(days['from'])}). Pick a later end date."]
    if errors:
        raise ValidationError(errors)
    return days["from"], days["to"]
