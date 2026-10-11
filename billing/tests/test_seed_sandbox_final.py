"""Final Task 11 checks assert the seeded behavior independently of snapshot and loop details."""

import tempfile
from datetime import date
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.test import TestCase, override_settings

from billing.management.commands.seed_sandbox import Command, month_add
from billing.models import AuditLog, BinnedInvoice, Business, Invoice
from billing.numbering import counter_of, paper_book
from billing.services.bin import restore_from_bin


class SeedFinalTest(TestCase):
    def seed(self, today, *args):
        with tempfile.TemporaryDirectory(prefix="seed-final-") as media, override_settings(MEDIA_ROOT=media), \
                mock.patch.object(Command, "_assert_sandbox"), \
                mock.patch("billing.management.commands.seed_sandbox.timezone.localdate", return_value=today):
            call_command("seed_sandbox", "--scale", "0.1", *args, stdout=StringIO(), stderr=StringIO())

    def test_the_cancelled_paper_bill_has_its_audit_entry(self):
        self.seed(date(2026, 10, 15))
        cancelled = Invoice.objects.get(status="cancelled")
        audit = AuditLog.objects.filter(entity="invoice", entity_id=cancelled.pk, action="cancelled").first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.details, "Customer returned the piece the same day")
        self.assertEqual(audit.changes, {"status": {"old": "active", "new": "cancelled"}})
        self.assertIsNone(audit.user_id)
        self.assertIsNone(cancelled.cancelled_by_id)

    def test_the_deleted_paper_bill_restores_as_a_paper_bill(self):
        self.seed(date(2026, 10, 15))
        binned = BinnedInvoice.objects.get(reason="Entered twice by mistake")
        restored = restore_from_bin(binned, None)
        self.assertIs(restored.paper, True)
        self.assertEqual(restored.pk, binned.original_id)
        self.assertEqual(restored.invoice_date, date(2026, 9, 21))
        self.assertTrue(restored.invoice_number.startswith("KGH/2026-27/"))

    def test_two_of_each_three_recent_app_bills_were_sent(self):
        today = date(2026, 10, 15)
        self.seed(today)
        sent = list(Invoice.objects.sales().filter(invoice_date__gte=today.replace(day=1), paper=False).exclude(
            customer__customer_type="walkin").order_by("id").values_list("sent_at", flat=True))
        self.assertGreaterEqual(len(sent), 3)
        # Two sends, then one still to send; a partial final group starts with the sends.
        for start in range(0, len(sent), 3):
            group = sent[start:start + 3]
            self.assertEqual([stamp is not None for stamp in group], [True, True, False][:len(group)])

    def test_paper_run_ends_before_this_month_even_when_today_is_midmonth(self):
        for today in (date(2026, 10, 15), date(2027, 3, 15), date(2027, 4, 15)):
            with self.subTest(today=today):
                self.seed(today, "--reset")
                this_month = today.replace(day=1)
                last_month = month_add(this_month, -1)
                kiran = Business.objects.get(name="KIRAN GOLD HOUSE (SANDBOX)")
                paper = list(Invoice.objects.sales().filter(business=kiran, paper=True))
                binned = BinnedInvoice.objects.get(reason="Entered twice by mistake")
                run = [*paper, binned]
                self.assertEqual(len(run), 6)
                self.assertTrue(all(last_month.replace(day=15) <= bill.invoice_date < this_month for bill in run))
                self.assertFalse(Invoice.objects.sales().filter(
                    business=kiran, paper=False, invoice_date__gte=last_month.replace(day=15),
                    invoice_date__lt=this_month).exists())
                current = list(Invoice.objects.sales().filter(business=kiran, invoice_date__gte=this_month))
                self.assertTrue(current)
                self.assertGreater(min(bill.pk for bill in paper), max(bill.pk for bill in current))
                counters = [counter_of(bill.invoice_number) for bill in run]
                self.assertEqual(max(counters) - min(counters) + 1, 8)
                self.assertEqual(paper_book(kiran, last_month.year, last_month.month)["missing_count"], 2)
