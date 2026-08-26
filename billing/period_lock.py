"""Filed-period write guard.

One helper, called from every API path that writes invoice money for a
(business, date): create, update, delete, inward capture, bulk import.
Management commands and repair scripts deliberately bypass this — prod
corrections under explicit permission stay possible; the lock exists to
stop *casual* edits from silently diverging from a filed return.
"""

from rest_framework.exceptions import ValidationError


def locked_period_or_none(business_id, invoice_date):
    """Return the FiledPeriod covering (business, date), or None.

    `invoice_date` may be a date or an ISO "YYYY-MM-DD" string (write
    payloads arrive as strings before serializer validation).
    """
    from billing.models import FiledPeriod

    if not business_id or not invoice_date:
        return None
    if isinstance(invoice_date, str):
        parts = invoice_date.split("-")
        if len(parts) < 2:
            return None
        try:
            year, month = int(parts[0]), int(parts[1])
        except ValueError:
            return None
    else:
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
