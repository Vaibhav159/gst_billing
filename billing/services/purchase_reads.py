"""The contract's purchase rows, figures and filters, reading around cacheops."""
from collections import defaultdict
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from types import SimpleNamespace

from django.db.models import (
    Case,
    CharField,
    Count,
    DateField,
    DecimalField,
    Exists,
    ExpressionWrapper,
    F,
    Func,
    IntegerField,
    OuterRef,
    Q,
    Subquery,
    Sum,
    Value,
    When,
)
from django.db.models.functions import (
    Cast,
    Coalesce,
    Collate,
    ExtractMonth,
    ExtractYear,
    Replace,
    Round,
    TruncMonth,
    Upper,
)
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
DETAIL_FIELDS = (*ROW_FIELDS, "source_preview", "buyer_ack", "linked_sale", "customer__address",
                 "customer__pan_number", "customer__customer_type", "customer__mobile_number", "customer__email")


MONEY_SQL = DecimalField(max_digits=30, decimal_places=6)
# Every non-ASCII character whose Python upper() contributes ASCII to inward_number_key.
# Fold before C-collated SQL upper(): PostgreSQL's locale must not change the shared identity.
ASCII_FOLDS = {"ß": "SS", "ı": "I", "ŉ": "N", "ſ": "S", "ǰ": "J", "ẖ": "H", "ẗ": "T",
               "ẘ": "W", "ẙ": "Y", "ẚ": "A", "ﬀ": "FF", "ﬁ": "FI", "ﬂ": "FL", "ﬃ": "FFI",
               "ﬄ": "FFL", "ﬅ": "ST", "ﬆ": "ST"}

# Python 3.12 Unicode 15 Nd ranges: its regex \d includes these under every locale.
# C-collated PostgreSQL \d is ASCII-only, so spell the same boundaries explicitly.
DECIMAL_DIGITS = (
    "\u0030-\u0039\u0660-\u0669\u06f0-\u06f9\u07c0-\u07c9\u0966-\u096f"
    "\u09e6-\u09ef\u0a66-\u0a6f\u0ae6-\u0aef\u0b66-\u0b6f\u0be6-\u0bef"
    "\u0c66-\u0c6f\u0ce6-\u0cef\u0d66-\u0d6f\u0de6-\u0def\u0e50-\u0e59"
    "\u0ed0-\u0ed9\u0f20-\u0f29\u1040-\u1049\u1090-\u1099\u17e0-\u17e9"
    "\u1810-\u1819\u1946-\u194f\u19d0-\u19d9\u1a80-\u1a89\u1a90-\u1a99"
    "\u1b50-\u1b59\u1bb0-\u1bb9\u1c40-\u1c49\u1c50-\u1c59\ua620-\ua629"
    "\ua8d0-\ua8d9\ua900-\ua909\ua9d0-\ua9d9\ua9f0-\ua9f9\uaa50-\uaa59"
    "\uabf0-\uabf9\uff10-\uff19\U000104a0-\U000104a9\U00010d30-\U00010d39\U00011066-\U0001106f"
    "\U000110f0-\U000110f9\U00011136-\U0001113f\U000111d0-\U000111d9\U000112f0-\U000112f9\U00011450-\U00011459"
    "\U000114d0-\U000114d9\U00011650-\U00011659\U000116c0-\U000116c9\U00011730-\U00011739\U000118e0-\U000118e9"
    "\U00011950-\U00011959\U00011c50-\U00011c59\U00011d50-\U00011d59\U00011da0-\U00011da9\U00011f50-\U00011f59"
    "\U00016a60-\U00016a69\U00016ac0-\U00016ac9\U00016b50-\U00016b59\U0001d7ce-\U0001d7ff\U0001e140-\U0001e149"
    "\U0001e2f0-\U0001e2f9\U0001e4f0-\U0001e4f9\U0001e950-\U0001e959\U0001fbf0-\U0001fbf9"
)


class NumberKey(Func):
    """The shared purchase identity, evaluated by the database instead of transferring numbers."""
    function = "v3_purchase_number_key"
    output_field = CharField()
    arity = 1

    def as_sqlite(self, compiler, connection, **extra_context):
        # SQLite has no regexp_replace; its deterministic function uses the existing comparator.
        connection.ensure_connection()
        connection.connection.create_function(self.function, 1, inward_number_key, deterministic=True)
        return super().as_sql(compiler, connection, **extra_context)

    def as_postgresql(self, compiler, connection, **extra_context):
        expression = Replace(self.source_expressions[0], Value("#"), Value("/"))
        for character, folded in ASCII_FOLDS.items():
            expression = Replace(expression, Value(character), Value(folded))
        expression = Upper(Collate(expression, "C"))
        expression = Func(expression, Value(f"(?<=[{DECIMAL_DIGITS}])[^0-9A-Z]+(?=[{DECIMAL_DIGITS}])"), Value("#"), Value("g"),
                          function="REGEXP_REPLACE", output_field=CharField())
        expression = Func(expression, Value("[^0-9A-Z#]"), Value(""), Value("g"),
                          function="REGEXP_REPLACE", output_field=CharField())
        return compiler.compile(Replace(expression, Value("#"), Value("-")))


def _rounded_tax():
    return Round(F("cgst"), 2) + Round(F("sgst"), 2) + Round(F("igst"), 2)


def _credit_totals(qs):
    """One rounded tax subtotal per bill, then the contract's eligibility/deadline predicate."""
    tax = (uncached(LineItem).filter(invoice_id=OuterRef("pk")).order_by().values("invoice_id")
           .annotate(tax=Sum(_rounded_tax(), output_field=MONEY_SQL)).values("tax"))
    qs = qs.annotate(
        _tax=Coalesce(Subquery(tax), Value(ZERO), output_field=MONEY_SQL),
        _credit_month=Coalesce("itc_month", Cast(TruncMonth("invoice_date"), DateField())),
        _limit_year=ExtractYear("invoice_date") + Case(When(invoice_date__month__lt=4, then=Value(0)),
                                                    default=Value(1), output_field=IntegerField()),
        _credit_year=ExtractYear(Coalesce("itc_month", "invoice_date")),
        _credit_number=ExtractMonth(Coalesce("itc_month", "invoice_date")),
    )
    in_time = Q(_credit_year__lt=F("_limit_year")) | Q(_credit_year=F("_limit_year"), _credit_number__lte=10)
    # credit_lapsed is false for a zero/negative historical tax subtotal, even after the deadline.
    claimable = Q(itc_eligible=True, invoice_date__gte=LEDGER_START) & (in_time | Q(_tax__lte=ZERO))
    return qs.annotate(_claimed=Case(When(claimable, then=F("_tax")), default=Value(ZERO), output_field=MONEY_SQL))


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
    key = inward_number_key(text)
    if key:
        qs = qs.alias(number_key=NumberKey("invoice_number"))
        match |= Q(number_key__contains=key)
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
        pairs = qs.order_by().annotate(year=ExtractYear("invoice_date") - Case(
            When(invoice_date__month__lt=4, then=Value(1)), default=Value(0), output_field=IntegerField()))
        identities = [SimpleNamespace(business_id=pk, invoice_date=date(year, 4, 1))
                      for pk, year in pairs.values_list("business_id", "year").distinct()]
        qs = qs.filter(pk__in=duplicate_ids(identities, duplicates))
    if search_text(params):
        qs = search(qs, search_text(params))
    return qs


def ordered(qs, params):
    order = {"-date": ("-invoice_date", "-created_at", "-id"), "date": ("invoice_date", "created_at", "id"),
             "total": ("total_amount", "id"), "-total": ("-total_amount", "-id"),
             "supplier": ("customer__name", "-invoice_date", "-id")}
    return qs.order_by(*order.get(params.get("ordering"), order["-date"]))


def purchase_summary(qs, lines=None):
    # Keep invoice totals separate from the line join: a two-line bill counts once.
    bills = _credit_totals(qs.select_related(None).order_by()).aggregate(
        bills=Count("pk"), total_amount=Sum("total_amount"), credit=Sum("_claimed"))
    line_rows = uncached(LineItem).filter(invoice_id__in=qs.order_by().values("pk"))
    total = line_rows.aggregate(
        taxable=Sum(Round(F("quantity") * F("rate"), 2), output_field=MONEY_SQL),
        **{head: Sum(Round(F(head), 2), output_field=MONEY_SQL) for head in HEADS})
    total = {key: value or ZERO for key, value in total.items()}
    total["tax"] = sum((total[head] for head in HEADS), ZERO)
    return {"bills": bills["bills"], **figures(total), "total_amount": money(bills["total_amount"] or ZERO),
            "credit": money(bills["credit"] or ZERO)}


def purchase_facets(qs, params, lines=None, duplicates=None):
    firm = id_param(params, "business_id", PICK_A_FIRM)
    year = fy_param(params)
    year = fy_of(None) if year is None else year
    start, end = fy_range(year)
    base = (qs.filter(business_id=firm) if firm is not None else qs).select_related(None).order_by()
    firms = [firm] if firm is not None else list(uncached(Business).values_list("pk", flat=True))
    closed = closed_credit_months(firms)
    # Duplicate identity still has one narrow firm/FY read; no FY headers or lines cross the wire for sums.
    twins = duplicate_ids([SimpleNamespace(business_id=pk, invoice_date=start) for pk in firms], duplicates)
    own = base.filter(invoice_date__range=(start, end)).alias(
        has_line=Exists(uncached(LineItem).filter(invoice_id=OuterRef("pk"))),
        missing_hsn=Exists(uncached(LineItem).filter(invoice_id=OuterRef("pk")).filter(
            Q(hsn_code__isnull=True) | Q(hsn_code__regex=r"^\s*$"))),
    )
    photo = Q(has_capture=True) | (Q(source_file__isnull=False) & ~Q(source_file=""))
    by_date = {row["month"]: row for row in own.annotate(month=TruncMonth("invoice_date")).values("month").annotate(
        bills=Count("pk"), needs_review=Count("pk", filter=Q(needs_review=True)),
        duplicate=Count("pk", filter=Q(pk__in=twins)), no_lines=Count("pk", filter=Q(has_line=False)),
        no_hsn=Count("pk", filter=Q(missing_hsn=True)), photo=Count("pk", filter=photo))}
    allocated = _credit_totals(base).filter(invoice_date__gte=LEDGER_START, _credit_month__range=(start, end))
    late = ~Q(_credit_month=TruncMonth("invoice_date"))
    by_credit = {row["_credit_month"]: row for row in allocated.values("_credit_month").annotate(
        bills=Count("pk"), credit=Sum("_claimed"), late_in=Count("pk", filter=late),
        late_in_credit=Sum("_claimed", filter=late))}
    check_counts = {key: sum(row[key] for row in by_date.values())
                    for key in ("needs_review", "duplicate", "no_lines", "no_hsn", "photo")}
    months, cursor = [], start
    while cursor <= min(end, timezone.localdate()):
        credit_rows = by_credit.get(cursor, {})
        months.append({"month": cursor.strftime("%Y-%m"), "bills": by_date.get(cursor, {}).get("bills", 0),
                       "late_in": credit_rows.get("late_in", 0), "late_in_credit": money(credit_rows.get("late_in_credit") or ZERO),
                       "closed": bool(firms) and all((f, cursor.year, cursor.month) in closed for f in firms)})
        cursor = date(cursor.year + cursor.month // 12, cursor.month % 12 + 1, 1)
    elsewhere = []
    if search_text(params):
        hits = search(base, search_text(params)).exclude(invoice_date__range=(start, end)).annotate(
            year=ExtractYear("invoice_date") - Case(When(invoice_date__month__lt=4, then=Value(1)),
                                                  default=Value(0), output_field=IntegerField()))
        elsewhere = [{"fy": fy_label(row["year"]), "bills": row["bills"]}
                     for row in hits.values("year").annotate(bills=Count("pk")).order_by("-year")]
    return {"months": months,
            "credit_months": [{"month": month.strftime("%Y-%m"), "bills": row["bills"], "credit": money(row["credit"])}
                              for month, row in sorted(by_credit.items()) if row["credit"]],
            "checks": check_counts, "elsewhere": elsewhere}


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
