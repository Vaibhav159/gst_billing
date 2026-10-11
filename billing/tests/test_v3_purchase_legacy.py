"""v2 cannot overwrite or bypass a v3 purchase's credit period."""
from datetime import date
from types import SimpleNamespace

from django.contrib.admin.sites import AdminSite
from django.test import TestCase

from billing.admin import InvoiceAdmin
from billing.models import AuditLog, FiledPeriod, Invoice
from billing.services.bin import v2_snapshot
from billing.tests.v3_helpers import buyer, client_for, firm, person, sale


class PurchaseLegacyTests(TestCase):
    def setUp(self):
        self.firm = firm()
        self.supplier = buyer(gst_number="08ABCDE1234A1Z5")
        self.bill = sale(self.firm, self.supplier, "P-7", date(2026, 8, 1), kind="inward",
                         itc_month=date(2026, 9, 1), needs_review=True, source="capture")
        self.owner = person("owner", "admin")
        self.client = client_for(self.owner)

    def test_v2_patch_cannot_edit_filed_credit(self):
        FiledPeriod.objects.create(business=self.firm, year=2026, month=9)
        response = self.client.patch(f"/api/invoices/{self.bill.pk}/", {"payment_mode": "cash"}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(int(response.data["locked_period"]["month"]), 9)

    def test_v2_delete_cannot_delete_filed_credit(self):
        FiledPeriod.objects.create(business=self.firm, year=2026, month=9)
        response = self.client.delete(f"/api/invoices/{self.bill.pk}/")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertTrue(Invoice.objects.filter(pk=self.bill.pk).exists())

    def test_line_replace_checks_stored_credit(self):
        FiledPeriod.objects.create(business=self.firm, year=2026, month=9)
        response = self.client.post(f"/api/invoices/{self.bill.pk}/update_line_items/",
                                    {"line_items": []}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(self.bill.lineitem_set.count(), 1)

    def test_direct_line_delete_checks_stored_credit(self):
        FiledPeriod.objects.create(business=self.firm, year=2026, month=9)
        line = self.bill.lineitem_set.first()
        response = self.client.delete(f"/api/line-items/{line.pk}/")
        self.assertEqual(response.status_code, 400, response.data)

    def test_v2_date_and_firm_edits_clear_only_credit_month(self):
        other = firm("OTHER", gstin="27ABCDE1234A1Z5", state="MAHARASHTRA")
        for changes in ({"invoice_date": "2026-08-02"}, {"business": other.pk}):
            with self.subTest(changes=changes):
                Invoice.objects.filter(pk=self.bill.pk).update(itc_month=date(2026, 9, 1))
                response = self.client.patch(f"/api/invoices/{self.bill.pk}/", changes, format="json")
                self.assertEqual(response.status_code, 200, response.data)
                self.bill.refresh_from_db()
                self.assertIsNone(self.bill.itc_month)
                self.assertTrue(self.bill.needs_review)
                self.assertEqual(self.bill.source, "capture")

    def test_v2_no_date_change_keeps_month_and_ignores_v3_payload(self):
        response = self.client.patch(f"/api/invoices/{self.bill.pk}/",
                                    {"payment_mode": "cash", "itc_month": "2026-10-01", "needs_review": False}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.itc_month, date(2026, 9, 1))
        self.assertTrue(self.bill.needs_review)

    def test_admin_date_change_clears_month(self):
        self.bill.invoice_date = date(2026, 8, 2)
        InvoiceAdmin(Invoice, AdminSite()).save_model(SimpleNamespace(user=self.owner), self.bill, None, True)
        self.bill.refresh_from_db()
        self.assertIsNone(self.bill.itc_month)

    def test_undo_date_change_clears_month(self):
        snapshot = v2_snapshot(self.bill)
        snapshot["invoice_date"] = "2026-08-02"
        entry = AuditLog.objects.create(action="updated", entity="invoice", entity_id=self.bill.pk,
                                        entity_name="P-7", user=self.owner, snapshot=snapshot)
        response = self.client.post(f"/api/audit-logs/{entry.pk}/undo/")
        self.assertEqual(response.status_code, 200, response.data)
        self.bill.refresh_from_db()
        self.assertIsNone(self.bill.itc_month)

    def test_accountant_can_edit_purchase_line_but_staff_cannot(self):
        line = self.bill.lineitem_set.first()
        for groups, expected in ((("editor", "accountant"), 200), (("editor", "counter_staff"), 403)):
            client = client_for(person(groups[1], *groups))
            response = client.patch(f"/api/line-items/{line.pk}/", {"product_name": "Silver 925"}, format="json")
            self.assertEqual(response.status_code, expected, response.data)

    def test_inward_rows_expose_read_only_credit_fields(self):
        response = self.client.get(f"/api/inward-bills/{self.bill.pk}/")
        self.assertEqual(response.status_code, 200, response.data)
        for field in ("itc_month", "itc_eligible", "needs_review", "buyer_gstin", "source", "linked_sale"):
            self.assertIn(field, response.data)

    def test_line_replace_date_and_firm_changes_clear_month(self):
        other = firm("OTHER", gstin="27ABCDE1234A1Z5", state="MAHARASHTRA")
        for header in ({"invoice_date": "2026-08-02"}, {"business": other.pk}):
            with self.subTest(header=header):
                Invoice.objects.filter(pk=self.bill.pk).update(itc_month=date(2026, 9, 1))
                response = self.client.post(f"/api/invoices/{self.bill.pk}/update_line_items/",
                                             {"invoice": header, "line_items": []}, format="json")
                self.assertEqual(response.status_code, 200, response.data)
                self.bill.refresh_from_db()
                self.assertIsNone(self.bill.itc_month)

    def test_new_line_endpoints_check_credit_and_parent_permissions(self):
        FiledPeriod.objects.create(business=self.firm, year=2026, month=9)
        data = {"invoice": self.bill.pk, "product_name": "Silver", "quantity": "1", "rate": "10",
                "gst_tax_rate": "0", "amount": "10", "hsn_code": "7113"}
        response = self.client.post("/api/line-items/", data, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("locked_period", response.data)

    def test_undo_cannot_change_filed_credit(self):
        FiledPeriod.objects.create(business=self.firm, year=2026, month=9)
        entry = AuditLog.objects.create(action="created", entity="invoice", entity_id=self.bill.pk,
                                        entity_name="P-7", user=self.owner)
        response = self.client.post(f"/api/audit-logs/{entry.pk}/undo/")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertTrue(Invoice.objects.filter(pk=self.bill.pk).exists())
