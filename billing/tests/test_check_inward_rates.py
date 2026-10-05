"""C1: the report of past inward lines whose GST rate looks wrong."""

from decimal import Decimal as D
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from billing.constants import INVOICE_TYPE_INWARD, INVOICE_TYPE_OUTWARD
from billing.models import Business, Customer, Invoice, LineItem, Product


class CheckInwardRatesTest(TestCase):
    def setUp(self):
        self.business = Business.objects.create(
            name="AARAV JEWELLERS", gst_number="08AAAAA0000A1Z5", state_name="RAJASTHAN"
        )
        self.supplier = Customer.objects.create(name="GEM HOUSE", gst_number="08CCCCC0000C1Z5")
        Product.objects.create(name="Making Charges", hsn_code="998892", gst_tax_rate=D("0.05"))
        Product.objects.create(name="Gold Ornaments", hsn_code="711319", gst_tax_rate=D("0.03"))

    def _line(self, number, hsn, rate, qty, price, kind=INVOICE_TYPE_INWARD, date="2026-05-05"):
        """A line as the inward write path stored it: tax = qty x price x rate, split intra."""
        inv = Invoice.objects.create(
            business=self.business, customer=self.supplier, invoice_number=number,
            invoice_date=date, type_of_invoice=kind,
        )
        half = (D(qty) * D(price) * D(rate) / 2).quantize(D("0.01"))
        return LineItem.objects.create(
            invoice=inv, customer=self.supplier, product_name=f"item {number}", hsn_code=hsn,
            gst_tax_rate=D(rate), quantity=D(qty), rate=D(price), cgst=half, sgst=half,
            amount=D(qty) * D(price) + 2 * half,
        )

    def _report(self, *args):
        out = StringIO()
        call_command("check_inward_rates", *args, stdout=out)
        return out.getvalue()

    def test_lists_the_lines_that_look_wrong_and_what_their_itc_should_be(self):
        self._line("D-1", "710239", "0.03", "2", "500000")   # diamonds at the old 3% default
        self._line("A-1", "710391", "0.25", "1", "100000")   # a ruby read as 0.25, stored verbatim: taxed 25%
        self._line("M-1", "998892", "0.03", "1", "10000")    # making charges, master says 5%
        self._line("G-1", "711319", "0.03", "10", "9000")    # gold at 3%: right
        self._line("Z-1", "711319", "0", "1", "5000")        # no GST charged: not a rate error
        self._line("S-1", "710239", "0.03", "1", "500000", kind=INVOICE_TYPE_OUTWARD)  # a sale

        out = self._report()

        for listed in ("#D-1", "#A-1", "#M-1"):
            self.assertIn(listed, out)
        for clean in ("#G-1", "#Z-1", "#S-1"):
            self.assertNotIn(clean, out)
        # On file 30,000 + 25,000 + 300; at 0.25%, 0.25% and 5%: 2,500 + 250 + 500.
        self.assertIn("55300.00", out)
        self.assertIn("3250.00", out)
        self.assertIn("52050.00", out)

    def test_lists_tax_claimed_on_purchases_from_suppliers_without_a_gstin(self):
        karigar = Customer.objects.create(name="LOCAL KARIGAR", gst_number="URP")
        walk_in = Customer.objects.create(name="CASH SUPPLIER", gst_number=None)
        self.supplier = karigar
        self._line("K-1", "711319", "0.03", "1", "100000")   # 3,000 claimed, none allowed
        self._line("K-0", "711319", "0", "1", "5000")        # no tax claimed: fine
        self.supplier = walk_in
        self._line("W-1", "998892", "0.05", "1", "10000")    # 500 claimed, none allowed

        out = self._report()

        self.assertIn("#K-1", out)
        self.assertIn("#W-1", out)
        self.assertNotIn("#K-0", out)
        self.assertIn("no GSTIN", out)
        self.assertIn("3500.00 on file, 0.00 at the suggested rates", out)

    def test_never_writes(self):
        li = self._line("D-1", "710239", "0.03", "2", "500000")
        self._report()
        li.refresh_from_db()
        self.assertEqual((li.gst_tax_rate, li.cgst, li.amount), (D("0.0300"), D("15000.00"), D("1030000.00")))

    def test_date_and_firm_filters(self):
        self._line("OLD-1", "710239", "0.03", "1", "1000", date="2025-05-05")
        self._line("NEW-1", "710239", "0.03", "1", "1000", date="2026-05-05")
        out = self._report("--from", "2026-04-01", "--business", str(self.business.id))
        self.assertIn("#NEW-1", out)
        self.assertNotIn("#OLD-1", out)
        self.assertNotIn("#NEW-1", self._report("--business", str(self.business.id + 1)))

    def test_says_so_when_nothing_looks_wrong(self):
        self._line("G-1", "711319", "0.03", "10", "9000")
        self.assertIn("No inward lines", self._report())
