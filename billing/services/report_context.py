"""Join 3B projections to the purchase and GST services, without another money engine."""

from datetime import date
from decimal import Decimal

from django.db.models import F, Q
from django.utils import timezone

from billing.cache import uncached
from billing.fy import fy_label, fy_range
from billing.models import Business, FiledPeriod, FilingMonth, FilingRecord
from billing.services.filing import _person_rows, changes_since_filing, filing_data, month_stages
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
    """Project only figures needed for reconciliation, then apply carried bill deltas.

    This follows filing.changes_for_month: own GSTR-1A replaces GSTR-1, and later
    GSTR-1 amendments update the original month's baseline in calendar order.
    It reads no full bill or portal-file snapshots.
    """
    selected = _fy_filter(fy)
    totals, amended_in = {}, {}
    fields = {"value_" + key: F("figures__" + key) for key in (*COLUMNS, "bills")}
    rows = (uncached(FilingRecord).filter(selected, business_id=business.pk)
            .annotate(**fields, output=F("figures__output"))
            .values("year", "month", "kind", *fields, "output").order_by("year", "month", "kind"))
    for row in rows:
        month = f"{row['year']:04d}-{row['month']:02d}"
        target = totals.setdefault(month, {})
        if row["kind"] == "gstr3b":
            target["gstr3b"] = row["output"]
        else:
            target["gstr1"] = {key: Decimal(str(row["value_" + key] or 0)) for key in COLUMNS}
            target["gstr1"]["bills"] = int(row["value_bills"] or 0)
    legacy_fields = {"value_" + key: F("legacy_snapshot__gstr1__figures__" + key) for key in (*COLUMNS, "bills")}
    for row in (uncached(FilingMonth).filter(selected, business_id=business.pk, legacy_frozen_at__isnull=False)
                .annotate(**legacy_fields, output=F("legacy_snapshot__gstr3b__figures__output"))
                .values("year", "month", *legacy_fields, "output")):
        month = f"{row['year']:04d}-{row['month']:02d}"
        target = totals.setdefault(month, {})
        target.setdefault("gstr1", {**{key: Decimal(str(row["value_" + key] or 0)) for key in COLUMNS},
                                    "bills": int(row["value_bills"] or 0)})
        target.setdefault("gstr3b", row["output"])
    # Legacy locks without a saved snapshot still hold their unchanged books.
    for year, number in uncached(FiledPeriod).filter(selected, business_id=business.pk).values_list("year", "month"):
        month = f"{year:04d}-{number:02d}"
        if "gstr1" not in totals.get(month, {}) or "gstr3b" not in totals.get(month, {}):
            books = amounts([bill for bill in sales if bill["date"].strftime("%Y-%m") == month and bill["status"] == "active"])
            target = totals.setdefault(month, {})
            target.setdefault("gstr1", {key: books[key] for key in (*COLUMNS, "bills")})
            target.setdefault("gstr3b", {key: books[key] for key in HEADS})
    later = (uncached(FilingRecord).filter(business_id=business.pk, kind="gstr1")
             .filter(Q(year__gt=fy) | Q(year=fy, month__gte=4))
             .values("year", "month", "figures__amendments").order_by("year", "month"))
    for record in later:
        carrying = f"{record['year']:04d}-{record['month']:02d}"
        for change in record["figures__amendments"] or []:
            source = change["month"]
            baseline = totals.get(source, {}).get("gstr1")
            if baseline is None or source >= carrying:
                continue
            before, after = change.get("before") or {}, change.get("after") or {}
            for key in COLUMNS:
                baseline[key] += Decimal(str(after.get(key, 0))) - Decimal(str(before.get(key, 0)))
            baseline["bills"] += int(bool(after)) - int(bool(before))
            amended_in[source] = carrying
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
        for record in _person_rows(uncached(FilingRecord).filter(selected, business_id__in=[firm.pk for firm in firms], kind="gstr3b")):
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
