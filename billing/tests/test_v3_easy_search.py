"""Easy's numeric search is the shared Sales search, before paging and sums."""

from django.test import TestCase
from django.urls import reverse

from billing.tests.v3_helpers import buyer, client_for, firm, line, person, sale


class EasySearchTest(TestCase):
    def setUp(self):
        self.client = client_for(person("viewer", "viewer"))
        self.biz = firm()
        self.customer = buyer("Anil Gupta")
        self.seed_numbers = ("31", "MO-031", "KGH/2026-27/31", "131", "310")
        self.bills = [
            sale(self.biz, self.customer, number, f"2026-10-0{i}", line(rate=str(i)))
            for i, number in enumerate(self.seed_numbers, 1)
        ]

    def search(self, q, **params):
        response = self.client.get(reverse("sale-list"), {
            "business_id": self.biz.pk, "fy": "2026-27", "q": q, **params,
        })
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def numbers(self, data):
        return [row["invoice_number"] for row in data["results"]]

    def test_bare_number_ranks_equal_parts_before_contains(self):
        self.assertEqual(self.numbers(self.search("31")), ["31", "KGH/2026-27/31", "MO-031", "310", "131"])

    def test_leading_zeros_expand_the_filter_and_exact_number_stays_first(self):
        sale(self.biz, self.customer, "031", "2026-10-01")
        self.assertEqual(self.numbers(self.search("031")), ["031", "KGH/2026-27/31", "MO-031", "31"])

    def test_each_rank_keeps_the_chosen_order(self):
        for ordering in ("date", "number", "total", "-date", "-number", "-total"):
            with self.subTest(ordering=ordering):
                parts = ["MO-031", "KGH/2026-27/31"]
                rest = ["131", "310"]
                if ordering.startswith("-"):
                    parts.reverse()
                    rest.reverse()
                self.assertEqual(self.numbers(self.search("31", ordering=ordering)), ["31", *parts, *rest])

    def test_paging_summary_and_other_filters_use_the_expanded_set(self):
        sale(firm("OTHER"), self.customer, "31", "2026-10-06")
        sale(self.biz, self.customer, "31", "2025-10-06")
        sale(self.biz, self.customer, "PUR-031", "2026-10-06", kind="inward")
        first = self.search("031", page_size=1)
        self.assertEqual((first["count"], first["summary"]["bills"], first["summary"]["total_amount"]), (3, 3, "6.18"))
        self.assertEqual(self.numbers(first), ["KGH/2026-27/31"])
        self.assertIsNotNone(first["next"])
        self.assertEqual(self.numbers(self.search("031", page_size=1, page=3)), ["31"])
        self.assertEqual(self.numbers(self.search("031", start_date="2026-10-02", end_date="2026-10-02")), ["MO-031"])

    def test_zero_suffix_and_ascii_only_rule(self):
        for number in ("0", "ZERO-000", "ZERO-10", "ZERO-001"):
            sale(self.biz, self.customer, number, "2026-10-06")
        self.assertEqual(self.numbers(self.search("000")), ["ZERO-000", "0"])
        for query in ("０３１", "०३१", "+031", "0 31", "0.*31"):
            with self.subTest(query=query):
                self.assertEqual(self.search(query)["count"], 0)

    def test_name_full_number_phone_and_gstin_matches_stay_available(self):
        self.assertEqual(self.numbers(self.search("An Gu")), list(reversed(self.seed_numbers)))
        self.assertEqual(self.numbers(self.search("MO-031")), ["MO-031"])
        other = buyer("Hemant", mobile_number="9829003122", gst_number="08ABCDE0314F1Z5")
        sale(self.biz, other, "88", "2026-10-06")
        self.assertEqual(self.numbers(self.search("031")), ["KGH/2026-27/31", "MO-031", "31", "88"])
        self.assertEqual(self.numbers(self.search("ABCDE")), ["88"])

    def test_long_digit_input_and_null_character_keep_the_existing_bounds(self):
        self.assertEqual(self.search("9" * 200)["count"], 0)
        self.assertEqual(self.numbers(self.search("0\x0031")), ["KGH/2026-27/31", "MO-031", "31"])
