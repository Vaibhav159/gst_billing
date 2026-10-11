"""What v3 shows of a customer's sales: the list's figures, filters and orders, and the statement (part 1 API
contract, 6.1 and 6.3).

Sales only, counted bills only: a cancelled bill is listed on the statement, marked, and counted in no total.
"A register of bills, not a ledger": the app doesn't record payments received, so `paid` says only how the bill
was marked. Reads only (Ruling 1A-16), around cacheops (Ruling 1A-34: every bill read starts from
Invoice.objects.sales()), and in only the columns the sums use (Ruling 1A-36): the database adds up the list's
figures, and the statement reads each bill and line in the few columns it shows.
"""

from collections import defaultdict
from decimal import Decimal

from django.db.models import Case, Count, F, IntegerField, OuterRef, Q, Subquery, Sum, Value, When, Window
from django.db.models.functions import Coalesce, RowNumber, Trim

from billing.constants import BILL_CANCELLED
from billing.models import Invoice
from billing.params import text_param
from billing.services.bill_reads import itax_flags, lines_of, sums
from billing.tax_rules import GSTIN_SHAPE, HEADS
from billing.text import money

ZERO = Decimal("0")
# How a bill was marked when it was made (6.3's paid): at billing (cash, UPI or both), udhaar, or not recorded.
PAID = {"cash": "billing", "bank": "billing", "mixed": "billing", "credit": "udhaar", "": "not_recorded"}
# A customer's last bill: the latest date, then the one made last. The list's figure and its order read it alike.
NEWEST = ("-invoice_date", "-id")
FIGURE_ORDERINGS = ("-last_bill", "-sales")
FIGURES = ("bills", "total", "cancelled", "udhaar_bills", "udhaar_total")
# What the statement shows of a bill and adds up of a line.
STATEMENT_FIELDS = ("business__name", "invoice_number", "invoice_date", "payment_mode", "total_amount", "status",
                    "cancel_reason")
STATEMENT_LINE_FIELDS = ("quantity", "rate", *HEADS)


def scoped_sales(firm=None, start=None, end=None):
    """Sales of one firm (None: every firm) dated from `start` to `end` (either or both may be None)."""
    bills = Invoice.objects.sales()
    if firm is not None:
        bills = bills.filter(business_id=firm)
    if start:
        bills = bills.filter(invoice_date__gte=start)
    if end:
        bills = bills.filter(invoice_date__lte=end)
    return bills


def _adding_up():
    """The list's figures (6.1) as the database adds them up: the active sales and their total, the cancelled ones
    left out, and the udhaar (credit) ones among the active."""
    active = ~Q(status=BILL_CANCELLED)
    udhaar = active & Q(payment_mode="credit")
    return {"bills": Count("pk", filter=active), "total": Sum("total_amount", filter=active),
            "cancelled": Count("pk", filter=Q(status=BILL_CANCELLED)),
            "udhaar_bills": Count("pk", filter=udhaar), "udhaar_total": Sum("total_amount", filter=udhaar)}


def _sent(added):
    """Figures as the API sends them: counts, and money to the paisa, never rounded to the rupee (Ruling 1B-12).
    Over no bills each is 0."""
    return {key: money(added.get(key) or ZERO) if key.endswith("total") else added.get(key) or 0 for key in FIGURES}


def customer_figures(customer_ids, firm=None, start=None, end=None):
    """{customer id: figures} for a page of the list (6.1): the active sales in the firm and period, the cancelled
    ones counted apart, and last_bill, the newest active sale in the firm whatever its date (None if there is none).
    Two queries, each one row per customer however many bills."""
    if not customer_ids:
        return {}
    added = {row["customer_id"]: row for row in scoped_sales(firm, start, end).filter(customer_id__in=customer_ids)
             .values("customer_id").annotate(**_adding_up()).order_by()}
    newest = Window(RowNumber(), partition_by=F("customer_id"), order_by=NEWEST)
    last = {cid: {"id": pk, "invoice_number": number, "invoice_date": day.isoformat(), "total_amount": money(total),
                  "business": business}
            for cid, pk, number, day, total, business in scoped_sales(firm).counted()
            .filter(customer_id__in=customer_ids).annotate(newest=newest).filter(newest=1)
            .values_list("customer_id", "pk", "invoice_number", "invoice_date", "total_amount", "business_id")}
    return {cid: {**_sent(added.get(cid, {})), "last_bill": last.get(cid)} for cid in customer_ids}


def figures_summary(customers, firm=None, start=None, end=None, count=None):
    """The list's summary (6.1) over every customer in `customers` (a queryset), not just the page: one query, and
    one more to count them unless the caller already has the count."""
    added = scoped_sales(firm, start, end).filter(customer__in=customers.values("pk")).aggregate(**_adding_up())
    return {"customers": customers.count() if count is None else count, **_sent(added)}


def filter_customers(customers, params):
    """customers/'s v3 filters (6.1): a GSTIN or none, the state, and the effective type, read as Customer.kind
    reads them (the stored customer_type, else business with a GSTIN, else person; a GSTIN is has_gstin's, the
    value trimmed)."""
    customers = customers.alias(gstin=Coalesce(Trim("gst_number"), Value("")))
    registered = Q(gstin__regex=GSTIN_SHAPE)
    if params.get("has_gstin") == "1":
        customers = customers.filter(registered)
    elif params.get("has_gstin") == "0":
        customers = customers.exclude(registered)
    state = text_param(params, "state_name")
    if state:
        customers = customers.filter(state_name__iexact=state)
    kind = params.get("type")
    if kind == "walkin":
        customers = customers.filter(customer_type="walkin")
    elif kind == "business":
        customers = customers.filter(Q(customer_type="business") | (Q(customer_type="") & registered))
    elif kind == "person":
        customers = customers.filter(Q(customer_type="person") | (Q(customer_type="") & ~registered))
    return customers


def order_by_figures(customers, ordering, firm=None, start=None, end=None):
    """customers/'s two v3 orders (6.1): -last_bill puts the newest active sale in the firm (any date) first, and
    -sales the most sold in the firm and period. Customers with none come after them by name, and the walk-in
    record last."""
    if ordering == "-sales":
        bills = scoped_sales(firm, start, end).counted().filter(customer=OuterRef("pk"))
        figure = Subquery(bills.values("customer").annotate(sold=Sum("total_amount")).values("sold").order_by())
    else:
        bills = scoped_sales(firm).counted().filter(customer=OuterRef("pk"))
        figure = Subquery(bills.order_by(*NEWEST).values("invoice_date")[:1])
    walkin_last = Case(When(customer_type="walkin", then=Value(1)), default=Value(0), output_field=IntegerField())
    return customers.alias(walkin_last=walkin_last, figure=figure).order_by(
        "walkin_last", F("figure").desc(nulls_last=True), "name")


def _count_total(group):
    return {"bills": group["bills"], "total": money(group["total"])}


def statement(customer, start=None, end=None, firm=None):
    """GET customers/{id}/statement/ (6.3): the customer's sales in a period, oldest first, cancelled ones listed,
    marked and left out of every total. Two queries, the bills and their lines, in only the columns shown."""
    bills = list(scoped_sales(firm, start, end).filter(customer=customer).select_related("business")
                 .only(*STATEMENT_FIELDS).order_by("invoice_date", "id"))
    lines = lines_of(bills, STATEMENT_LINE_FIELDS)
    totals = {"bills": 0, "billed": ZERO, "taxable": ZERO, "tax": ZERO, "cancelled": 0}
    paid = {way: {"bills": 0, "total": ZERO} for way in ("billing", "udhaar", "not_recorded")}
    months = defaultdict(lambda: {"bills": 0, "total": ZERO})
    rows = []
    for inv in bills:
        inv.customer = customer  # read once, not joined to every bill: the income-tax flags read it
        added = sums(lines[inv.pk])  # the bill's taxable value and tax as its page and the bills list work them out
        cancelled = inv.status == BILL_CANCELLED
        way = "cancelled" if cancelled else PAID.get(inv.payment_mode, "not_recorded")
        rows.append({"id": inv.pk, "business": inv.business_id, "business_name": inv.business.name,
                     "invoice_number": inv.invoice_number, "invoice_date": inv.invoice_date.isoformat(),
                     "payment_mode": inv.payment_mode, "taxable": money(added["taxable"]), "tax": money(added["tax"]),
                     "total_amount": money(inv.total_amount), "status": inv.status, "cancel_reason": inv.cancel_reason,
                     "paid": way, "itax": itax_flags(inv)})
        if cancelled:
            totals["cancelled"] += 1
            continue
        total = inv.total_amount or ZERO
        totals["bills"] += 1
        totals["billed"] += total
        totals["taxable"] += added["taxable"]
        totals["tax"] += added["tax"]
        day = inv.invoice_date
        for group in (paid[way], months[f"{day.year:04d}-{day.month:02d}"]):
            group["bills"] += 1
            group["total"] += total
    return {
        "customer": {"id": customer.pk, "name": customer.name, "type": customer.kind,
                     "mobile_number": customer.mobile_number or "", "gst_number": customer.gst_number or "",
                     "pan": customer.pan, "city": customer.city or "", "state_name": customer.state_name or ""},
        "start_date": start.isoformat() if start else None, "end_date": end.isoformat() if end else None,
        "business": firm,
        "bills": rows,
        "totals": {"bills": totals["bills"], "billed": money(totals["billed"]), "taxable": money(totals["taxable"]),
                   "tax": money(totals["tax"]), "cancelled": totals["cancelled"],
                   "paid_at_billing": _count_total(paid["billing"]), "udhaar": _count_total(paid["udhaar"]),
                   "not_recorded": _count_total(paid["not_recorded"])},
        "months": [{"month": month, **_count_total(group)} for month, group in sorted(months.items())],
    }
