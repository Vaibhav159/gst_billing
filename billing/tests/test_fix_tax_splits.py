"""fix_tax_splits: the repair pass for half-paise heads already on file (H13)."""

from decimal import Decimal as D
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from billing.models import Business, Customer, FiledPeriod, Invoice, LineItem


class FixTaxSplitsTests(TestCase):
    def setUp(self):
        self.business = Business.objects.create(name="LODHA JEWELLERS", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN")
        self.customer = Customer.objects.create(name="A BUYER", state_name="RAJASTHAN")
        self.invoice = Invoice.objects.create(
            business=self.business, customer=self.customer, invoice_number="7",
            invoice_date="2026-07-10", type_of_invoice="outward",
        )

    def _line(self, cgst, sgst, igst="0", amount="566.160"):
        return LineItem.objects.create(
            invoice=self.invoice, customer=self.customer, product_name="SILVER", hsn_code="711311",
            gst_tax_rate=D("0.03"), quantity=D("1"), rate=D("549.67"),
            cgst=D(cgst), sgst=D(sgst), igst=D(igst), amount=D(amount),
        )

    def _run(self, *args):
        out = StringIO()
        call_command("fix_tax_splits", *args, stdout=out)
        return out.getvalue()

    def test_reports_a_half_paise_split_without_writing(self):
        li = self._line("8.245", "8.245")
        output = self._run()
        self.assertIn("#7", output)
        self.assertIn("8.245 + 8.245", output)
        self.assertIn("8.25 + 8.24", output)
        self.assertIn("Dry run", output)
        li.refresh_from_db()
        self.assertEqual((li.cgst, li.sgst), (D("8.245"), D("8.245")))

    def test_apply_resplits_in_whole_paise_and_keeps_the_amount(self):
        li = self._line("8.245", "8.245")
        self._run("--apply")
        li.refresh_from_db()
        self.assertEqual((li.cgst, li.sgst, li.igst), (D("8.25"), D("8.24"), D("0")))
        self.assertEqual(li.amount, D("566.160"))
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.total_amount, D("566.160"))  # no invoice total moves

    def test_a_sub_paisa_igst_is_rounded(self):
        li = self._line("0", "0", igst="16.491", amount="566.161")
        self._run("--apply")
        li.refresh_from_db()
        self.assertEqual(li.igst, D("16.49"))
        self.assertEqual(li.amount, D("566.161"))

    def test_whole_paise_lines_are_left_alone(self):
        li = self._line("8.25", "8.24")
        output = self._run("--apply")
        self.assertIn("No half-paise tax heads found", output)
        li.refresh_from_db()
        self.assertEqual((li.cgst, li.sgst), (D("8.25"), D("8.24")))

    def test_a_filed_month_is_marked(self):
        FiledPeriod.objects.create(business=self.business, year=2026, month=7)
        self._line("8.245", "8.245")
        self.assertIn("FILED", self._run())

    def test_a_line_carrying_both_heads_is_listed_but_not_touched(self):
        li = self._line("4.125", "4.125", igst="8.245")
        output = self._run("--apply")
        self.assertIn("fix_tax_heads", output)
        li.refresh_from_db()
        self.assertEqual(li.igst, D("8.245"))
