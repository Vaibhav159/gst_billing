"""M27: the CSV invoice import books what its own columns say.

It ignored the file's gst_tax_rate and hsn_code and took the product master
(or the 3% / 711319 default): a loose diamond at 0.0025 for a product not in
the master was stored at 3% under 711319 (Rs 3,000 of tax instead of 250).
One blank number made pandas read the column as floats, so "101" became
"101.0", which GSTR-1 rejects and the duplicate check misses. An invoice
whose lines all failed was left behind empty.
"""

from decimal import Decimal as D

from django.test import TestCase

from billing.models import Business, Customer, Invoice
from billing.utils import process_invoice_csv

HEADER = "invoice_number,invoice_date,customer_name,product_name,quantity,rate,hsn_code,gst_tax_rate\n"


class CsvImportMoneyTest(TestCase):
    def setUp(self):
        self.biz = Business.objects.create(name="LODHA JEWELLERS", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN")
        self.buyer = Customer.objects.create(name="LOCAL BUYER", state_name="RAJASTHAN")
        self.buyer.businesses.add(self.biz)

    def _import(self, rows):
        return process_invoice_csv((HEADER + rows).encode(), self.biz.id)

    def test_the_rows_own_rate_and_hsn_are_used(self):
        self._import("D-1,2026-05-10,LOCAL BUYER,Loose diamond,1,100000,7102,0.0025\n")
        li = Invoice.objects.get(invoice_number="D-1").lineitem_set.get()
        self.assertEqual((li.gst_tax_rate, li.hsn_code), (D("0.0025"), "7102"))
        self.assertEqual(li.cgst + li.sgst, D("250"))

    def test_bill_numbers_stay_as_written_when_one_is_blank(self):
        result = self._import(
            "101,2026-05-10,LOCAL BUYER,Silver,1,1000,711311,0.03\n"
            ",2026-05-10,LOCAL BUYER,Silver,1,1000,711311,0.03\n"
            "102,2026-05-10,LOCAL BUYER,Silver,1,1000,711311,0.03\n"
        )
        self.assertEqual(sorted(Invoice.objects.values_list("invoice_number", flat=True)), ["101", "102"])
        self.assertTrue(result["errors"])  # the blank one is reported

    def test_an_invoice_whose_lines_all_fail_is_not_left_empty(self):
        result = self._import("E-1,2026-05-10,LOCAL BUYER,Silver,abc,1000,711311,0.03\n")
        self.assertFalse(Invoice.objects.filter(invoice_number="E-1").exists())
        self.assertTrue(any("E-1" in e for e in result["errors"]), result["errors"])


    def test_a_rate_written_as_a_percent_is_read(self):
        # Review of M27: "3%" failed each line with a raw "ConversionSyntax"
        # (the product CSV already read it).
        result = self._import("P-1,2026-05-10,LOCAL BUYER,Silver,1,1000,711311,3%\n"
                              "P-2,2026-05-10,LOCAL BUYER,Loose diamond,1,100000,7102,0.25%\n")
        self.assertEqual(result["errors"], [])
        self.assertEqual(Invoice.objects.get(invoice_number="P-1").lineitem_set.get().gst_tax_rate, D("0.03"))
        self.assertEqual(Invoice.objects.get(invoice_number="P-2").lineitem_set.get().gst_tax_rate, D("0.0025"))
