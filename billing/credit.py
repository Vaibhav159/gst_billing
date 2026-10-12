"""Purchase credit periods; Sec 16(4) lapse is the 3A ledger's rule (R3A-9)."""
import re
from datetime import date
from decimal import Decimal

from django.db.models import BooleanField, DateField, F, Sum, Value
from django.db.models.functions import Cast, Coalesce, TruncMonth
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from billing.cache import uncached
from billing.fy import fy_of
from billing.models import Business, Invoice, LineItem
from billing.period_lock import assert_purchase_open, closed_credit_months, credit_month_closed
from billing.services.ledger import _credit_lapse
from billing.text import day_text

UNSET = object()
LEDGER_START = date(2025, 4, 1)


def credit_month_of(invoice):
    return None if invoice.invoice_date < LEDGER_START else invoice.itc_month or invoice.invoice_date.replace(day=1)


def credit_deadline(bill_date):
    return date(fy_of(bill_date) + 1, 11, 30)


def last_credit_month(bill_date):
    return date(fy_of(bill_date) + 1, 10, 1)


def with_credit_lapse(bills, today=None):
    """Annotate bills with the ledger's `lapsed` and their credit month's GSTR-3B day `claimed_on`."""
    # Postgres truncates a date to a timestamp; the month stays a date key for callers.
    return _credit_lapse(bills.annotate(credit_month=Coalesce("itc_month", Cast(TruncMonth("invoice_date"), DateField())),
                                        credit_eligible=F("itc_eligible")), today=today, bill="")


def credit_lapses(invoices, today=None):
    """One read for a page: {bill id: (lapsed, GSTR-3B filed_on)} from the saved bills."""
    ids = [bill.pk for bill in invoices if bill.pk]
    if not ids:
        return {}
    rows = with_credit_lapse(uncached(Invoice).filter(pk__in=ids), today).values_list("pk", "lapsed", "claimed_on")
    return {pk: (lapsed, filed_on) for pk, lapsed, filed_on in rows}


def credit_lapse(invoice, today=None):
    """(lapsed, GSTR-3B filed_on) for one bill's in-memory date, credit month and eligibility."""
    month = credit_month_of(invoice)
    if month is None:
        return False, None
    one = uncached(Business).filter(pk=invoice.business_id).annotate(
        bill_invoice_date=Value(invoice.invoice_date, output_field=DateField()), bill_business_id=F("pk"),
        credit_month=Value(month, output_field=DateField()),
        credit_eligible=Value(bool(invoice.itc_eligible), output_field=BooleanField()))
    return _credit_lapse(one, today=today, bill="bill_").values_list("lapsed", "claimed_on").first() or (False, None)


def credit_lapsed(invoice, today=None, lapse=None):
    month = credit_month_of(invoice)
    if month is None or not invoice.itc_eligible:
        return False
    tax = getattr(invoice, "_purchase_tax", None)
    if tax is None:
        sums = uncached(LineItem).filter(invoice_id=invoice.pk).aggregate(cgst=Sum("cgst"), sgst=Sum("sgst"), igst=Sum("igst"))
        tax = sum((value or Decimal("0") for value in sums.values()), Decimal("0"))
    # A zero/negative historical subtotal has no credit to lose.
    return tax > 0 and (lapse or credit_lapse(invoice, today))[0]


def next_month(month):
    return date(month.year + (month.month == 12), month.month % 12 + 1, 1)


def open_credit_months(business_id, bill_date, today=None):
    today = today or timezone.localdate()
    if bill_date > today:
        raise ValidationError({"invoice_date": [f"That's after today ({day_text(today)}). Check the date on the bill."]})
    if bill_date < LEDGER_START:
        return []
    closed = closed_credit_months([business_id])
    month, end = bill_date.replace(day=1), today.replace(day=1)
    result = []
    while month <= end:
        if (business_id, month.year, month.month) not in closed:
            result.append(month)
        month = next_month(month)
    return result


def default_credit_month(business_id, bill_date, today=None):
    if bill_date < LEDGER_START:
        return None, False
    today = today or timezone.localdate()
    options = open_credit_months(business_id, bill_date, today)
    if not options:
        assert_purchase_open(business_id, today.replace(day=1), "create")
        raise ValidationError({"invoice_date": ["Type the date like 2026-09-30."]})
    chosen = options[0]
    return (None if chosen == bill_date.replace(day=1) else chosen,
            chosen > last_credit_month(bill_date))


def check_credit_month(business_id, bill_date, month, today=None, action="create"):
    today = today or timezone.localdate()
    if not isinstance(month, date):
        if not isinstance(month, str) or not re.fullmatch(r"20\d{2}-(0[1-9]|1[0-2])", month):
            raise ValidationError({"itc_month": ["Give the month like 2026-09."]})
        month = date.fromisoformat(month + "-01")
    if month.day != 1:
        raise ValidationError({"itc_month": ["Give the month like 2026-09."]})
    if month < LEDGER_START:
        raise ValidationError({"itc_month": ["The credit ledger starts in April 2025. Pick April 2025 or later."]})
    if month < bill_date.replace(day=1):
        raise ValidationError({"itc_month": [f"The credit can't go in a month before the bill's date ({bill_date:%B %Y})."]})
    if month > today.replace(day=1):
        raise ValidationError({"itc_month": [f"{month:%B %Y} hasn't started yet. Pick a month up to this one."]})
    assert_purchase_open(business_id, month, action)
    last = last_credit_month(bill_date)
    if month > last and any(option <= last for option in open_credit_months(business_id, bill_date, today)):
        deadline = credit_deadline(bill_date)
        raise ValidationError({"itc_month": [(f"{month:%B %Y}'s GSTR-3B is due after the last day for this bill's credit "
                                             f"({deadline:%d %b %Y}). Pick {last:%B %Y} or earlier.")]})
    return month


def choose_credit_month(business, day, value=UNSET, *, invoice=None, today=None):
    business_id = getattr(business, "pk", business)
    if day < LEDGER_START:
        if value is not UNSET and value is not None:
            raise ValidationError({"itc_month": ["This bill is before April 2025. Its credit is in the opening balance or lapsed; leave the credit month blank."]})
        return None
    if value is UNSET and invoice is not None and invoice.business_id == business_id and invoice.invoice_date == day:
        return invoice.itc_month
    if value is UNSET or value is None:
        return default_credit_month(business_id, day, today)[0]
    month = check_credit_month(business_id, day, value, today, action="edit" if invoice else "create")
    return None if month == day.replace(day=1) else month


def credit_month_choices(business, day, today=None):
    today = today or timezone.localdate()
    business_id = getattr(business, "pk", business)
    options = open_credit_months(business_id, day, today)
    own = day.replace(day=1)
    last = last_credit_month(day)
    # No open return is an informative form state; saving will return month_closed.
    chosen = options[0] if options else None
    return {"bill_month": own.strftime("%Y-%m"), "bill_month_closed": day >= LEDGER_START and credit_month_closed(business_id, own),
            "default": chosen.strftime("%Y-%m") if chosen else None,
            "options": [{"month": option.strftime("%Y-%m"), "due": next_month(option).replace(day=20).isoformat(),
                         "running": option == today.replace(day=1), "in_time": option <= last} for option in options],
            "deadline": credit_deadline(day).isoformat(), "lapsed": day >= LEDGER_START and not any(option <= last for option in options)}
