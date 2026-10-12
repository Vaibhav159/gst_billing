"""Credit tab projections; filing, opening balances and the ledger belong to 3A."""

from decimal import Decimal
from types import SimpleNamespace

from django.db.models import Count, DateField, Exists, OuterRef, Sum
from django.db.models.functions import Coalesce, ExtractMonth, ExtractYear, TruncMonth
from django.utils import timezone

from billing.cache import uncached
from billing.credit import (
    LEDGER_START,
    credit_deadline,
    credit_lapsed,
    credit_month_of,
    last_credit_month,
    open_credit_months,
)
from billing.fy import due_dates, fy_label, fy_of, fy_range
from billing.models import FiledPeriod, FilingMonth, FilingRecord, Invoice, LineItem
from billing.services.gst_amounts import paise_expression
from billing.services.ledger import lapsed_purchase_ids
from billing.tax_rules import HEADS, clean_gstin, has_gstin, registered
from billing.text import money


def assemble_credit(business_id, fy, rows, filed, opening, *, today, deadline, others_at_risk=()):
    """Project narrowed purchase rows. ``filed`` includes unlocked recorded returns and legacy locks.

    Deadlines, claim months and scheduled lapse come from part 2's helpers. Lapsed
    credit stays lapsed when recorded; otherwise an unfiled bill expires after its deadline.
    """
    buckets = {"fy": fy_label(fy), "deadline": deadline.isoformat(), "days_left": (deadline - today).days,
               **{key: {"bills": 0, "tax": Decimal("0")} for key in ("claimed", "open", "lapsed")}, "none": []}
    risk = []
    for row in rows:
        bill_fy = fy_of(row["bill_date"])
        month = row["credit_month"]
        claimed = month is not None and (business_id, month.year, month.month) in filed
        lapsed = row["lapsed"] or month is None or (not claimed and today > row["deadline"])
        reason = ("not_allowed" if not row["eligible"] else
                  "no_gstin" if not has_gstin(row["supplier"]["gst_number"]) else
                  "no_gst" if row["tax"] <= 0 else None)
        if bill_fy == fy:
            if reason:
                buckets["none"].append({"id": row["id"], "bill_no": row["bill_no"],
                                        "supplier_name": row["supplier"]["name"], "why": reason})
            else:
                key = "lapsed" if lapsed else "claimed" if claimed else "open"
                buckets[key]["bills"] += 1
                buckets[key]["tax"] += row["tax"]
        if bill_fy != fy - 1 or reason or lapsed or claimed:
            continue
        risk.append({"id": row["id"], "bill_no": row["bill_no"], "bill_date": row["bill_date"].isoformat(),
                     "entered_on": row["entered_on"].isoformat(), "supplier": dict(row["supplier"]),
                     "tax": money(row["tax"]), "credit_month": month.strftime("%Y-%m"),
                     "credit_month_due": row["credit_month_due"].isoformat(), "claim_months": row["claim_months"],
                     "deadline": row["deadline"].isoformat(), "days_left": (row["deadline"] - today).days})
    risk.sort(key=lambda row: (row["deadline"], row["bill_date"], row["id"]))
    for key in ("claimed", "open", "lapsed"):
        buckets[key]["tax"] = money(buckets[key]["tax"])
    return {"business": business_id, "fy": fy_label(fy), "at_risk": {
        "deadline": risk[0]["deadline"] if risk else None, "days_left": risk[0]["days_left"] if risk else None,
        "tax": money(sum((Decimal(row["tax"]) for row in risk), Decimal("0"))), "count": len(risk), "bills": risk},
        "others_at_risk": list(others_at_risk), "buckets": buckets, "opening": opening}


def on_record_months(business_ids):
    """Batch claim history as {(firm id, YYYY-MM)}, even after unlocking; no snapshots read."""
    keys = ("business_id", "year", "month")
    recorded = (uncached(FilingRecord).filter(business_id__in=business_ids, kind="gstr3b")
                .order_by().values_list(*keys))
    legacy = uncached(FiledPeriod).filter(business_id__in=business_ids).order_by().values_list(*keys)
    frozen_legacy = (uncached(FilingMonth).filter(business_id__in=business_ids, legacy_frozen_at__isnull=False)
                     .order_by().values_list(*keys))
    return {(business_id, f"{year:04d}-{month:02d}")
            for business_id, year, month in recorded.union(legacy, frozen_legacy)}


def credit_data(business, fy, *, opening, today=None):
    """Contract §8 read. Requires 2A credit columns/helpers and 3A filing models/due dates.

    ``opening`` is the complete §7 body from 3A's existing opening-credit read. The caller
    supplies it so this service does not own or rebuild any ledger or opening-credit logic.
    """
    today = today or timezone.localdate()
    filed = {(business_id, int(month[:4]), int(month[5:])) for business_id, month in on_record_months([business.pk])}
    raw = list(uncached(Invoice).filter(
        business_id=business.pk, type_of_invoice="inward",
        invoice_date__range=(fy_range(fy - 1)[0], fy_range(fy)[1]),
    ).order_by("invoice_date", "pk").values(
        "id", "invoice_number", "invoice_date", "created_at", "itc_month", "itc_eligible",
        "customer_id", "customer__name", "customer__gst_number",
    ).annotate(**{f"tax_{head}": Sum(paise_expression(f"lineitem__{head}")) for head in HEADS}))
    rows = []
    for bill in raw:
        tax = sum((bill[f"tax_{head}"] or Decimal("0") for head in HEADS), Decimal("0"))
        invoice = SimpleNamespace(pk=bill["id"], business_id=business.pk, itc_month=bill["itc_month"],
                                  invoice_date=bill["invoice_date"], itc_eligible=bill["itc_eligible"], _purchase_tax=tax)
        month = credit_month_of(invoice)
        rows.append({
            "id": bill["id"], "bill_no": bill["invoice_number"], "bill_date": bill["invoice_date"],
            "entered_on": timezone.localtime(bill["created_at"]).date(), "supplier": {
                "id": bill["customer_id"], "name": bill["customer__name"],
                "gst_number": clean_gstin(bill["customer__gst_number"])},
            "tax": tax, "lapsed": credit_lapsed(invoice),
            "credit_month": month, "credit_month_due": due_dates(month.year, month.month)["gstr3b"] if month else None,
            "eligible": bill["itc_eligible"], "deadline": credit_deadline(bill["invoice_date"]), "claim_months": [],
        })
    # P3-15: a GSTR-3B filed after 30 November lapses the credit it claimed, as in its tables.
    lapsed = lapsed_purchase_ids((row["id"] for row in rows if row["credit_month"] and not row["lapsed"]), today=today)
    for row in rows:
        row["lapsed"] = row["lapsed"] or row["id"] in lapsed
    candidates = [row for row in rows if row["credit_month"] is not None and not row["lapsed"]
                  and fy_of(row["bill_date"]) == fy - 1 and row["eligible"]
                  and row["tax"] > 0 and has_gstin(row["supplier"]["gst_number"]) and today <= row["deadline"]
                  and (business.pk, row["credit_month"].year, row["credit_month"].month) not in filed]
    if candidates:
        # Read the open-month calendar once, then slice it for each bill. A recorded but unlocked
        # return stays out: §8 says "on record", whereas part 2's write choices mean "not locked".
        choices = open_credit_months(business.pk, min(row["bill_date"] for row in candidates), today)
        for row in candidates:
            row["claim_months"] = [
                {"month": month.strftime("%Y-%m"),
                 "state": "running" if month == today.replace(day=1) else "not_filed",
                 "gstr3b_due": due_dates(month.year, month.month)["gstr3b"].isoformat(),
                 "too_late": due_dates(month.year, month.month)["gstr3b"] > row["deadline"]}
                for month in choices if month >= row["bill_date"].replace(day=1)
                and (business.pk, month.year, month.month) not in filed]
    return assemble_credit(business.pk, fy, rows, filed, opening, today=today,
                           deadline=credit_deadline(fy_range(fy)[0]),
                           others_at_risk=_other_risk(business.pk, fy, today))


def _other_risk(business_id, fy, today):
    """Other firms need counts only, never each firm's purchase headers or stored snapshots."""
    start, end = fy_range(fy - 1)
    if today > credit_deadline(start):
        return []
    recorded = uncached(FilingRecord).filter(business_id=OuterRef("business_id"), kind="gstr3b",
                                              year=OuterRef("credit_year"), month=OuterRef("credit_number"))
    legacy = uncached(FiledPeriod).filter(business_id=OuterRef("business_id"),
                                          year=OuterRef("credit_year"), month=OuterRef("credit_number"))
    frozen_legacy = uncached(FilingMonth).filter(business_id=OuterRef("business_id"), legacy_frozen_at__isnull=False,
                                                 year=OuterRef("credit_year"), month=OuterRef("credit_number"))
    taxed = (uncached(LineItem).filter(invoice_id=OuterRef("pk")).order_by().values("invoice_id")
             .annotate(tax=Sum(paise_expression("igst") + paise_expression("cgst") + paise_expression("sgst")))
             .filter(tax__gt=0))
    rows = (uncached(Invoice).filter(type_of_invoice="inward", itc_eligible=True, invoice_date__range=(start, end),
                                     invoice_date__gte=LEDGER_START)
            .exclude(business_id=business_id).filter(registered("customer__gst_number"), Exists(taxed))
            .alias(credit_date=Coalesce("itc_month", TruncMonth("invoice_date"), output_field=DateField()))
            .filter(credit_date__lte=last_credit_month(start))
            .alias(credit_year=ExtractYear("credit_date"), credit_number=ExtractMonth("credit_date"))
            .filter(~Exists(recorded), ~Exists(legacy), ~Exists(frozen_legacy)).values("business_id", "business__name")
            .annotate(count=Count("pk")).order_by("business__name", "business_id"))
    # ponytail: no stored short name exists; match the web firm reader's first-word fallback.
    return [{"business": row["business_id"], "short": row["business__name"].split()[0].capitalize()
             if row["business__name"].split() else row["business__name"], "count": row["count"]} for row in rows]
