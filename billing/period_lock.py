"""Filed-period write guard.

One helper, called from every API path that writes invoice money for a
(business, date): create, update, delete, inward capture, bulk import.
Management commands and repair scripts deliberately bypass this — prod
corrections under explicit permission stay possible; the lock exists to
stop *casual* edits from silently diverging from a filed return.
"""

from datetime import date

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
    # The firm comes in the same query: a refusal names it, and a firm read on its own would go through cacheops
    # (Ruling 1A-34).
    return FiledPeriod.objects.select_related("business").filter(
        business_id=business_id, year=year, month=month
    ).first()


def assert_period_unlocked(business_id, invoice_date, action="change", *, invoice_type="outward"):
    """Keep v2's refusal shape; GSTR-1 closes sales, while purchases keep the 3B guard."""
    period = locked_period_or_none(business_id, invoice_date)
    if period is None and invoice_type == "outward" and business_id and invoice_date:
        from types import SimpleNamespace

        from billing.cache import uncached
        from billing.models import Business

        day = parse_date(invoice_date.strip()) if isinstance(invoice_date, str) else invoice_date
        business_id = int(business_id)
        if sales_month_closed(business_id, day):
            period = SimpleNamespace(id=None, business_id=business_id, year=day.year, month=day.month,
                                     business=uncached(Business).get(pk=business_id))
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


# What a closed month refuses, per sales write (part 1 API contract, section 1).
CLOSED_WORDS = {
    "create": "no bill can go into it",
    "edit": "its bills can't be changed",
    "cancel": "its bills can't be cancelled",
    "delete": "its bills can't be deleted",
    "restore": "a deleted bill can't go back into it",
    "renumber": "its bills can't be renumbered",
    "move": "its bills can't move to another firm",
    "merge": "its bills can't move to another customer",
    "backup_restore": "a bill from the backup can't go into it",
}


def assert_sales_open(business, day, action="edit"):
    """Read-only guard; write callers acquire bill then firm locks before checking."""
    from billing.cache import uncached
    from billing.models import Business
    from billing.refusals import Refusal

    business_id = getattr(business, "pk", business)
    if isinstance(day, str):
        day = parse_date(day)
    if not sales_month_closed(business_id, day):
        return
    status = month_status(business_id, day.year, day.month)
    name = business.name if hasattr(business, "name") else uncached(Business).values_list("name", flat=True).get(pk=business_id)
    label = day.strftime("%B %Y")
    if status.stage == "gstr1":
        words = (f"{label}'s GSTR-1 is filed for {name}, so {CLOSED_WORDS[action]}. "
                 f"Have the owner unlock {label}'s sales bills in GST returns first.")
    else:
        words = (f"{label} is filed and locked for {name}, so {CLOSED_WORDS[action]}. "
                 f"Have the owner unlock {label} in GST returns first.")
    raise Refusal(words, "month_closed", stage=status.stage,
                  locked_period={"id": status.locked_period_id, "business": business_id, "year": day.year, "month": day.month})


def _month(value):
    return (value.year, value.month) if isinstance(value, date) else tuple(value)


def closed_credit_months(business_ids):
    from billing.cache import uncached
    from billing.models import FiledPeriod
    return set(uncached(FiledPeriod).filter(business_id__in=business_ids).values_list("business_id", "year", "month"))


def credit_month_closed(business_id, month):
    from billing.cache import uncached
    from billing.models import FiledPeriod
    year, number = _month(month)
    return uncached(FiledPeriod).filter(business_id=business_id, year=year, month=number).exists()


def closed_months(business_ids, month=None):
    """One SQL UNION: legacy/3B locks plus GSTR-1 without an open unlock; month=(year, month) reads one."""
    business_ids = list(business_ids)
    if not business_ids:
        return set()
    from django.db.models import Exists, OuterRef

    from billing.cache import uncached
    from billing.models import FiledPeriod, FilingMonth, FilingRecord
    unlocked = uncached(FilingMonth).filter(business_id=OuterRef("business_id"), year=OuterRef("year"),
                                            month=OuterRef("month"), unlocked_at__isnull=False)
    records = uncached(FilingRecord).filter(business_id__in=business_ids, kind="gstr1").exclude(Exists(unlocked))
    locks = uncached(FiledPeriod).filter(business_id__in=business_ids)
    if month is not None:
        records, locks = (rows.filter(year=month[0], month=month[1]) for rows in (records, locks))
    combined = locks.values_list("business_id", "year", "month").union(records.values_list("business_id", "year", "month"))
    # PostgreSQL parenthesizes UNION arms. Keep a plain outer SELECT for read-only
    # query instrumentation; the derived table contains only these three columns.
    from django.db import connection

    sql, params = combined.query.sql_with_params()
    with connection.cursor() as cursor:
        cursor.execute(f"SELECT * FROM ({sql}) AS sales_closed_months", params)
        return set(cursor.fetchall())


def sales_month_closed(business_id, day):
    return (business_id, *_month(day)) in closed_months([business_id], month=_month(day))


def next_open_credit_month(business_id, from_month, today=None):
    from django.utils import timezone

    from billing.cache import uncached
    from billing.models import FiledPeriod
    start = max(date(2025, 4, 1), date(*_month(from_month), 1))
    today = today or timezone.localdate()
    closed = set(uncached(FiledPeriod).filter(business_id=business_id, year__gte=start.year,
                                               year__lte=today.year).values_list("year", "month"))
    current = start
    while current <= today and (current.year, current.month) in closed:
        current = date(current.year + (current.month == 12), current.month % 12 + 1, 1)
    return current


from dataclasses import dataclass


@dataclass(frozen=True)
class MonthStatus:
    stage: str
    sales_closed: bool
    credit_closed: bool
    gstr1: object = None
    gstr1a: object = None
    gstr3b: object = None
    legacy: bool = False
    unlocked: object = None
    locked_period_id: int | None = None


def month_status(business_id, year, month, *, include_checks=True):
    """Two narrow state reads, plus one aggregate for an unfiled past month."""
    from django.db.models import OuterRef, Subquery
    from django.utils import timezone

    from billing.cache import uncached
    from billing.models import Business, FiledPeriod, FilingMonth, FilingRecord
    rows = {row.kind: row for row in uncached(FilingRecord).filter(business_id=business_id, year=year, month=month)
            .only("id", "business_id", "year", "month", "kind", "filed_on", "marked_by_id", "marked_at")}
    periods = uncached(FiledPeriod).filter(business_id=OuterRef("pk"), year=year, month=month)
    months = uncached(FilingMonth).filter(business_id=OuterRef("pk"), year=year, month=month)
    fields = ("id", "unlocked_at", "unlocked_by_id", "unlock_reason", "relocked_at", "relocked_by_id", "legacy_frozen_at")
    annotations = {f"state_{field}": Subquery(months.values(field)[:1]) for field in fields}
    info = uncached(Business).filter(pk=business_id).annotate(
        lock_id=Subquery(periods.values("pk")[:1]), lock_note=Subquery(periods.values("note")[:1]),
        **annotations).values("lock_id", "lock_note", *annotations).first() or {}
    lock_id = info.get("lock_id")
    unlock = FilingMonth(business_id=business_id, year=year, month=month,
                         **{field: info[f"state_{field}"] for field in fields}) if info.get("state_id") else None
    unlocked = unlock if unlock and unlock.unlocked_at else None
    today = timezone.localdate().replace(day=1)
    key = date(year, month, 1)
    from billing.constants import ROLLBACK_GSTR1_LOCK
    legacy = bool("gstr3b" not in rows and ((lock_id and info["lock_note"] != ROLLBACK_GSTR1_LOCK)
                                          or (unlock and unlock.legacy_frozen_at)))
    if unlocked:
        stage = "unlocked"
    elif lock_id:
        stage = "filed"
    elif "gstr1" in rows:
        stage = "gstr1"
    else:
        stage = "future" if key > today else "open" if key == today else "ready"
        if stage == "ready" and include_checks:
            from billing.services.gst_checks import gstr1_blockers
            blockers = gstr1_blockers([business_id], [f"{year}-{month:02}"])
            if blockers.get((business_id, f"{year}-{month:02}"), {}).get("count", 0):
                stage = "blocked"
    return MonthStatus(stage, stage in ("filed", "gstr1"), bool(lock_id), rows.get("gstr1"), rows.get("gstr1a"),
                       rows.get("gstr3b"), legacy, unlocked, lock_id)


CREDIT_CLOSED_WORDS = {
    "create": "so a bill can't put its credit there.",
    "edit": "with this bill's credit in it, so it can't be changed.",
    "files": "with this bill's credit in it, so it can't be changed.",
    "checked": "with this bill's credit in it, so it can't be changed.",
    "credit-month": "with this bill's credit in it, so its credit can't move.",
    "delete": "with this bill's credit in it, so it can't be deleted.",
    "restore": "so a deleted bill can't go back into it.",
}


def assert_purchase_open(business, month, action="edit"):
    from billing.cache import uncached
    from billing.models import Business, FiledPeriod
    from billing.refusals import Refusal
    business_id = getattr(business, "pk", business)
    if month is None:
        return
    if not credit_month_closed(business_id, month):
        return
    name = business.name if isinstance(business, Business) else uncached(Business).filter(pk=business_id).values_list("name", flat=True).first()
    period_id = uncached(FiledPeriod).filter(business_id=business_id, year=month.year, month=month.month).values_list("id", flat=True).first()
    label = month.strftime("%B %Y")
    raise Refusal(f"{label}'s GSTR-3B is filed for {name}, {CREDIT_CLOSED_WORDS[action]} "
                  f"Have the owner unlock {label} in GST returns first.", "month_closed",
                  locked_period={"id": period_id, "business": business_id, "year": month.year, "month": month.month})


def assert_inward_unlocked(invoice, new_date=None):
    assert_period_unlocked(invoice.business_id, invoice.invoice_date, "edit", invoice_type="inward")
    if getattr(invoice, "itc_month", None):
        assert_period_unlocked(invoice.business_id, invoice.itc_month, "edit", invoice_type="inward")
    if new_date:
        assert_period_unlocked(invoice.business_id, new_date, "edit", invoice_type="inward")


def lock_legacy_invoice(invoice, *target_business_ids):
    """Inside the caller's transaction, lock the stored bill before its firms.

    Return the fresh row so a v3 move completed before this lock cannot leave a legacy
    write checking the old firm/month. New invoices have no row to lock yet.
    """
    from billing.cache import uncached
    from billing.models import Invoice
    from billing.numbering import lock_firms

    stored = uncached(Invoice).select_for_update().get(pk=invoice.pk) if invoice.pk else invoice
    lock_firms(stored.business_id, *target_business_ids)
    return stored
