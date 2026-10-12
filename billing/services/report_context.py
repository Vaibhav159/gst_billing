"""Join 3B projections to the purchase and GST services, without another money engine."""

from datetime import date

from django.db.models import Q
from django.utils import timezone

from billing.cache import uncached
from billing.fy import fy_label, fy_range
from billing.models import Business, FiledPeriod, FilingRecord
from billing.services.filing import changes_since_filing, filed_figures, filing_data, month_stages, records_with_people
from billing.services.gst_reads import wire
from billing.services.gstr1_file import build_gstr1
from billing.services.ledger import gstr3b_tables, ledger
from billing.services.v3_credit import credit_data, on_record_months
from billing.services.v3_reconciliation import reconcile
from billing.services.v3_reports import (
    amounts,
    build_report,
    ca_workbook,
    load_register,
    load_sales,
    months_between,
    tax_span,
)
from billing.tax_rules import HEADS

COLUMNS = ("taxable", *HEADS)
FIRM_FIELDS = ("id", "name", "gst_number", "state_name", "invoice_prefix")


def credit_payload(business, fy):
    from billing.api.gst import opening_data
    return credit_data(business, fy, opening=opening_data(business))


def _fy_filter(fy):
    return Q(year=fy, month__gte=4) | Q(year=fy + 1, month__lte=3)


def _filed_totals(business, fy, sales):
    """3A's as-filed figures; legacy locks without a saved snapshot still hold their unchanged books."""
    totals, amended_in = filed_figures(business, fy)
    for year, number in uncached(FiledPeriod).filter(_fy_filter(fy), business_id=business.pk).values_list("year", "month"):
        month = f"{year:04d}-{number:02d}"
        if "gstr1" not in totals.get(month, {}) or "gstr3b" not in totals.get(month, {}):
            books = amounts([bill for bill in sales if bill["date"].strftime("%Y-%m") == month and bill["status"] == "active"])
            target = totals.setdefault(month, {})
            target.setdefault("gstr1", {key: books[key] for key in (*COLUMNS, "bills")})
            target.setdefault("gstr3b", {key: books[key] for key in HEADS})
    return totals, amended_in


def reconciliation_payload(business, fy, *, split):
    today = timezone.localdate()
    start, end = fy_range(fy)
    sales = load_sales(start, min(end, today), business.pk) if start <= today else []
    filed, amendments = _filed_totals(business, fy, sales)
    stages = month_stages([business.pk], list(months_between(start, end)), today=today)["stages"]
    return reconcile(business.pk, fy_label(fy), sales, filed=filed, amendments=amendments,
                     stages={month: value for (_, month), value in stages.items()}, split=split, today=today)


def _positions(firms, end, today):
    result = {}
    for business in firms:
        result.update({(business.pk, month): position for month, position in ledger(business, min(end, today), today=today).items()})
    return result


def _return_data(firms, months, positions, stages, today):
    records = {}
    if firms:
        dates = [date.fromisoformat(month + "-01") for month in months]
        selected = Q(pk__in=[])
        for day in dates:
            selected |= Q(year=day.year, month=day.month)
        for record in records_with_people(uncached(FilingRecord).filter(selected, business_id__in=[firm.pk for firm in firms], kind="gstr3b")):
            records[record.business_id, f"{record.year:04d}-{record.month:02d}"] = filing_data(record)
    result = {}
    for business in firms:
        for month in months:
            day = date.fromisoformat(month + "-01")
            key = (business.pk, month)
            changes = changes_since_filing(business, day.year, day.month) if day >= date(2025, 4, 1) else None
            position = positions.get(key)
            result[key] = {
                "gstr1": build_gstr1(business, day.year, day.month)["sections"],
                "gstr3b": gstr3b_tables(business, day.year, day.month, today=today, position=position) if position else None,
                "stage": stages.get(key, "before_ledger"), "filing": records.get(key),
                "amendments": [{"month": month, **row} for row in changes["rows"]] if changes else [],
            }
    return wire(result)


def report_payload(kind, business, start, end, *, split, side):
    today = timezone.localdate()
    requested_start, requested_end = start, end
    if kind == "tax":
        start, end = tax_span(start, end)
    sides = (("sales",) if kind in ("sales", "customers", "products") or (kind == "hsn" and side == "sales") else
             ("purchases",) if kind == "purchases" or (kind == "hsn" and side == "purchases") else ("sales", "purchases"))
    register = load_register(start, end, business.pk if business else None, credit_start=start, credit_end=end,
                             include_products=kind == "products", sides=sides)
    months = list(months_between(start, end))
    ids = [firm["id"] for firm in register["firms"]]
    needs_positions = kind in ("tax", "ca-workbook") or (kind == "months" and len(ids) == 1)
    models = ([business] if business else list(uncached(Business).filter(pk__in=ids).only(*FIRM_FIELDS).order_by("name", "pk"))) if needs_positions else []
    closed = on_record_months(ids) if "purchases" in sides else set()
    positions = _positions(models, end, today) if needs_positions else {}
    stages = month_stages(ids, [month for month in months if month >= "2025-04"], today=today)["stages"] if kind in ("months", "ca-workbook") else {}
    if kind == "ca-workbook":
        returns = _return_data(models, months, positions, stages, today)
        return ca_workbook(register["sales"], register["purchases"], firms=register["firms"], start=start, end=end,
                           split=split, return_data=returns, closed_credit=closed, today=today,
                           scope=business.name if business else "All firms")
    if kind == "tax":
        for row in uncached(FilingRecord).filter(business_id__in=ids, year__range=(start.year, end.year), kind__in=("gstr1", "gstr3b")).values("business_id", "year", "month", "kind", "filed_on"):
            key = (row["business_id"], f"{row['year']:04d}-{row['month']:02d}")
            if key in positions:
                positions[key][row["kind"] + "_filed_on"] = row["filed_on"].isoformat()
    return build_report(kind, register["sales"], register["purchases"], firms=register["firms"], start=requested_start, end=requested_end,
                        split=split, positions=positions, stages=stages, closed_credit=closed, today=today,
                        side=side, product_units=register.get("product_units"))
