"""Bill numbers: the paper book's series, one per firm per financial year (design §4.4).

Numbers are stored as typed, trimmed. A number is in use while an active or cancelled bill or
a deleted one (in the bin) has it, compared without regard to case; the counter is a number's
trailing digits, and the next number is the series' highest counter + 1, so gaps are never
refilled.
"""

import re

from billing.constants import INVOICE_TYPE_OUTWARD
from billing.fy import fy_label, fy_of, fy_range
from billing.models import BinnedInvoice, Invoice
from billing.refusals import Refusal
from billing.text import day_text, stamp

_TRAILING = re.compile(r"(\d+)\s*$")
# The shapes the next number reads, as v2's next_invoice_number does: "108" and
# "KGH/2026-27/108". Anything else ("P1778291284") would leak a giant counter.
_SERIES_SHAPE = re.compile(r"^(?:\d+|[A-Za-z]+/\d{4}-\d{2}/\d+)\s*$")


def counter_of(number):
    """The number's trailing digits: "KGH/2026-27/108" -> 108, "45" -> 45; None when it has none."""
    m = _TRAILING.search(number or "")
    return int(m.group(1)) if m else None


def format_number(business, day, typed):
    """What a typed number is stored as: trimmed."""
    return (typed or "").strip()


def series_bills(business_id, fy):
    """The firm's sales in that FY, any status."""
    start, end = fy_range(fy)
    return Invoice.objects.sales().filter(business_id=business_id, invoice_date__range=(start, end))


def series_bin(business_id, fy):
    """The firm's deleted sales of that FY still in the bin (not ones v2's undo brought back: Ruling 1A-6)."""
    start, end = fy_range(fy)
    return BinnedInvoice.objects.live().filter(business_id=business_id, type_of_invoice=INVOICE_TYPE_OUTWARD,
                                               invoice_date__range=(start, end))


def next_counter(business_id, fy):
    """The highest counter in the series (active, cancelled and deleted bills) + 1."""
    numbers = [*series_bills(business_id, fy).values_list("invoice_number", flat=True),
               *series_bin(business_id, fy).values_list("invoice_number", flat=True)]
    counters = [counter_of(n) for n in numbers if _SERIES_SHAPE.match(n or "")]
    return max(counters, default=0) + 1


def next_number(business, day):
    """{"counter", "invoice_number"}: the next free number on that date, as it would be stored."""
    counter = next_counter(business.pk, fy_of(day))
    return {"counter": counter, "invoice_number": format_number(business, day, str(counter))}


def holder(business_id, fy, number, exclude_invoice=None, exclude_bin=None):
    """The bill (Invoice) or deleted bill (BinnedInvoice) that has `number` in the series, or None."""
    number = (number or "").strip()
    if not number:
        return None
    bills = series_bills(business_id, fy).filter(invoice_number__iexact=number).select_related("customer")
    if exclude_invoice:
        bills = bills.exclude(pk=exclude_invoice)
    found = bills.first()
    if found is None:
        binned = series_bin(business_id, fy).filter(invoice_number__iexact=number)
        if exclude_bin:
            binned = binned.exclude(pk=exclude_bin)
        found = binned.first()
    return found


def bill_ref(invoice):
    """A bill named in another answer: {"id", "invoice_number", "invoice_date", "customer_name", "status"}."""
    return {"id": invoice.pk, "invoice_number": invoice.invoice_number, "invoice_date": invoice.invoice_date.isoformat(),
            "customer_name": invoice.customer.name, "status": invoice.status}


def refuse_taken(business, day, number, exclude_invoice=None, exclude_bin=None):
    """409 number_taken or number_deleted when `number` is in use in the firm's series for `day`."""
    fy = fy_of(day)
    found = holder(business.pk, fy, number, exclude_invoice, exclude_bin)
    if found is None:
        return
    following = next_number(business, day)
    if isinstance(found, Invoice):
        raise Refusal(
            f"{found.invoice_number} is already used in FY {fy_label(fy)} by {found.customer.name}'s bill of "
            f"{day_text(found.invoice_date)}. The next free number is {following['invoice_number']}.",
            "number_taken", bill=bill_ref(found), next=following,
        )
    raise Refusal(
        f"{found.invoice_number} belonged to a bill that was deleted (it can be restored from the Audit log), "
        f"so it can't be used again. The next free number is {following['invoice_number']}.",
        "number_deleted", next=following,
        binned={"id": found.pk, "original_id": found.original_id, "invoice_number": found.invoice_number,
                "invoice_date": found.invoice_date.isoformat(), "reason": found.reason,
                "deleted_at": stamp(found.deleted_at)},
    )
