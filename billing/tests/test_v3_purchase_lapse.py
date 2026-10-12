"""R3A-9 on the purchase screens: the card and totals lapse credit by the ledger's rule."""
from datetime import date
from unittest.mock import patch

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from billing.models import FilingRecord
from billing.tests.v3_helpers import buyer, firm, sale

UNFILED_AFTER = date(2026, 12, 1)


class PurchaseLapseTests(TestCase):
    def setUp(self):
        self.business = firm()
        # April 2025 bill, credit month April 2025: 10000 x 3% = 150 CGST + 150 SGST.
        self.bill = sale(self.business, buyer(), "P-APR", date(2025, 4, 10), kind="inward")

    def read(self, today):
        from billing.credit import credit_lapsed
        from billing.services.ledger import _purchase_lines
        from billing.services.purchase_reads import purchase_queryset, purchase_rows, purchase_summary
        from billing.services.suppliers import supplier_figures

        with patch("django.utils.timezone.localdate", return_value=today):
            qs = purchase_queryset().filter(pk=self.bill.pk)
            row = purchase_rows(qs)[0]
            return {"ledger": _purchase_lines(self.business, today=today).filter(lapsed=True).exists(),
                    "card": row["credit"], "summary": purchase_summary(qs)["credit"],
                    "supplier": supplier_figures([self.bill.customer_id])[self.bill.customer_id]["credit"],
                    "helper": credit_lapsed(self.bill, today=today)}

    def test_april_credit_unfiled_on_1_december_next_year_lapses_like_the_ledger(self):
        seen = self.read(UNFILED_AFTER)
        self.assertTrue(seen["ledger"])
        self.assertTrue(seen["helper"])
        self.assertTrue(seen["card"]["lapsed"])
        self.assertEqual(seen["card"]["claimed"], "0.00")
        self.assertIsNone(seen["card"]["filed_on"])
        self.assertEqual(seen["summary"], "0.00")
        self.assertEqual(seen["supplier"], "0.00")

    def test_april_credit_still_claimed_on_30_november(self):
        seen = self.read(date(2026, 11, 30))
        self.assertFalse(seen["ledger"])
        self.assertFalse(seen["card"]["lapsed"])
        self.assertEqual(seen["card"]["claimed"], "300.00")
        self.assertEqual(seen["summary"], "300.00")

    def test_april_gstr3b_filed_on_25_november_keeps_the_credit_and_shows_the_day(self):
        FilingRecord.objects.create(business=self.business, year=2025, month=4, kind="gstr3b", filed_on=date(2026, 11, 25))
        seen = self.read(UNFILED_AFTER)
        self.assertFalse(seen["ledger"])
        self.assertFalse(seen["helper"])
        self.assertFalse(seen["card"]["lapsed"])
        self.assertEqual(seen["card"]["claimed"], "300.00")
        self.assertEqual(seen["card"]["filed_on"], "2026-11-25")
        self.assertEqual(seen["summary"], "300.00")
        self.assertEqual(seen["supplier"], "300.00")

    def test_april_gstr3b_recorded_on_1_december_lapses(self):
        FilingRecord.objects.create(business=self.business, year=2025, month=4, kind="gstr3b", filed_on=date(2026, 12, 1))
        seen = self.read(date(2026, 12, 2))
        self.assertTrue(seen["ledger"])
        self.assertTrue(seen["card"]["lapsed"])
        self.assertEqual(seen["card"]["filed_on"], "2026-12-01")
        self.assertEqual(seen["summary"], "0.00")

    def test_page_reads_lapse_without_a_query_per_bill(self):
        from billing.services.purchase_reads import purchase_queryset, purchase_rows

        sale(self.business, buyer("Second"), "P-MAY", date(2025, 5, 10), kind="inward")
        with patch("django.utils.timezone.localdate", return_value=UNFILED_AFTER):
            one = purchase_queryset().filter(pk=self.bill.pk)
            both = purchase_queryset()
            with CaptureQueriesContext(connection) as small:
                purchase_rows(one)
            with CaptureQueriesContext(connection) as large:
                rows = purchase_rows(both)
        self.assertEqual(len(small), len(large))
        self.assertTrue(all(row["credit"]["lapsed"] for row in rows))
