"""P4-7/X-40: run the Audit budget against real 3A closed-month state at landing."""
from datetime import date
from unittest.mock import patch

from django.apps import apps
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from billing import period_lock
from billing.models import FiledPeriod
from billing.tests import test_records_audit_preflight as audit_fixture


class AuditFilingPageBudgetTest(TestCase):
    def setUp(self):
        try:
            self.filing_model = apps.get_model("billing", "FilingRecord")
        except LookupError:
            self.skipTest("X-40: the real closed-month Audit budget requires 3A filing models.")
        if not hasattr(period_lock, "month_status"):
            self.skipTest("X-40: the real closed-month Audit budget requires 3A month_status.")
        # Reuse the 30-row fixture without inheriting and collecting its tests again.
        audit_fixture.AuditPageBudgetTest.setUp(self)
        self.filing_model.objects.create(
            business=self.business, year=2026, month=9, kind="gstr1", filed_on=date(2026, 10, 1),
        )

    def assert_closed_page(self, stage):
        # Warm only authentication before measuring the complete request, as in the base budget.
        self.client.get("/api/audit/?counts=1")
        with patch("billing.period_lock.month_status", wraps=period_lock.month_status) as reader, \
                patch("billing.period_lock.assert_sales_open", side_effect=AssertionError(
                    "Audit must use its cached filing state instead of rereading the sales guard."
                )) as guard, CaptureQueriesContext(connection) as queries:
            response = self.client.get("/api/audit/?counts=1")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data["results"]), 30)
        self.assertEqual(response.data["counts"]["all"], 30)
        self.assertLessEqual(len(queries), 15, "\n".join(query["sql"] for query in queries))
        reader.assert_called_once_with(self.business.pk, 2026, 9, include_checks=False)
        guard.assert_not_called()
        invoices = [row for row in response.data["results"] if row["entity"] == "invoice"]
        self.assertEqual(len(invoices), 12)
        self.assertEqual(sum(row["can"]["kind"] == "undo" for row in invoices), 6)
        self.assertEqual(sum(row["can"]["kind"] == "restore" for row in invoices), 6)
        for row in invoices:
            words = "its bills can't be deleted" if row["can"]["kind"] == "undo" else "a deleted bill can't go back into it"
            if stage == "gstr1":
                expected = (f"September 2026's GSTR-1 is filed for {self.business.name}, so {words}. "
                            "Have the owner unlock September 2026's sales bills in GST returns first.")
            else:
                expected = (f"September 2026 is filed and locked for {self.business.name}, so {words}. "
                            "Have the owner unlock September 2026 in GST returns first.")
            self.assertEqual(row["can"]["disabled"], expected)
        self.assertFalse(any('"billing_auditlog"."snapshot",' in query["sql"] for query in queries))
        self.assertFalse(any(', "billing_binnedinvoice"."data",' in query["sql"] for query in queries))

    def test_real_gstr1_closed_month_keeps_the_mixed_audit_page_budget(self):
        self.assert_closed_page("gstr1")

    def test_real_filed_and_locked_month_keeps_the_mixed_audit_page_budget(self):
        self.filing_model.objects.create(
            business=self.business, year=2026, month=9, kind="gstr3b", filed_on=date(2026, 10, 2),
        )
        FiledPeriod.objects.create(business=self.business, year=2026, month=9)
        self.assert_closed_page("filed")
