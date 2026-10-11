"""The bin, search, Audit undo and opt-in synthetic purchase seed share the new domain."""
import tempfile
from datetime import date
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase, override_settings

from billing.management.commands.seed_sandbox import Command
from billing.models import AiRead, AuditLog, CapturePage, FiledPeriod, Invoice, InwardCapture
from billing.services.purchase_bin import bin_purchase
from billing.tests.v3_helpers import buyer, client_for, firm, person, sale


class PurchaseIntegrationTests(TestCase):
    def setUp(self):
        self.owner = person("integration-owner", "admin")
        self.client = client_for(self.owner)
        self.business = firm()
        self.supplier = buyer("SUNRISE SUPPLIER", gst_number="08AACFU5521R1ZN", is_supplier=True)
        self.bill = sale(self.business, self.supplier, "PUR-71", date(2026, 8, 1), kind="inward",
                         itc_month=date(2026, 10, 1), needs_review=True)

    def test_sales_bin_does_not_list_or_restore_a_purchase(self):
        binned = bin_purchase(self.bill, self.owner)
        result = self.client.get("/api/bin/")
        self.assertNotIn(binned.pk, [row["id"] for row in result.data["results"]])
        self.assertEqual(self.client.post(f"/api/bin/{binned.pk}/restore/").status_code, 404)

    def test_audit_undo_uses_purchase_restore_and_credit_guard(self):
        binned = bin_purchase(self.bill, self.owner)
        period = FiledPeriod.objects.create(business=self.business, year=2026, month=10)
        result = self.client.post(f"/api/audit-logs/{binned.audit_log_id}/undo/")
        self.assertEqual(result.status_code, 400, result.data)
        period.delete()
        result = self.client.post(f"/api/audit-logs/{binned.audit_log_id}/undo/")
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(result.data["new_id"], self.bill.pk)
        bill = Invoice.objects.get(pk=self.bill.pk)
        self.assertEqual(bill.itc_month, date(2026, 10, 1))
        self.assertTrue(bill.needs_review)

    def test_legacy_deleted_purchase_undo_checks_its_saved_credit_month(self):
        self.assertEqual(self.client.delete(f"/api/invoices/{self.bill.pk}/").status_code, 204)
        entry = AuditLog.objects.get(action="deleted", entity="invoice", entity_id=self.bill.pk)
        period = FiledPeriod.objects.create(business=self.business, year=2026, month=10)
        refused = self.client.post(f"/api/audit-logs/{entry.pk}/undo/")
        self.assertEqual(refused.status_code, 400, refused.data)
        period.delete()
        restored = self.client.post(f"/api/audit-logs/{entry.pk}/undo/")
        self.assertEqual(restored.status_code, 200, restored.data)
        self.assertEqual(Invoice.objects.get(pk=restored.data["new_id"]).itc_month, date(2026, 10, 1))

    def test_search_purchase_rows_and_supplier_rows(self):
        result = self.client.get("/api/search/quick/", {"q": "PUR-71"})
        row = next(row for row in result.data["invoices"] if row["id"] == self.bill.pk)
        self.assertEqual(row["credit_month"], "2026-10")
        self.assertTrue(row["needs_review"])
        result = self.client.get("/api/search/quick/", {"q": "SUNRISE"})
        self.assertEqual(result.data["suppliers"][0]["id"], self.supplier.pk)

    def test_bin_keeps_json_as_json(self):
        self.bill.firm_snapshot = {"name": "Frozen", "business_id": self.business.pk}
        self.bill.save(update_fields=["firm_snapshot"])
        binned = bin_purchase(self.bill, self.owner)
        self.assertEqual(binned.data["invoice"]["firm_snapshot"], self.bill.firm_snapshot)
        response = self.client.post(f"/api/purchases/bin/{binned.pk}/restore/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Invoice.objects.get(pk=self.bill.pk).firm_snapshot, self.bill.firm_snapshot)


class PurchaseSeedTests(TestCase):
    def test_opt_in_seed_has_every_purchase_flow_and_resets(self):
        with tempfile.TemporaryDirectory() as media, override_settings(MEDIA_ROOT=media), \
                patch.object(Command, "_assert_sandbox"), \
                patch("billing.management.commands.seed_sandbox.timezone.localdate", return_value=date(2026, 10, 8)):
            for flags in ([], ["--reset"]):
                call_command("seed_sandbox", "--scale", "0.1", "--purchases-v3", *flags,
                             stdout=StringIO(), stderr=StringIO())
                purchases = Invoice.objects.purchases()
                self.assertTrue(purchases.filter(itc_month__isnull=False).exists())
                self.assertEqual(purchases.filter(needs_review=True).count(), 2)
                self.assertTrue(purchases.filter(itc_eligible=False).exists())
                self.assertTrue(purchases.filter(linked_sale__isnull=False).exists())
                self.assertEqual(purchases.filter(invoice_number="P2-DUP").count(), 2)
                self.assertTrue(InwardCapture.objects.filter(read_status="ready").exists())
                self.assertTrue(InwardCapture.objects.filter(read_status="failed").exists())
                self.assertTrue(InwardCapture.objects.filter(discarded_at__isnull=False).exists())
                self.assertTrue(InwardCapture.objects.filter(pdf=True).exists())
                self.assertTrue(CapturePage.objects.filter(position=2).exists())
                self.assertEqual(AiRead.objects.filter(ok=True).count(), 1212)
                self.assertTrue(AuditLog.objects.filter(action="created", entity="invoice").exists())
