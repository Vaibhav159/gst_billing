"""What v3 shows of a sale: the list rows, their summary and facets, and the bill page (part 1
API contract, sections 0.2 and 2.1-2.2). Reads only: nothing here writes (Ruling 1A-16).

Every money figure is worked out the server's one way: a line's taxable value is
paise(quantity x rate), its heads and tax are as stored, and each sum is rounded to the paisa
once, so a list row, its bill and the list's summary agree. A bill's total is exact: no rupee
rounding (Ruling 1B-12).
"""

import re
from collections import Counter, defaultdict
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from django.core.exceptions import ObjectDoesNotExist
from django.db.models import Case, Exists, IntegerField, OuterRef, Q, QuerySet, Value, When
from django.db.models.functions import Coalesce, ExtractYear, Length, Trim
from django.utils import timezone

from billing.cache import uncached
from billing.constants import B2CL_THRESHOLD, BILL_ACTIVE, BILL_CANCELLED, GST_CODE
from billing.fy import fy_label, fy_of, fy_range
from billing.gstin import validate
from billing.media import sign_media_path
from billing.models import AuditLog, Business, Invoice, LineItem
from billing.numbering import bill_ref, counter_of
from billing.params import PICK_A_CUSTOMER, PICK_A_FIRM, date_param, fy_param, id_param, month_param, text_param
from billing.period_lock import closed_months
from billing.services.sales import FIRM_FIELDS, firm_snapshot, sent_block
from billing.tax_rules import (
    GSTIN_SHAPE,
    HEADS,
    PAISA,
    THOUSANDTH,
    chosen_place,
    classify_b2c,
    clean_gstin,
    has_gstin,
    normalize_rate,
    place_of_supply,
    rate_as_percent,
    state_code,
    supply_interstate,
    to_paise,
)
from billing.text import in_words, inr, money, percent, person, stamp

ZERO = Decimal("0")
ITAX_LIMIT = Decimal("200000")  # Sec 269ST (cash, at or over) and Rule 114B (PAN, over)
EWAY_LIMIT = Decimal("50000")
RATE_PLACES = Decimal("0.0001")  # LineItem.gst_tax_rate keeps 4 places

# What the FY-wide reads fetch (Ruling 1A-36: Neon's free plan has 5 GB of transfer a month): only the columns the
# checks (bill_checks, supply_interstate, classify_b2c), the facets' views and duplicated_ids read of a bill, and
# what bill_checks and sums() read of a line. A column left out here would be read again a bill at a time:
# test_the_narrowed_reads_never_load_a_column_later fails on that.
CHECK_FIELDS = ("invoice_date", "status", "paper", "sent_at", "payment_mode", "total_amount", "place_of_supply",
                "customer__gst_number", "customer__state_name", "business__gst_number", "business__state_name")
ITAX_FIELDS = ("status", "payment_mode", "total_amount", "customer__name", "customer__customer_type",
               "customer__pan_number", "customer__gst_number", "customer__address")
LINE_FIELDS = ("quantity", "rate", "gst_tax_rate", "cgst", "sgst", "igst", "hsn_code")


# ── one bill ──────────────────────────────────────────────────────────────

def line_taxable(li):
    """A line's taxable value: paise(quantity x rate), the one way every figure works it out."""
    return to_paise((li.quantity or 0) * (li.rate or 0))


def line_tax(li):
    """A line's tax as stored: CGST + SGST + IGST."""
    return sum((getattr(li, head) or ZERO for head in HEADS), ZERO)


def sums(lines):
    """Lines added up: the taxable value (each line's to the paisa), the stored heads, the tax and the quantity."""
    out = dict.fromkeys(("taxable", *HEADS, "tax", "quantity"), ZERO)
    for li in lines:
        out["taxable"] += line_taxable(li)
        for head in HEADS:
            out[head] += getattr(li, head) or ZERO
        out["tax"] += line_tax(li)
        out["quantity"] += li.quantity or ZERO
    return out


def grouped(lines, key):
    """sums() per group of lines, by key(line)."""
    groups = defaultdict(list)
    for li in lines:
        groups[key(li)].append(li)
    return {k: sums(group) for k, group in groups.items()}


def figures(totals):
    """sums() as the API sends money: the taxable value, each head and the tax, each rounded to the paisa once."""
    return {k: money(totals[k]) for k in ("taxable", *HEADS, "tax")}


def itax_flags(invoice):
    """The income-tax checks on a saved bill (design §4.5; PROTO complianceFlags). None on a cancelled bill."""
    if invoice.status == BILL_CANCELLED:
        return []
    customer, total, flags = invoice.customer, invoice.total_amount or ZERO, []
    if invoice.payment_mode == "cash" and total >= ITAX_LIMIT:
        flags.append({"kind": "cash_limit", "short": "Cash ≥ ₹2 lakh",
                      "text": f"{inr(total)} taken in cash is at or over the ₹2,00,000 limit for one bill "
                              "(Income Tax Sec 269ST)."})
    if total > ITAX_LIMIT and customer.kind == "walkin":
        flags.append({"kind": "walkin_limit", "short": "Walk-in over ₹2 lakh",
                      "text": "A bill over ₹2,00,000 needs the buyer's PAN (Rule 114B). Put the bill in the buyer's "
                              "name, with their PAN, not Walk-in."})
    elif total > ITAX_LIMIT and not customer.pan:
        flags.append({"kind": "pan", "short": "PAN missing",
                      "text": f"A bill over ₹2,00,000 needs the buyer's PAN (Rule 114B). Add {customer.name}'s PAN."})
    if has_gstin(customer.gst_number) and not (customer.address or "").strip():
        flags.append({"kind": "b2b_address", "short": "No address",
                      "text": "A bill to a business needs the buyer's address (CGST Rule 46). Add it on the customer."})
    return flags


def _tax_off(li):
    """A line's stored tax differs from its slab's by more than a paisa (a line with no taxable value is left be)."""
    taxable = line_taxable(li)
    return bool(taxable) and abs(to_paise(taxable * rate_as_percent(li.gst_tax_rate) / 100) - line_tax(li)) > PAISA


def bill_checks(invoice, lines, duplicated):
    """What makes a bill "Need a check" (PROTO needsCheck). None on a cancelled bill."""
    if invoice.status == BILL_CANCELLED:
        return []
    out = []
    if not lines:
        out.append("no_lines")
    if any(not (li.hsn_code or "").strip() for li in lines):
        out.append("no_hsn")
    if duplicated:
        out.append("duplicate")
    inter = supply_interstate(invoice)
    if any((li.cgst or li.sgst) if inter else li.igst for li in lines):
        out.append("heads_mismatch")
    if any(_tax_off(li) for li in lines):
        out.append("tax_mismatch")
    return out


def _number_key(firm, day, number):
    """A bill's number as the duplicate check compares it: in its firm and FY, trimmed, in any case."""
    return firm, fy_of(day), (number or "").strip().lower()


def _by_number(invoices):
    """{_number_key: [ids]} of every sale in the firms and FYs of `invoices` (any status): one query."""
    where = Q()
    for firm, fy in {(inv.business_id, fy_of(inv.invoice_date)) for inv in invoices}:
        where |= Q(business_id=firm, invoice_date__range=fy_range(fy))
    groups = defaultdict(list)
    if where:
        for pk, *bill in Invoice.objects.sales().filter(where).values_list(
                "pk", "business_id", "invoice_date", "invoice_number"):
            key = _number_key(*bill)
            if key[2]:
                groups[key].append(pk)
    return groups


def duplicated_ids(invoices):
    """Ids of the sales whose number another sale of the same firm and FY also has (any status, any case), in the
    firms and FYs of `invoices`."""
    return {pk for ids in _by_number(invoices).values() if len(ids) > 1 for pk in ids}


def _customer_ref(customer):
    """CustomerRef (part 1 API contract, 0.2)."""
    return {"id": customer.pk, "name": customer.name, "gst_number": customer.gst_number or "",
            "mobile_number": customer.mobile_number or "", "type": customer.kind}


def bill_row(invoice, lines, closed, duplicated):
    """A sale as a list row (BillRow). `closed`: closed months of its firm; `duplicated`: its number is used twice."""
    day = invoice.invoice_date
    return {
        "id": invoice.pk, "business": invoice.business_id, "business_name": invoice.business.name,
        "invoice_number": invoice.invoice_number, "counter": counter_of(invoice.invoice_number),
        "fy": fy_label(fy_of(day)), "invoice_date": day.isoformat(), "created_at": stamp(invoice.created_at),
        "paper": invoice.paper, "customer": _customer_ref(invoice.customer), "payment_mode": invoice.payment_mode,
        **figures(sums(lines)), "total_amount": money(invoice.total_amount),
        "interstate": supply_interstate(invoice),
        "gst_percents": sorted({percent(li.gst_tax_rate) for li in lines}, key=Decimal, reverse=True),
        "line_count": len(lines), "status": invoice.status, "cancel_reason": invoice.cancel_reason,
        "sent": sent_block(invoice), "checks": bill_checks(invoice, lines, duplicated), "itax": itax_flags(invoice),
        "locked": (invoice.business_id, day.year, day.month) in closed,
    }


def lines_of(invoices, fields=None):
    """{invoice id: [its lines]} in one query, in the order they were made, read around cacheops (Ruling 1A-34).

    `invoices`: bills, or a queryset of them, read as a subquery and never fetched. `fields`: only these columns
    (Ruling 1A-36); every line's by default.
    """
    ids = invoices.values("pk") if isinstance(invoices, QuerySet) else [inv.pk for inv in invoices]
    lines = uncached(LineItem).filter(invoice_id__in=ids).order_by("id")
    out = defaultdict(list)
    for li in lines.only("invoice", *fields) if fields else lines:
        out[li.invoice_id].append(li)
    return out


def bill_rows(invoices):
    """BillRows for a page of sales (customer and firm joined): three queries however long the page."""
    invoices = list(invoices)
    lines = lines_of(invoices, LINE_FIELDS)  # a row shows figures, not items
    closed = closed_months({inv.business_id for inv in invoices})
    twice = duplicated_ids(invoices)
    return [bill_row(inv, lines[inv.pk], closed, inv.pk in twice) for inv in invoices]


def firm_block(invoice):
    """The firm as the bill prints it: frozen at create or move, else the live firm (older bills). Every key of the
    contract's firm, whatever an older snapshot holds."""
    frozen = invoice.firm_snapshot if isinstance(invoice.firm_snapshot, dict) else None
    source = frozen or firm_snapshot(invoice.business)
    data = {field: source.get(field) or "" for field in FIRM_FIELDS}
    signature = source.get("signature_image") or ""
    data["state_code"] = state_code(SimpleNamespace(**data))
    data["signature_url"] = sign_media_path(signature) if signature else None
    data["frozen"] = bool(frozen)
    return data


def _named(invoice, field):
    """The person a bill names in `field`, or None: nobody, or a user v2 deleted since (Ruling 1A-6)."""
    try:
        return person(getattr(invoice, field))
    except ObjectDoesNotExist:
        return None


def _same_number(invoice):
    """The other sales with this bill's number in its firm and FY, as the list's duplicate check finds them."""
    key = _number_key(invoice.business_id, invoice.invoice_date, invoice.invoice_number)
    ids = [pk for pk in _by_number([invoice]).get(key, []) if pk != invoice.pk]
    return list(Invoice.objects.sales().filter(pk__in=ids).select_related("customer").order_by("invoice_date", "pk")) if ids else []


def bill_detail(invoice):
    """GET sales/{id}/: the bill page and the print data (BillDetail)."""
    lines = lines_of([invoice])[invoice.pk]
    twins = _same_number(invoice)
    customer, total = invoice.customer, invoice.total_amount or ZERO
    pos, gstin = place_of_supply(invoice), clean_gstin(customer.gst_number)
    replaces = (Invoice.objects.sales().filter(pk=invoice.replaces).select_related("customer").first()
                if invoice.replaces else None)
    replaced_by = Invoice.objects.sales().filter(replaces=invoice.pk).select_related("customer").order_by("pk").first()
    made = (Invoice.history.filter(id=invoice.pk, history_type="+").order_by("history_date")
            .select_related("history_user").first())
    activity = (AuditLog.objects.filter(entity="invoice", entity_id=invoice.pk).select_related("user")
                .order_by("-timestamp", "-id")[:50])
    by_slab = grouped(lines, lambda li: percent(li.gst_tax_rate))
    by_hsn = grouped(lines, lambda li: (li.hsn_code or "", percent(li.gst_tax_rate), li.unit or ""))
    return {
        **bill_row(invoice, lines, closed_months({invoice.business_id}), bool(twins)),
        "place_of_supply": pos, "place_of_supply_name": GST_CODE.get(pos, ""),
        "place_of_supply_chosen": chosen_place(invoice) or None,  # one reading of the place everywhere (Task 5)
        "segment": classify_b2c(invoice.business, invoice)[0],
        "notes": invoice.notes,
        "replaces": bill_ref(replaces) if replaces else None,
        "replaced_by": bill_ref(replaced_by) if replaced_by else None,
        "cancelled_at": stamp(invoice.cancelled_at), "cancelled_by": _named(invoice, "cancelled_by"),
        "firm": firm_block(invoice),
        "customer": {**_customer_ref(customer), "address": customer.address or "", "city": customer.city or "",
                     "state_name": customer.state_name or "", "state_code": state_code(customer),
                     "gstin_valid": validate(gstin)[0] if gstin else None,
                     "pan_number": customer.pan_number or "", "pan": customer.pan, "email": customer.email or ""},
        "lines": [{"id": li.pk, "product_name": li.product_name, "hsn_code": li.hsn_code,
                   "quantity": str((li.quantity or ZERO).quantize(THOUSANDTH)), "unit": li.unit,
                   "rate": str((li.rate or ZERO).quantize(THOUSANDTH)), "gst_percent": percent(li.gst_tax_rate),
                   **figures(sums([li])), "amount": money(li.amount), "note": li.note}
                  for li in lines],
        "slabs": [{"gst_percent": slab, **figures(g)}
                  for slab, g in sorted(by_slab.items(), key=lambda kv: -Decimal(kv[0]))],
        "hsn_summary": [{"hsn_code": hsn, "gst_percent": slab, "unit": unit,
                         "quantity": str(g["quantity"].quantize(THOUSANDTH)), **figures(g)}
                        for (hsn, slab, unit), g in sorted(by_hsn.items(),
                                                           key=lambda kv: (-Decimal(kv[0][1]), kv[0][0], kv[0][2]))],
        "total_in_words": in_words(total), "tax_in_words": in_words(sums(lines)["tax"]),
        "eway": {
            "eway_bill_number": invoice.eway_bill_number, "transporter_name": invoice.transporter_name,
            "transporter_gstin": invoice.transporter_gstin, "vehicle_number": invoice.vehicle_number,
            "vehicle_type": invoice.vehicle_type, "transport_mode": invoice.transport_mode,
            "distance_km": invoice.distance_km,
            "may_be_needed": (invoice.status == BILL_ACTIVE and total > EWAY_LIMIT and not invoice.eway_bill_number
                              and any(li.hsn_code and not li.hsn_code.startswith("71") for li in lines)),
        },
        "duplicates": [bill_ref(b) for b in twins],
        "history": {
            "created_by": person(made.history_user) if made else None,
            "activity": [{"at": stamp(e.timestamp), "by": person(e.user)["name"] if e.user else None,
                          "action": e.action, "details": e.details} for e in activity],
        },
    }


# ── the list ──────────────────────────────────────────────────────────────

def search(bills, q):
    """Bills whose number contains q; or whose customer's name has words starting with each word of q;
    or whose customer's mobile has q's digits (3+, typed as a phone); or whose GSTIN has q (4+)."""
    name = Q()
    for word in q.split():
        name &= Q(customer__name__istartswith=word) | Q(customer__name__icontains=f" {word}")
    match = Q(invoice_number__icontains=q) | name
    digits = re.sub(r"[^0-9]", "", q)
    if len(digits) >= 3 and re.fullmatch(r"[0-9\s+]+", q):
        match |= Q(customer__mobile_number__contains=digits)
    if len(q) >= 4:
        match |= Q(customer__gst_number__icontains=q)
    return bills.filter(match)


def _stored_rates(text):
    """The stored rates gst_rate matches (Ruling 1A-37): its slab read either way ("3" and "0.03" are 3%), as the
    column holds it (0.03) and as older rows may (3); an off-slab rate as a percent the same two ways, so it still
    finds v2's odd lines. [] (no bill) for what isn't a rate the column could hold ("abc", "NaN", "1e-9")."""
    try:
        fraction = normalize_rate(Decimal(text))
        return [r for r in {fraction, fraction * 100} if abs(r) < 10 ** 9 and r == r.quantize(RATE_PLACES)]
    except ArithmeticError:
        return []


def filter_bills(bills, params, dates=True):
    """GET sales/'s filters (part 1 API contract, 2.1), all combined. `dates=False` leaves out fy, month and dates.

    What can't be read is a 400 in the contract's words, never a 500 (Rulings 1A-5, 1A-28). No filter repeats
    a bill: the lines are asked about in subqueries, not joined.
    """
    p = params
    firm, customer = id_param(p, "business_id", PICK_A_FIRM), id_param(p, "customer_id", PICK_A_CUSTOMER)
    if firm is not None:
        bills = bills.filter(business_id=firm)
    if customer is not None:
        bills = bills.filter(customer_id=customer)
    if dates:
        fy, month = fy_param(p), month_param(p)
        start, end = date_param(p, "start_date"), date_param(p, "end_date")
        if fy is not None:
            bills = bills.filter(invoice_date__range=fy_range(fy))
        if month:
            bills = bills.filter(invoice_date__year=month[0], invoice_date__month=month[1])
        if start:
            bills = bills.filter(invoice_date__gte=start)
        if end:
            bills = bills.filter(invoice_date__lte=end)
    mode = p.get("payment_mode")
    if mode in ("cash", "bank", "credit", "mixed"):
        bills = bills.filter(payment_mode=mode)
    elif mode == "none":
        bills = bills.filter(payment_mode="")
    if p.get("status") in (BILL_ACTIVE, BILL_CANCELLED):
        bills = bills.filter(status=p["status"])
    if p.get("unsent") == "1":
        bills = bills.filter(status=BILL_ACTIVE, paper=False, sent_at__isnull=True)
    if p.get("credit") == "1":
        bills = bills.filter(status=BILL_ACTIVE, payment_mode="credit")
    if p.get("cash") == "1":
        bills = bills.filter(status=BILL_ACTIVE, payment_mode="cash", total_amount__gte=ITAX_LIMIT)
    if p.get("paper") in ("0", "1"):
        bills = bills.filter(paper=p["paper"] == "1")
    number = text_param(p, "number")
    if number:
        bills = bills.filter(invoice_number__iexact=number)
    if p.get("gst_rate"):
        rates = _stored_rates(p["gst_rate"])
        lines = LineItem.objects.filter(invoice=OuterRef("pk"), gst_tax_rate__in=rates)
        bills = bills.filter(Exists(lines)) if rates else bills.none()
    # v2's drill-downs (Ruling 1A-35): a cancelled bill needs no items or HSN fixed, so these list active bills, and
    # a blank HSN is one with nothing but spaces too, as the no_hsn check reads it. dups=1, below, keeps cancelled
    # bills: their numbers stay used.
    if p.get("empty") == "1":
        bills = bills.counted().filter(~Exists(LineItem.objects.filter(invoice=OuterRef("pk"))))
    if p.get("no_hsn") == "1":
        no_hsn = LineItem.objects.filter(Q(hsn_code__isnull=True) | Q(hsn_code__regex=r"^\s*$"), invoice=OuterRef("pk"))
        bills = bills.counted().filter(Exists(no_hsn))
    if p.get("segment") in ("b2b", "b2cl", "b2cs"):
        registered = Q(segment_gstin__regex=GSTIN_SHAPE)
        bills = bills.annotate(segment_gstin=Coalesce(Trim("customer__gst_number"), Value("")))
        if p["segment"] == "b2b":
            bills = bills.filter(registered)
        else:
            unregistered = bills.exclude(registered)
            large = [inv.pk for inv in unregistered.filter(total_amount__gt=B2CL_THRESHOLD).only(*CHECK_FIELDS)
                     if classify_b2c(inv.business, inv)[0] == "b2cl"]
            bills = unregistered.filter(pk__in=large) if p["segment"] == "b2cl" else unregistered.exclude(pk__in=large)
    q = text_param(p, "q")
    if q:
        bills = search(bills, q)
    # Worked out in Python over what's left: they need the lines, the customer or other bills.
    if p.get("dups") == "1":
        bills = bills.filter(pk__in=duplicated_ids(bills.select_related(None).only("business_id", "invoice_date")))
    if p.get("itax") == "1":
        # A flag needs a total at the limits or a GSTIN (15 characters, once trimmed): the database narrows to those.
        maybe = (bills.select_related(None).select_related("customer").alias(gstin_length=Length("customer__gst_number"))
                 .filter(Q(total_amount__gte=ITAX_LIMIT) | Q(gstin_length__gte=15)).only(*ITAX_FIELDS))
        bills = bills.filter(pk__in=[inv.pk for inv in maybe if itax_flags(inv)])
    if p.get("check") == "1":
        bills = bills.filter(pk__in=checked_ids(bills.counted().only(*CHECK_FIELDS)))
    return bills


def checked_ids(invoices):
    """Ids of these bills that have a check code: two queries (their lines, the twins). Each bill needs CHECK_FIELDS,
    customer and firm joined."""
    invoices = list(invoices)
    lines, twice = lines_of(invoices, LINE_FIELDS), duplicated_ids(invoices)
    return {inv.pk for inv in invoices if bill_checks(inv, lines[inv.pk], inv.pk in twice)}


_FY_EXPR = ExtractYear("invoice_date") - Case(When(invoice_date__month__lt=4, then=Value(1)), default=Value(0),
                                              output_field=IntegerField())
ORDERINGS = {
    "-date": ("-invoice_date", "-created_at", "-id"), "date": ("invoice_date", "created_at", "id"),
    "-number": ("-fy", "-number_length", "-invoice_number", "-id"), "number": ("fy", "number_length", "invoice_number", "id"),
    "-total": ("-total_amount", "-id"), "total": ("total_amount", "id"),
}


def ordered(bills, params):
    """The list's order; a bill whose number is exactly `q` comes first."""
    keys = ORDERINGS.get(params.get("ordering") or "-date", ORDERINGS["-date"])
    if "number" in (params.get("ordering") or ""):
        bills = bills.annotate(fy=_FY_EXPR, number_length=Length("invoice_number"))
    q = text_param(params, "q")
    if q:
        bills = bills.annotate(exact=Case(When(invoice_number__iexact=q, then=Value(0)), default=Value(1),
                                          output_field=IntegerField()))
        keys = ("exact", *keys)
    return bills.order_by(*keys)


def summary(bills, of):
    """The list's figures over every bill in the filtered set (not the page): the active bills (counted()), or
    with status=cancelled the cancelled ones' totals when issued. Three queries."""
    chosen = bills.filter(status=BILL_CANCELLED) if of == BILL_CANCELLED else bills.counted()
    totals = list(chosen.values_list("total_amount", flat=True))
    # Every line of the set, as a subquery, in only the columns sums() reads (Rulings 1A-34, 1A-36).
    lines = uncached(LineItem).filter(invoice__in=chosen.values("pk")).only("quantity", "rate", *HEADS)
    total = sum((t or ZERO for t in totals), ZERO)
    return {
        "of": of, "bills": len(totals), **figures(sums(lines)), "total_amount": money(total),
        "average": money(total / len(totals)) if len(totals) >= 2 else None,
        "cancelled": 0 if of == BILL_CANCELLED else bills.filter(status=BILL_CANCELLED).count(),
    }


def facets(sales, params):
    """Month chips, view counts and other years' hits, for the firm and FY whatever else is filtered (part 1 API
    contract, 2.1). The FY's active bills are read once, with their lines, in only the columns the views and checks
    use: a fixed number of queries."""
    firm = id_param(params, "business_id", PICK_A_FIRM)
    fy = fy_param(params)
    start, end = fy_range(fy_of(None) if fy is None else fy)
    today = timezone.localdate()
    scope = sales.filter(invoice_date__range=(start, end))
    if firm is not None:
        scope = scope.filter(business_id=firm)
    active = list(scope.counted().only(*CHECK_FIELDS))
    per_month = Counter((b.invoice_date.year, b.invoice_date.month) for b in active)
    firms = [firm] if firm is not None else list(uncached(Business).values_list("pk", flat=True))
    closed = closed_months(firms)
    months, cursor = [], start
    while cursor <= min(end, today):  # up to the current month
        key = (cursor.year, cursor.month)
        months.append({"month": f"{cursor.year}-{cursor.month:02d}", "bills": per_month[key],
                       "locked": bool(firms) and all((f, *key) in closed for f in firms)})
        cursor = date(cursor.year + cursor.month // 12, cursor.month % 12 + 1, 1)
    out = {"months": months, "views": {
        "unsent_today": sum(b.invoice_date == today and not b.paper and b.sent_at is None for b in active),
        "credit_month": sum(b.payment_mode == "credit" and (b.invoice_date.year, b.invoice_date.month)
                            == (today.year, today.month) for b in active),
        "check": len(checked_ids(active)),
        "cash": sum(b.payment_mode == "cash" and (b.total_amount or ZERO) >= ITAX_LIMIT for b in active),
    }, "elsewhere": []}
    if text_param(params, "q"):
        hits = Counter(fy_of(day) for day in filter_bills(sales, params, dates=False)
                       .exclude(invoice_date__range=(start, end)).values_list("invoice_date", flat=True))
        out["elsewhere"] = [{"fy": fy_label(y), "bills": n} for y, n in sorted(hits.items(), reverse=True)]
    return out
