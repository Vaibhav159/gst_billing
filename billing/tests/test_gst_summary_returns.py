"""The GST page's summary: what it says it files (M18, M29)."""

from decimal import Decimal as D

from django.contrib.auth.models import User
from django.urls import reverse
from rest_framework.test import APITestCase

from billing.models import Business, Customer, Invoice, LineItem


class GstSummaryCase(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="summary", password="pw", is_superuser=True, is_staff=True)
        self.client.force_authenticate(user=self.user)
        self.business = Business.objects.create(name="LODHA JEWELLERS", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN")
        self.buyer = Customer.objects.create(name="LOCAL BUYER", state_name="RAJASTHAN")
        self.supplier = Customer.objects.create(name="SUPPLIER LTD", gst_number="08AAECD1234K1Z2", state_name="RAJASTHAN")
        self.mumbai = Customer.objects.create(name="MUMBAI BUYER", gst_number="27ABCDE1234A1Z5", state_name="MAHARASHTRA")

    def _bill(self, party, kind, number, taxable, cgst=0, sgst=0, igst=0, hsn="711319", business=None):
        inv = Invoice.objects.create(
            business=business or self.business, customer=party, invoice_number=number, invoice_date="2026-07-10",
            type_of_invoice=kind, total_amount=D(taxable) + D(cgst) + D(sgst) + D(igst))
        LineItem.objects.create(
            invoice=inv, customer=party, product_name="Gold", hsn_code=hsn, gst_tax_rate=D("0.03"),
            quantity=D("1"), rate=D(taxable), cgst=D(cgst), sgst=D(sgst), igst=D(igst),
            amount=inv.total_amount)
        return inv

    def _summary(self, **params):
        base = {"start_date": "2026-07-01", "end_date": "2026-07-31", "business_id": self.business.id}
        base.update(params)
        r = self.client.get(reverse("invoice-gst-summary"), {k: v for k, v in base.items() if v is not None})
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        return r.data


class HsnSummaryTest(GstSummaryCase):
    def test_the_hsn_summary_counts_sales_only(self):
        """M18: 10 lakh of HSN 7113 sold and 8 lakh bought showed 18 lakh, in
        the Summary tab's HSN table and the CA CSV built from it."""
        self._bill(self.buyer, "outward", "S-1", "1000000", cgst="15000", sgst="15000", hsn="711319")
        self._bill(self.supplier, "inward", "P-1", "800000", cgst="12000", sgst="12000", hsn="711319")
        rows = self._summary()["hsn_summary"]
        self.assertEqual([(r["hsn_code"], r["taxable"], r["count"]) for r in rows], [("711319", 1000000.0, 1)])
