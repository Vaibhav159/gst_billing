"""The bin puts an exact bill number ahead of newer partial matches (Ruling 1B-24)."""

from django.db import connection
from django.test import TransactionTestCase
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from billing.models import BinnedInvoice
from billing.roles import group_names
from billing.services.bin import bin_bill
from billing.tests.test_v3_cacheops import cacheops_on
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person, sale


class BinSearchTest(TransactionTestCase):
    def setUp(self):
        self.owner = person("kailash", *ROLE_GROUPS["owner"])
        self.client = client_for(self.owner)
        group_names(self.owner)
        self.business, self.customer = firm(), buyer()
        self.bare = self.bin("31")
        self.prefixed = self.bin("KGH/2026-27/31")
        self.padded = self.bin("MO-0031")
        self.newer = [self.bin(f"KGH/2026-27/{n}") for n in range(310, 319)]

    def bin(self, number):
        return bin_bill(sale(self.business, self.customer, number, "2026-09-24"), self.owner)[0]

    def rows(self, **params):
        response = self.client.get(reverse("bin-list"), {"page_size": 8, **params})
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_number_parts_precede_nine_newer_partial_matches(self):
        response = self.rows(q=" 31 ")
        expected = [self.bare, self.padded, self.prefixed, *reversed(self.newer)]
        self.assertEqual(response["count"], 12)
        self.assertEqual([row["id"] for row in response["results"]], [b.pk for b in expected[:8]])
        self.assertIsNotNone(response["next"])
        second = self.rows(q="31", page=2)
        self.assertEqual([row["id"] for row in second["results"]], [b.pk for b in expected[8:]])

    def test_full_number_is_case_insensitive_and_query_is_trimmed(self):
        response = self.rows(q="  kgh/2026-27/31  ")
        self.assertEqual(response["count"], 10)
        expected = [self.prefixed, *reversed(self.newer)]
        self.assertEqual([row["id"] for row in response["results"]], [b.pk for b in expected[:8]])

    def test_leading_zero_digits_find_the_same_number_parts(self):
        response = self.rows(q="00031")
        self.assertEqual(response["count"], 3)
        self.assertEqual([row["id"] for row in response["results"]],
                         [self.padded.pk, self.prefixed.pk, self.bare.pk])
        self.assertEqual(self.rows(q="٣١")["count"], 0)

    def test_search_keeps_bounded_uncached_reads_and_the_other_orders(self):
        for params in ({"q": "31"}, {"q": "Anil"}, {}):
            with self.subTest(params=params), cacheops_on() as cached, CaptureQueriesContext(connection) as queries:
                response = self.rows(**params)
            self.assertEqual(cached, [])
            self.assertEqual(len(queries), 3)  # count, the page with its deleting user, and closed months
            self.assertTrue(all(query["sql"].startswith("SELECT") for query in queries))
            pages = [q["sql"] for q in queries
                     if 'FROM "billing_binnedinvoice"' in q["sql"] and not q["sql"].startswith("SELECT COUNT(")]
            self.assertEqual(len(pages), 1)
            self.assertIn("LIMIT 8", pages[0])
            if params.get("q") != "31":
                self.assertEqual([row["id"] for row in response["results"]],
                                 [b.pk for b in list(reversed(self.newer))[:8]])
        self.assertEqual(BinnedInvoice.objects.count(), 12)
