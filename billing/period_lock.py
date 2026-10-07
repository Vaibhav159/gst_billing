"""Filed-period write guard.

One helper, called from every API path that writes invoice money for a
(business, date): create, update, delete, inward capture, bulk import.
Management commands and repair scripts deliberately bypass this — prod
corrections under explicit permission stay possible; the lock exists to
stop *casual* edits from silently diverging from a filed return.
"""

from django.utils.dateparse import parse_date
from rest_framework.exceptions import ValidationError


def locked_period_or_none(business_id, invoice_date):
    """Return the FiledPeriod covering (business, date), or None.

    `invoice_date` may be a date or a string (write payloads arrive as strings
    before serializer validation). Strings are read with the parser DRF and the
    model use, so the month checked is the month that gets stored: splitting on
    "-" let 20260715 and 2026-W29-3, which both store as 15 July, into a filed
    July (H4). A string that won't parse is refused, never waved through.
    """
    from billing.models import FiledPeriod

    if not business_id or not invoice_date:
        return None
    if isinstance(invoice_date, str):
        try:
            parsed = parse_date(invoice_date.strip())
        except ValueError:
            parsed = None
        if parsed is None:
            raise ValidationError({"invoice_date": f"{invoice_date!r} is not a date (expected YYYY-MM-DD)."})
        invoice_date = parsed
    year, month = invoice_date.year, invoice_date.month
    return FiledPeriod.objects.filter(
        business_id=business_id, year=year, month=month
    ).first()


def assert_period_unlocked(business_id, invoice_date, action="change"):
    """Raise a DRF ValidationError when the period is filed-and-locked."""
    period = locked_period_or_none(business_id, invoice_date)
    if period is None:
        return
    raise ValidationError(
        {
            "detail": (
                f"{period.month:02d}/{period.year} is filed and locked for "
                f"{period.business.name} — this {action} would make the books "
                "disagree with the filed return. Unlock the month on the GST "
                "page first (the unlock is audit-logged)."
            ),
            "locked_period": {
                "id": period.id,
                "business": period.business_id,
                "year": period.year,
                "month": period.month,
            },
        }
    )
