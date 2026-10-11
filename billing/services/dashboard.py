"""Small database aggregates for the dashboard; invoice headers never join their lines."""
from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import BooleanField, Case, Count, Exists, F, OuterRef, Q, Sum, Value, When
from django.db.models.functions import Coalesce, Left, Round, TruncMonth

from billing.cache import uncached
from billing.fy import fy_label, fy_of, fy_range
from billing.models import BinnedInvoice, Business, Invoice, LineItem
from billing.roles import can
from billing.services.bill_reads import CHECK_FIELDS, ITAX_FIELDS, bill_rows
from billing.text import money

ROW_FIELDS = tuple(set((*CHECK_FIELDS, *ITAX_FIELDS, "invoice_number", "created_at", "cancel_reason",
                       "business__name", "customer__mobile_number", "sent_count", "sent_via", "sent_to", "last_sent_at")))
ZERO = Decimal("0")


def firms_in_scope(business_id):
    fields = ["id", "name", "gst_number"]
    if any(f.name == "short_name" for f in Business._meta.fields):
        fields.append("short_name")
    firms = uncached(Business).only(*fields).order_by("name", "id")
    return list(firms.filter(pk=business_id) if business_id is not None else firms)


def month_keys(start, end):
    cursor = start.replace(day=1)
    while cursor <= end:
        yield cursor.strftime("%Y-%m")
        cursor = date(cursor.year + cursor.month // 12, cursor.month % 12 + 1, 1)


def latest_changes():
    from billing.services.audit import entry_row, read_entries
    rows = read_entries().exclude(entity__in=["backup", "gst_file"]).exclude(action__in=["printed", "exported", "downloaded"])
    rows = rows.defer("details", "changes").annotate(
        short_details=Left("details", 160),
        role_changed=Case(When(changes__has_key="role", then=Value(True)), default=Value(False), output_field=BooleanField()),
        is_purchase=Exists(uncached(Invoice).filter(pk=OuterRef("entity_id"), type_of_invoice="inward")),
        was_purchase=Exists(uncached(BinnedInvoice).filter(original_id=OuterRef("entity_id"), type_of_invoice="inward")),
    )
    answer = []
    for entry in rows[:4]:
        entry.details = entry.short_details
        entry.changes = {"role": {}} if entry.role_changed else None
        row = entry_row(entry, actions=False)
        row.pop("changes", None)
        answer.append(row)
    return answer


def filing_totals(ids, year):
    from billing.services.filing import year_filings
    return year_filings(ids, year)


def past_returns(firms, year):
    values = filing_totals([f.pk for f in firms], year)
    rows = []
    for firm in firms:
        row = values.get(firm.pk, {})
        day = row.get("last_gstr3b_filed_on")
        rows.append({"firm": {"id": firm.pk, "name": firm.name, "gst_number": firm.gst_number or ""},
                     "months_filed": row.get("months_filed", 0), "last_gstr3b_filed_on": day.isoformat() if day else None,
                     "cash_paid": money(row.get("cash_paid") or ZERO)})
    return rows


def dashboard(user, firms, year, today):
    ids = [f.pk for f in firms]
    active = uncached(Invoice).counted().filter(business_id__in=ids)
    today_bills = active.filter(type_of_invoice="outward", invoice_date=today)
    payments = list(today_bills.order_by().values("payment_mode").annotate(count=Count("pk"), total=Sum("total_amount")))
    count = sum(p["count"] for p in payments)
    totals = {p["payment_mode"] or "": p["total"] or ZERO for p in payments}
    shown = today_bills if count else active.filter(type_of_invoice="outward")
    shown = shown.select_related("customer", "business").only(*ROW_FIELDS).order_by("-created_at", "-id")[:100 if count else 5]
    rows = bill_rows(shown)
    current = year == fy_of(today)
    start, end = fy_range(year)
    end = today if current else end
    first = today.replace(day=1) if current else date(year + 1, 3, 1)
    last = today if current else date(year + 1, 3, monthrange(year + 1, 3)[1])
    windows = {"month": (first, last)}
    if current:
        windows["last30"] = (today - timedelta(days=29), today)
    queries = {}
    line_queries = {}
    tax = sum((Coalesce(F(h), ZERO) for h in ("cgst", "sgst", "igst")), ZERO)
    for key, period in windows.items():
        where = Q(invoice_date__range=period)
        queries[key + "_count"] = Count("pk", filter=where)
        queries[key + "_total"] = Sum("total_amount", filter=where)
        line_where = Q(invoice__invoice_date__range=period)
        line_queries[key + "_taxable"] = Sum(Round(F("quantity") * F("rate"), 2), filter=line_where)
        line_queries[key + "_tax"] = Sum(tax, filter=line_where)
    lo = min(p[0] for p in windows.values())
    hi = max(p[1] for p in windows.values())
    window_bills = active.filter(invoice_date__range=(lo, hi))
    invoice_totals = {r["type_of_invoice"]: r for r in window_bills.order_by().values("type_of_invoice").annotate(**queries)}
    window_lines = uncached(LineItem).filter(invoice__in=window_bills.values("pk"))
    line_totals = {r["invoice__type_of_invoice"]: r for r in window_lines.order_by().values("invoice__type_of_invoice").annotate(**line_queries)}
    def window(key):
        a, b = windows[key]
        out = {"from": a.isoformat(), "to": b.isoformat()}
        for kind, label in (("outward", "sales"), ("inward", "purchases")):
            inv, lines = invoice_totals.get(kind, {}), line_totals.get(kind, {})
            out[label] = {"count": inv.get(key + "_count", 0), "total": money(inv.get(key + "_total") or ZERO),
                          "taxable": money(lines.get(key + "_taxable") or ZERO), "tax": money(lines.get(key + "_tax") or ZERO)}
        return out
    year_bills = active.filter(invoice_date__range=(start, end))
    yearly = {(r["month"].strftime("%Y-%m"), r["type_of_invoice"]): r for r in year_bills.order_by()
              .annotate(month=TruncMonth("invoice_date")).values("month", "type_of_invoice").annotate(count=Count("pk"), total=Sum("total_amount"))}
    yearly_tax = {(r["month"].strftime("%Y-%m"), r["invoice__type_of_invoice"]): r["tax"] for r in
                  uncached(LineItem).filter(invoice__in=year_bills.values("pk")).order_by()
                  .annotate(month=TruncMonth("invoice__invoice_date")).values("month", "invoice__type_of_invoice").annotate(tax=Sum(tax))}
    months = []
    for key in month_keys(start, end):
        row = {"month": key}
        for kind, label in (("outward", "sales"), ("inward", "purchases")):
            values = yearly.get((key, kind), {})
            row[label] = {"count": values.get("count", 0), "total": money(values.get("total") or ZERO),
                          "tax": money(yearly_tax.get((key, kind)) or ZERO)}
        months.append(row)
    year_block = {"from": start.isoformat(), "to": end.isoformat(), "months": months}
    for label in ("sales", "purchases"):
        year_block[label] = {"count": sum(r[label]["count"] for r in months),
                             "total": money(sum((r["total"] or ZERO for (_month, kind), r in yearly.items()
                                                 if kind == ("outward" if label == "sales" else "inward")), ZERO))}
    return {"today": {"date": today.isoformat(), "count": count, "total": money(sum(totals.values(), ZERO)),
                       "by_payment": [{"mode": mode, "total": money(totals[mode])} for mode in ("cash", "bank", "mixed", "credit", "") if totals.get(mode)],
                       "bills": rows if count else [], "more": max(count - 100, 0), "recent": [] if count else rows},
            "fy": fy_label(year), "current": current,
            "month": {"kind": "so_far" if current else "last_of_fy", "month": first.strftime("%Y-%m"), **window("month")},
            "last30": window("last30") if current else None, "year": year_block,
            "returns_year": None if current else past_returns(firms, year),
            "changes": latest_changes() if can(user, "audit.view") else None}
