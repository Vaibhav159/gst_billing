"""X-84's cross-language fixture: real v2 API reads and the real v3 CA builder.

The web-only CI job cannot import Django. Its checked-in response is verified here
against the same stored books on every backend run, never manufactured in TS.
Regenerate after an intentional contract change with GST_UPDATE_CA_FIXTURE=1.
"""
import json
import os
from datetime import date
from pathlib import Path

import pytest

from billing.models import Business, Customer, Invoice, LineItem
from billing.services.v3_reports import ca_workbook, load_register
from billing.tests.v3_helpers import client_for, person

pytestmark = pytest.mark.django_db
FIXTURES = Path(__file__).resolve().parents[2] / "web/src/core/excel/__fixtures__"
BOOKS = json.loads((FIXTURES / "caWorkbook.books.json").read_text())
PROJECTION = FIXTURES / "caWorkbook.responses.json"


def test_real_export_transformations_match_the_shared_web_fixture():
    business = Business.objects.create(**BOOKS["business"])
    for customer in BOOKS["customers"]:
        Customer.objects.create(**customer)
    client = client_for(person("ca-parity", "admin"))
    start, end = date.fromisoformat(BOOKS["from"]), date.fromisoformat(BOOKS["to"])
    actual = {}
    for name, bills in BOOKS["cases"].items():
        Invoice.objects.all().delete()
        for source in bills:
            fields = {key: value for key, value in source.items() if key not in ("business", "customer", "line_items")}
            invoice = Invoice.objects.create(**fields, business_id=source["business"], customer_id=source["customer"])
            # Preserve historical 3-decimal stored rows; do not run today's write-path rounding.
            for line in source["line_items"]:
                LineItem.objects.create(invoice=invoice, **line)
            # LineItem saves recalculate the bill; restore the historical stored total.
            Invoice.objects.filter(pk=invoice.pk).update(total_amount=source["total_amount"])
        response = client.get("/api/invoices/", {"include_items": "true", "page_size": 200,
                                                 "business_id": business.pk, "start_date": start, "end_date": end})
        assert response.status_code == 200, response.content
        assert response.data["next"] is None
        # Omit volatile metadata and line PKs; every money/identity field comes from the real serializer.
        invoices = []
        for row in response.json()["results"]:
            values = {key: value for key, value in row.items() if key in (
                "id", "invoice_number", "invoice_date", "customer", "customer_name", "business", "business_name",
                "type_of_invoice", "total_amount", "payment_mode", "status", "is_igst_applicable", "total_tax",
            )}
            values["line_items"] = [{key: value for key, value in line.items() if key in (
                "product_name", "hsn_code", "gst_tax_rate", "quantity", "rate", "cgst", "sgst", "igst", "amount", "unit",
            )} for line in row["line_items"]]
            invoices.append(values)
        register = load_register(start, end, business.pk)
        actual[name] = {"invoices": invoices, "workbook": ca_workbook(
            register["sales"], register["purchases"], firms=register["firms"], start=start, end=end,
            split=True, today=date(2026, 12, 10),
        )}
    if os.environ.get("GST_UPDATE_CA_FIXTURE") == "1":
        PROJECTION.write_text(json.dumps(actual, indent=2) + "\n")
    assert actual == json.loads(PROJECTION.read_text())
