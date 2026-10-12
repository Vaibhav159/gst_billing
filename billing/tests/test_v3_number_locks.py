"""Ruling 1A-46: one firm's number writes wait for each other, including case variants."""

import threading
import time
from datetime import date
from unittest.mock import patch

from django.db import connection, transaction
from django.test import TransactionTestCase, skipUnlessDBFeature
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from billing.models import BinnedInvoice, Invoice
from billing.numbering import checked_number
from billing.services.bin import bin_bill
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, line, person, sale


@skipUnlessDBFeature("has_select_for_update")
class NumberWriteLockTest(TransactionTestCase):
    def setUp(self):
        self.owner = person("kailash", *ROLE_GROUPS["owner"])
        self.biz, self.cust = firm(), buyer()

    def race(self, first_request, second_request, success, invoice_count=1):
        held, release, started = threading.Event(), threading.Event(), threading.Event()
        answers, pids = {}, {}

        def first():
            try:
                with transaction.atomic():
                    with connection.cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid()")
                        pids["first"] = cursor.fetchone()[0]
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
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    pids["second"] = cursor.fetchone()[0]
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
            # A scheduled thread is not enough: release only after its SQL actually waits on the first writer.
            waited, deadline = False, time.monotonic() + 5
            while time.monotonic() < deadline:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT %s = ANY(pg_blocking_pids(%s))", [pids["first"], pids["second"]])
                    waited = cursor.fetchone()[0]
                if waited or "second_error" in answers:
                    break
                time.sleep(0.02)
        finally:
            release.set()
            a.join(10)
            if b.ident is not None:
                b.join(10)
        self.assertFalse(a.is_alive() or b.is_alive(), answers)
        self.assertNotIn("first_error", answers, answers)
        self.assertNotIn("second_error", answers, answers)
        self.assertTrue(waited, "The second write must wait for the first writer's transaction")
        first_answer, second_answer = answers["first"], answers["second"]
        self.assertEqual(first_answer.status_code, success, first_answer.data)
        self.assertEqual((second_answer.status_code, second_answer.data.get("code")),
                         (409, "number_taken"), second_answer.data)
        self.assertEqual(second_answer.data["bill"]["id"], first_answer.data["id"])
        self.assertEqual(Invoice.objects.count(), invoice_count)

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

    def v2_create(self, client):
        # Ruling 1A-49, from the re-review's test_rr_deadlocks.py: v2 holds the unique number before
        # its deferred firm FK takes FOR KEY SHARE at commit. v3's firm lock must let that commit finish.
        return client.post(reverse("invoice-list"), {
            "business": self.biz.pk, "customer": self.cust.pk, "invoice_number": "KGH/2026-27/31",
            "invoice_date": "2026-09-30", "type_of_invoice": "outward",
            "line_items": [{**line(), "cgst": "150", "sgst": "150", "igst": "0", "amount": "10300"}],
        }, format="json")

    def test_v2_create_racing_a_v3_save_answers_409_without_deadlock(self):
        body = {"business": self.biz.pk, "customer": self.cust.pk, "invoice_number": "KGH/2026-27/31",
                "invoice_date": "2026-09-30", "lines": [{"product_name": "Silver", "hsn_code": "711311",
                "gst_percent": "3", "quantity": "1", "rate": "10000", "unit": "gms"}]}
        self.race(self.v2_create, lambda c: c.post(reverse("sale-list"), body, format="json"), 201)

    def test_v2_create_racing_a_v3_renumber_answers_409_without_deadlock(self):
        bill = sale(self.biz, self.cust, "KGH/2026-27/5", "2026-09-30")
        self.race(self.v2_create, lambda c: c.post(reverse("sale-renumber", args=[bill.pk]),
                  {"invoice_number": "KGH/2026-27/31"}, format="json"), 201, invoice_count=2)
        bill.refresh_from_db()
        self.assertEqual(bill.invoice_number, "KGH/2026-27/5")

    def test_v2_create_racing_a_v3_restore_answers_409_without_deadlock(self):
        binned, _ = bin_bill(sale(self.biz, self.cust, "KGH/2026-27/31", "2026-09-30"), self.owner)
        self.race(self.v2_create, lambda c: c.post(reverse("bin-restore", args=[binned.pk])), 201)
        binned.refresh_from_db()
        self.assertIsNone(binned.restored_at)
        self.assertTrue(BinnedInvoice.objects.live().filter(pk=binned.pk).exists())

    def test_move_locks_both_firms_in_id_order_before_checking_the_number(self):
        second = firm("MEERA ORNAMENTS", gstin="24AAAAA0000A1Z5")
        bill = sale(second, self.cust, "MO/2026-27/17", "2026-09-30")
        with CaptureQueriesContext(connection) as seen:
            def check(*args, **kwargs):
                locks = [q["sql"] for q in seen.captured_queries
                         if 'FROM "billing_business"' in q["sql"]
                         and any(lock in q["sql"] for lock in ("FOR UPDATE", "FOR NO KEY UPDATE"))]
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
                         if 'FROM "billing_business"' in q["sql"]
                         and any(lock in q["sql"] for lock in ("FOR UPDATE", "FOR NO KEY UPDATE"))]
                self.assertTrue(locks, seen.captured_queries)
                return refuse_taken(*args, **kwargs)

            with patch("billing.numbering.refuse_taken", check):
                self.assertEqual(checked_number(self.biz, date(2026, 9, 30), "31"), "31")
