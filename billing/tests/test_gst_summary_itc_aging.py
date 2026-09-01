"""The ITC-aging buckets inside gst_summary.

`gst_summary` was covered, but only with outward invoices — the aging loop
body runs only when an inward invoice with a date exists, so its contents were
never executed by the suite. A NameError sat in there undetected.
"""

from datetime import date
from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from billing.models import Business, Customer, Invoice, LineItem


class ItcAgingTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="aging", password="pw", is_superuser=True, is_staff=True
        )
        self.client.force_authenticate(user=self.user)
        self.business = Business.objects.create(
            name="LODHA JEWELLERS", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN"
        )
        self.supplier = Customer.objects.create(
            name="SUPPLIER LTD", gst_number="08SUPPL1234A1Z5", state_name="RAJASTHAN"
        )

    def _inward(self, number, invoice_date):
        invoice = Invoice.objects.create(
            business=self.business, customer=self.supplier,
            invoice_number=number, invoice_date=invoice_date,
            type_of_invoice="inward", total_amount=Decimal("10300"),
        )
        LineItem.objects.create(
            invoice=invoice, customer=self.supplier, product_name="GOLD",
            hsn_code="711319", gst_tax_rate=Decimal("0.03"),
            quantity=Decimal("1"), rate=Decimal("10000"),
            cgst=Decimal("150"), sgst=Decimal("150"), amount=Decimal("10300"),
        )
        return invoice

    def test_summary_runs_with_dated_inward_invoices(self):
        """Exercises the aging loop body — the path that was never executed."""
        self._inward("P1", date(2026, 5, 10))
        self._inward("P2", date(2023, 5, 10))  # long past its Sec 16(4) cutoff

        response = self.client.get("/api/invoices/gst_summary/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("itc_aging", response.data)

    def test_buckets_every_dated_inward_invoice(self):
        self._inward("P1", date(2026, 5, 10))
        self._inward("P2", date(2023, 5, 10))

        aging = self.client.get("/api/invoices/gst_summary/").data["itc_aging"]
        counted = sum(b["count"] for b in aging["buckets"].values())
        self.assertEqual(counted, 2)

    def test_an_invoice_past_its_cutoff_is_forfeit(self):
        """Sec 16(4): claimable until 30 Nov of the following FY."""
        self._inward("OLD", date(2020, 5, 10))

        aging = self.client.get("/api/invoices/gst_summary/").data["itc_aging"]
        self.assertEqual(aging["buckets"]["expired"]["count"], 1)
