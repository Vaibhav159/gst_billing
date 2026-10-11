"""v3 reports: narrow register reads and Decimal-only report/workbook projections."""
import calendar
import re
from collections import Counter, defaultdict
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, localcontext

from django.db.models import Case, Count, IntegerField, Prefetch, Q, Value, When
from django.db.models.functions import ExtractYear, Lower
from django.utils import timezone

from billing.cache import uncached
from billing.credit import LEDGER_START
from billing.fy import fy_label, fy_of
from billing.models import Business, Invoice, LineItem, Product
from billing.reconciliation import payment_split as old_payment_split
from billing.services.bill_reads import line_taxable
from billing.services.gst_amounts import heads as decimal_heads
from billing.services.gstr1_file import hsn_description
from billing.tax_rules import HEADS, classify_b2c, clean_gstin, has_gstin, normalize_rate, to_paise
from billing.text import day_text, inr, money, percent

ZERO = Decimal("0")
COLUMNS = ("taxable", *HEADS)
KINDS = frozenset({"sales", "purchases", "tax", "hsn", "months", "customers", "products"})
LINE_FIELDS = ("id", "invoice_id", "product_name", "hsn_code", "unit", "quantity", "rate", "gst_tax_rate", *HEADS)
BILL_FIELDS = ("id", "business_id", "customer_id", "invoice_number", "invoice_date", "total_amount", "payment_mode", "status", "place_of_supply",
               "business__id", "business__name", "business__gst_number", "business__state_name",
               "customer__id", "customer__name", "customer__gst_number", "customer__pan_number", "customer__state_name", "customer__customer_type")


def months_between(start, end):
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        yield f"{year:04d}-{month:02d}"
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)


def _load_invoices(queryset, *, purchases=False):
    fields = BILL_FIELDS + (("itc_month", "itc_eligible", "needs_review") if purchases else ())
    queryset = queryset.select_related("business", "customer").only(*fields).prefetch_related(
        Prefetch("lineitem_set", queryset=uncached(LineItem).only(*LINE_FIELDS).order_by("id"), to_attr="report_lines"),
    ).order_by("invoice_date", "id")
    result = []
    for bill in queryset:
        customer = bill.customer
        section, _, pos, _ = classify_b2c(bill.business, bill)
        row = {"id": bill.pk, "number": bill.invoice_number, "date": bill.invoice_date,
               "business": {"id": bill.business_id, "name": bill.business.name, "gst_number": bill.business.gst_number or ""},
               "customer": {"id": bill.customer_id, "name": customer.name, "gst_number": customer.gst_number or "", "pan": customer.pan, "type": customer.kind},
               "total": to_paise(bill.total_amount), "payment": bill.payment_mode, "status": bill.status,
               "section": section, "pos": pos, "duplicate": False,
               "lines": [{"name": li.product_name, "hsn": li.hsn_code, "unit": li.unit,
                          "quantity": li.quantity, "rate": li.rate, "gst_rate": normalize_rate(li.gst_tax_rate),
                          "taxable": line_taxable(li), **{head: to_paise(getattr(li, head)) for head in HEADS}}
                         for li in bill.report_lines]}
        if purchases:
            from billing.credit import credit_lapsed, credit_month_of

            month = credit_month_of(bill)
            bill._purchase_tax = sum((sum((line[head] for head in HEADS), ZERO) for line in row["lines"]), ZERO)
            row.update(credit_month=month.strftime("%Y-%m") if month else None, credit_lapsed=credit_lapsed(bill),
                       itc_eligible=bill.itc_eligible, needs_review=bill.needs_review)
        result.append(row)
    return result


def load_sales(start, end, business_id=None):
    """All sales rows, including cancelled; duplicates are scoped to firm + entire FY."""
    query = Invoice.objects.sales()
    if business_id is not None:
        query = query.filter(business_id=business_id)
    duplicate_rows = query.filter(invoice_date__gte=date(fy_of(start), 4, 1), invoice_date__lte=date(fy_of(end) + 1, 3, 31)).annotate(
        report_fy=ExtractYear("invoice_date") - Case(When(invoice_date__month__lt=4, then=Value(1)), default=Value(0), output_field=IntegerField()),
        folded=Lower("invoice_number"),
    ).values("business_id", "report_fy", "folded").annotate(n=Count("id")).filter(n__gt=1).order_by()
    duplicates = {(r["business_id"], r["report_fy"], r["folded"]) for r in duplicate_rows}
    rows = _load_invoices(query.filter(invoice_date__range=(start, end)))
    for row in rows:
        row["duplicate"] = (row["business"]["id"], fy_of(row["date"]), row["number"].lower()) in duplicates
    return rows


def load_register(start, end, business_id=None, *, credit_start=None, credit_end=None, include_products=False, sides=("sales", "purchases")):
    """The purchase union includes bills dated outside the range whose credit falls inside it.

    Requires part 2A's three credit columns. Never substitutes fake defaults for a missing schema.
    """
    credit_start = (credit_start or start).replace(day=1)
    credit_end = (credit_end or end).replace(day=1)
    credit_last_day = credit_end.replace(day=calendar.monthrange(credit_end.year, credit_end.month)[1])
    credit_filter = Q(itc_month__range=(credit_start, credit_end)) | Q(itc_month__isnull=True, invoice_date__range=(credit_start, credit_last_day))
    purchases = uncached(Invoice).filter(type_of_invoice="inward").filter(Q(invoice_date__range=(start, end)) | credit_filter)
    firms = uncached(Business)
    if business_id is not None:
        firms = firms.filter(pk=business_id)
        purchases = purchases.filter(business_id=business_id)
    result = {"sales": load_sales(start, end, business_id) if "sales" in sides else [],
              "purchases": _load_invoices(purchases, purchases=True) if "purchases" in sides else [],
              "firms": list(firms.order_by("name", "id").values("id", "name", "gst_number"))}
    if include_products:
        names = {line["name"] for bill in result["sales"] for line in bill["lines"]}
        result["product_units"] = {(product["name"], product["hsn_code"]): product["default_unit"]
                                   for product in uncached(Product).filter(name__in=names)
                                   .values("name", "hsn_code", "default_unit")}
    return result


def _active(bills):
    return [bill for bill in bills if bill["status"] != "cancelled"]


def _dated(bills, start, end):
    return sorted((bill for bill in bills if start <= bill["date"] <= end), key=lambda bill: (bill["date"], bill["id"]))


def line_amounts(line):
    """X-36: round each line first, using 3A's shared head reader."""
    return {"taxable": to_paise(line["taxable"]), **decimal_heads(line)}


def amounts(bills):
    result = {key: ZERO for key in (*COLUMNS, "tax", "value", "round_off")}
    result["bills"] = len(bills)
    for bill in bills:
        result["value"] += to_paise(bill["total"])
        for line in bill["lines"]:
            rounded = line_amounts(line)
            for key in COLUMNS:
                result[key] += rounded[key]
    for key in (*COLUMNS, "value"):
        result[key] = to_paise(result[key])
    result["tax"] = sum((result[head] for head in HEADS), ZERO)
    result["round_off"] = result["value"] - result["taxable"] - result["tax"]
    return result


def wire(values):
    return {key: money(value) if isinstance(value, Decimal) else value for key, value in values.items()}


def heads(values):
    if any(head in values and values[head] is None for head in HEADS):
        return {key: money(values[key]) if values.get(key) is not None else None for key in (*HEADS, "total")}
    return wire(decimal_heads(values))


def sum_heads(rows):
    """Recorded cash can have a known total without any allocation by tax head."""
    return {key: money(sum((Decimal(row[key]) for row in rows), ZERO))
            if all(row[key] is not None for row in rows) else None for key in (*HEADS, "total")}


def reconciliation_rows(bills):
    return [{"id": bill["id"], "invoice_number": bill["number"], "invoice_date": bill["date"],
             "customer_gstin": bill["customer"]["gst_number"], "payment_mode": bill["payment"], "total_amount": to_paise(bill["total"]),
             "lines": [{**line, **line_amounts(line), "rate": line["gst_rate"]} for line in bill["lines"]]} for bill in bills]


def payment_split(bills):
    with localcontext() as context:
        context.rounding = ROUND_HALF_UP
        buckets = old_payment_split(reconciliation_rows(bills))
    total = sum((bucket.gross for bucket in buckets), ZERO)
    used = ZERO
    result = []
    for index, bucket in enumerate(buckets):
        share = to_paise(bucket.gross * 100 / total) if total and index < len(buckets) - 1 else Decimal("100") - used
        if not total and index < len(buckets) - 1:
            share = ZERO
        used += share
        result.append({"mode": "" if bucket.mode == "(not set)" else bucket.mode, "bills": bucket.invoice_count,
                       "value": money(bucket.gross), "taxable": money(bucket.taxable),
                       **{head: money(getattr(bucket, head)) for head in HEADS}, "share": money(share)})
    return result


def credit_state(bill, closed_credit):
    """Part 2's chosen-credit-month lapse rule; needs-review never removes credit."""
    if bill["credit_month"] is None:
        return "outside"
    tax = amounts([bill])["tax"]
    if not bill["itc_eligible"] or not tax or not has_gstin(bill["customer"]["gst_number"]):
        return "not_allowed"
    if bill["credit_lapsed"]:
        return "lapsed"
    if (bill["business"]["id"], bill["credit_month"]) in closed_credit:
        return "claimed"
    return "to_confirm" if bill["needs_review"] else "to_claim"


def credit_in(purchases, start, end, closed_credit):
    first, last = start.strftime("%Y-%m"), end.strftime("%Y-%m")
    return [bill for bill in purchases if bill["credit_month"] is not None and first <= bill["credit_month"] <= last and credit_state(bill, closed_credit) not in {"not_allowed", "lapsed"}]


def credit_gap(purchases, start, end, closed_credit):
    dated = _dated(purchases, start, end)
    credited = credit_in(purchases, start, end, closed_credit)
    dated_ids, credited_ids = {r["id"] for r in dated}, {r["id"] for r in credited}
    parts = []
    for bill in credited:
        if bill["id"] not in dated_ids:
            sign = "+" + inr(amounts([bill])["tax"])
            claim = date.fromisoformat(bill["credit_month"] + "-01").strftime("%B %Y")
            parts.append(f"{sign} from a {bill['date']:%b %Y} bill claimed in {claim}")
    for bill in dated:
        if bill["id"] not in credited_ids and amounts([bill])["tax"]:
            sign = "−" + inr(amounts([bill])["tax"])
            state = credit_state(bill, closed_credit)
            if state in {"not_allowed", "lapsed", "outside"}:
                parts.append(f"{sign} on 1 bill with no credit")
            else:
                claim = date.fromisoformat(bill["credit_month"] + "-01").strftime("%B %Y")
                parts.append(f"{sign} from {bill['number']}, dated {day_text(bill['date'])} and claimed in {claim}")
    by_date, by_return = amounts(dated)["tax"], amounts(credited)["tax"]
    return {"by_date": money(by_date), "by_return": money(by_return), "difference": money(by_return - by_date), "parts": parts}


def _bill_row(bill, *, purchase=False, closed_credit=()):
    total = amounts([bill])
    result = {"id": bill["id"], "number": bill["number"], "date": bill["date"].isoformat(),
              "firm": bill["business"], "taxable": money(total["taxable"]), "heads": heads(total), "total": money(bill["total"]), "payment": bill["payment"]}
    if purchase:
        result.update(bill_no=bill["number"], supplier=bill["customer"], credit_month=bill["credit_month"], credit_state=credit_state(bill, closed_credit))
    else:
        result.update(invoice_number=bill["number"], invoice_date=bill["date"].isoformat(), customer_name=bill["customer"]["name"], customer=bill["customer"], status=bill["status"], duplicate=bill["duplicate"])
    return result


def _hsn_rows(bills):
    from billing.tax_rules import filed_quantity, uqc_for

    groups = {}
    descriptions = defaultdict(Counter)
    for bill in bills:
        for line in bill["lines"]:
            descriptions[line["hsn"]][line["name"]] += 1
            uqc = uqc_for(line["unit"], line["hsn"])
            key = line["hsn"], uqc, line["gst_rate"]
            value = groups.setdefault(key, {"quantity": ZERO, "ids": set(), **dict.fromkeys(COLUMNS, ZERO)})
            value["quantity"] += ZERO if uqc == "NA" else filed_quantity(line["unit"], line["quantity"])
            value["ids"].add(bill["id"])
            rounded = line_amounts(line)
            for column in COLUMNS:
                value[column] += rounded[column]
    return [{"hsn": hsn, "description": hsn_description(hsn, descriptions=descriptions[hsn]), "uqc": uqc,
             "quantity": f"{to_paise(value['quantity']):.2f}", "rate": percent(rate),
             **wire({column: value[column] for column in COLUMNS}), "bills": len(value["ids"])}
            for (hsn, uqc, rate), value in sorted(groups.items())]


def tax_span(start, end):
    return start.replace(day=1), end.replace(day=calendar.monthrange(end.year, end.month)[1])


def _tax_rows(firms, start, end, positions, sales, purchases):
    result = []
    for firm in firms:
        rows = []
        for month in months_between(start, end):
            if month < LEDGER_START.strftime("%Y-%m"):
                output = [bill for bill in sales if bill["business"]["id"] == firm["id"] and bill["date"].strftime("%Y-%m") == month]
                credit = [bill for bill in purchases if bill["business"]["id"] == firm["id"] and bill["date"].strftime("%Y-%m") == month
                          and bill["itc_eligible"] and has_gstin(bill["customer"]["gst_number"])]
                rows.append({"month": month, "output": heads(amounts(output)), "credit": heads(amounts(credit)),
                             "cash": None, "carry_on": None, "state": "before_ledger",
                             "note": "Before the app's credit ledger (it starts April 2025).",
                             "gstr1_filed_on": None, "gstr3b_filed_on": None})
                continue
            position = positions.get((firm["id"], month))
            if position is None:
                continue
            cash = position.get("cash_paid") if position["filed"] else None
            rows.append({"month": month, **{key: heads(position[key]) for key in ("output", "credit", "carry_on")},
                         "cash": heads(cash if cash is not None else position["cash"]),
                         "state": "paid" if position["filed"] else "to_pay", "note": None,
                         "gstr1_filed_on": position.get("gstr1_filed_on"), "gstr3b_filed_on": position.get("gstr3b_filed_on")})
        totals = {key: heads({head: sum((Decimal(row[key][head]) for row in rows), ZERO) for head in HEADS}) for key in ("output", "credit")}
        ledger_rows = [row for row in rows if row["state"] != "before_ledger"]
        totals["cash"] = sum_heads([row["cash"] for row in ledger_rows]) if ledger_rows else None
        # Credit carried on is a balance, not a sum of repeated monthly balances.
        totals["carry_on"] = ledger_rows[-1]["carry_on"] if ledger_rows else None
        result.append({"firm": firm, "rows": rows, "totals": totals})
    return result

def build_report(kind, sales, purchases, *, firms, start, end, split=False, positions=None, stages=None, closed_credit=None, today=None, side="sales", product_units=None):
    """Pure report projection; all return-context mappings use (business id, YYYY-MM) keys."""
    positions, stages, closed_credit = positions or {}, stages or {}, closed_credit or set()
    today = today or timezone.localdate()
    requested = start, end
    if kind == "tax":
        start, end = tax_span(start, end)
    dated_sales, buys = _dated(sales, start, end), _dated(purchases, start, end)
    active = _active(dated_sales)
    if kind == "sales":
        return {"bills": [_bill_row(bill) for bill in dated_sales],
                "totals": {**wire(amounts(active)), "cancelled": len(dated_sales) - len(active)},
                "by_firm": [{"firm": firm, **wire(amounts([bill for bill in active if bill["business"]["id"] == firm["id"]]))} for firm in firms],
                "split": payment_split(active) if split else []}
    if kind == "purchases":
        credited = credit_in(purchases, start, end, closed_credit)
        return {"bills": [_bill_row(bill, purchase=True, closed_credit=closed_credit) for bill in buys], "totals": wire(amounts(buys)),
                "credit_by_return": wire(amounts(credited)), "gap": credit_gap(purchases, start, end, closed_credit), "split": payment_split(buys) if split else []}
    if kind == "tax":
        widened = requested != (start, end)
        return {"firms": _tax_rows(firms, start, end, positions, active, buys), "gap": credit_gap(purchases, start, end, closed_credit),
                "from": start.isoformat(), "to": end.isoformat(), "cuts_month": widened,
                "note": f"Shown for whole months: {day_text(start)} to {day_text(end)}." if widened else None}
    if kind == "hsn":
        selected = active if side == "sales" else buys
        return {"side": side, "rows": _hsn_rows(selected), "totals": wire(amounts(selected))}
    if kind == "months":
        rows = []
        for month in months_between(start, min(end, today)):
            month_sales = [bill for bill in active if bill["date"].strftime("%Y-%m") == month]
            month_buys = [bill for bill in buys if bill["date"].strftime("%Y-%m") == month]
            month_credit = [bill for bill in credit_in(purchases, start, end, closed_credit) if bill["credit_month"] == month]
            key = (firms[0]["id"], month) if len(firms) == 1 else None
            position = positions.get(key)
            rows.append({"month": month, "sales": wire(amounts(month_sales)), "purchases": wire(amounts(month_buys)),
                         "sales_tax": money(amounts(month_sales)["tax"]), "credit": heads(amounts(month_credit)),
                         "cash": heads(position["cash"]) if position else None, "stage": stages.get(key) if key else None})
        return {"rows": rows, "totals": {"sales": wire(amounts(active)), "purchases": wire(amounts(buys)), "credit": heads(amounts(credit_in(purchases, start, end, closed_credit)))}, "crosses_fy": fy_of(start) != fy_of(end)}
    if kind == "customers":
        groups = defaultdict(list)
        for bill in active:
            if bill["customer"]["type"] != "walkin":
                groups[bill["customer"]["id"]].append(bill)
        rows = [{"customer": bills[0]["customer"], "bills": len(bills), "total": money(amounts(bills)["value"]),
                 "udhaar": {"bills": sum(bill["payment"] == "credit" for bill in bills), "total": money(sum((bill["total"] for bill in bills if bill["payment"] == "credit"), ZERO))},
                 "last_bill": max(bill["date"] for bill in bills).isoformat()} for bills in groups.values()]
        rows.sort(key=lambda row: (-Decimal(row["total"]), row["customer"]["id"]))
        return {"rows": rows, "totals": wire(amounts(active)), "walkin": wire(amounts([bill for bill in active if bill["customer"]["type"] == "walkin"]))}
    if kind == "products":
        groups = {}
        product_units = product_units or {}
        for bill in active:
            for line in bill["lines"]:
                key = line["name"], line["hsn"]
                group = groups.setdefault(key, {"quantities": defaultdict(lambda: ZERO), "by_unit": defaultdict(lambda: ZERO), "taxable": ZERO, "ids": set()})
                unit = "gms" if line["unit"] == "g" else line["unit"]
                group["quantities"][unit] += line["quantity"]
                group["by_unit"][unit] += to_paise(line["taxable"])
                group["taxable"] += to_paise(line["taxable"])
                group["ids"].add(bill["id"])
        rows = []
        for (name, hsn), group in groups.items():
            own_unit = product_units.get((name, hsn))
            own_unit = "gms" if own_unit == "g" else own_unit
            own_qty = group["quantities"].get(own_unit, ZERO)
            average = (group["by_unit"][own_unit] / own_qty).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP) if own_qty else None
            quantities = {unit: f"{quantity:.3f}" for unit, quantity in sorted(group["quantities"].items())}
            rows.append({"name": name, "hsn": hsn, "unit": own_unit, "quantity": quantities,
                         "taxable": money(group["taxable"]), "bills": len(group["ids"]),
                         "average_rate": str(average) if average is not None else None,
                         "other_units": [{"unit": unit, "quantity": quantity} for unit, quantity in quantities.items() if unit != own_unit]})
        rows.sort(key=lambda row: (-Decimal(row["taxable"]), row["name"], row["hsn"]))
        return {"rows": rows, "totals": wire(amounts(active))}
    raise ValueError(f'There\'s no report called "{kind}".')


def period_label(start, end, today):
    if start.day == 1 and (start.year, start.month) == (end.year, end.month) and end.day == calendar.monthrange(end.year, end.month)[1]:
        return start.strftime("%b %Y")
    if start == date(fy_of(start), 4, 1):
        label = f"FY {fy_label(fy_of(start))}"
        if end == date(fy_of(start) + 1, 3, 31):
            return label
        if end == today and fy_of(today) == fy_of(start):
            return label + " so far"
    return f"{day_text(start)} to {day_text(end)}"


def _workbook_rows(bills, *, purchases, closed_credit):
    rows = []
    for number, bill in enumerate(bills, 1):
        party = bill["customer"]
        tax_id = clean_gstin(party["gst_number"]) or (f"{party['pan']} (PAN)" if party["pan"] else "-")
        totals = amounts([bill])
        for index, line in enumerate(bill["lines"] or [None]):
            first = index == 0
            cells = [number, bill["number"], bill["date"].isoformat(), party["name"], tax_id] if first else [""] * 5
            cells.extend([line["name"], line["hsn"], percent(line["gst_rate"]), f"{line['quantity']:.3f}", line["unit"], f"{line['rate']:.3f}", money(line["taxable"]), money(line["cgst"]), money(line["sgst"]), money(line["igst"])] if line else ["(no items)", "", "", "", "", "", "0.00", "0.00", "0.00", "0.00"])
            cells.extend([money(totals["round_off"]) if first else "", money(bill["total"]) if first else "", bill["payment"]])
            cells.extend([bill["credit_month"] or "", credit_state(bill, closed_credit)] if purchases else ["NIL" if line and not line["gst_rate"] else bill["section"].upper(), bill["pos"]])
            rows.append(cells)
    return rows


def _without_customers(value):
    if isinstance(value, dict):
        return {key: _without_customers(item) for key, item in value.items() if key != "customer"}
    if isinstance(value, list):
        return [_without_customers(item) for item in value]
    return value


def ca_workbook(sales, purchases, *, firms, start, end, split=False, return_data=None, closed_credit=None, today=None, scope=None):
    return_data, closed_credit = return_data or {}, closed_credit or set()
    today = today or timezone.localdate()
    sales, purchases = _active(_dated(sales, start, end)), _dated(purchases, start, end)
    summary, sheets = [], []
    for firm in firms:
        firm_sales = [bill for bill in sales if bill["business"]["id"] == firm["id"]]
        firm_purchases = [bill for bill in purchases if bill["business"]["id"] == firm["id"]]
        summary.append({"firm": firm["name"], "sales": wire(amounts(firm_sales)), "purchases": wire(amounts(firm_purchases))})
        sheet = {"firm": firm, "months": [], "gstr1": [], "gstr3b": [], "amendments": []}
        for month in months_between(start, end):
            monthly = {"month": month}
            for side, bills in (("sales", firm_sales), ("purchases", firm_purchases)):
                selection = [bill for bill in bills if bill["date"].strftime("%Y-%m") == month]
                monthly[side] = {"rows": _workbook_rows(selection, purchases=side == "purchases", closed_credit=closed_credit),
                                 "totals": wire(amounts(selection)), "split": payment_split(selection) if split else []}
            sheet["months"].append(monthly)
            returns = return_data.get((firm["id"], month))
            if returns is not None:
                sheet["gstr1"].append({"month": month, "sections": _without_customers(returns["gstr1"]), "stage": returns["stage"]})
                sheet["gstr3b"].append({"month": month, "tables": returns["gstr3b"], "stage": returns["stage"], "filing": returns.get("filing")})
                sheet["amendments"].extend(returns.get("amendments", []))
        sheets.append(sheet)
    scope = scope or (firms[0]["name"] if len(firms) == 1 else "All firms")
    period = period_label(start, end, today)
    def slug(value):
        return re.sub(r"[^A-Za-z0-9-]+", "_", value).strip("_")
    return {"scope": scope, "period": period, "file": f"GST_Report_{slug(scope)}_{slug(period)}{'_with_split' if split else ''}.xlsx", "summary": summary, "firms": sheets}
