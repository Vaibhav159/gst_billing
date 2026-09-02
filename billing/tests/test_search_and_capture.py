"""Quick search (Wave C) and the inward capture inbox (Wave D)."""

import json
from decimal import Decimal as D

from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from billing.models import Customer, Invoice, InwardCapture
from billing.tests.test_base import BaseAPITestCase

PNG = (b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)  # not a real image; storage only


class QuickSearchTest(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.narendra = Customer.objects.create(
            workspace_id=1, name="NARENDRA JI QS", state_name="RAJASTHAN")
        for _i, (num, dt, amt) in enumerate([
            ("QS-1", "2026-05-01", "100"), ("QS-2", "2026-06-01", "200"),
            ("QS-3", "2026-07-01", "300"), ("QS-4", "2026-08-01", "400"),
        ]):
            Invoice.objects.create(
                workspace_id=1, business=self.business, customer=self.narendra,
                invoice_number=num, invoice_date=dt,
                type_of_invoice="outward", total_amount=D(amt))

    def test_customer_hit_carries_three_most_recent_invoices(self):
        r = self.client.get(reverse("quick-search"), {"q": "narendra ji q"})
        self.assertEqual(r.status_code, 200)
        cust = next(c for c in r.data["customers"] if c["name"] == "NARENDRA JI QS")
        nums = [i["invoice_number"] for i in cust["recent_invoices"]]
        self.assertEqual(nums, ["QS-4", "QS-3", "QS-2"], nums)

    def test_invoice_number_hits_come_from_whole_db(self):
        r = self.client.get(reverse("quick-search"), {"q": "QS-1"})
        self.assertIn("QS-1", [i["invoice_number"] for i in r.data["invoices"]])

    def test_short_query_returns_empty(self):
        r = self.client.get(reverse("quick-search"), {"q": "n"})
        self.assertEqual(r.data, {"customers": [], "invoices": [], "products": []})


class CaptureInboxTest(BaseAPITestCase):
    def _snap(self, **extra):
        data = {"image": SimpleUploadedFile("bill.png", PNG, content_type="image/png")}
        data.update(extra)
        return self.client.post(reverse("inward-capture-list"), data, format="multipart")

    def test_capture_create_and_inbox_list(self):
        r = self._snap(supplier_hint="SOLANKI", note="exhibition day 2",
                       business_id=self.business.id)
        self.assertEqual(r.status_code, 201, getattr(r, "data", None))
        listed = self.client.get(reverse("inward-capture-list"))
        row = listed.data["results"][0]
        self.assertEqual(row["supplier_hint"], "SOLANKI")
        self.assertEqual(row["status"], "new")
        self.assertTrue(row["image_url"].startswith("/api/media/"))
        self.assertIn("?s=", row["image_url"])

    def test_convert_attaches_photo_and_retires_capture(self):
        cap_id = self._snap().data["id"]
        r = self.client.post(reverse("inward-bill-list"), {
            "business_id": self.business.id,
            "supplier_name": "CAPTURE SUPPLIER",
            "invoice_number": "CAP-1", "invoice_date": "2026-08-20",
            "capture_id": cap_id,
            "lines": json.dumps([{"product_name": "Silver", "hsn_code": "711311",
                                  "quantity": "10", "rate": "100",
                                  "gst_tax_rate": "0.03", "unit": "gms"}]),
        })
        self.assertEqual(r.status_code, 201, getattr(r, "data", None))
        cap = InwardCapture.objects.get(id=cap_id)
        self.assertEqual(cap.status, "converted")
        inv = Invoice.objects.get(invoice_number="CAP-1")
        self.assertEqual(cap.invoice_id, inv.id)
        self.assertTrue(inv.source_file.name, "photo must ride onto the invoice")
        inbox = self.client.get(reverse("inward-capture-list"))
        self.assertEqual(inbox.data["count"], 0, "converted captures leave the inbox")

    def test_delete_discards_capture(self):
        cap_id = self._snap().data["id"]
        r = self.client.delete(reverse("inward-capture-detail", args=[cap_id]))
        self.assertEqual(r.status_code, 204)
        self.assertFalse(InwardCapture.objects.filter(id=cap_id).exists())
