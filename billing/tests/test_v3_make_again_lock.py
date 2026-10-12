"""Ruling 1A-49: make-again locks the named bill before its firm's number series."""

import threading
import time
from unittest.mock import patch

from django.db import connection
from django.test import TransactionTestCase, skipUnlessDBFeature
from django.urls import reverse

from billing.models import AuditLog, Invoice, LineItem
from billing.services import sales
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person, sale


@skipUnlessDBFeature("has_select_for_no_key_update")
class MakeAgainLockTest(TransactionTestCase):
    def test_make_again_naming_a_bill_being_renumbered_waits_then_refuses(self):
        owner = person("kailash", *ROLE_GROUPS["owner"])
        business, customer = firm(invoice_prefix="KGH"), buyer()
        bill = sale(business, customer, "KGH/2026-27/5", "2026-09-30")
        before = Invoice.objects.filter(pk=bill.pk).values().get()
        lines = list(LineItem.objects.filter(invoice_id=bill.pk).values())
        paused, release, reading_replaced = threading.Event(), threading.Event(), threading.Event()
        answers, errors, pids = {}, {}, {}
        real_open, real_remade = sales.assert_sales_open, sales._remade

        def pause_renumber(*args, **kwargs):
            if args[2] == "renumber":
                # locked_bill() has acquired the bill, but checked_number() has not acquired the firm.
                paused.set()
                if not release.wait(10):
                    raise AssertionError("The renumber was not released")
            return real_open(*args, **kwargs)

        def read_replaced(*args, **kwargs):
            reading_replaced.set()
            return real_remade(*args, **kwargs)

        def request(name, url, body):
            try:
                with connection.cursor() as cursor:
                    # Bound even an unexpected lock cycle; only these worker connections are changed.
                    cursor.execute("SET statement_timeout = '10s'")
                    cursor.execute("SELECT pg_backend_pid()")
                    pids[name] = cursor.fetchone()[0]
                answers[name] = client_for(owner).post(url, body, format="json")
            except Exception as exc:
                errors[name] = exc
            finally:
                connection.close()

        renumber = threading.Thread(target=request, daemon=True, args=(
            "renumber", reverse("sale-renumber", args=[bill.pk]), {"invoice_number": "KGH/2026-27/6"}))
        make_again = threading.Thread(target=request, daemon=True, args=(
            "make_again", reverse("sale-list"), {
                "business": business.pk, "customer": customer.pk, "invoice_number": "KGH/2026-27/7",
                "invoice_date": "2026-09-30", "replaces": bill.pk,
                "lines": [{"product_name": "Silver", "hsn_code": "711311", "gst_percent": "3",
                           "quantity": "1", "rate": "10000", "unit": "gms"}],
            }))

        with patch.object(sales, "assert_sales_open", pause_renumber), \
                patch.object(sales, "_remade", read_replaced):
            renumber.start()
            try:
                self.assertTrue(paused.wait(10), errors)
                make_again.start()
                self.assertTrue(reading_replaced.wait(10), errors)
                # Wait for the real database lock, not just a scheduled thread. Before the fix,
                # make-again already holds the firm here, creating a cycle when renumber resumes.
                blocked, deadline = False, time.monotonic() + 5
                while time.monotonic() < deadline:
                    with connection.cursor() as cursor:
                        cursor.execute("SELECT %s = ANY(pg_blocking_pids(%s))",
                                       [pids["renumber"], pids["make_again"]])
                        blocked = cursor.fetchone()[0]
                    if blocked:
                        break
                    time.sleep(0.02)
                self.assertTrue(blocked, "Make-again must wait for the bill being renumbered")
                self.assertTrue(make_again.is_alive())
            finally:
                release.set()
                renumber.join(15)
                if make_again.ident is not None:
                    make_again.join(15)

        self.assertFalse(renumber.is_alive() or make_again.is_alive(), "The requests did not finish")
        self.assertFalse(errors, errors)
        self.assertEqual((answers["renumber"].status_code, answers["renumber"].data), (200, {
            "id": bill.pk, "invoice_number": "KGH/2026-27/6", "previous": "KGH/2026-27/5",
        }))
        self.assertEqual((answers["make_again"].status_code, answers["make_again"].data), (400, {
            "replaces": ["Only a cancelled bill can be made again."],
        }))
        self.assertEqual(Invoice.objects.count(), 1)
        after = Invoice.objects.filter(pk=bill.pk).values().get()
        self.assertEqual(after, {**before, "invoice_number": "KGH/2026-27/6", "updated_at": after["updated_at"]})
        self.assertEqual(list(LineItem.objects.filter(invoice_id=bill.pk).values()), lines)
        self.assertEqual(list(AuditLog.objects.values_list("action", flat=True)), ["renumbered"])
