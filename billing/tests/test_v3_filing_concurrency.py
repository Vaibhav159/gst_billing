"""Postgres proves the firm mutex protects filing reads, captures and inserts."""

import threading
from datetime import date
from queue import Queue
from unittest import skipUnless
from unittest.mock import patch

from django.contrib.auth.models import User
from django.db import connection, connections
from django.test import TransactionTestCase

from billing.models import AuditLog, Business, FiledPeriod, FilingRecord
from billing.refusals import Refusal
from billing.services.filing import mark_filed


@skipUnless(connection.vendor == "postgresql", "Row-lock concurrency requires PostgreSQL.")
class FilingConcurrencyTest(TransactionTestCase):
    def test_two_clicks_freeze_and_mark_3b_only_once(self):
        firm = Business.objects.create(name="KIRAN GOLD HOUSE")
        user = User.objects.create_user("filing-owner")
        FilingRecord.objects.create(business=firm, year=2026, month=9, kind="gstr1", filed_on=date(2026, 10, 8))
        captured, release, duplicate_capture = threading.Event(), threading.Event(), threading.Event()
        start_second = threading.Barrier(2)
        answers = Queue()
        heads = {"igst": "0.00", "cgst": "15.00", "sgst": "15.00", "total": "30.00"}

        def snapshot(_business, _month, _kind):
            if threading.current_thread().name == "filing-first":
                captured.set()
                if not release.wait(5):
                    raise AssertionError("The first filing was not released.")
            else:
                duplicate_capture.set()
            return {"cash": heads, "carry_on": heads}, {}, {}

        def file_return(second=False):
            connections.close_all()
            try:
                with connection.cursor() as cursor:
                    cursor.execute("SET lock_timeout = '3s'")
                    cursor.execute("SET statement_timeout = '5s'")
                if second:
                    start_second.wait(timeout=5)
                records = mark_filed(firm, date(2026, 9, 1), user, {"kind": "gstr3b", "filed_on": "2026-10-10"})
                answers.put(("filed", records[0].pk))
            except Refusal as exc:
                answers.put(("refused", exc.detail["code"]))
            except BaseException as exc:
                answers.put(("error", repr(exc)))
            finally:
                connections.close_all()

        first = threading.Thread(name="filing-first", target=file_return, daemon=True)
        second = threading.Thread(name="filing-second", target=file_return, args=(True,), daemon=True)
        with patch("billing.services.filing._snapshot", side_effect=snapshot) as capture, patch(
            "billing.services.filing.timezone.localdate", return_value=date(2026, 10, 11)
        ):
            first.start()
            try:
                self.assertTrue(captured.wait(5), "The first transaction did not reach its snapshot.")
                second.start()
                start_second.wait(timeout=5)
                self.assertFalse(duplicate_capture.wait(0.25), "The second filing crossed the mutex before the first committed.")
            finally:
                release.set()
                first.join(timeout=5)
                if second.ident is not None:
                    second.join(timeout=5)
            self.assertFalse(first.is_alive(), "The first filing did not finish.")
            self.assertFalse(second.is_alive(), "The second filing did not finish.")
            self.assertEqual(capture.call_count, 1)
        results = [answers.get_nowait(), answers.get_nowait()]
        self.assertEqual(sorted(result[0] for result in results), ["filed", "refused"], results)
        self.assertIn(("refused", "already_filed"), results)
        self.assertEqual(FilingRecord.objects.filter(business=firm, year=2026, month=9, kind="gstr3b").count(), 1)
        self.assertEqual(FiledPeriod.objects.filter(business=firm, year=2026, month=9).count(), 1)
        self.assertEqual(AuditLog.objects.filter(entity="filing", action="filed").count(), 1)

    def test_cancel_waits_for_filing_then_refuses_the_closed_month(self):
        from billing.models import Customer, Invoice
        from billing.services.sales import cancel_bill

        firm = Business.objects.create(name="KIRAN GOLD HOUSE")
        user = User.objects.create_user("filing-cancel-owner")
        customer = Customer.objects.create(name="Synthetic buyer")
        bill = Invoice.objects.create(business=firm, customer=customer, invoice_number="RACE-1",
                                      invoice_date=date(2026, 9, 1), type_of_invoice="outward", total_amount="1030.00")
        captured, release, cancelled = threading.Event(), threading.Event(), threading.Event()
        start_cancel = threading.Barrier(2)
        answers = Queue()

        def snapshot(_business, _month, _kind):
            captured.set()
            if not release.wait(5):
                raise AssertionError("The filing snapshot was not released.")
            return {}, {str(bill.pk): {"id": bill.pk, "total": "1030.00"}}, {"total": "1030.00"}

        def request(cancel=False):
            connections.close_all()
            try:
                with connection.cursor() as cursor:
                    cursor.execute("SET lock_timeout = '3s'")
                    cursor.execute("SET statement_timeout = '5s'")
                if cancel:
                    start_cancel.wait(timeout=5)
                    cancel_bill(bill, user, "Duplicate")
                    answers.put(("cancelled", None))
                else:
                    mark_filed(firm, date(2026, 9, 1), user, {"kind": "gstr1", "filed_on": "2026-10-08"})
                    answers.put(("filed", None))
            except Refusal as exc:
                answers.put(("refused", exc.detail["code"]))
            except BaseException as exc:
                answers.put(("error", repr(exc)))
            finally:
                if cancel:
                    cancelled.set()
                connections.close_all()

        first = threading.Thread(target=request, daemon=True)
        second = threading.Thread(target=request, args=(True,), daemon=True)
        with patch("billing.services.filing._snapshot", side_effect=snapshot), patch(
            "billing.services.filing._blockers", return_value=[]
        ), patch("billing.services.filing.timezone.localdate", return_value=date(2026, 10, 11)):
            first.start()
            try:
                self.assertTrue(captured.wait(5), "The first transaction did not reach its snapshot.")
                second.start()
                start_cancel.wait(timeout=5)
                self.assertFalse(cancelled.wait(0.25), "Cancellation passed the filing transaction before it committed.")
            finally:
                release.set()
                first.join(timeout=5)
                if second.ident is not None:
                    second.join(timeout=5)
            self.assertFalse(first.is_alive() or second.is_alive(), "The requests did not finish.")
        results = [answers.get_nowait(), answers.get_nowait()]
        self.assertCountEqual(results, [("filed", None), ("refused", "month_closed")])
        bill.refresh_from_db()
        self.assertEqual(bill.status, "active")
        self.assertEqual(FilingRecord.objects.get().bills[str(bill.pk)]["total"], "1030.00")
        self.assertFalse(AuditLog.objects.filter(entity="invoice", action="cancelled").exists())
