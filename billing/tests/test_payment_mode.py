"""Payment mode (bank/cash/credit/mixed) — recorded, filtered, imported.

Blank means "not recorded" and stays the default everywhere: no path may
invent a mode the user never entered.
"""

import json

from django.urls import reverse

from billing.constants import normalize_payment_mode
from billing.models import Customer, Invoice
from billing.tests.test_base import BaseAPITestCase


class NormalizeTest(BaseAPITestCase):
    def test_canonical_and_aliases(self):
        for raw, want in [
            ("bank", "bank"), ("Bank", "bank"), ("UPI", "bank"), ("neft", "bank"),
            ("cheque", "bank"), ("CASH", "cash"), ("c", "cash"), ("b", "bank"),
            ("credit", "credit"), ("udhaar", "credit"), ("unpaid", "credit"),
            ("mixed", "mixed"), ("part", "mixed"),
        ]:
            self.assertEqual(normalize_payment_mode(raw), want, raw)

    def test_junk_becomes_not_set(self):
        for raw in ("", None, "gold", "123", "ba nk"):
            self.assertEqual(normalize_payment_mode(raw), "")


class InvoiceApiTest(BaseAPITestCase):
    def _create(self, extra=None):
        payload = {
            "invoice_number": "PM-1",
            "invoice_date": "2026-08-01",
            "type_of_invoice": "outward",
            "customer": self.customer.id,
            "business": self.business.id,
            "total_amount": "1000",
        }
        payload.update(extra or {})
        return self.client.post(reverse("invoice-list"), payload, format="json")

    def test_default_is_not_set(self):
        r = self._create()
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(Invoice.objects.get(id=r.data["id"]).payment_mode, "")

    def test_create_and_update_round_trip(self):
        r = self._create({"payment_mode": "cash"})
        self.assertEqual(r.status_code, 201, r.data)
        inv_id = r.data["id"]
        self.assertEqual(Invoice.objects.get(id=inv_id).payment_mode, "cash")
        r2 = self.client.patch(
            reverse("invoice-detail", args=[inv_id]),
            {"payment_mode": "credit"}, format="json")
        self.assertEqual(r2.status_code, 200, r2.data)
        self.assertEqual(Invoice.objects.get(id=inv_id).payment_mode, "credit")

    def test_invalid_mode_is_rejected(self):
        r = self._create({"payment_mode": "barter"})
        self.assertEqual(r.status_code, 400)

    def test_list_serializer_exposes_it_and_filter_works(self):
        self._create({"payment_mode": "cash", "invoice_number": "PM-C"})
        self._create({"invoice_number": "PM-N"})
        listed = self.client.get(reverse("invoice-list"), {"payment_mode": "cash"})
        numbers = [i["invoice_number"] for i in listed.data["results"]]
        self.assertIn("PM-C", numbers)
        self.assertNotIn("PM-N", numbers)
        self.assertEqual(
            [i["payment_mode"] for i in listed.data["results"] if i["invoice_number"] == "PM-C"],
            ["cash"])
        unset = self.client.get(reverse("invoice-list"), {"payment_mode": "none"})
        numbers = [i["invoice_number"] for i in unset.data["results"]]
        self.assertIn("PM-N", numbers)
        self.assertNotIn("PM-C", numbers)


class InwardCaptureTest(BaseAPITestCase):
    def test_capture_records_supplier_payment(self):
        r = self.client.post(reverse("inward-bill-list"), {
            "business_id": self.business.id,
            "supplier_name": "PAYMENT SUPPLIER",
            "invoice_number": "PMI-1", "invoice_date": "2026-08-01",
            "payment_mode": "Bank",
            "lines": json.dumps([{"product_name": "Silver", "hsn_code": "711311",
                                  "quantity": "10", "rate": "100",
                                  "gst_tax_rate": "0.03", "unit": "gms"}]),
        })
        self.assertEqual(r.status_code, 201, r.data)
        inv = Invoice.objects.get(invoice_number="PMI-1")
        self.assertEqual(inv.payment_mode, "bank")
        listed = self.client.get(reverse("inward-bill-list"), {"business_id": self.business.id})
        row = next(i for i in listed.data["results"] if i["invoice_number"] == "PMI-1")
        self.assertEqual(row["payment_mode"], "bank")


class BulkImportTest(BaseAPITestCase):
    def test_rows_carry_mode_and_junk_degrades_to_not_set(self):
        Customer.objects.create(workspace_id=1, name="BULK PARTY")
        payload = {
            "business_id": self.business.id,
            "invoices": [
                {"invoiceNumber": "B-1", "invoice_date": "2026-08-02",
                 "customerName": "BULK PARTY", "type": "OUTWARD", "total": 100,
                 "paymentMode": "UPI",
                 "items": [{"productName": "Silver", "hsn": "711311",
                            "qty": 10, "rate": 10, "gstRate": 3}]},
                {"invoiceNumber": "B-2", "invoice_date": "2026-08-03",
                 "customerName": "BULK PARTY", "type": "OUTWARD", "total": 100,
                 "paymentMode": "??",
                 "items": [{"productName": "Silver", "hsn": "711311",
                            "qty": 10, "rate": 10, "gstRate": 3}]},
            ],
        }
        r = self.client.post(reverse("bulk-invoice-import"), payload, format="json")
        self.assertEqual(r.status_code, 201, getattr(r, "data", r.content))
        self.assertEqual(r.data.get("created"), 2, r.data)
        self.assertEqual(Invoice.objects.get(invoice_number="B-1").payment_mode, "bank")
        self.assertEqual(Invoice.objects.get(invoice_number="B-2").payment_mode, "")
