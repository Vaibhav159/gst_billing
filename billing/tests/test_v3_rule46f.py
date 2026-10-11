"""Rule 46(f) warns on unregistered buyers' missing name/address, without blocking a bill."""

from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase, TransactionTestCase
from django.urls import reverse

from billing.models import Invoice
from billing.tests.test_v3_cacheops import cacheops_on
from billing.tests.v3_helpers import buyer, client_for, firm, line, person, sale

SHORT = "Name and address needed"
WALKIN = ("A bill of ₹50,000 or more to a buyer without a GSTIN needs the buyer's name and address "
          "(CGST Rule 46(f)). Put the bill in the buyer's name, with their address, not Walk-in.")
NAMED = ("A bill of ₹50,000 or more to a buyer without a GSTIN needs the buyer's address "
         "(CGST Rule 46(f)). Add Anil Gupta's address.")


class Rule46fTest(TestCase):
    def setUp(self):
        self.enterContext(patch("django.utils.timezone.now", return_value=datetime(2026, 10, 11, tzinfo=timezone.utc)))
        self.biz = firm()
        self.client = client_for(person("viewer", "viewer"))

    def bill(self, customer, taxable="50000.00", **kwargs):
        return sale(self.biz, customer, str(Invoice.objects.count() + 1), "2026-10-08",
                    line(rate=taxable), **kwargs)

    def detail(self, bill):
        response = self.client.get(reverse("sale-detail", args=[bill.pk]))
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_taxable_boundary_and_customer_cases(self):
        cases = (
            ("49999.99", {}, None),
            ("50000.00", {}, NAMED),
            ("50000.01", {"address": " \t\n"}, NAMED),
            ("50000.00", {"address": "15 Demo Road"}, None),
            ("50000.00", {"customer_type": "walkin"}, WALKIN),
            ("50000.00", {"customer_type": "walkin", "address": "Shop address"}, WALKIN),
            ("49999.99", {"customer_type": "walkin"}, None),
            ("50000.00", {"gst_number": "URP"}, NAMED),
            ("50000.00", {"gst_number": "08AAKFS4821M1ZW"}, None),
        )
        for n, (taxable, fields, expected) in enumerate(cases):
            with self.subTest(taxable=taxable, fields=fields):
                data = self.detail(self.bill(buyer(f"Buyer {n}", **fields), taxable))
                # The below-threshold bill's total exceeds ₹50,000 after GST: only taxable counts.
                self.assertGreater(Decimal(data["total_amount"]), Decimal("50000"))
                flags = [f for f in data["itax"] if f["kind"] == "b2c_address"]
                self.assertEqual(flags, [] if expected is None else [
                    {"kind": "b2c_address", "short": SHORT, "text": expected.replace("Anil Gupta", f"Buyer {n}")}])
                if fields.get("gst_number", "").startswith("08"):
                    self.assertEqual([f["kind"] for f in data["itax"]], ["b2b_address"])

    def test_name_uses_the_clients_possessive_rule(self):
        for name, possessive in (("James", "James'"), ("JAMES  ", "JAMES'"),
                                 ("Joshi's", "Joshi's"), ("Joshi’s", "Joshi’s")):
            with self.subTest(name=name):
                flags = self.detail(self.bill(buyer(name)))["itax"]
                self.assertEqual(flags, [{"kind": "b2c_address", "short": SHORT,
                                          "text": NAMED.replace("Anil Gupta's", possessive)}])

    def test_sums_the_lines_and_does_not_use_a_legacy_stored_total(self):
        bill = sale(self.biz, buyer(), "1", "2026-10-08", line(rate="24999.99"), line(rate="25000.01"))
        Invoice.objects.filter(pk=bill.pk).update(total_amount=Decimal("1"))
        detail = self.detail(bill)
        self.assertEqual(detail["taxable"], "50000.00")
        self.assertEqual(detail["itax"], [{"kind": "b2c_address", "short": SHORT, "text": NAMED}])
        filtered = self.client.get(reverse("sale-list"), {"itax": "1"})
        self.assertEqual(filtered.status_code, 200)
        self.assertEqual([row["id"] for row in filtered.data["results"]], [bill.pk])

    def test_cancelled_bill_has_no_flags(self):
        for n, fields in enumerate(({}, {"customer_type": "walkin"}, {"gst_number": "08AAKFS4821M1ZW"})):
            with self.subTest(fields=fields):
                bill = self.bill(buyer(f"Buyer {n}", **fields), "258000", status="cancelled", payment_mode="cash")
                self.assertEqual(self.detail(bill)["itax"], [])

    def test_list_filter_detail_and_customer_statement_agree(self):
        customer = buyer(address=" \t\n")
        below = self.bill(customer, "49999.99")
        flagged = self.bill(customer)
        cancelled = self.bill(customer, status="cancelled")
        addressed = self.bill(buyer("Named buyer", address="15 Demo Road"))
        walkin = self.bill(buyer("Walk-in Customer", customer_type="walkin", address="Shop address"))
        response = self.client.get(reverse("sale-list"), {"itax": "1"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual({row["id"] for row in response.data["results"]}, {flagged.pk, walkin.pk})
        self.assertEqual(response.data["summary"]["bills"], 2)
        flags = self.detail(flagged)["itax"]
        row = next(row for row in response.data["results"] if row["id"] == flagged.pk)
        self.assertEqual(row["itax"], flags)
        statement = self.client.get(reverse("customer-statement", args=[customer.pk]))
        self.assertEqual(statement.status_code, 200)
        self.assertEqual({row["id"]: row["itax"] for row in statement.data["bills"]},
                         {below.pk: [], flagged.pk: flags, cancelled.pk: []})
        figures = self.client.get(reverse("customer-list"), {"figures": "1"})
        self.assertEqual(figures.status_code, 200)
        row = next(row for row in figures.data["results"] if row["id"] == customer.pk)
        self.assertEqual(row["figures"]["bills"], 2)  # warnings do not exclude active sales
        self.assertEqual(self.detail(addressed)["itax"], [])


class Rule46fCacheTest(TransactionTestCase):
    def test_flagged_reads_bypass_cacheops(self):
        self.enterContext(patch("django.utils.timezone.now", return_value=datetime(2026, 10, 11, tzinfo=timezone.utc)))
        customer = buyer()
        bill = sale(firm(), customer, "1", "2026-10-08", line(rate="50000"))
        client = client_for(person("viewer", "viewer"))
        with cacheops_on() as touched:
            filtered = client.get(reverse("sale-list"), {"itax": "1"})
            detail = client.get(reverse("sale-detail", args=[bill.pk]))
            statement = client.get(reverse("customer-statement", args=[customer.pk]))
        for response in (filtered, detail, statement):
            self.assertEqual(response.status_code, 200)
        self.assertEqual(touched, [])
        self.assertEqual([row["id"] for row in filtered.data["results"]], [bill.pk])
        self.assertEqual(detail.data["itax"], [{"kind": "b2c_address", "short": SHORT, "text": NAMED}])
        self.assertEqual(statement.data["bills"][0]["itax"], detail.data["itax"])
