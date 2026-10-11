"""Ruling 1A-46: one firm's number writes wait for each other, including case variants."""

import threading
from datetime import date
from unittest.mock import patch

from django.db import connection, transaction
from django.test import TransactionTestCase, skipUnlessDBFeature
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from billing.models import BinnedInvoice, Invoice
from billing.numbering import checked_number
from billing.services.bin import bin_bill
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person, sale


@skipUnlessDBFeature("has_select_for_update")
class NumberWriteLockTest(TransactionTestCase):
    def setUp(self):
        self.owner = person("kailash", *ROLE_GROUPS["owner"])
        self.biz, self.cust = firm(), buyer()

    def race(self, first_request, second_request, success):
        held, release, started = threading.Event(), threading.Event(), threading.Event()
        answers = {}

        def first():
            try:
                with transaction.atomic():
                    answers["first"] = first_request(client_for(self.owner))
                    held.set()
                    if not release.wait(10):
                        raise AssertionError("The first number write was not released")
            except Exception as exc:
                answers["first_error"] = exc
                held.set()
            finally:
                connection.close()

        def second():
            try:
                started.set()
                answers["second"] = second_request(client_for(self.owner))
            except Exception as exc:
                answers["second_error"] = exc
            finally:
                connection.close()

        a = threading.Thread(target=first, daemon=True)
        b = threading.Thread(target=second, daemon=True)
        a.start()
        try:
            self.assertTrue(held.wait(10), answers)
            self.assertNotIn("first_error", answers, answers)
            b.start()
            self.assertTrue(started.wait(10))
            b.join(0.5)
            waited = b.is_alive()
        finally:
            release.set()
            a.join(10)
            if b.ident is not None:
                b.join(10)
        self.assertFalse(a.is_alive() or b.is_alive(), answers)
        self.assertNotIn("first_error", answers, answers)
        self.assertNotIn("second_error", answers, answers)
        self.assertTrue(waited, "The second write must wait for the firm's number check")
        first_answer, second_answer = answers["first"], answers["second"]
        self.assertEqual(first_answer.status_code, success, first_answer.data)
        self.assertEqual((second_answer.status_code, second_answer.data.get("code")),
                         (409, "number_taken"), second_answer.data)
        self.assertEqual(second_answer.data["bill"]["id"], first_answer.data["id"])
        self.assertEqual(Invoice.objects.count(), 1)

    def saves(self, other_number):
        body = {"business": self.biz.pk, "customer": self.cust.pk, "invoice_number": "KGH/2026-27/31",
                "invoice_date": "2026-09-30", "lines": [{"product_name": "Silver", "hsn_code": "711311",
                "gst_percent": "3", "quantity": "1", "rate": "10000", "unit": "gms"}]}
        self.race(lambda c: c.post(reverse("sale-list"), body, format="json"),
                  lambda c: c.post(reverse("sale-list"), {**body, "invoice_number": other_number}, format="json"), 201)

    def test_two_saves_racing_for_one_number_answer_409(self):
        self.saves("KGH/2026-27/31")

    def test_two_saves_racing_for_case_variants_answer_409(self):
        self.saves("kgh/2026-27/31")

    def restores(self, other_number):
        first, _ = bin_bill(sale(self.biz, self.cust, "KGH/2026-27/31", "2026-09-30"), self.owner)
        second, _ = bin_bill(sale(self.biz, self.cust, other_number, "2026-09-30"), self.owner)
        self.race(lambda c: c.post(reverse("bin-restore", args=[first.pk])),
                  lambda c: c.post(reverse("bin-restore", args=[second.pk])), 200)
        self.assertEqual(BinnedInvoice.objects.filter(restored_at__isnull=False).count(), 1)
        self.assertEqual(BinnedInvoice.objects.live().count(), 1)

    def test_two_restores_racing_for_one_number_answer_409(self):
        self.restores("KGH/2026-27/31")

    def test_two_restores_racing_for_case_variants_answer_409(self):
        self.restores("kgh/2026-27/31")

    def test_move_locks_both_firms_in_id_order_before_checking_the_number(self):
        second = firm("MEERA ORNAMENTS", gstin="24AAAAA0000A1Z5")
        bill = sale(second, self.cust, "MO/2026-27/17", "2026-09-30")
        with CaptureQueriesContext(connection) as seen:
            def check(*args, **kwargs):
                locks = [q["sql"] for q in seen.captured_queries
                         if 'FROM "billing_business"' in q["sql"] and "FOR UPDATE" in q["sql"]]
                self.assertTrue(locks, seen.captured_queries)
                self.assertIn(f"IN ({self.biz.pk}, {second.pk})", locks[-1])
                self.assertRegex(locks[-1], r'ORDER BY (?:1|"billing_business"\."id") ASC')
                return checked_number(*args, **kwargs)

            with patch("billing.services.sales.checked_number", check):
                answer = client_for(self.owner).post(reverse("sale-move", args=[bill.pk]),
                    {"business": self.biz.pk, "invoice_number": "31"}, format="json")
        self.assertEqual(answer.status_code, 200, answer.data)

    def test_checked_number_holds_the_firm_before_reading_the_series(self):
        from billing.numbering import refuse_taken

        with transaction.atomic(), CaptureQueriesContext(connection) as seen:
            def check(*args, **kwargs):
                locks = [q["sql"] for q in seen.captured_queries
                         if 'FROM "billing_business"' in q["sql"] and "FOR UPDATE" in q["sql"]]
                self.assertTrue(locks, seen.captured_queries)
                return refuse_taken(*args, **kwargs)

            with patch("billing.numbering.refuse_taken", check):
                self.assertEqual(checked_number(self.biz, date(2026, 9, 30), "31"), "31")
