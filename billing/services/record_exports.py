"""Narrow, streamed CSV and spreadsheet exports. All monetary sums stay Decimal."""

import csv
import re
from decimal import Decimal
from io import StringIO
from tempfile import TemporaryFile
from types import SimpleNamespace

from django.http import FileResponse, StreamingHttpResponse
from django.utils import timezone
from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from rest_framework.exceptions import ValidationError

from billing.cache import uncached
from billing.credit import credit_month_of
from billing.fy import fy_label, fy_of, fy_range
from billing.models import AuditLog, Business, Customer, Invoice, LineItem, Product
from billing.params import PICK_A_FIRM, date_param, fy_param, id_param
from billing.services.backups import batches
from billing.services.bill_reads import sums
from billing.tax_rules import HEADS, to_paise
from billing.text import money, percent

COLUMNS = {
    "sales": ["Date", "Bill no.", "Firm", "Customer", "GSTIN", "State", "Payment", "Taxable", "CGST", "SGST", "IGST", "Total", "Status", "From paper book"],
    "purchases": ["Date", "Supplier bill no.", "Firm", "Supplier", "GSTIN", "Taxable", "CGST", "SGST", "IGST", "Total", "Credit month", "Credit allowed"],
    "customers": ["Name", "Type", "Phone", "Email", "GSTIN", "PAN", "State", "City", "Address", "Firms"],
    "products": ["Name", "HSN", "GST rate", "Unit", "Kind", "Purity", "Usual rate", "Bought only", "Description"],
    "firms": ["Name", "Short name", "GSTIN", "PAN", "State", "City", "PIN", "Address", "Phone", "Email", "Prefix", "Bank", "Account number", "IFSC", "Branch"],
}


def safe_cell(value):
    if isinstance(value, str) and (value.startswith(("\t", "\r")) or value.lstrip().startswith(("=", "+", "-", "@"))):
        return "'" + value
    return value


def export_scope(params):
    start, end = date_param(params, "start_date"), date_param(params, "end_date")
    fy = None if params.get("fy") == "all" else fy_param(params)
    if start or end:
        if start is None:
            raise ValidationError({"start_date": ["Type the date like 2026-09-30."]})
        if end is None:
            raise ValidationError({"end_date": ["Type the date like 2026-09-30."]})
        if start > end:
            raise ValidationError({"end_date": ["The start date is after the end date."]})
        filename_period, words = f"{start}_to_{end}", f"{start} to {end}"
    elif params.get("fy") == "all":
        filename_period, words = "all-years", "All years"
    else:
        fy = fy_of() if fy is None else fy
        start, end = fy_range(fy)
        filename_period, words = f"FY{fy_label(fy)}", f"FY {fy_label(fy)}"
    firm_id = id_param(params, "business_id", PICK_A_FIRM)
    firm = None
    if firm_id is not None:
        fields = ["id", "name", "short_name"]
        firm = uncached(Business).filter(pk=firm_id).values(*fields).first()
        if firm is None:
            raise ValidationError({"business_id": [PICK_A_FIRM]})
    short = (firm.get("short_name") or firm["name"].split()[0].title()) if firm else "All-firms"
    safe = re.sub(r"[^A-Za-z0-9_-]+", "-", short).strip("-") or "Firm"
    return start, end, firm, filename_period + "_" + safe, words


def bill_rows(kind, start, end, firm, count):
    queryset = uncached(Invoice).filter(type_of_invoice="outward" if kind == "sales" else "inward")
    if start:
        queryset = queryset.filter(invoice_date__range=(start, end))
    if firm:
        queryset = queryset.filter(business_id=firm["id"])
    fields = ["id", "invoice_date", "invoice_number", "business__name", "customer__name",
              "customer__gst_number", "status"]
    if kind == "sales":
        fields += ["customer__state_name", "payment_mode", "paper"]
    else:
        fields += ["itc_month", "itc_eligible"]
    total = {key: Decimal("0") for key in ("taxable", "cgst", "sgst", "igst", "total")}
    for batch in batches(queryset.order_by("invoice_date", "pk"), fields):
        lines = {}
        for row in uncached(LineItem).filter(invoice_id__in=[b["id"] for b in batch]).values(
                "invoice_id", "quantity", "rate", "cgst", "sgst", "igst").iterator(chunk_size=500):
            for head in HEADS:
                row[head] = to_paise(row[head] or 0)
            lines.setdefault(row.pop("invoice_id"), []).append(SimpleNamespace(**row))
        for bill in batch:
            count[0] += 1
            values = sums(lines.get(bill["id"], []))
            values["total"] = values["taxable"] + values["tax"]
            if bill["status"] != "cancelled":
                for key in total:
                    total[key] += values[key]
            row = [str(bill["invoice_date"]), bill["invoice_number"], bill["business__name"],
                   bill["customer__name"], bill["customer__gst_number"] or ""]
            if kind == "sales":
                row += [bill["customer__state_name"] or "", bill["payment_mode"]]
            row += [Decimal(money(values[key])) for key in total]
            if kind == "sales":
                row += ["Cancelled" if bill["status"] == "cancelled" else "Active", "Yes" if bill["paper"] else "No"]
            else:
                credit = credit_month_of(SimpleNamespace(invoice_date=bill["invoice_date"], itc_month=bill["itc_month"]))
                row += [credit.strftime("%Y-%m") if credit is not None else "", "Yes" if bill["itc_eligible"] else "No"]
            yield row
    offset = 7 if kind == "sales" else 5
    yield ["Total"] + [""] * (offset - 1) + [Decimal(money(total[key])) for key in total] + ["", ""]


def master_rows(kind, count):
    model = {"customers": Customer, "products": Product, "firms": Business}[kind]
    keys = {
        "customers": ["id", "name", "customer_type", "mobile_number", "email", "gst_number", "pan_number", "state_name", "city", "address"],
        "products": ["name", "hsn_code", "gst_tax_rate", "default_unit", "kind", "purity", "usual_rate", "purchase_only", "description"],
        "firms": ["name", "short_name", "gst_number", "pan_number", "state_name", "city", "pin_code", "address", "mobile_number", "email", "invoice_prefix", "bank_name", "bank_account_number", "bank_ifsc_code", "bank_branch_name"],
    }[kind]
    for batch in batches(uncached(model).order_by("name", "pk"), keys):
        firms = {}
        if kind == "customers":
            for customer_id, name in uncached(Customer.businesses.through).filter(
                    customer_id__in=[r["id"] for r in batch]).order_by("business__name").values_list("customer_id", "business__name"):
                firms.setdefault(customer_id, []).append(name)
        for row in batch:
            count[0] += 1
            if kind == "customers":
                customer = Customer(**row)
                yield [row["name"], customer.kind, row["mobile_number"], row["email"], row["gst_number"],
                       customer.pan, row["state_name"], row["city"], row["address"], ", ".join(firms.get(row["id"], []))]
            elif kind == "products":
                from billing.services.catalog import effective_kind

                product = Product(**row)
                yield [row["name"], row["hsn_code"], percent(row["gst_tax_rate"]), row["default_unit"], effective_kind(product),
                       row["purity"], money(row["usual_rate"]) if row["usual_rate"] is not None else "",
                       "Yes" if row["purchase_only"] else "No", row["description"]]
            else:
                yield [row.get(key) or "" for key in keys]


def response_for(user, kind, params):
    if kind not in COLUMNS:
        raise ValidationError({"kind": ["Choose sales, purchases, customers, products or firms."]})
    bills = kind in ("sales", "purchases")
    format_name = params.get("format", "xlsx" if bills else "csv")
    if format_name not in ("xlsx", "csv") or (not bills and format_name != "csv"):
        raise ValidationError({"format": ["Choose xlsx or csv."]})
    count = [0]
    if bills:
        start, end, firm, suffix, period = export_scope(params)
        rows = bill_rows(kind, start, end, firm, count)
        details = f"{'Sales' if kind == 'sales' else 'Purchase'} bills · {period} · {firm['name'].title() if firm else 'All firms'}"
    else:
        suffix, rows, details = str(timezone.localdate()), master_rows(kind, count), kind.title()
    filename = f"{kind.title()}_{suffix}.{format_name}"
    def audit():
        AuditLog.objects.create(action="exported", entity="backup", entity_id=0, entity_name=("Sales bills" if kind == "sales" else "Purchase bills") if bills else kind.title(),
            details=f'{details} · {count[0]} {"bills" if bills else kind}', user=user)
    def csv_content():
        yield "\ufeff"
        output = StringIO()
        writer = csv.writer(output)
        writer.writerow(COLUMNS[kind])
        yield output.getvalue()
        output.seek(0)
        output.truncate()
        for row in rows:
            writer.writerow([safe_cell(value) for value in row])
            yield output.getvalue()
            output.seek(0)
            output.truncate()
        audit()
    if format_name == "csv":
        response = StreamingHttpResponse(csv_content(), content_type="text/csv; charset=utf-8")
    else:
        workbook = Workbook(write_only=True)
        sheet = workbook.create_sheet(kind.title())
        sheet.append(COLUMNS[kind])
        for row in rows:
            sheet.append([safe_cell(ILLEGAL_CHARACTERS_RE.sub("", value) if isinstance(value, str) else value) for value in row])
        handle = TemporaryFile()
        try:
            workbook.save(handle)
            handle.seek(0)
            response = FileResponse(handle, content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        except BaseException:
            handle.close()
            raise
        original = response.streaming_content
        def streamed_file():
            yield from original
            audit()
        response.streaming_content = streamed_file()
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response
