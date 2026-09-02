"""One builder for invoice lines (audit F1)."""

from decimal import Decimal

from django.test import TestCase
from rest_framework.exceptions import ValidationError

from billing.constants import GST_TAX_RATE
from billing.models import Business, Customer, Invoice, LineItem, Product
from billing.services.line_items import build_line_items, rate_for_product


class BuildLineItemsTests(TestCase):
    def setUp(self):
        self.business = Business.objects.create(
            name="LODHA JEWELLERS", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN"
        )
        self.intra = Customer.objects.create(name="LOCAL BUYER", state_name="RAJASTHAN")
        self.inter = Customer.objects.create(
            name="MUMBAI BUYER", gst_number="27ABCDE1234A1Z5", state_name="MAHARASHTRA"
        )

    def _invoice(self, customer, number="1"):
        return Invoice.objects.create(
            business=self.business, customer=customer, invoice_number=number,
            invoice_date="2026-04-10", type_of_invoice="outward",
        )

    def test_every_derived_source_files_the_same_heads(self):
        """A3/A7/A11's mechanism: the same payload used to get different heads
        depending on which door it entered."""
        item = {"product_name": "DIAMOND", "hsn_code": "7102", "quantity": "2", "rate": "10000", "gst_tax_rate": "0.0025"}
        inv = self._invoice(self.intra)
        for src in ("ai", "csv", "api"):
            with self.subTest(source=src):
                lines, total = build_line_items(inv, [item], source=src)
                li = lines[0]
                self.assertEqual((li.cgst, li.sgst, li.igst), (Decimal("25"), Decimal("25"), Decimal("0")))
                self.assertEqual(li.amount, Decimal("20050"))
                self.assertEqual(total, Decimal("20050"))
                self.assertEqual(li.gst_tax_rate, Decimal("0.0025"))

    def test_direction_comes_from_state_codes(self):
        item = {"product_name": "DIAMOND", "quantity": "1", "rate": "10000", "gst_tax_rate": "0.03"}
        lines, _ = build_line_items(self._invoice(self.inter), [item], source="csv")
        self.assertEqual((lines[0].cgst, lines[0].sgst, lines[0].igst), (Decimal("0"), Decimal("0"), Decimal("300")))

    def test_form_source_trusts_the_amount_and_refiles_heads_by_direction(self):
        inv = self._invoice(self.inter)
        item = {"product_name": "DIAMOND", "quantity": "1", "rate": "10000", "gst_tax_rate": "0.03",
                "cgst": "150", "sgst": "150", "igst": "0", "amount": "10300"}
        lines, total = build_line_items(inv, [item], source="form")
        self.assertEqual((lines[0].cgst, lines[0].sgst, lines[0].igst), (Decimal("0"), Decimal("0"), Decimal("300")))
        self.assertEqual(total, Decimal("10300"))

    def test_form_source_rejects_a_fabricated_amount(self):
        inv = self._invoice(self.intra)
        item = {"product_name": "DIAMOND", "quantity": "1", "rate": "10000", "gst_tax_rate": "0.03",
                "cgst": "150", "sgst": "150", "igst": "0", "amount": "99999"}
        with self.assertRaises(ValidationError):
            build_line_items(inv, [item], source="form")

    def test_rates_go_through_the_allowlist(self):
        inv = self._invoice(self.intra)
        for raw, stored in (("0.25", "0.0025"), ("3", "0.03"), ("0.03", "0.03"), ("18", "0.18")):
            with self.subTest(raw=raw):
                lines, _ = build_line_items(inv, [{"product_name": "X", "quantity": "1", "rate": "100", "gst_tax_rate": raw}], source="ai")
                self.assertEqual(lines[0].gst_tax_rate, Decimal(stored))

    def test_default_rate_fills_a_missing_one(self):
        inv = self._invoice(self.intra)
        lines, _ = build_line_items(inv, [{"product_name": "X", "quantity": "1", "rate": "100"}], source="ai", default_rate=Decimal("0.03"))
        self.assertEqual(lines[0].gst_tax_rate, Decimal("0.03"))
        self.assertEqual(lines[0].cgst + lines[0].sgst, Decimal("3"))

    def test_rate_for_product(self):
        self.assertEqual(rate_for_product(None), GST_TAX_RATE)
        stale = Product.objects.create(name="STONE", hsn_code="7102", gst_tax_rate=Decimal("0.25"))  # pre-fix row
        self.assertEqual(rate_for_product(stale), Decimal("0.0025"))

    def test_the_model_helper_uses_the_builder(self):
        Product.objects.create(name="STONE", hsn_code="7102", gst_tax_rate=Decimal("0.0025"))
        inv = self._invoice(self.intra)
        li = LineItem.create_line_item_for_invoice("STONE", 1, 10000, inv.id)
        li.refresh_from_db()
        self.assertEqual(li.hsn_code, "7102")
        self.assertEqual((li.cgst, li.sgst, li.igst), (Decimal("12.5"), Decimal("12.5"), Decimal("0")))
        self.assertEqual(li.amount, Decimal("10025"))

    def test_rows_come_back_unsaved_with_the_invoice_attached(self):
        inv = self._invoice(self.intra)
        lines, _ = build_line_items(inv, [{"product_name": "X", "quantity": "1", "rate": "100", "gst_tax_rate": "0.03"}], source="csv")
        self.assertIsNone(lines[0].pk)
        self.assertEqual(lines[0].invoice_id, inv.id)
        self.assertEqual(lines[0].customer_id, self.intra.id)
