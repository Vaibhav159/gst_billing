"""Review coverage for every legacy line create door and placed purchase roles."""
from datetime import date

from django.test import TestCase

from billing.models import FiledPeriod, InwardCapture
from billing.tests.v3_helpers import buyer, client_for, firm, person, sale


class ReviewLegacyPermissionsTests(TestCase):
    def setUp(self):
        self.business = firm()
        self.supplier = buyer()
        self.purchase = sale(self.business, self.supplier, "REVIEW-P", date(2026, 8, 1), kind="inward",
                             itc_month=date(2026, 9, 1))
        self.sale = sale(self.business, self.supplier, "REVIEW-S", date(2026, 8, 1))
        self.accountant = client_for(person("review-accountant", "editor", "accountant"))
        self.staff = client_for(person("review-staff", "editor", "counter_staff"))

    def doors(self, bill):
        return [
            ("/api/line-items/", {"invoice": bill.pk, "product_name": "Silver", "quantity": "1",
                                 "rate": "10", "gst_tax_rate": "0", "amount": "10", "hsn_code": "7113"}),
            (f"/api/invoices/{bill.pk}/line-items/", {"product_name": "Silver", "quantity": "1", "rate": "10"}),
            ("/api/line-items/create_for_invoice/", {"invoice_id": bill.pk, "item_name": "Silver", "qty": "1", "rate": "10"}),
        ]

    def test_every_line_create_door_uses_the_stored_parent_permission(self):
        for url, data in self.doors(self.purchase):
            denied = self.staff.post(url, {**data, "type_of_invoice": "outward"}, format="json")
            self.assertEqual((denied.status_code, denied.data["needs"]), (403, "purchase.edit"))
            allowed = self.accountant.post(url, {**data, "type_of_invoice": "outward"}, format="json")
            self.assertIn(allowed.status_code, (200, 201), allowed.data)
        for url, data in self.doors(self.sale):
            denied = self.accountant.post(url, {**data, "type_of_invoice": "inward"}, format="json")
            self.assertEqual((denied.status_code, denied.data["needs"]), (403, "bill.edit"))

    def test_alternate_line_creates_refuse_the_stored_credit_lock(self):
        FiledPeriod.objects.create(business=self.business, year=2026, month=9)
        before = self.purchase.lineitem_set.count()
        for url, data in self.doors(self.purchase):
            response = self.accountant.post(url, data, format="json")
            self.assertEqual(response.status_code, 400, response.data)
            self.assertEqual(int(response.data["locked_period"]["month"]), 9)
        self.assertEqual(self.purchase.lineitem_set.count(), before)

    def test_placed_roles_enter_inward_extract_and_capture_handlers_but_cannot_purge(self):
        capture = InwardCapture.objects.create(business=self.business)
        for client in (self.accountant, self.staff):
            inward = client.post("/api/inward-bills/", {}, format="multipart")
            extract = client.post("/api/inward-bills/extract/", {}, format="multipart")
            uploaded = client.post("/api/inward-captures/", {}, format="multipart")
            self.assertEqual((inward.status_code, inward.data), (400, {"error": "Unknown business."}))
            self.assertEqual((extract.status_code, extract.data), (400, {"error": "No file provided."}))
            self.assertEqual((uploaded.status_code, uploaded.data), (400, {"error": "No image provided."}))
            self.assertEqual(client.delete(f"/api/inward-captures/{capture.pk}/").status_code, 403)
        self.assertTrue(InwardCapture.objects.filter(pk=capture.pk).exists())
