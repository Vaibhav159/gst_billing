"""One builder for invoice lines (audit F1).

Invoice create and update, the AI importer, the CSV importer and the model
helper each carried their own copy of "turn a payload into LineItem rows",
with different money contracts: which interstate rule decided the head, whether
the client's amount was trusted, what the default rate was. The same payload
produced different tax heads depending on which door it entered — the
mechanism behind A3, A7 and A11.

There is now one contract:

* direction comes from ``is_interstate(invoice.business, invoice.customer)``;
* the rate goes through the slab allowlist (``normalize_rate``), so a stray
  percent or a pre-fix ``0.25`` cannot bill 25%;
* ``source="form"`` trusts the client's tax-inclusive ``amount`` (checked
  against qty x rate within ``LINE_MONEY_TOLERANCE``) and re-files the
  client's heads on the correct side — the split is advisory;
* every other source derives tax = qty x rate x rate and splits it itself.

Instances are returned unsaved so callers can ``bulk_create`` them and skip the
per-line resync signal; the running total comes back with them.
"""

from __future__ import annotations

from collections.abc import Iterable
from decimal import Decimal
from typing import Literal

from billing.constants import GST_TAX_RATE
from billing.tax_rules import (
    check_line_money,
    is_interstate,
    normalize_rate,
    normalize_tax_heads,
)

Source = Literal["form", "ai", "csv", "api"]

ZERO = Decimal("0")


def _dec(value, default="0") -> Decimal:
    return Decimal(str(value if value not in (None, "") else default))


def rate_for_product(product) -> Decimal:
    """The product master's rate through the allowlist, or the default slab.

    Resolved so a master row still holding a pre-fix ``0.25`` does not put 25%
    tax on a new line.
    """
    if product is None:
        return GST_TAX_RATE
    return normalize_rate(product.gst_tax_rate, assume="fraction")


def build_line_items(
    invoice,
    items: Iterable[dict],
    *,
    source: Source,
    default_rate: Decimal | None = None,
) -> tuple[list, Decimal]:
    """Return ``(unsaved LineItem rows, total)`` for ``items`` on ``invoice``."""
    from billing.models import LineItem  # models imports this module's helper

    interstate = is_interstate(invoice.business, invoice.customer)
    workspace_id = getattr(invoice, "workspace_id", None) or 1
    lines: list = []
    total = ZERO
    for item in items:
        qty = _dec(item.get("quantity"), "1" if source == "form" else "0")
        rate = _dec(item.get("rate"))
        raw_rate = item.get("gst_tax_rate")
        if raw_rate in (None, "", 0, "0") and default_rate is not None:
            raw_rate = default_rate
        gst_rate = normalize_rate(raw_rate or 0, assume="fraction")
        net = qty * rate

        if source == "form":
            amount = _dec(item.get("amount"), str(net))
            check_line_money(item, qty, rate, amount)
            cgst, sgst, igst = normalize_tax_heads(
                _dec(item.get("cgst")), _dec(item.get("sgst")), _dec(item.get("igst")), interstate
            )
        else:
            tax = net * gst_rate
            if interstate:
                cgst, sgst, igst = ZERO, ZERO, tax
            else:
                cgst = sgst = tax / 2
                igst = ZERO
            amount = net + tax

        total += amount
        lines.append(
            LineItem(
                invoice=invoice,
                customer_id=invoice.customer_id,
                workspace_id=workspace_id,
                product_name=(item.get("product_name") or "")[:255] or "Item",
                hsn_code=item.get("hsn_code") or "",
                gst_tax_rate=gst_rate,
                quantity=qty,
                rate=rate,
                cgst=cgst,
                sgst=sgst,
                igst=igst,
                amount=amount,
                unit=item.get("unit") or "gms",
            )
        )
    return lines, total
