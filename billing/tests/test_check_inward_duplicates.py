"""check_inward_duplicates: purchases already on file twice (review of M28 and H7).

Before M28 each purchase door had its own duplicate rule, and before H7 an
undo of a deleted purchase could be used again; both booked one bill's ITC
twice. Nothing measured what is already in the books.
"""

from decimal import Decimal as D
from io import StringIO

from django.core.management import call_command

from billing.models import Customer, FiledPeriod, Invoice, LineItem
from billing.tests.test_base import BaseAPITestCase


class CheckInwardDuplicatesTest(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.supplier = Customer.objects.create(name="SJ GOLD", gst_number="22CCCCC0000C1Z5")
        self.other = Customer.objects.create(name="OTHER GOLD", gst_number="22EEEEE0000E1Z5")

    def _bill(self, number, day, supplier=None, tax="150"):
        inv = Invoice.objects.create(business=self.business, customer=supplier or self.supplier,
                                     invoice_number=number, invoice_date=day, type_of_invoice="inward")
        LineItem.objects.create(invoice=inv, customer=inv.customer, product_name="Gold bar", hsn_code="710813",
                                gst_tax_rate=D("0.03"), quantity=D("1"), rate=D("10000"), cgst=D(tax),
                                sgst=D(tax), igst=0, amount=D("10000") + 2 * D(tax))
        return inv

    def _run(self, *args):
        out = StringIO()
        call_command("check_inward_duplicates", *args, stdout=out)
        return out.getvalue()

    def test_lists_the_same_bill_entered_twice_and_the_itc_claimed_again(self):
        self._bill("SJ-101", "2026-05-05")
        self._bill("SJ/101", "2026-05-07")
        self._bill("SJ-101", "2026-05-05", supplier=self.other)  # another supplier's 101
        self._bill("SJ-101", "2027-05-05")  # next FY's 101
        FiledPeriod.objects.create(business=self.business, year=2026, month=5)
        output = self._run()
        self.assertIn("SJ-101", output)
        self.assertIn("SJ/101", output)
        self.assertIn("FILED", output)
        self.assertIn("1 bill(s)", output)
        self.assertIn("300", output)  # the ITC claimed a second time
        self.assertNotIn("OTHER GOLD", output)
        self.assertNotIn("2027-05-05", output)

    def test_says_so_when_there_are_none(self):
        self._bill("SJ-101", "2026-05-05")
        self.assertIn("No purchase is on file twice", self._run())

    def test_it_changes_nothing(self):
        self._bill("SJ-101", "2026-05-05")
        self._bill("SJ/101", "2026-05-07")
        self._run()
        self.assertEqual(Invoice.objects.filter(type_of_invoice="inward").count(), 2)
