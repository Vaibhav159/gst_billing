"""The contract's purchase rows, figures and filters, reading around cacheops."""
from collections import Counter, defaultdict
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from types import SimpleNamespace

from django.db.models import DecimalField, Exists, ExpressionWrapper, OuterRef, Q, Sum
from django.db.models.functions import Coalesce
from django.http import Http404
from django.utils import timezone

from billing.api.body import UNSTORABLE
from billing.api.inward_bills_service import inward_number_key, supplier_key
from billing.cache import uncached
from billing.credit import LEDGER_START, credit_deadline, credit_lapsed, credit_month_of
from billing.fy import fy_label, fy_of, fy_range
from billing.models import AuditLog, Business, Invoice, InwardCapture, LineItem
from billing.numbering import bill_ref
from billing.params import PICK_A_FIRM, date_param, fy_param, id_param, month_param
from billing.period_lock import closed_credit_months
from billing.services.bill_reads import figures, grouped, lines_of, search_text, sums
from billing.tax_rules import HEADS, THOUSANDTH, clean_gstin, is_interstate, state_code
from billing.text import money, percent, person, stamp

ZERO = Decimal("0")
PICK_SUPPLIER = "Pick a supplier from the list."
LINE_FIELDS = ("product_name", "hsn_code", "quantity", "unit", "rate", "gst_tax_rate", "cgst", "sgst", "igst", "amount", "note")
ROW_FIELDS = ("business_id", "customer_id", "invoice_number", "invoice_date", "created_at", "payment_mode",
              "total_amount", "itc_month", "itc_eligible", "needs_review", "source", "source_file", "buyer_gstin",
              "business__name", "business__gst_number", "business__state_name", "customer__name",
              "customer__gst_number", "customer__state_name", "customer__city")
TOTAL_FIELDS = ("business_id", "invoice_date", "itc_month", "itc_eligible", "total_amount")
DETAIL_FIELDS = (*ROW_FIELDS, "source_preview", "buyer_ack", "linked_sale", "customer__address",
                 "customer__pan_number", "customer__customer_type", "customer__mobile_number", "customer__email")


def purchase_queryset():
    return (Invoice.objects.purchases().select_related("business", "customer")
            .annotate(has_capture=Exists(uncached(InwardCapture).filter(invoice_id=OuterRef("pk")))).only(*DETAIL_FIELDS))


def locked_purchase(invoice):
    bill = purchase_queryset().defer(None).select_for_update(of=("self",)).filter(pk=invoice.pk).first()
    if bill is None:
        raise Http404("No purchase matches the given query.")
    return bill


def supplier_ref(customer, detail=False):
    out = {"id": customer.pk, "name": customer.name, "gst_number": clean_gstin(customer.gst_number),
           "state_code": state_code(customer), "state_name": customer.state_name or "", "city": customer.city or ""}
    if detail:
        out.update(address=customer.address or "", pan=customer.pan, mobile_number=customer.mobile_number or "",
                   email=customer.email or "")
    return out


def purchase_ref(invoice):
    return {"id": invoice.pk, "invoice_number": invoice.invoice_number, "invoice_date": invoice.invoice_date.isoformat(),
            "supplier_name": invoice.customer.name, "total_amount": money(invoice.total_amount),
            "business_name": invoice.business.name}


def credit_block(invoice, tax=None, closed=None):
    if tax is None:
        tax = sums(lines_of([invoice], ("quantity", "rate", *HEADS))[invoice.pk])["tax"]
    month = credit_month_of(invoice)
    closed = closed_credit_months({invoice.business_id}) if closed is None else closed
    lapsed = credit_lapsed(SimpleNamespace(itc_eligible=invoice.itc_eligible, itc_month=invoice.itc_month,
                                           invoice_date=invoice.invoice_date, _purchase_tax=tax))
    return {"month": month.strftime("%Y-%m") if month else None,
            "chosen": invoice.itc_month.strftime("%Y-%m") if month and invoice.itc_month else None,
            "late": bool(month and month > invoice.invoice_date.replace(day=1)), "eligible": invoice.itc_eligible, "lapsed": lapsed,
            "claimed": money(tax if month and invoice.itc_eligible and not lapsed else ZERO),
            "state": "outside" if month is None else "filed" if (invoice.business_id, month.year, month.month) in closed else "open",
            "filed_on": None, "deadline": credit_deadline(invoice.invoice_date).isoformat()}


def line_block(line):
    return {"id": line.pk, "product_name": line.product_name, "hsn_code": line.hsn_code or "",
            "quantity": str((line.quantity or ZERO).quantize(THOUSANDTH)), "unit": line.unit,
            "rate": str((line.rate or ZERO).quantize(THOUSANDTH)), "gst_percent": percent(line.gst_tax_rate),
            **figures(sums([line])), "amount": money(line.amount), "note": line.note}


def duplicate_ids(invoices, known=None, narrow=False):
    """Each firm/FY's duplicates once per request; page/detail reads only candidate numbers."""
    invoices = list(invoices)
    pairs = {(b.business_id, fy_of(b.invoice_date)) for b in invoices}
    known = {} if known is None else known
    missing = pairs - known.keys()
    found = {pair: set() for pair in missing}
    if missing:
        where = Q(pk__in=[])
        for firm, year in missing:
            where |= Q(business_id=firm, invoice_date__range=fy_range(year))
        rows = Invoice.objects.purchases().filter(where).select_related("customer").only(
            "business_id", "invoice_date", "invoice_number", "customer_id", "customer__gst_number")
        if narrow:
            # A loose candidate filter only: the shared Python key still decides identity.
            # Keep non-ASCII numbers too: upper() can expand a character such as ß to SS.
            candidates = Q(invoice_number__regex=r"[^ -~]")
            keys = {inward_number_key(b.invoice_number).replace("-", "") for b in invoices}
            for key in keys - {""}:
                candidates |= Q(invoice_number__iregex="[^0-9A-Z]*".join(key))
            rows = rows.filter(candidates)
        groups = defaultdict(list)
        for bill in rows:
            key = inward_number_key(bill.invoice_number)
            if key:
                groups[bill.business_id, fy_of(bill.invoice_date), supplier_key(bill.customer), key].append(bill.pk)
        for identity, ids in groups.items():
            if len(ids) > 1:
                found[identity[:2]].update(ids)
        if not narrow:
            known.update(found)
    return set().union(*(known.get(pair, found.get(pair, set())) for pair in pairs))


def read_lines(invoices, fields, known=None):
    """Reuse page lines and fetch only missing bills in the narrower facet/summary columns."""
    known = {} if known is None else known
    missing = [bill for bill in invoices if bill.pk not in known]
    if missing:
        loaded = lines_of(missing, fields)
        known.update((bill.pk, loaded[bill.pk]) for bill in missing)
    return known


def checks(invoice, lines, duplicated=False):
    result = ["duplicate"] if duplicated else []
    if not lines:
        result.append("no_lines")
    if any(not (li.hsn_code or "").strip() for li in lines):
        result.append("no_hsn")
    if invoice.buyer_gstin and invoice.buyer_gstin != clean_gstin(invoice.business.gst_number):
        result.append("billed_to_other")
    return result


def has_files(invoice):
    return bool(invoice.source_file or invoice.has_capture)


def purchase_row(invoice, lines, closed, duplicated=False, include_lines=False):
    total = sums(lines)
    credit = credit_block(invoice, total["tax"], closed)
    weights = defaultdict(lambda: ZERO)
    for li in lines:
        if li.unit in ("gms", "g", "kg", "ct", "tola", "oz") and li.note != "Amount only":
            weights["gms" if li.unit == "g" else li.unit] += li.quantity or ZERO
    first = lines[0] if lines else None
    out = {"id": invoice.pk, "business": invoice.business_id, "business_name": invoice.business.name,
           "invoice_number": invoice.invoice_number, "invoice_date": invoice.invoice_date.isoformat(),
           "fy": fy_label(fy_of(invoice.invoice_date)), "created_at": stamp(invoice.created_at),
           "supplier": supplier_ref(invoice.customer), "payment_mode": invoice.payment_mode, **figures(total),
           "total_amount": money(invoice.total_amount), "interstate": bool(total["igst"]) if total["tax"] else is_interstate(invoice.business, invoice.customer),
           "gst_percents": sorted({percent(li.gst_tax_rate) for li in lines}, key=Decimal, reverse=True),
           "line_count": len(lines), "first_line": None if first is None else {
               "product_name": first.product_name, "quantity": str((first.quantity or ZERO).quantize(THOUSANDTH)),
               "unit": first.unit, "rate": str((first.rate or ZERO).quantize(THOUSANDTH)),
               "amount_only": first.note == "Amount only"},
           "weights": [{"unit": unit, "quantity": str(qty.quantize(THOUSANDTH))} for unit, qty in sorted(weights.items())],
           "credit": credit, "needs_review": invoice.needs_review, "source": invoice.source,
           "has_files": has_files(invoice), "checks": checks(invoice, lines, duplicated),
           "locked": credit["state"] == "filed"}
    if include_lines:
        out["lines"] = [line_block(li) for li in lines]
    return out


def purchase_rows(invoices, include_lines=False, lines=None, duplicates=None):
    invoices = list(invoices)
    lines = read_lines(invoices, LINE_FIELDS, lines)
    closed = closed_credit_months({b.business_id for b in invoices})
    duplicated = duplicate_ids(invoices, duplicates, narrow=True)
    return [purchase_row(b, lines[b.pk], closed, b.pk in duplicated, include_lines) for b in invoices]


def purchase_detail(invoice):
    from billing.services.capture_reads import capture_summary, purchase_files

    lines = lines_of([invoice], LINE_FIELDS)[invoice.pk]
    activity = list(uncached(AuditLog).filter(entity="invoice", entity_id=invoice.pk).select_related("user")
                    .only("timestamp", "action", "details", "user__first_name", "user__last_name", "user__username")
                    .order_by("-timestamp", "-id")[:50])
    creator = (uncached(AuditLog).filter(entity="invoice", entity_id=invoice.pk, action__in=("created", "imported"))
               .select_related("user").only("user__first_name", "user__last_name", "user__username")
               .order_by("timestamp", "id").first())
    capture = (uncached(InwardCapture).filter(invoice_id=invoice.pk).select_related("captured_by")
               .only("created_at", "captured_by_id", "captured_by__first_name", "captured_by__last_name",
                     "captured_by__username", "pages", "note", "supplier_hint", "pdf", "read_data").first())
    linked = (Invoice.objects.sales().select_related("customer").filter(pk=invoice.linked_sale)
              .only("invoice_number", "invoice_date", "status", "customer_id", "customer__name").first()
              if invoice.linked_sale else None)
    firm = invoice.business
    return {**purchase_row(invoice, lines, closed_credit_months({invoice.business_id}),
                           invoice.pk in duplicate_ids([invoice], narrow=True), True),
            "firm": {"id": firm.pk, "name": firm.name, "short": firm.name.split()[0].title(),
                     "gst_number": firm.gst_number or "", "state_code": state_code(firm), "state_name": firm.state_name},
            "supplier": supplier_ref(invoice.customer, True), "buyer_gstin": invoice.buyer_gstin,
            "buyer_ack": invoice.buyer_ack, "linked_sale": bill_ref(linked) if linked else None,
            "slabs": [{"gst_percent": slab, **figures(value)} for slab, value in
                      sorted(grouped(lines, lambda li: percent(li.gst_tax_rate)).items(), key=lambda kv: -Decimal(kv[0]))],
            "files": purchase_files(invoice), "capture": capture_summary(capture) if capture else None,
            "history": {"created_by": person(creator.user) if creator else None,
                        "activity": [{"at": stamp(e.timestamp), "by": person(e.user)["name"] if e.user else None,
                                      "action": e.action,
                                      "details": e.details} for e in activity]}}


def credit_filter(qs, month):
    return qs.filter(invoice_date__gte=LEDGER_START).filter(Q(itc_month=month) | Q(itc_month__isnull=True, invoice_date__year=month.year,
                                           invoice_date__month=month.month))


def search(qs, text):
    name = Q()
    for word in text.split():
        name &= Q(customer__name__istartswith=word) | Q(customer__name__icontains=f" {word}")
    match = Q(invoice_number__icontains=text) | name
    if len(text) >= 4:
        match |= Q(customer__gst_number__icontains=text)
    if len(text) >= 3:
        line = uncached(LineItem).filter(invoice_id=OuterRef("pk")).filter(
            Q(product_name__istartswith=text) | Q(product_name__icontains=f" {text}"))
        qs = qs.alias(item_match=Exists(line))
        match |= Q(item_match=True)
    # The Python key is shared with find_duplicate; read only ids and numbers for separator folding.
    key = inward_number_key(text)
    if key:
        ids = [pk for pk, number in qs.values_list("pk", "invoice_number") if key in inward_number_key(number)]
        match |= Q(pk__in=ids)
    return qs.filter(match)


def filter_purchases(qs, params, duplicates=None):
    firm, supplier = id_param(params, "business_id", PICK_A_FIRM), id_param(params, "supplier_id", PICK_SUPPLIER)
    if firm is not None:
        qs = qs.filter(business_id=firm)
    if supplier is not None:
        qs = qs.filter(customer_id=supplier)
    credit = params.get("credit_month")
    if credit:
        from rest_framework.exceptions import ValidationError
        try:
            year, month = month_param({"month": credit})
        except ValidationError:
            raise ValidationError({"credit_month": ["Give the month like 2026-09."]}) from None
        if date(year, month, 1) < LEDGER_START:
            raise ValidationError({"credit_month": ["The credit ledger starts in April 2025. Pick April 2025 or later."]})
        qs = credit_filter(qs, date(year, month, 1))
    else:
        fy, month = fy_param(params), month_param(params)
        start, end = date_param(params, "start_date"), date_param(params, "end_date")
        if fy is not None:
            qs = qs.filter(invoice_date__range=fy_range(fy))
        if month:
            qs = qs.filter(invoice_date__year=month[0], invoice_date__month=month[1])
        if start:
            qs = qs.filter(invoice_date__gte=start)
        if end:
            qs = qs.filter(invoice_date__lte=end)
    if params.get("check") == "1":
        qs = qs.filter(needs_review=True)
    if params.get("eligible") == "0":
        qs = qs.filter(itc_eligible=False)
    if params.get("photo") == "1":
        qs = qs.filter(Q(has_capture=True) | (Q(source_file__isnull=False) & ~Q(source_file="")))
    if params.get("empty") == "1":
        qs = qs.filter(~Exists(uncached(LineItem).filter(invoice_id=OuterRef("pk"))))
    if params.get("no_hsn") == "1":
        qs = qs.filter(Exists(uncached(LineItem).filter(invoice_id=OuterRef("pk")).filter(
            Q(hsn_code__isnull=True) | Q(hsn_code__regex=r"^\s*$"))))
    if params.get("dups") == "1":
        qs = qs.filter(pk__in=duplicate_ids(qs.select_related(None).only("business_id", "invoice_date"), duplicates))
    if search_text(params):
        qs = search(qs, search_text(params))
    return qs


def ordered(qs, params):
    order = {"-date": ("-invoice_date", "-created_at", "-id"), "date": ("invoice_date", "created_at", "id"),
             "total": ("total_amount", "id"), "-total": ("-total_amount", "-id"),
             "supplier": ("customer__name", "-invoice_date", "-id")}
    return qs.order_by(*order.get(params.get("ordering"), order["-date"]))


def purchase_summary(qs, lines=None):
    bills = [SimpleNamespace(pk=row.pop("id"), **row)
             for row in qs.select_related(None).values("id", *TOTAL_FIELDS)]
    lines = read_lines(bills, ("quantity", "rate", *HEADS), lines)
    total = sums([li for bill in bills for li in lines[bill.pk]])
    return {"bills": len(bills), **figures(total),
            "total_amount": money(sum((b.total_amount for b in bills), ZERO)),
            "credit": money(sum((Decimal(credit_block(b, sums(lines[b.pk])["tax"], set())["claimed"]) for b in bills), ZERO))}


def purchase_facets(qs, params, lines=None, duplicates=None):
    firm = id_param(params, "business_id", PICK_A_FIRM)
    year = fy_param(params)
    year = fy_of(None) if year is None else year
    start, end = fy_range(year)
    base = qs.filter(business_id=firm) if firm is not None else qs
    # Rows dated in the FY plus late credit arriving from any earlier FY, in one narrow read.
    relevant = list(base.filter(Q(invoice_date__range=(start, end)) | Q(itc_month__range=(start, end)))
                    .select_related(None).select_related("business").only(
                        "business_id", "invoice_date", "itc_month", "itc_eligible", "needs_review",
                        "source_file", "buyer_gstin", "business__gst_number"))
    lines = read_lines(relevant, ("quantity", "rate", "hsn_code", *HEADS), lines)
    twins = duplicate_ids(relevant, duplicates)
    firms = [firm] if firm is not None else list(uncached(Business).values_list("pk", flat=True))
    closed = closed_credit_months(firms)
    by_date, by_credit, late, late_credit, credit_sum = Counter(), Counter(), Counter(), Counter(), Counter()
    check_counts = dict.fromkeys(("needs_review", "duplicate", "no_lines", "no_hsn", "photo"), 0)
    for bill in relevant:
        month = credit_month_of(bill)
        claimed = Decimal(credit_block(bill, sums(lines[bill.pk])["tax"], closed)["claimed"])
        if month is not None and start <= month <= end:
            by_credit[month] += 1
            credit_sum[month] += claimed
            if month != bill.invoice_date.replace(day=1):
                late[month] += 1
                late_credit[month] += claimed
        if start <= bill.invoice_date <= end:
            by_date[bill.invoice_date.replace(day=1)] += 1
            check_counts["needs_review"] += bill.needs_review
            check_counts["photo"] += has_files(bill)
            for check in checks(bill, lines[bill.pk], bill.pk in twins):
                if check in check_counts:
                    check_counts[check] += 1
    months, cursor = [], start
    while cursor <= min(end, timezone.localdate()):
        months.append({"month": cursor.strftime("%Y-%m"), "bills": by_date[cursor], "late_in": late[cursor],
                       "late_in_credit": money(late_credit[cursor]),
                       "closed": bool(firms) and all((f, cursor.year, cursor.month) in closed for f in firms)})
        cursor = date(cursor.year + cursor.month // 12, cursor.month % 12 + 1, 1)
    elsewhere = Counter()
    if search_text(params):
        elsewhere.update(fy_of(day) for day in search(base, search_text(params)).exclude(
            invoice_date__range=(start, end)).values_list("invoice_date", flat=True))
    return {"months": months,
            "credit_months": [{"month": m.strftime("%Y-%m"), "bills": by_credit[m], "credit": money(credit_sum[m])}
                              for m in sorted(by_credit) if credit_sum[m]], "checks": check_counts,
            "elsewhere": [{"fy": fy_label(y), "bills": n} for y, n in sorted(elsewhere.items(), reverse=True)]}


def usual_rate(params):
    product = UNSTORABLE.sub("", str(params.get("product_name") or "")).strip()
    unit = UNSTORABLE.sub("", str(params.get("unit") or "")).strip()
    supplier = id_param(params, "supplier_id", PICK_SUPPLIER)
    qs = uncached(LineItem).filter(invoice__type_of_invoice="inward", product_name__iexact=product, unit=unit,
                                  invoice__invoice_date__gte=timezone.localdate() - timedelta(days=182),
                                  invoice__invoice_date__lte=timezone.localdate()).exclude(note="Amount only")
    value = ExpressionWrapper(Coalesce("quantity", ZERO) * Coalesce("rate", ZERO),
                              output_field=DecimalField(max_digits=30, decimal_places=6))
    sums_all = {"all_quantity": Sum("quantity"), "all_value": Sum(value)}
    if supplier is not None:
        sums_all.update(own_quantity=Sum("quantity", filter=Q(invoice__customer_id=supplier)),
                        own_value=Sum(value, filter=Q(invoice__customer_id=supplier)))
    totals = qs.aggregate(**sums_all)
    own = bool(totals.get("own_quantity"))
    quantity, total = (totals["own_quantity"], totals["own_value"]) if own else (totals["all_quantity"], totals["all_value"])
    last = (uncached(LineItem).filter(invoice__type_of_invoice="inward", invoice__customer_id=supplier,
            product_name__iexact=product, unit=unit).exclude(note="Amount only")
            .order_by("-invoice__invoice_date", "-invoice__created_at", "-id")
            .values("rate", "invoice__invoice_date", "invoice__invoice_number").first()) if supplier is not None else None
    return {"rate": str((total / quantity).quantize(THOUSANDTH, rounding=ROUND_HALF_UP)) if quantity else None,
            "from": ("them" if own else "anyone") if quantity else None,
            "last": {"rate": str(last["rate"].quantize(THOUSANDTH)),
                     "invoice_date": last["invoice__invoice_date"].isoformat(),
                     "invoice_number": last["invoice__invoice_number"]} if last else None}
