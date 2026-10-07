"""Pure, unit-testable helpers for the Inward Bills module.

Kept free of view/serializer concerns so the tax + validation rules can be
tested in isolation. Only ``find_duplicate`` touches the DB (read-only).
"""

import re
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.db.models.functions import Trim, Upper

from billing.constants import INVOICE_TYPE_INWARD
from billing.tax_rules import clean_gstin

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
    total = sum((line["amount"] for line in out), Decimal("0.00"))
    if bill_total is not None and out:
        bill_total = Decimal(bill_total)
        if total != bill_total:
            out[-1]["amount"] = _r(out[-1]["amount"] + (bill_total - total))
            total = sum((line["amount"] for line in out), Decimal("0.00"))
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


def gstin_conflict(party, gstin):
    """Why a bill carrying `gstin` can't be booked on `party`, found by name.

    A trade name can hold a registration in each state, and a scan can misread
    a GSTIN. Booked on a record with another GSTIN, the bill's head and its
    credit followed that GSTIN instead of the bill's (review of M26).
    """
    on_file = clean_gstin(getattr(party, "gst_number", ""))
    gstin = clean_gstin(gstin)
    if gstin and on_file and gstin != on_file:
        return (
            f"{party.name} is on file with GSTIN {on_file}, but this bill's GSTIN is {gstin}. "
            "If the GSTIN was misread, correct it; if this is another branch, give the supplier its own name."
        )
    return None


def inward_number_key(number):
    """A supplier's bill number spelt one way: upper-case letters and digits.

    "SJ-101" typed on the inward form and "SJ/101" read by AI or the GSTR-2A
    file are the same bill (M28). A separator between two digits is kept, as
    "-": with every separator stripped, 12-3 and 1-23 were one bill.
    """
    marked = re.sub(r"(?<=\d)[^0-9A-Z]+(?=\d)", "\0", str(number or "").upper())
    return re.sub(r"[^0-9A-Z\0]", "", marked).replace("\0", "-")


def supplier_key(supplier):
    """Who issued a bill: the supplier's GSTIN, or its record when it has none.

    By GSTIN so the same registration on two customer records (made by two
    different import paths) is one supplier.
    """
    gstin = clean_gstin(getattr(supplier, "gst_number", ""))
    return ("gstin", gstin) if gstin else ("id", supplier.pk)


def fy_start(day):
    """1 April of the financial year `day` falls in, or None when it won't parse."""
    if isinstance(day, str):
        from django.utils.dateparse import parse_date

        try:
            day = parse_date(day.strip())
        except ValueError:
            day = None
    if not day:
        return None
    return date(day.year if day.month >= 4 else day.year - 1, 4, 1)


def find_duplicate(business, invoice_number, supplier=None, invoice_date=None):
    """Return an existing purchase that is really the same bill, or None.

    The one rule for every inward door: inward bills, AI import, GSTR-2A
    import and bulk import each had their own, so "SJ-101" from one and
    "SJ/101" from another both counted, ITC and all (M28). Same business, same
    supplier (supplier_key), the same number once spelt one way, the same FY.
    Supplier numbering is the supplier's own: two suppliers' "001" are two
    bills, and so is next year's "001" when a series restarts in April.
    """
    from billing.models import Invoice

    key = inward_number_key(invoice_number)
    if not key:
        return None
    qs = Invoice.objects.defer("source_file", "source_preview").filter(
        business=business, type_of_invoice=INVOICE_TYPE_INWARD,
    )
    if supplier is not None:
        kind, value = supplier_key(supplier)
        if kind == "gstin":
            # As clean_gstin reads it: a GSTIN on file with stray spaces is the same supplier.
            qs = qs.annotate(supplier_gstin=Upper(Trim("customer__gst_number"))).filter(supplier_gstin=value)
        else:
            qs = qs.filter(customer=supplier)
    start = fy_start(invoice_date) if invoice_date else None
    if start:
        qs = qs.filter(invoice_date__range=(start, date(start.year + 1, 3, 31)))
    return next((inv for inv in qs.order_by("id") if inward_number_key(inv.invoice_number) == key), None)
