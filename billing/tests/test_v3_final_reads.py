"""Final review: bounded list reads, selective facets, capped search and narrow activity rows."""

from datetime import date
from unittest.mock import patch

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from billing.constants import BILL_CANCELLED
from billing.models import AuditLog, FiledPeriod
from billing.roles import group_names
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person, sale


@patch("django.utils.timezone.localdate", return_value=date(2026, 10, 11))
class SelectiveListReadsTest(TestCase):
    def setUp(self):
        self.owner = person("kailash", *ROLE_GROUPS["owner"], first_name="Kailash", last_name="Mehta")
        self.client = client_for(self.owner)
        group_names(self.owner)  # permission caches these; exclude its one-time read from query comparisons
        self.business, self.customer = firm(invoice_prefix="KGH"), buyer()
        self.bill = sale(self.business, self.customer, "KGH/2026-27/123", "2026-09-10")
        sale(self.business, self.customer, "KGH/2026-27/124", "2026-09-11", status=BILL_CANCELLED)
        sale(self.business, self.customer, "KGH/2026-27/125", "2026-10-01")
        sale(self.business, self.customer, "KGH/2025-26/122", "2025-09-10")
        FiledPeriod.objects.create(business=self.business, year=2026, month=9)

    def get(self, **params):
        response = self.client.get(reverse("sale-list"), {"business_id": self.business.pk, "fy": "2026-27", **params})
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_summary_zero_omits_summary_and_its_three_queries(self, _today):
        with CaptureQueriesContext(connection) as full_queries:
            full = self.get(page_size=1, page=2)
        with CaptureQueriesContext(connection) as short_queries:
            short = self.get(page_size=1, page=2, summary="0")
        self.assertNotIn("summary", short)
        self.assertEqual(short["results"], full["results"])
        self.assertEqual(len(full_queries) - len(short_queries), 3)
        self.assertEqual(self.get(summary="1")["summary"], self.get()["summary"])
        sqls = [query["sql"] for query in short_queries]
        self.assertFalse(any('FROM "billing_lineitem"' in sql and "IN (SELECT" in sql for sql in sqls))
        self.assertFalse(any(sql.startswith('SELECT "billing_invoice"."total_amount"') for sql in sqls))

    def test_months_only_matches_full_facets_and_ignores_other_filters(self, _today):
        full = self.get(facets="1")["facets"]
        months = self.get(facets="months", summary="0", q="Nobody", status="cancelled", month="2026-04")
        self.assertEqual(months["facets"], {"months": full["months"]})
        self.assertNotIn("summary", months)
        self.assertEqual(next(m for m in full["months"] if m["month"] == "2026-09"),
                         {"month": "2026-09", "bills": 1, "locked": True})

    def test_months_only_uses_one_grouped_count_and_no_views_or_summary_reads(self, _today):
        # An empty page separates the facets' own reads from the page's lines and duplicate checks.
        with CaptureQueriesContext(connection) as seen:
            data = self.get(facets="months", summary="0", q="Nobody")
        self.assertEqual(set(data["facets"]), {"months"})
        sqls = [query["sql"] for query in seen]
        grouped = [sql for sql in sqls if 'FROM "billing_invoice"' in sql and "GROUP BY" in sql]
        self.assertEqual(len(grouped), 1)
        self.assertIn("COUNT(", grouped[0])
        self.assertEqual([sql for sql in sqls if 'FROM "billing_lineitem"' in sql], [])
        self.assertFalse(any('"billing_invoice"."total_amount"' in sql for sql in sqls))
        self.assertFalse(any('"billing_invoice"."invoice_number" AS "invoice_number"' in sql for sql in sqls))

    def test_months_all_firms_are_closed_only_when_every_firm_is_closed(self, _today):
        other = firm("MEERA ORNAMENTS")
        sale(other, self.customer, "7", "2026-09-12")
        params = {"fy": "2026-27", "facets": "months", "summary": "0"}
        response = self.client.get(reverse("sale-list"), params)
        september = next(m for m in response.data["facets"]["months"] if m["month"] == "2026-09")
        self.assertEqual(september, {"month": "2026-09", "bills": 2, "locked": False})
        FiledPeriod.objects.create(business=other, year=2026, month=9)
        response = self.client.get(reverse("sale-list"), params)
        self.assertTrue(next(m for m in response.data["facets"]["months"] if m["month"] == "2026-09")["locked"])

    def test_elsewhere_only_matches_full_facets_with_no_month_or_view_queries(self, _today):
        full = self.get(facets="1", q="KGH/2025")["facets"]
        with CaptureQueriesContext(connection) as seen:
            data = self.get(facets="elsewhere", q="KGH/2025", summary="0")
        self.assertEqual(data["facets"], {"elsewhere": full["elsewhere"]})
        self.assertEqual(data["facets"]["elsewhere"], [{"fy": "2025-26", "bills": 1}])
        sqls = [query["sql"] for query in seen]
        self.assertFalse(any('FROM "billing_lineitem"' in sql for sql in sqls))
        self.assertFalse(any('FROM "billing_filedperiod"' in sql for sql in sqls))
        self.assertFalse(any('"billing_invoice"."total_amount"' in sql for sql in sqls))

    def test_elsewhere_without_a_search_is_empty_and_adds_no_query(self, _today):
        with CaptureQueriesContext(connection) as plain:
            self.get(summary="0")
        with CaptureQueriesContext(connection) as elsewhere:
            data = self.get(facets="elsewhere", summary="0")
        self.assertEqual(data["facets"], {"elsewhere": []})
        self.assertEqual(len(elsewhere), len(plain))

    def test_odd_selectors_are_400s_in_words(self, _today):
        for key, words in (("facets", "Choose 1, months or elsewhere for facets."),
                           ("summary", "Choose 0 or 1 for summary.")):
            for value in ("odd", "2", "[]", "", "\x00"):
                with self.subTest(key=key, value=value):
                    response = self.client.get(reverse("sale-list"), {key: value})
                    self.assertEqual((response.status_code, response.data), (400, {key: [words]}))

    def test_a_pages_twins_read_only_its_number_parts(self, _today):
        twin = sale(self.business, self.customer, " kgh/2026-27/123 ", "2026-08-01", status=BILL_CANCELLED)
        for n in range(200, 225):
            sale(self.business, self.customer, f"KGH/2026-27/{n}", "2026-08-01")
        with CaptureQueriesContext(connection) as seen:
            data = self.get(number=self.bill.invoice_number, summary="0")
        self.assertEqual(data["results"][0]["checks"], ["duplicate"])
        numbers = [query["sql"] for query in seen
                   if '"billing_invoice"."invoice_number" AS "invoice_number"' in query["sql"]]
        self.assertEqual(len(numbers), 1)
        with connection.cursor() as cursor:
            cursor.execute(numbers[0])
            candidates = cursor.fetchall()
        self.assertEqual({row[0] for row in candidates}, {self.bill.pk, twin.pk})

    def test_nonnumeric_number_twins_still_match_without_reading_the_fy(self, _today):
        original = sale(self.business, self.customer, "SPECIAL", "2026-09-01")
        twin = sale(self.business, self.customer, " special ", "2026-08-01")
        with CaptureQueriesContext(connection) as seen:
            data = self.get(number="SPECIAL", summary="0")
        self.assertEqual(data["results"][0]["checks"], ["duplicate"])
        numbers = [query["sql"] for query in seen
                   if '"billing_invoice"."invoice_number" AS "invoice_number"' in query["sql"]]
        with connection.cursor() as cursor:
            cursor.execute(numbers[0])
            self.assertEqual({row[0] for row in cursor.fetchall()}, {original.pk, twin.pk})

    def test_blank_legacy_numbers_have_no_twins_and_read_no_fy_numbers(self, _today):
        blank = sale(self.business, self.customer, "", "2026-09-02")
        space = sale(self.business, self.customer, " ", "2026-09-02")
        with CaptureQueriesContext(connection) as seen:
            data = self.get(start_date="2026-09-02", end_date="2026-09-02", summary="0")
        self.assertEqual({row["id"] for row in data["results"]}, {blank.pk, space.pk})
        self.assertTrue(all("duplicate" not in row["checks"] for row in data["results"]))
        self.assertFalse(any('"billing_invoice"."invoice_number" AS "invoice_number"' in query["sql"] for query in seen))

    def test_two_thousand_search_words_are_bounded_and_keep_the_first_ten(self, _today):
        self.customer.name = " ".join(["Anil"] * 10)
        self.customer.save()
        prefix = " ".join(["Anil"] * 10)
        expected = self.get(q=prefix, facets="elsewhere")
        long = self.get(q=prefix + " missing" * 1990, facets="elsewhere")
        self.assertEqual((long["results"], long["summary"], long["facets"]),
                         (expected["results"], expected["summary"], expected["facets"]))

    def test_search_uses_first_hundred_characters_for_filter_and_exact_order(self, _today):
        number = "A" * 100
        exact = sale(self.business, self.customer, number, "2026-04-01")
        sale(self.business, self.customer, number + "B", "2026-10-10")
        data = self.get(q=number + "Z" * 100)
        self.assertEqual(data["count"], 2)
        self.assertEqual(data["results"][0]["id"], exact.pk)

    def test_activity_fetches_no_snapshot_changes_or_unused_user_columns(self, _today):
        AuditLog.objects.create(user=self.owner, action="edited", entity="invoice", entity_id=self.bill.pk,
                                entity_name="Bill 123", details="Changed its note", snapshot={"notes": "x" * 2000},
                                changes={"notes": ["before", "after"]})
        with CaptureQueriesContext(connection) as seen:
            response = self.client.get(reverse("sale-detail", args=[self.bill.pk]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["history"]["activity"][0]["by"], "Kailash Mehta")
        audit = [q["sql"] for q in seen if 'FROM "billing_auditlog"' in q["sql"]]
        self.assertEqual(len(audit), 1)
        for field in ('"snapshot"', '"changes"', '"password"', '"email"'):
            self.assertNotIn(field, audit[0])
