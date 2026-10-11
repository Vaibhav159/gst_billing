"""Rule 46(f)'s candidate read stays small without trusting legacy stored totals."""

from datetime import datetime, timezone
from unittest.mock import patch

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from billing.models import Invoice
from billing.services.bill_reads import filter_bills
from billing.tests.v3_helpers import buyer, client_for, firm, line, person, sale


def row_count(sql):
    """Replay a captured SELECT to measure the rows that crossed the database boundary."""
    with connection.cursor() as cursor:
        cursor.execute(sql)
        return len(cursor.fetchall())


class Rule46fCandidatesTest(TestCase):
    def setUp(self):
        self.enterContext(patch("django.utils.timezone.now", return_value=datetime(2026, 10, 11, tzinfo=timezone.utc)))
        self.biz = firm()
        self.client = client_for(person("viewer", "viewer"))

    def probe_bills(self, customer):
        for n in range(60):
            sale(self.biz, customer, str(n + 1), "2026-10-08", line(rate="750"), line(rate="750"))
        return sale(self.biz, customer, "61", "2026-10-08", line(rate="60000"))

    def test_filter_reads_only_the_large_walkin_bill_and_its_line(self):
        large = self.probe_bills(buyer("Walk-in Customer", customer_type="walkin"))
        with CaptureQueriesContext(connection) as seen:
            filtered = filter_bills(Invoice.objects.sales(), {"itax": "1"})
        # Candidate bills and their lines stay two batch reads, regardless of the bill count.
        self.assertEqual(len(seen), 2)
        counts = [row_count(q["sql"]) for q in seen]
        self.assertEqual(counts, [1, 1], f"candidate bills / lines read: {counts}")
        self.assertEqual(list(filtered.values_list("pk", flat=True)), [large.pk])
        for q in seen:
            self.assertNotIn('"notes"', q["sql"])
            self.assertNotIn('"firm_snapshot"', q["sql"])
            self.assertNotIn('"product_name"', q["sql"])

    def test_list_and_walkin_customer_page_read_only_one_candidate(self):
        customer = buyer("Walk-in Customer", customer_type="walkin")
        large = self.probe_bills(customer)
        for params in ({"itax": "1", "fy": "2026-27"},
                       {"customer_id": customer.pk, "itax": "1", "ordering": "-date", "page_size": 200}):
            with self.subTest(params=params):
                with CaptureQueriesContext(connection) as seen:
                    response = self.client.get(reverse("sale-list"), params)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data["count"], 1)
                self.assertEqual([row["id"] for row in response.data["results"]], [large.pk])
                sqls = [q["sql"] for q in seen]
                # Only the candidate read joins the customer without the business. The first
                # line read supplies that candidate decision; later reads render the result.
                candidates = [sql for sql in sqls if sql.startswith('SELECT "billing_invoice".')
                              and '"billing_customer"."pan_number"' in sql
                              and 'JOIN "billing_business"' not in sql]
                self.assertEqual(len(candidates), 1)
                lines = next(sql for sql in sqls if sql.startswith('SELECT "billing_lineitem".'))
                counts = [row_count(candidates[0]), row_count(lines)]
                self.assertEqual(counts, [1, 1], f"candidate bills / lines read: {counts}")
                self.assertFalse(any(sql.startswith(("INSERT", "UPDATE", "DELETE")) for sql in sqls))

    def test_named_blank_address_candidates_are_narrowed_too(self):
        large = self.probe_bills(buyer(address=" \t\n", gst_number="URP"))
        with CaptureQueriesContext(connection) as seen:
            filtered = filter_bills(Invoice.objects.sales(), {"itax": "1"})
        counts = [row_count(q["sql"]) for q in seen]
        self.assertEqual(counts, [1, 1], f"candidate bills / lines read: {counts}")
        self.assertEqual(list(filtered.values_list("pk", flat=True)), [large.pk])

    def test_candidates_keep_per_line_rounding_and_python_decides_exactly(self):
        # Reviewer's parity cases, persisted at the models' three decimal places.
        cases = (
            ((line(rate="49999.99"),), False),
            ((line(rate="50000"),), True),
            ((line(rate="24999.995"), line(rate="24999.995")), True),
            ((line(qty="10.005", rate="4997.501"),), True),
            ((line(qty="10.005", rate="4997.500"),), False),
            ((line(qty="0.333", rate="50050.05"), line(rate="33333.33"), line(qty="2.5", rate="0.002")), True),
            # Within the SQL margin but still below the exact rounded taxable limit.
            ((line(rate="49999.991"), line(rate="0.001")), False),
        )
        for n, (lines, flagged) in enumerate(cases):
            with self.subTest(case=n):
                customer = buyer(f"Buyer {n}")
                bill = sale(self.biz, customer, str(n), "2026-10-08", *lines)
                Invoice.objects.filter(pk=bill.pk).update(total_amount="1.00")
                filtered = filter_bills(Invoice.objects.sales(), {"itax": "1", "customer_id": str(customer.pk)})
                self.assertEqual(list(filtered.values_list("pk", flat=True)), [bill.pk] if flagged else [])

    def test_no_lines_means_no_b2c_address_candidate(self):
        Invoice.objects.create(business=self.biz, customer=buyer("Walk-in Customer", customer_type="walkin"),
                               invoice_number="1", invoice_date="2026-10-08")
        with CaptureQueriesContext(connection) as seen:
            filtered = filter_bills(Invoice.objects.sales(), {"itax": "1"})
        self.assertEqual([row_count(q["sql"]) for q in seen], [0])
        self.assertEqual(list(filtered), [])

    def test_sqlite_numeric_drift_keeps_a_bill_at_the_rounded_limit(self):
        # SQLite sums these as 49999.98499999999; adding .005 per line stays
        # just below 50000 in binary, although the three rounded lines reach it.
        bill = sale(self.biz, buyer(), "1", "2026-10-08",
                    line(rate="4037.165"), line(rate="34957.395"), line(rate="11005.425"))
        filtered = filter_bills(Invoice.objects.sales(), {"itax": "1"})
        self.assertEqual(list(filtered.values_list("pk", flat=True)), [bill.pk])
