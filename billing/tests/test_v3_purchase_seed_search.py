"""Part 2 additions keep quick search bounded and the default v2 seed stable."""
import tempfile
from datetime import date
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext

from billing.management.commands.seed_sandbox import Command
from billing.models import AiRead, AuditLog, CapturePage, Customer, Invoice, InwardCapture
from billing.tests.test_v3_cacheops import cacheops_on
from billing.tests.v3_helpers import buyer, client_for, firm, person, sale


class PurchaseQuickSearchTests(TestCase):
    def setUp(self):
        self.client = client_for(person("search-viewer", "viewer"))
        self.business = firm()
        self.supplier = buyer("Sunrise Supplier", gst_number="08AACFU5521R1ZN", is_supplier=True)
        self.bill = sale(self.business, self.supplier, "PUR-71", date(2026, 8, 1), kind="inward",
                         itc_month=date(2026, 10, 1), needs_review=True)

    def test_direct_and_recent_purchase_rows_show_effective_credit_and_check(self):
        response = self.client.get("/api/search/quick/", {"q": "PUR-71"})
        row = response.data["invoices"][0]
        self.assertEqual((row["credit_month"], row["needs_review"], row["business_id"]),
                         ("2026-10", True, self.business.pk))
        response = self.client.get("/api/search/quick/", {"q": "Sunrise"})
        self.assertEqual(response.data["customers"][0]["recent_invoices"][0]["credit_month"], "2026-10")
        self.bill.itc_month = None
        self.bill.save(update_fields=["itc_month"])
        response = self.client.get("/api/search/quick/", {"q": "PUR-71"})
        self.assertEqual(response.data["invoices"][0]["credit_month"], "2026-08")

    def test_pre_ledger_purchase_has_no_credit_month_in_direct_or_recent_rows(self):
        self.bill.invoice_date = date(2025, 3, 31)
        self.bill.itc_month = date(2025, 4, 1)  # even a legacy stored choice cannot create ledger credit
        self.bill.save(update_fields=["invoice_date", "itc_month"])
        direct = self.client.get("/api/search/quick/", {"q": "PUR-71"}).data["invoices"][0]
        recent = self.client.get("/api/search/quick/", {"q": "Sunrise"}).data["customers"][0]["recent_invoices"][0]
        for row in (direct, recent):
            self.assertIsNone(row["credit_month"])
            self.assertTrue(row["needs_review"])
            self.assertEqual(row["business_id"], self.business.pk)

    def test_supplier_role_includes_prior_purchase_and_marked_rows_only(self):
        old = buyer("Sunrise Legacy")
        sale(self.business, old, "OLD-PURCHASE", date(2026, 9, 1), kind="inward")
        buyer("Sunrise Buyer")
        response = self.client.get("/api/search/quick/", {"q": "Sunrise"})
        self.assertEqual([row["id"] for row in response.data["suppliers"]], [old.pk, self.supplier.pk])
        self.assertEqual(set(response.data["suppliers"][1]), {"id", "name", "gst_number", "state_code", "state_name", "city"})
        self.assertEqual(response.data["suppliers"][1]["gst_number"], "08AACFU5521R1ZN")

    def test_short_search_preserves_the_legacy_three_empty_arrays(self):
        self.assertEqual(self.client.get("/api/search/quick/", {"q": "s"}).data,
                         {"customers": [], "invoices": [], "products": []})

    def test_suppliers_are_bounded_narrow_and_uncached(self):
        Customer.objects.bulk_create([Customer(name=f"Sunrise {index:02}", is_supplier=True,
                                               address="Private long address", pan_number="ABCDE1234F")
                                      for index in range(8)])
        self.client.get("/api/search/quick/", {"q": "Sunrise"})
        with cacheops_on() as cached, CaptureQueriesContext(connection) as queries:
            response = self.client.get("/api/search/quick/", {"q": "Sunrise"})
        self.assertEqual(cached, [])
        self.assertEqual(len(response.data["suppliers"]), 5)
        party_queries = [query["sql"] for query in queries if 'FROM "billing_customer"' in query["sql"]]
        self.assertEqual(len(party_queries), 2)
        for sql in party_queries:
            self.assertIn("LIMIT 5", sql)
            self.assertNotIn('"address"', sql)
            self.assertNotIn('"pan_number"', sql)


class PurchaseOptInSeedTests(TestCase):
    def test_default_three_captures_and_opt_in_all_cases_survive_reset(self):
        with tempfile.TemporaryDirectory() as media, override_settings(MEDIA_ROOT=media), \
                patch.object(Command, "_assert_sandbox"), \
                patch("billing.management.commands.seed_sandbox.timezone.localdate", return_value=date(2026, 10, 8)):
            call_command("seed_sandbox", "--scale", "0.1", stdout=StringIO(), stderr=StringIO())
            self.assertEqual(InwardCapture.objects.count(), 3)
            self.assertFalse(CapturePage.objects.exists())
            self.assertFalse(AiRead.objects.exists())
            for _ in range(2):
                call_command("seed_sandbox", "--scale", "0.1", "--purchases-v3", "--reset",
                             stdout=StringIO(), stderr=StringIO())
                purchases = Invoice.objects.purchases()
                self.assertEqual(purchases.get(invoice_number="P2-LATE").itc_month, date(2026, 9, 1))
                old = purchases.get(invoice_number="P2-OLD-FY")
                self.assertEqual((old.invoice_date, old.itc_month), (date(2026, 3, 31), date(2026, 10, 1)))
                self.assertEqual(purchases.filter(needs_review=True).count(), 2)
                self.assertTrue(purchases.filter(itc_eligible=False).exists())
                paired = purchases.get(linked_sale__isnull=False)
                self.assertTrue(Invoice.objects.sales().filter(pk=paired.linked_sale).exists())
                self.assertEqual(purchases.filter(invoice_number="P2-DUP").count(), 2)
                self.assertEqual(purchases.get(invoice_number="P2-NO-HSN").lineitem_set.get().hsn_code, "")
                unregistered = purchases.get(invoice_number="P2-NO-GSTIN")
                self.assertFalse(unregistered.customer.gst_number)
                self.assertEqual(unregistered.lineitem_set.get().gst_tax_rate, 0)
                self.assertTrue(Customer.objects.filter(is_supplier=True).exists())
                self.assertEqual(InwardCapture.objects.count(), 5)
                self.assertTrue(InwardCapture.objects.filter(read_status="ready", read_data__isnull=False).exists())
                self.assertTrue(InwardCapture.objects.filter(read_status="failed", read_data__isnull=True).exists())
                self.assertTrue(InwardCapture.objects.filter(read_status="reading", read_started_at__isnull=False,
                                                              business__isnull=True).exists())
                filled = InwardCapture.objects.get(status="converted")
                self.assertTrue(purchases.filter(pk=filled.invoice_id).exists())
                self.assertIsNotNone(filled.read_data)
                self.assertTrue(InwardCapture.objects.filter(discarded_at__isnull=False).exists())
                self.assertTrue(InwardCapture.objects.filter(pdf=True).exists())
                self.assertTrue(CapturePage.objects.filter(position=2).exists())
                for capture in InwardCapture.objects.all():
                    first = capture.v3_pages.get(position=1)
                    self.assertEqual(capture.image.name, first.file.name)
                    self.assertTrue(first.file.storage.exists(first.file.name))
                    self.assertTrue(first.preview.storage.exists(first.preview.name))
                self.assertEqual(AiRead.objects.filter(ok=True).count(), 1212)
                self.assertTrue(AuditLog.objects.filter(action="created", entity="invoice").exists())
