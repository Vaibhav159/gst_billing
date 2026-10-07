"""H13: every stored CGST/SGST pair is the paise-exact split of its tax.

The form sends 16.49 of tax as two halves in whole paise. The server used to
re-split it as 16.49 / 2 = 8.245 + 8.245, so each surface rounded the half-paise
its own way: the classic print showed 8.25 + 8.25 (16.50), the Tally PDF, the
Excel export and GSTR-1 8.24 + 8.24 (16.48), beside a total of 16.49. About half
of all intra-state lines carry an odd paisa.

The rule, on both sides: the tax rounded to the paisa, CGST is half of it
rounded half-up, SGST is the rest (money.ts halveTax mirrors it).
"""

from decimal import Decimal as D

from django.urls import reverse

from billing.constants import INVOICE_TYPE_OUTWARD
from billing.models import Business, Customer, Invoice, LineItem
from billing.services.line_items import build_line_items
from billing.tax_rules import normalize_tax_heads
from billing.tests.test_base import BaseAPITestCase


def _paise(value):
    """True when a Decimal has nothing below the paisa."""
    return value == value.quantize(D("0.01"))


class NormalizeTaxHeadsSplitTest(BaseAPITestCase):
    def test_odd_paise_tax_splits_into_whole_paise(self):
        self.assertEqual(normalize_tax_heads(D("8.25"), D("8.24"), D("0"), False), (D("8.25"), D("8.24"), D("0")))

    def test_refiling_an_odd_igst_to_cgst_sgst_keeps_the_paisa(self):
        self.assertEqual(normalize_tax_heads(D("0"), D("0"), D("16.49"), False), (D("8.25"), D("8.24"), D("0")))

    def test_every_odd_paise_tax_up_to_twenty_rupees(self):
        for paise in range(2001):
            tax = D(paise) / 100
            cgst, sgst, igst = normalize_tax_heads(tax, D("0"), D("0"), False)
            with self.subTest(tax=tax):
                self.assertTrue(_paise(cgst) and _paise(sgst), (cgst, sgst))
                self.assertEqual(cgst + sgst, tax)
                self.assertIn(cgst - sgst, (D("0"), D("0.01")))
                self.assertEqual(igst, 0)


class FormWriteSplitTest(BaseAPITestCase):
    """POST /api/invoices/: what the form sends is what is stored."""

    def setUp(self):
        super().setUp()
        self.biz = Business.objects.create(name="LODHA JEWELLERS", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN")
        self.local = Customer.objects.create(name="LOCAL BUYER", state_name="RAJASTHAN")

    def test_the_forms_odd_paise_split_is_stored_as_sent(self):
        resp = self.client.post(reverse("invoice-list"), {
            "business": self.biz.id, "customer": self.local.id, "invoice_number": "H13-1",
            "invoice_date": "2026-08-05", "type_of_invoice": INVOICE_TYPE_OUTWARD,
            "line_items": [{
                "product_name": "Silver", "hsn_code": "711311", "gst_tax_rate": "0.03",
                "quantity": "1", "rate": "549.67", "unit": "gms",
                "cgst": "8.25", "sgst": "8.24", "igst": "0", "amount": "566.16",
            }],
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        li = LineItem.objects.get(invoice_id=resp.data["id"])
        self.assertEqual((li.cgst, li.sgst, li.igst), (D("8.25"), D("8.24"), D("0")))
        self.assertEqual(li.amount, D("566.16"))


class DerivedSourceSplitTest(BaseAPITestCase):
    """AI, CSV and the model helper derive the tax themselves."""

    def setUp(self):
        super().setUp()
        self.biz = Business.objects.create(name="LODHA JEWELLERS", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN")
        self.local = Customer.objects.create(name="LOCAL BUYER", state_name="RAJASTHAN")
        self.mumbai = Customer.objects.create(name="MUMBAI BUYER", gst_number="27ABCDE1234A1Z5", state_name="MAHARASHTRA")

    def _inv(self, customer):
        return Invoice.objects.create(
            business=self.biz, customer=customer, invoice_number=f"D-{Invoice.objects.count()}",
            invoice_date="2026-08-05", type_of_invoice=INVOICE_TYPE_OUTWARD,
        )

    def test_derived_lines_are_paise_exact_like_the_form(self):
        # 549.67 at 3% is 16.4901 of tax: the form books 16.49 (8.25 + 8.24)
        # and a line total of 566.16, so the derived doors must too.
        item = {"product_name": "Silver", "quantity": "1", "rate": "549.67", "gst_tax_rate": "0.03"}
        for src in ("ai", "csv", "api"):
            with self.subTest(source=src):
                (li,), total = build_line_items(self._inv(self.local), [item], source=src)
                self.assertEqual((li.cgst, li.sgst, li.igst), (D("8.25"), D("8.24"), D("0")))
                self.assertEqual(li.amount, D("566.16"))
                self.assertEqual(total, D("566.16"))

    def test_derived_igst_is_rounded_to_the_paisa(self):
        item = {"product_name": "Silver", "quantity": "1", "rate": "549.67", "gst_tax_rate": "0.03"}
        (li,), _ = build_line_items(self._inv(self.mumbai), [item], source="ai")
        self.assertEqual((li.cgst, li.sgst, li.igst), (D("0"), D("0"), D("16.49")))
        self.assertEqual(li.amount, D("566.16"))


class BulkImportSplitTest(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.biz = Business.objects.create(name="LODHA JEWELLERS", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN")
        Customer.objects.create(name="LOCAL BUYER", state_name="RAJASTHAN")

    def test_a_row_without_heads_is_split_paise_exact(self):
        r = self.client.post(reverse("bulk-invoice-import"), {"business_id": self.biz.id, "invoices": [{
            "invoiceNumber": "B-1", "invoice_date": "2026-05-10", "customerName": "LOCAL BUYER",
            "type": "OUTWARD", "total": 566.16,
            "items": [{"productName": "Silver", "hsn": "711311", "qty": 1, "rate": 549.67, "gstRate": 3}],
        }]}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        li = Invoice.objects.get(invoice_number="B-1").lineitem_set.get()
        self.assertEqual((li.cgst, li.sgst, li.igst), (D("8.25"), D("8.24"), D("0")))
