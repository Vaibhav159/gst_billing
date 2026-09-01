"""The repair pass for rates stored 100x too large (audit A1)."""

from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from billing.models import Business, Customer, Invoice, LineItem, Product


class FixGstRatesTests(TestCase):
    def setUp(self):
        self.business = Business.objects.create(
            name="LODHA JEWELLERS", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN"
        )
        self.customer = Customer.objects.create(name="A BUYER", state_name="RAJASTHAN")
        self.invoice = Invoice.objects.create(
            business=self.business,
            customer=self.customer,
            invoice_number="1",
            invoice_date="2026-04-10",
            type_of_invoice="outward",
        )

    def _line(self, rate, qty="1", unit_rate="100000", cgst="0", sgst="0"):
        net = Decimal(qty) * Decimal(unit_rate)
        return LineItem.objects.create(
            invoice=self.invoice,
            customer=self.customer,
            product_name="DIAMOND STONE",
            hsn_code="7102",
            gst_tax_rate=Decimal(rate),
            quantity=Decimal(qty),
            rate=Decimal(unit_rate),
            cgst=Decimal(cgst),
            sgst=Decimal(sgst),
            amount=net + Decimal(cgst) + Decimal(sgst),
        )

    def _run(self, *args):
        out = StringIO()
        call_command("fix_gst_rates", *args, stdout=out)
        return out.getvalue()

    def test_dry_run_reports_without_writing(self):
        li = self._line("0.25")
        output = self._run()
        self.assertIn("Dry run", output)
        li.refresh_from_db()
        self.assertEqual(li.gst_tax_rate, Decimal("0.2500"))

    def test_apply_repairs_the_quarter_percent_line(self):
        li = self._line("0.25")
        self._run("--apply")
        li.refresh_from_db()
        self.assertEqual(li.gst_tax_rate, Decimal("0.0025"))

    def test_apply_repairs_the_one_percent_line(self):
        li = self._line("1")
        self._run("--apply")
        li.refresh_from_db()
        self.assertEqual(li.gst_tax_rate, Decimal("0.0100"))

    def test_correctly_stored_rates_are_left_alone(self):
        for rate in ("0.0025", "0.03", "0.05", "0.12", "0.18", "0.28"):
            with self.subTest(rate=rate):
                li = self._line(rate)
                self._run("--apply")
                li.refresh_from_db()
                self.assertEqual(li.gst_tax_rate, Decimal(rate).quantize(Decimal("0.0001")))
                li.delete()

    def test_repairs_the_product_master(self):
        p = Product.objects.create(name="STONE", hsn_code="7102", gst_tax_rate=Decimal("0.25"))
        self._run("--apply")
        p.refresh_from_db()
        self.assertEqual(p.gst_tax_rate, Decimal("0.0025"))

    def test_money_is_never_touched(self):
        """Only the rate column moves — totals must not shift."""
        li = self._line("0.25", cgst="125", sgst="125")  # correct tax for 0.25%
        self._run("--apply")
        li.refresh_from_db()
        self.assertEqual(li.cgst, Decimal("125.000"))
        self.assertEqual(li.sgst, Decimal("125.000"))

    def test_flags_lines_whose_tax_was_recomputed_at_the_inflated_rate(self):
        """A line edited while the bug was live has wrong money the fix can't heal."""
        self._line("0.25", cgst="12500", sgst="12500")  # tax charged at 25%
        output = self._run()
        self.assertIn("computed at the inflated", output)
        self.assertIn("needs a human decision", output)

    def test_does_not_flag_lines_whose_tax_is_already_correct(self):
        self._line("0.25", cgst="125", sgst="125")
        self.assertNotIn("computed at the inflated", self._run())

    def test_idempotent(self):
        li = self._line("0.25")
        self._run("--apply")
        second = self._run("--apply")
        li.refresh_from_db()
        self.assertEqual(li.gst_tax_rate, Decimal("0.0025"))
        self.assertIn("No mis-stored GST rates found", second)

    def test_clean_book_reports_nothing(self):
        self._line("0.03")
        self.assertIn("No mis-stored GST rates found", self._run())
