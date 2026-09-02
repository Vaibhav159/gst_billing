"""Bulk import's money derivations (audit F5.4).

The endpoint was reached by two tests — payment-mode passthrough and the
lock row-skip — both at a 3% rate where the old heuristic happened to work.
Rate normalisation, the gross back-out, the head split, the empty-invoice
rollback and the per-row savepoint were all unasserted.
"""

from decimal import Decimal

from django.urls import reverse

from billing.models import Business, Customer, Invoice, Product
from billing.tests.test_base import BaseAPITestCase


class BulkImportDerivationTests(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.biz = Business.objects.create(
            name="LODHA JEWELLERS", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN"
        )
        Customer.objects.create(name="LOCAL BUYER", state_name="RAJASTHAN")
        Customer.objects.create(name="MUMBAI BUYER", gst_number="27ABCDE1234A1Z5", state_name="MAHARASHTRA")

    def _post(self, invoices):
        r = self.client.post(
            reverse("bulk-invoice-import"), {"business_id": self.biz.id, "invoices": invoices}, format="json"
        )
        self.assertEqual(r.status_code, 201, getattr(r, "data", None))
        return r.data

    def _inv(self, number, customer="LOCAL BUYER", items=None, total=10300):
        return {
            "invoiceNumber": number, "invoice_date": "2026-05-10", "customerName": customer,
            "type": "OUTWARD", "total": total,
            "items": items or [{"productName": "Silver", "hsn": "711311", "qty": 1, "rate": 10000, "gstRate": 3}],
        }

    def _line(self, number):
        return Invoice.objects.get(invoice_number=number, business=self.biz).lineitem_set.get()

    def test_quarter_percent_slab_is_stored_as_a_fraction_and_taxed_as_such(self):
        """A1 at this door: 0.25% used to be stored as 25%."""
        data = self._post([self._inv("Q-1", items=[{"productName": "Diamond", "hsn": "7102", "qty": 1, "rate": 100000, "gstRate": 0.25}], total=100250)])
        self.assertEqual(data.get("errors") or [], [])
        li = self._line("Q-1")
        self.assertEqual(li.gst_tax_rate, Decimal("0.0025"))
        self.assertEqual((li.cgst, li.sgst, li.igst), (Decimal("125"), Decimal("125"), Decimal("0")))
        self.assertEqual(li.amount, Decimal("100250"))

    def test_amount_only_row_backs_the_taxable_value_out_of_the_gross(self):
        """Sheets often carry only the gross; qty and rate are zero."""
        self._post([self._inv("G-1", items=[{"productName": "Silver", "hsn": "711311", "qty": 0, "rate": 0, "gstRate": 3, "amount": 10300}])])
        li = self._line("G-1")
        self.assertEqual(li.amount, Decimal("10300"))
        self.assertEqual(li.cgst + li.sgst, Decimal("300"))
        self.assertEqual(li.igst, Decimal("0"))

    def test_heads_split_by_the_customer_state(self):
        self._post([self._inv("I-1", customer="MUMBAI BUYER")])
        li = self._line("I-1")
        self.assertEqual((li.cgst, li.sgst, li.igst), (Decimal("0"), Decimal("0"), Decimal("300")))
        self.assertTrue(Invoice.objects.get(invoice_number="I-1").is_igst_applicable)

    def test_product_master_rate_is_used_when_the_row_has_none(self):
        Product.objects.create(name="Diamond", hsn_code="7102", gst_tax_rate=Decimal("0.0025"))
        self._post([self._inv("M-1", items=[{"productName": "Diamond", "hsn": "7102", "qty": 1, "rate": 100000}], total=100250)])
        self.assertEqual(self._line("M-1").gst_tax_rate, Decimal("0.0025"))

    def test_an_invoice_whose_only_line_is_invalid_is_rolled_back_not_left_empty(self):
        """A stub invoice with no lines would corrupt counters and reports."""
        bad = self._inv("BAD-1", items=[{"productName": "Silver", "hsn": "711311", "qty": 100000000, "rate": 10000, "gstRate": 3}])
        data = self._post([bad, self._inv("GOOD-1")])
        self.assertTrue(any("exceeds DB limit" in e for e in data.get("errors", [])), data.get("errors"))
        self.assertFalse(Invoice.objects.filter(invoice_number="BAD-1").exists())
        self.assertTrue(Invoice.objects.filter(invoice_number="GOOD-1").exists())

    def test_invoice_total_is_the_sum_of_its_lines(self):
        self._post([self._inv("T-1", items=[
            {"productName": "Silver", "hsn": "711311", "qty": 1, "rate": 10000, "gstRate": 3},
            {"productName": "Diamond", "hsn": "7102", "qty": 1, "rate": 100000, "gstRate": 0.25},
        ], total=110550)])
        inv = Invoice.objects.get(invoice_number="T-1")
        self.assertEqual(inv.total_amount, Decimal("110550"))
        self.assertEqual(inv.lineitem_set.count(), 2)
