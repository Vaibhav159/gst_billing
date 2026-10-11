"""P4-7: a full Audit page does bounded work, without GST checks or snapshots."""
from types import SimpleNamespace
from unittest.mock import patch

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from billing.models import AuditLog, Product
from billing.services.bin import bin_bill
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person, sale


class AuditPageBudgetTest(TestCase):
    def setUp(self):
        self.owner = person("audit-budget-owner", *ROLE_GROUPS["owner"])
        self.client = client_for(self.owner)
        self.business = firm()
        customer = buyer()
        for index in range(6):
            product = Product.objects.create(name=f"Unused {index}")
            for entity, obj in (("product", product), ("customer", customer), ("business", self.business)):
                AuditLog.objects.create(user=self.owner, action="created", entity=entity, entity_id=obj.pk, entity_name=obj.name)
            live = sale(self.business, customer, str(index), "2026-09-01")
            AuditLog.objects.create(user=self.owner, action="created", entity="invoice", entity_id=live.pk, entity_name=live.invoice_number)
            deleted = sale(self.business, customer, f"B{index}", "2026-09-01")
            bin_bill(deleted, self.owner)

    def test_thirty_mixed_rows_with_counts_have_a_bounded_query_budget(self):
        # Authentication's group cache is deliberately warm; measure the page itself.
        self.client.get("/api/audit/?counts=1")
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get("/api/audit/?counts=1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 30)
        self.assertLessEqual(len(queries), 15, "\n".join(q["sql"] for q in queries))
        self.assertEqual(response.data["counts"]["all"], 30)
        for row in response.data["results"]:
            self.assertIsNotNone(row["can"])
            if row["entity"] in {"business", "customer"}:
                self.assertTrue(row["can"]["disabled"])
            elif row["entity"] == "product":
                self.assertEqual(row["can"]["disabled"], "")
        self.assertFalse(any('"billing_auditlog"."snapshot",' in q["sql"] for q in queries))
        self.assertFalse(any(', "billing_binnedinvoice"."data",' in q["sql"] for q in queries))

    def test_month_status_is_shared_without_running_filing_checks(self):
        status = SimpleNamespace(unlocked=True, sales_closed=False, credit_closed=False)
        with patch("billing.period_lock.month_status", create=True, return_value=status) as reader:
            response = self.client.get("/api/audit/")
        self.assertEqual(response.status_code, 200)
        reader.assert_called_once_with(self.business.pk, 2026, 9, include_checks=False)
        restored = [row for row in response.data["results"] if row["can"]["kind"] == "restore"]
        self.assertEqual(len(restored), 6)
        self.assertTrue(all("needs an amendment" in row["can"]["effect"] for row in restored))

    def test_restored_capture_reconnects_its_earlier_discarded_event(self):
        from django.utils import timezone

        from billing.services.audit import entry_row
        entry = AuditLog(action="discarded", entity="capture", entity_id=17, entity_name="Supplier photo",
                         user=self.owner, timestamp=timezone.now())
        entry.used = False
        page = SimpleNamespace(records={}, bins={}, captures={17}, capture_has_discarded=True)
        self.assertEqual(entry_row(entry, page=page)["link"], "/purchases/inbox/17")
        # Before 2A's discard column exists, the legacy action fallback still applies.
        page.capture_has_discarded = False
        self.assertIsNone(entry_row(entry, page=page)["link"])

    def test_closed_month_uses_the_cached_state_for_both_action_words(self):
        status = SimpleNamespace(unlocked=None, sales_closed=True, credit_closed=False, stage="gstr1")
        with patch("billing.period_lock.month_status", create=True, return_value=status) as reader, \
                patch("billing.period_lock.assert_sales_open", side_effect=AssertionError("Do not re-read a cached month")):
            response = self.client.get("/api/audit/")
        self.assertEqual(response.status_code, 200)
        reader.assert_called_once_with(self.business.pk, 2026, 9, include_checks=False)
        rows = [row for row in response.data["results"] if row["entity"] == "invoice"]
        self.assertEqual(len(rows), 12)
        for row in rows:
            words = "a deleted bill can't go back into it" if row["can"]["kind"] == "restore" else "its bills can't be deleted"
            self.assertEqual(row["can"]["disabled"], f"September 2026's GSTR-1 is filed for KIRAN GOLD HOUSE, so {words}. Have the owner unlock September 2026's sales bills in GST returns first.")
