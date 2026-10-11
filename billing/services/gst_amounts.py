"""Small Decimal money helpers for GST estimates and immutable figures."""

from datetime import timedelta
from decimal import Decimal

from django.db.models import DecimalField, F, Value
from django.db.models.functions import Abs, Cast, Floor, Round, Sign
from django.utils import timezone

from billing.fy import due_dates
from billing.tax_rules import HEADS, to_paise


def heads(values=None):
    amounts = {head: to_paise((values or {}).get(head, 0)) for head in HEADS}
    return {**amounts, "total": sum(amounts.values(), Decimal("0.00"))}


def add_heads(*values):
    return heads({head: sum((Decimal(str(value.get(head, 0))) for value in values), Decimal(0))
                  for head in HEADS})


def subtract_heads(first, second):
    return add_heads(first, {head: -Decimal(str(second.get(head, 0))) for head in HEADS})


def taxable_expression():
    """Half-up per-line taxable using stored three-place qty/rate, in SQL.

    SQLite's round(1.005, 2) can return 1.00. Multiplying integer thousandths
    first keeps the half-paisa exact on both SQLite and PostgreSQL.
    """
    integer = DecimalField(max_digits=30, decimal_places=0)
    quantity = Cast(Round(F("quantity") * Value(1000), 0), integer)
    rate = Cast(Round(F("rate") * Value(1000), 0), integer)
    return Floor((quantity * rate + Value(5000)) / Value(10000)) * Value(Decimal("0.01"))


def paise_expression(field):
    """Round a stored three-place money column half-up before SQL aggregation."""
    thousandths = Cast(Round(F(field) * Value(1000), 0), DecimalField(max_digits=30, decimal_places=0))
    return Sign(thousandths) * Floor((Abs(thousandths) + Value(5)) / Value(10)) * Value(Decimal("0.01"))


def late_cost(year, month, *, cash, turnover, nil=None, filed=None, today=None):
    """Contract LateCost; a recorded return has zero outstanding late days.

    Notifications 19/2021 and 20/2021 set the central component's caps;
    the app shows the combined CGST and SGST estimate, design 3-D13.
    """
    today = today or timezone.localdate()
    nil, filed = nil or {}, filed or {}
    turnover = Decimal(str(turnover))
    band, cap = ("upto_1.5cr", 2000) if turnover <= 15000000 else (
        ("1.5cr_5cr", 5000) if turnover <= 50000000 else ("over_5cr", 10000))
    due, result = due_dates(year, month), {}
    for kind in ("gstr1", "gstr3b"):
        days = 0 if filed.get(kind) else max(0, (today - due[kind]).days)
        daily, limit = (Decimal(20), Decimal(500)) if nil.get(kind) else (Decimal(50), Decimal(cap))
        result[kind] = {"days": days, "per_day": daily, "cap": limit,
                        "fee": min(days * daily, limit), "capped": days * daily > limit}
    if not any(result[kind]["days"] for kind in ("gstr1", "gstr3b")):
        return None
    base = heads(cash)["total"]
    interest = to_paise(base * Decimal("0.18") * result["gstr3b"]["days"] / Decimal(365))
    return {**result, "interest": interest, "interest_on": base,
            "interest_from": (due["gstr3b"] + timedelta(days=1)).isoformat(), "turnover_band": band,
            "nil": {kind: bool(nil.get(kind)) for kind in ("gstr1", "gstr3b")},
            "total": result["gstr1"]["fee"] + result["gstr3b"]["fee"] + interest}
