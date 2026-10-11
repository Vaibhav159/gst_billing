"""The shop's quotes. A board is a reference, never a bill's typed rate."""
import json
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from django.conf import settings
from rest_framework.exceptions import ValidationError

from billing.cache import uncached
from billing.models import RateBoard
from billing.text import money, person, stamp

RATE_ROWS = json.loads((settings.BASE_DIR / "web/src/core/rates/rows.json").read_text())


def per_gram(quoted, row):
    return (Decimal(quoted[row["key"]]) / row["per"]).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)


def boards():
    return uncached(RateBoard).select_related("set_by").only(
        "on", "quoted", "set_at", "set_by__first_name", "set_by__last_name", "set_by__username")


def latest():
    return boards().first()


def previous(board):
    return boards().filter(on__lt=board.on).first() if board else None


def in_force(day):
    return boards().filter(on__lte=day).first()


def board_row(board):
    if board is None:
        return None
    return {"id": board.pk, "on": board.on.isoformat(), "set_at": stamp(board.set_at),
            "set_by": person(board.set_by), "quoted": board.quoted,
            "per_gram": {r["key"]: str(per_gram(board.quoted, r)) for r in RATE_ROWS}}


def read_quotes(body):
    raw = body.get("quoted") if isinstance(body, dict) else None
    if not isinstance(raw, dict):
        raise ValidationError({"quoted": ["Send the rates."]})
    errors = {key: [f"The board has no row {key}."] for key in raw if key not in {r["key"] for r in RATE_ROWS}}
    quoted = {}
    for row in RATE_ROWS:
        key, value = row["key"], raw.get(row["key"])
        error = None
        if value is None or (isinstance(value, str) and not value.strip()):
            error = f"Type the {row['label']} rate per {row['per_label']}."
        else:
            try:
                if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
                    raise InvalidOperation
                amount = Decimal(str(value))
                if not amount.is_finite() or amount <= 0:
                    raise InvalidOperation
                if amount > Decimal("9999999.99"):
                    error = f"That's more than ₹99,99,999.99 per {row['per_label']}."
                elif amount.as_tuple().exponent < -2:
                    raise InvalidOperation
                else:
                    quoted[key] = money(amount)
            except (InvalidOperation, ValueError):
                error = "That's not an amount."
        if error:
            errors[key] = [error]
    if errors:
        raise ValidationError({"quoted": errors})
    return quoted


def firm_short(business):
    """Mirror scope.tsx shortName, with part 4's explicit short name taking priority."""
    explicit = getattr(business, "short_name", "")
    first = business.name.strip().split()
    return explicit or (first[0][:1].upper() + first[0][1:].lower() if first else business.name)


def rate_key(product):
    # Part 4A owns inference; imported only when a product consumer calls this.
    from billing.services.catalog import effective_kind
    key = f"{effective_kind(product)}-{product.purity}"
    return key if key in {r["key"] for r in RATE_ROWS} else None


def rate_for(product, day):
    key = rate_key(product)
    board = in_force(day) if key else None
    row = next((r for r in RATE_ROWS if r["key"] == key), None)
    return per_gram(board.quoted, row) if board else None
