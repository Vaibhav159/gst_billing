"""Firm records: narrow uncached reads, legal identity freezing and print settings."""
from datetime import date

from django.apps import apps
from django.db.models import Count, F, Q, Sum, Window
from django.db.models.functions import Round, RowNumber
from django.utils import timezone

from billing.cache import uncached
from billing.constants import BILL_CANCELLED, INVOICE_TYPE_INWARD, INVOICE_TYPE_OUTWARD
from billing.fy import fy_label, fy_of, fy_range
from billing.gstin import validate
from billing.media import sign_media_path
from billing.models import (
    BinnedInvoice,
    FiledPeriod,
    Invoice,
    InwardCapture,
    ITCReclaimLedger,
    LineItem,
    SaleDraft,
    SavedDraft,
)
from billing.numbering import (
    REF_FIELDS,
    _in_series,
    bill_ref,
    counter_of,
    full_number_on,
    next_number,
    series_bills,
    series_bin,
)
from billing.tax_rules import state_code
from billing.text import money, stamp

DECLARATION = "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct."
SLIM_FIELDS = ("name", "short_name", "gst_number", "state_name", "invoice_prefix", "city", "paper_full_number_from")
DETAIL_FIELDS = (*SLIM_FIELDS, "pan_number", "address", "pin_code", "mobile_number", "email", "bank_name",
                 "bank_account_number", "bank_ifsc_code", "bank_branch_name", "signature_image", "signature_on_bills",
                 "jurisdiction", "declaration", "updated_at")


def short_name(business):
    return business.short_name or (business.name.split()[0].title() if business.name.split() else "")


def firm_ref(business):
    return {"id": business.pk, "name": business.name, "short": short_name(business)}


def live_print_fields(business):
    return {"bank_name": business.bank_name or "", "bank_account_number": business.bank_account_number or "",
            "bank_ifsc_code": business.bank_ifsc_code or "", "bank_branch_name": business.bank_branch_name or "",
            "signature_url": sign_media_path(business.signature_image.name) if business.signature_image else None,
            "signature_on_bills": business.signature_on_bills, "city": business.city, "pin_code": business.pin_code,
            "jurisdiction_printed": business.jurisdiction or business.city or "Udaipur",
            "declaration_printed": business.declaration or DECLARATION, "short": short_name(business)}


def firm_row(business):
    return {"id": business.pk, **{key: getattr(business, key) or "" for key in SLIM_FIELDS if key != "paper_full_number_from"},
            "short": short_name(business), "state_code": state_code(business),
            "paper_full_number_from": business.paper_full_number_from.isoformat() if business.paper_full_number_from else None}


def firm_numbers(business):
    today = timezone.localdate()
    fy = fy_of(today)
    following = next_number(business, today)
    tail = str(following["counter"] - 1)
    bills = list(series_bills(business.pk, fy).filter(invoice_number__endswith=tail).select_related("customer").only(*REF_FIELDS))
    binned = list(series_bin(business.pk, fy).filter(invoice_number__endswith=tail).select_related("customer").only(
        "original_id", "invoice_number", "invoice_date", "customer__name"))
    last = max((b for b in [*bills, *binned] if _in_series(b) and counter_of(b.invoice_number) == following["counter"] - 1),
               key=lambda b: (counter_of(b.invoice_number), b.invoice_date, b.pk), default=None)
    if isinstance(last, BinnedInvoice):
        ref = {"id": last.original_id, "invoice_number": last.invoice_number,
               "invoice_date": last.invoice_date.isoformat(), "customer_name": last.customer.name, "status": "deleted"}
    else:
        ref = bill_ref(last) if last else None
    return {"fy": fy_label(fy), "last": ref, "next": following, "full_number": full_number_on(business, today)}


def optional_filing_model(name):
    """Only absent part-3 models are optional; an installed model's database errors remain visible."""
    try:
        return apps.get_model("billing", name)
    except LookupError:
        return None


def filing_dates(ids, months):
    """Narrow filing dates for the requested grid and each firm's latest filed month."""
    model = optional_filing_model("FilingRecord")
    if model is None or not months:
        return {}
    where = Q()
    for label in months:
        year, month = map(int, label.split("-"))
        where |= Q(year=year, month=month)
    return {(pk, f"{year}-{month:02d}", kind): day.isoformat() for pk, year, month, kind, day in
            uncached(model).filter(where, business_id__in=ids, kind__in=("gstr1", "gstr3b"))
            .values_list("business_id", "year", "month", "kind", "filed_on")}


def read_filings(ids, months):
    """One bulk stage call, one narrow date query and one grouped blocker call; no monthly query loop."""
    from importlib import import_module
    today = timezone.localdate()
    months = sorted(set(months))
    closed = set(uncached(FiledPeriod).filter(business_id__in=ids).values_list("business_id", "year", "month"))
    latest = {pk: max((f"{year}-{month:02d}" for firm, year, month in closed if firm == pk), default=None) for pk in ids}
    try:
        filing = import_module("billing.services.filing")
    except ModuleNotFoundError as missing:
        if missing.name != "billing.services.filing":
            raise
        # ponytail: only the absence of part 3 selects its explicitly approved v2-lock fallback.
        stages = {(pk, label): "filed" if (pk, *map(int, label.split("-"))) in closed else "open"
                  for pk in ids for label in months}
    else:
        # Contract §11 names two results; confirm this (stage_map, latest_gstr1) carrier with 3A.
        stages, latest_gstr1 = filing.month_stages(ids, months, today=today)
        latest = {pk: max(filter(None, (latest[pk], latest_gstr1.get(pk))), default=None) for pk in ids}
    dates = filing_dates(ids, set(months) | {label for label in latest.values() if label})
    def dates_for(pk, label):
        return {"month": label, "gstr1_filed_on": dates.get((pk, label, "gstr1")),
                "gstr3b_filed_on": dates.get((pk, label, "gstr3b"))}
    shown = {(pk, label): {**dates_for(pk, label), "state": stages[pk, label]} for pk in ids for label in months}
    blocked = [(pk, label) for (pk, label), state in stages.items() if state == "blocked"]
    blockers = {}
    if blocked:
        from billing.services.gst_checks import gstr1_blockers
        blockers = {key: (value.get("first_two") or [""])[0] for key, value in
                    gstr1_blockers(sorted({pk for pk, _ in blocked}), sorted({label for _, label in blocked})).items()}
    return {"months": shown, "last": {pk: dates_for(pk, label) if label else None for pk, label in latest.items()},
            "blockers": blockers}


def firm_figures(ids, fy=None, filings=None):
    today = timezone.localdate()
    fy = fy_of(today) if fy is None else fy
    start, end = fy_range(fy)
    end = min(end, today)
    scope = uncached(Invoice).filter(business_id__in=ids, invoice_date__range=(start, end))
    active = ~Q(status=BILL_CANCELLED)
    totals = {(row["business_id"], row["type_of_invoice"]): row for row in scope.values("business_id", "type_of_invoice")
              .annotate(bills=Count("pk", filter=active), total=Sum("total_amount", filter=active),
                        cancelled=Count("pk", filter=Q(status=BILL_CANCELLED)), customers=Count("customer_id", distinct=True, filter=active))
              .order_by()}
    tax = {(row["invoice__business_id"], row["invoice__type_of_invoice"]): row["tax"] for row in
           uncached(LineItem).filter(invoice__in=scope.counted().values("pk"))
           .values("invoice__business_id", "invoice__type_of_invoice")
           .annotate(tax=Sum(Round("cgst", 2) + Round("sgst", 2) + Round("igst", 2))).order_by()}
    bounds = {}
    for label, ordering in (("first_bill", ("invoice_date", "pk")), ("last_bill", ("-invoice_date", "-pk"))):
        selected = scope.counted().filter(type_of_invoice=INVOICE_TYPE_OUTWARD).annotate(
            place=Window(RowNumber(), partition_by=F("business_id"), order_by=ordering)).filter(place=1)
        bounds[label] = {b.business_id: bill_ref(b) for b in selected.select_related("customer").only("business_id", *REF_FIELDS)}
    previous = date(today.year - (today.month == 1), 12 if today.month == 1 else today.month - 1, 1).strftime("%Y-%m")
    filings = read_filings(ids, [previous]) if filings is None else filings
    result = {}
    for pk in ids:
        sale_values = totals.get((pk, INVOICE_TYPE_OUTWARD), {})
        purchase_values = totals.get((pk, INVOICE_TYPE_INWARD), {})
        state = filings["months"][pk, previous]
        result[pk] = {"fy": fy_label(fy), "from": start.isoformat(), "to": end.isoformat(),
                      "sales": {"bills": sale_values.get("bills", 0), "total": money(sale_values.get("total")),
                                "tax": money(tax.get((pk, INVOICE_TYPE_OUTWARD))), "cancelled": sale_values.get("cancelled", 0)},
                      "purchases": {"bills": purchase_values.get("bills", 0), "total": money(purchase_values.get("total")),
                                    "tax": money(tax.get((pk, INVOICE_TYPE_INWARD)))},
                      "customers": sale_values.get("customers", 0), "first_bill": bounds["first_bill"].get(pk),
                      "last_bill": bounds["last_bill"].get(pk),
                      "last_filed": filings["last"][pk],
                      "previous_month": {"month": state["month"], "state": state["state"],
                                         "blocker": filings["blockers"].get((pk, state["month"]), "") if state["state"] == "blocked" else ""}}
    return result


def firm_uses(business):
    counts = uncached(Invoice).filter(business=business).aggregate(
        sales=Count("pk", filter=Q(type_of_invoice=INVOICE_TYPE_OUTWARD) & ~Q(status=BILL_CANCELLED)),
        cancelled=Count("pk", filter=Q(type_of_invoice=INVOICE_TYPE_OUTWARD, status=BILL_CANCELLED)),
        purchases=Count("pk", filter=Q(type_of_invoice=INVOICE_TYPE_INWARD)))
    retained = {}
    for key, name in (("filing_records", "FilingRecord"), ("filing_months", "FilingMonth"), ("opening_credits", "OpeningCredit")):
        model = optional_filing_model(name)
        retained[key] = uncached(model).filter(business_id=business.pk).count() if model is not None else 0
    downloads = optional_filing_model("ReturnDownload")
    if downloads is not None:
        retained["filing_records"] += uncached(downloads).filter(business_id=business.pk).count()
    retained["opening_credits"] += uncached(ITCReclaimLedger).filter(business_id=business.pk).count()
    retained["filed_periods"] = uncached(FiledPeriod).filter(business_id=business.pk).count()
    return {**counts, **retained, "bin": BinnedInvoice.objects.live().filter(business=business).count(),
            "drafts": SaleDraft.objects.filter(business=business).exclude(pk__in=SavedDraft.objects.values("pk")).count(),
            "captures": InwardCapture.objects.filter(business=business).count()}


def assert_firm_unused(business, uses=None, history_only=False):
    """One deletion guard for v3, audit and legacy v2; all retained GST history wins."""
    from billing.refusals import Refusal
    uses = firm_uses(business) if uses is None else uses
    if any(uses[key] for key in ("filing_records", "filing_months", "filed_periods", "opening_credits")):
        raise Refusal(f"{business.name} has filing records or opening credit, so it can't be deleted. "
                      "Its GST history keeps its firm.", "in_use", uses=uses)
    if not history_only and any(uses.values()):
        raise Refusal(f"{business.name} has {uses['sales'] + uses['cancelled']} sales bills and {uses['purchases']} purchase bills, "
                      "so it can't be deleted. Bills keep their firm.", "in_use", uses=uses)
    return uses


def firm_detail(business, fy=None):
    today = timezone.localdate()
    start, end = fy_range(fy_of(today) if fy is None else fy)
    cursor, month_labels = start, []
    while cursor <= min(today, end):
        month_labels.append(cursor.strftime("%Y-%m"))
        cursor = date(cursor.year + cursor.month // 12, cursor.month % 12 + 1, 1)
    previous = date(today.year - (today.month == 1), 12 if today.month == 1 else today.month - 1, 1).strftime("%Y-%m")
    filings = read_filings([business.pk], [*month_labels, previous])
    months = [filings["months"][business.pk, label] for label in month_labels]
    recent = Invoice.objects.sales().filter(business=business).select_related("customer").only(
        *REF_FIELDS, "payment_mode", "total_amount").order_by("-invoice_date", "-pk")[:6]
    data = {field: getattr(business, field) or "" for field in DETAIL_FIELDS if field not in ("signature_image", "updated_at", "paper_full_number_from")}
    return {**data, **firm_row(business), **live_print_fields(business), "gstin_valid": validate(business.gst_number)[0],
            "has_bank": bool(business.bank_account_number), "numbers": firm_numbers(business),
            "figures": firm_figures([business.pk], fy, filings)[business.pk], "months": months, "uses": firm_uses(business),
            "recent": [{**bill_ref(b), "payment_mode": b.payment_mode, "total_amount": money(b.total_amount)} for b in recent],
            "plain_after_full_date": Invoice.objects.sales().filter(business=business, invoice_date__gte=business.paper_full_number_from,
                invoice_number__regex=r"^[0-9]+$").count() if business.paper_full_number_from else 0,
            "updated_at": stamp(business.updated_at)}
