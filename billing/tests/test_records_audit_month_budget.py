"""P4-7: legacy Audit month reads stay bounded across different months."""
from datetime import date
from unittest import skipUnless
from unittest.mock import patch

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from billing import period_lock
from billing.models import AuditLog, FiledPeriod
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person, sale


class AuditMonthBudgetTests(TestCase):
    def setUp(self):
        self.owner = person("audit-month-budget-owner", *ROLE_GROUPS["owner"])
        self.client = client_for(self.owner)
        self.business = firm()
        customer = buyer()
        self.days = [date(2024 + index // 12, index % 12 + 1, 1) for index in range(30)]
        for index, day in enumerate(self.days):
            bill = sale(self.business, customer, str(index), day)
            AuditLog.objects.create(user=self.owner, action="created", entity="invoice",
                                    entity_id=bill.pk, entity_name=bill.invoice_number)

    def measured_page(self):
        self.client.get("/api/audit/?counts=1")
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get("/api/audit/?counts=1")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data["results"]), 30)
        self.assertLessEqual(len(queries), 15, "\n".join(query["sql"] for query in queries))
        return response, queries

    def test_thirty_distinct_open_months_use_one_legacy_period_read(self):
        with patch("billing.period_lock.month_status", None, create=True):
            response, queries = self.measured_page()
        self.assertTrue(all(row["can"]["disabled"] == "" for row in response.data["results"]))
        reads = [query for query in queries if 'FROM "billing_filedperiod"' in query["sql"]]
        self.assertEqual(len(reads), 1)

    def test_thirty_distinct_closed_months_keep_exact_words_without_guard_reads(self):
        FiledPeriod.objects.bulk_create([
            FiledPeriod(business=self.business, year=day.year, month=day.month) for day in self.days
        ])
        with patch("billing.period_lock.month_status", None, create=True), \
                patch("billing.period_lock.assert_sales_open", wraps=period_lock.assert_sales_open) as guard:
            response, queries = self.measured_page()
        expected = {
            f"{day:%B %Y} is filed and locked for {self.business.name}, so its bills can't be deleted. "
            f"Have the owner unlock {day:%B %Y} in GST returns first."
            for day in self.days
        }
        self.assertEqual({row["can"]["disabled"] for row in response.data["results"]}, expected)
        guard.assert_not_called()
        reads = [query for query in queries if 'FROM "billing_filedperiod"' in query["sql"]]
        self.assertEqual(len(reads), 1)

    @skipUnless(hasattr(period_lock, "month_status"),
                "X-40: real 3A varied-month budget needs its grouped status integration after landing")
    def test_real_three_a_thirty_distinct_months_remain_bounded(self):
        # Deliberately uses the real helper: a fake constant state cannot prove its query budget.
        response, _queries = self.measured_page()
        self.assertTrue(all(row["can"]["disabled"] == "" for row in response.data["results"]))
