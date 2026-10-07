"""H8: a gross-only import row keeps its taxable value.

For a row with only a gross amount, bulk import backed out the net to work
out the tax but stored quantity = rate = 0. Every GST output reads the
taxable value as quantity x rate, so a Rs 10,300 row filed B2CS txval 0, HSN
txval 0 and GST-summary taxable 0, and understated 3B outward supplies by
Rs 10,000. Backup restore goes through the same import.
"""

from decimal import Decimal as D
from io import StringIO

from django.core.management import call_command
from django.urls import reverse

from billing.models import Business, Customer, FiledPeriod, Invoice, LineItem
from billing.tests.test_base import BaseAPITestCase


class AmountOnlyRowTest(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.biz = Business.objects.create(name="LODHA JEWELLERS", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN")
        self.buyer = Customer.objects.create(name="LOCAL BUYER", state_name="RAJASTHAN")
        self.buyer.businesses.add(self.biz)

    def test_a_gross_only_row_is_stored_as_one_unit_at_its_taxable_value(self):
        r = self.client.post(reverse("bulk-invoice-import"), {"business_id": self.biz.id, "invoices": [{
            "invoiceNumber": "G-1", "invoice_date": "2026-07-10", "customerName": "LOCAL BUYER", "type": "OUTWARD",
            "total": 10300, "items": [{"productName": "Silver", "hsn": "711311", "qty": 0, "rate": 0, "gstRate": 3, "amount": 10300}],
        }]}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        li = Invoice.objects.get(invoice_number="G-1").lineitem_set.get()
        self.assertEqual((li.quantity, li.rate, li.amount), (D("1"), D("10000"), D("10300")))
        self.assertEqual((li.cgst, li.sgst), (D("150"), D("150")))

        portal = self.client.get(reverse("invoice-gstr1-portal-json"), {"business_id": self.biz.id, "month": 7, "year": 2026}).data["file"]
        self.assertEqual(sum(row["txval"] for row in portal["b2cs"]), 10000.0)
        self.assertEqual(sum(row["txval"] for row in portal["hsn"]["hsn_b2c"]), 10000.0)
        summary = self.client.get(reverse("invoice-gst-summary"), {"business_id": self.biz.id,
                                                                   "start_date": "2026-07-01", "end_date": "2026-07-31"}).data
        self.assertEqual(summary["rate_slabs"]["outward"][0]["taxable"], 10000.0)


class FixAmountOnlyLinesTest(BaseAPITestCase):
    def _run(self, *args):
        out = StringIO()
        call_command("fix_amount_only_lines", *args, stdout=out)
        return out.getvalue()

    def test_reports_then_restores_the_taxable_value(self):
        inv = Invoice.objects.create(business=self.business, customer=self.customer, invoice_number="AO-1",
                                     invoice_date="2026-07-10", type_of_invoice="outward", total_amount=D("10300"))
        li = LineItem.objects.create(invoice=inv, customer=self.customer, product_name="Silver", hsn_code="711311",
                                     gst_tax_rate=D("0.03"), quantity=0, rate=0, cgst=D("150"), sgst=D("150"),
                                     igst=0, amount=D("10300"))
        FiledPeriod.objects.create(business=self.business, year=2026, month=7)
        output = self._run()
        self.assertIn("AO-1", output)
        self.assertIn("10000", output)
        self.assertIn("FILED", output)
        self.assertIn("Dry run", output)
        li.refresh_from_db()
        self.assertEqual((li.quantity, li.rate), (D("0"), D("0")))

        self._run("--apply")
        li.refresh_from_db()
        self.assertEqual((li.quantity, li.rate, li.amount), (D("1"), D("10000"), D("10300")))
        self.assertIn("No amount-only", self._run())
