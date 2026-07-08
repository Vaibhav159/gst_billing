"""Pure, unit-testable helpers for the Inward Bills module.

Kept free of view/serializer concerns so the tax + validation rules can be
tested in isolation. Only ``find_duplicate`` touches the DB (read-only).
"""

from decimal import Decimal, ROUND_HALF_UP

from billing.constants import INVOICE_TYPE_INWARD

_CENT = Decimal("0.01")


def _r(value):
    """Round to 2 decimals, half-up (GST convention)."""
    return Decimal(value).quantize(_CENT, rounding=ROUND_HALF_UP)


def resolve_tax(taxable, rate, intra):
    """Split a line's tax.

    intra-state -> CGST == SGST == taxable * rate / 2, IGST 0.
    inter-state -> IGST == taxable * rate, CGST == SGST == 0.
    Returns ``(cgst, sgst, igst)`` as 2-dp Decimals.
    """
    taxable = Decimal(taxable)
    rate = Decimal(rate)
    if intra:
        half = _r(taxable * rate / 2)
        return (half, half, Decimal("0.00"))
    return (Decimal("0.00"), Decimal("0.00"), _r(taxable * rate))


def compute_lines(lines, intra, bill_total=None):
    """Compute tax + tax-inclusive amount for each line.

    Each input line is a dict with at least ``taxable`` and ``rate``. Returns
    ``(lines_out, total)`` where every line gains ``cgst/sgst/igst/amount`` and
    ``total == sum(amount)``. When ``bill_total`` is given and differs from the
    natural sum (printed round-off), the difference is absorbed into the last
    line's amount so the stored total matches the printed total to the paisa.
    """
    out = []
    for ln in lines:
        taxable = Decimal(ln["taxable"])
        rate = Decimal(ln["rate"])
        cgst, sgst, igst = resolve_tax(taxable, rate, intra)
        amount = _r(taxable + cgst + sgst + igst)
        out.append(
            {**ln, "taxable": taxable, "rate": rate,
             "cgst": cgst, "sgst": sgst, "igst": igst, "amount": amount}
        )
    total = sum((l["amount"] for l in out), Decimal("0.00"))
    if bill_total is not None and out:
        bill_total = Decimal(bill_total)
        if total != bill_total:
            out[-1]["amount"] = _r(out[-1]["amount"] + (bill_total - total))
            total = sum((l["amount"] for l in out), Decimal("0.00"))
    return out, total


def gstin_matches(bill_gstin, firm_gstin):
    """True only when both GSTINs are present and equal (case-insensitive).

    An empty ``bill_gstin`` (B2C / unregistered bill) never matches — that is
    what the our-GSTIN warning keys off.
    """
    return (
        bool(bill_gstin)
        and bool(firm_gstin)
        and str(bill_gstin).strip().upper() == str(firm_gstin).strip().upper()
    )


def find_duplicate(business, invoice_number):
    """Return an existing inward invoice with this (business, number), or None."""
    from billing.models import Invoice

    return (
        Invoice.objects.defer("source_file", "source_preview")
        .filter(
            business=business,
            invoice_number=invoice_number,
            type_of_invoice=INVOICE_TYPE_INWARD,
        )
        .first()
    )
