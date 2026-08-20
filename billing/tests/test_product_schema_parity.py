"""Regressions for the two schema gaps the 20 Aug prod cleanup exposed.

1. Product.description existed on prod's table but not in the model, so every
   ORM product INSERT on prod violated its NOT NULL constraint.
2. gst_tax_rate was numeric(12,3) — the 0.25% diamond/stone rate (0.0025)
   silently rounded to 0.003 on both Product and LineItem.
"""

from decimal import Decimal as D

from django.urls import reverse

from billing.constants import INVOICE_TYPE_OUTWARD
from billing.models import Invoice, LineItem, Product
from billing.tests.test_base import BaseAPITestCase


class ProductDescriptionTest(BaseAPITestCase):
    def test_description_round_trips_through_the_api(self):
        resp = self.client.post(reverse("product-list"), {
            "name": "Parity Ring", "hsn_code": "71131910", "gst_tax_rate": "0.03",
            "description": "22k, plain band",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["description"], "22k, plain band")
        self.assertEqual(Product.objects.get(id=resp.data["id"]).description, "22k, plain band")

    def test_description_defaults_to_empty_not_null(self):
        resp = self.client.post(reverse("product-list"), {
            "name": "Parity Band", "hsn_code": "71131910", "gst_tax_rate": "0.03",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(Product.objects.get(id=resp.data["id"]).description, "")


class QuarterPercentRateTest(BaseAPITestCase):
    def test_product_stores_0_25_percent_exactly(self):
        resp = self.client.post(reverse("product-list"), {
            "name": "Polished Diamond", "hsn_code": "71023910", "gst_tax_rate": "0.0025",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        stored = Product.objects.get(id=resp.data["id"]).gst_tax_rate
        self.assertEqual(D(stored), D("0.0025"))  # numeric(12,3) rounded this to 0.003

    def test_line_item_keeps_the_quarter_percent_rate(self):
        inv = Invoice.objects.create(
            workspace_id=1, business=self.business, customer=self.customer,
            invoice_number="DIA-1", invoice_date="2026-08-01",
            type_of_invoice=INVOICE_TYPE_OUTWARD, total_amount=0,
        )
        li = LineItem.objects.create(
            workspace_id=1, customer=self.customer, invoice=inv,
            product_name="Polished Diamond", hsn_code="71023910",
            gst_tax_rate=D("0.0025"), quantity=D("1"), rate=D("100000"),
            cgst=D("125"), sgst=D("125"), igst=D("0"), amount=D("100250"), unit="ct",
        )
        li.refresh_from_db()
        self.assertEqual(D(li.gst_tax_rate), D("0.0025"))
        # And the money at that rate is representable in the money columns:
        # 1,00,000 × 0.25% = 250, split 125/125 — three decimal places suffice
        # for the AMOUNTS; only the RATE needed the fourth place.
        self.assertEqual(D(li.cgst) + D(li.sgst), D("250"))
