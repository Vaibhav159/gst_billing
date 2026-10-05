import os
import tempfile
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings

from billing.constants import B2CL_THRESHOLD
from billing.models import Business, FiledPeriod, Invoice, InwardCapture, LineItem
from billing.tax_rules import is_interstate


@override_settings(MEDIA_ROOT=tempfile.mkdtemp(prefix="seed-sandbox-"))
class SeedSandboxTest(TestCase):
    def _seed(self, *args):
        out = StringIO()
        with mock.patch.dict(os.environ, {"GST_SANDBOX": "1"}):
            call_command("seed_sandbox", "--scale", "0.1", *args, stdout=out, stderr=StringIO())
        return out.getvalue()

    def test_refuses_outside_the_sandbox(self):
        with mock.patch.dict(os.environ, {"GST_SANDBOX": ""}), self.assertRaises(CommandError):
            call_command("seed_sandbox", stdout=StringIO(), stderr=StringIO())
        self.assertFalse(Business.objects.exists())

    def test_books_are_internally_consistent(self):
        logins = self._seed("--print-credentials").strip().splitlines()
        self.assertEqual(len(logins), 5)

        for inv in Invoice.objects.prefetch_related("lineitem_set"):
            lines = list(inv.lineitem_set.all())
            self.assertTrue(lines, inv.invoice_number)
            self.assertEqual(inv.total_amount, sum(li.amount for li in lines), inv.invoice_number)

        for li in LineItem.objects.select_related("invoice__business", "invoice__customer"):
            if is_interstate(li.invoice.business, li.invoice.customer):
                self.assertEqual(li.cgst + li.sgst, 0)
            else:
                self.assertEqual(li.igst, 0)

        b2cl = Invoice.objects.get(customer__name="Arjun Nair")
        self.assertGreater(b2cl.total_amount, B2CL_THRESHOLD)
        self.assertTrue(FiledPeriod.objects.exists())
        self.assertEqual(InwardCapture.objects.count(), 3)

    def test_second_run_needs_reset(self):
        self._seed()
        with self.assertRaises(CommandError):
            self._seed()
        self._seed("--reset")
        self.assertEqual(Business.objects.count(), 3)
