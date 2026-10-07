"""check_line_tax: lines whose tax isn't their rate (review of H10 and M14).

H10's Excel import taxed a cell shown as "3%" at 0.03% (Rs 18 on Rs 60,000),
and before M14 the line-item API and every invoice write took a line's tax as
sent (a 3% line with Rs 0 of tax). Those lines were filed under-reported, and
nothing listed them.
"""

from decimal import Decimal as D
from io import StringIO

from django.core.management import call_command

from billing.models import FiledPeriod, Invoice, LineItem
from billing.tests.test_base import BaseAPITestCase


class CheckLineTaxTest(BaseAPITestCase):
    def _line(self, number, quantity, rate, gst, cgst, sgst, amount, day="2026-07-10"):
        inv = Invoice.objects.create(business=self.business, customer=self.customer, invoice_number=number,
                                     invoice_date=day, type_of_invoice="outward")
        return LineItem.objects.create(invoice=inv, customer=self.customer, product_name="Gold", hsn_code="711319",
                                       gst_tax_rate=D(gst), quantity=D(quantity), rate=D(rate), cgst=D(cgst),
                                       sgst=D(sgst), igst=0, amount=D(amount))

    def _run(self, *args):
        out = StringIO()
        call_command("check_line_tax", *args, stdout=out)
        return out.getvalue()

    def test_lists_a_line_taxed_off_its_rate(self):
        self.line_item.delete()  # the base fixture's line is right; keep the report about these
        self._line("LT-1", "10", "6000", "0.03", "9", "9", "60018")             # H10: 0.03% at a 3% rate
        self._line("LT-2", "100", "1000", "0.03", "0", "0", "100000")           # M14: no tax at 3%
        self._line("LT-3", "10", "6000", "0.03", "900", "900", "61800")         # right
        self._line("LT-4", "0", "0", "0.03", "150", "150", "10300")             # amount-only, right
        self._line("LT-5", "1", "100000", "0.25", "125", "125", "100250")       # 0.25 meaning 0.25%: fix_gst_rates'
        FiledPeriod.objects.create(business=self.business, year=2026, month=7)
        output = self._run()
        self.assertIn("LT-1", output)
        self.assertIn("1800", output)
        self.assertIn("LT-2", output)
        self.assertIn("FILED", output)
        for fine in ("LT-3", "LT-4", "LT-5"):
            self.assertNotIn(fine, output)
        self.assertIn("2 line(s)", output)

    def test_says_so_when_every_line_is_its_rate(self):
        self.assertIn("Every line's tax is its rate", self._run())

    def test_it_changes_nothing(self):
        li = self._line("LT-6", "10", "6000", "0.03", "9", "9", "60018")
        self._run()
        li.refresh_from_db()
        self.assertEqual((li.cgst, li.sgst), (D("9"), D("9")))
