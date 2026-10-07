"""The /line-items/ API keeps the rules the invoice paths keep (H5, M14).

The SPA doesn't call this endpoint, but any editor can, and it wrote whatever
it was sent.
"""

from decimal import Decimal as D

from django.urls import reverse

from billing.models import Customer, FiledPeriod, Invoice, LineItem
from billing.tests.test_base import BaseAPITestCase


class LineItemMoveTest(BaseAPITestCase):
    """H5: PATCH {"invoice": <a filed July invoice>} was a 200. The filed July
    total doubled, the source invoice kept a stale total, and the lock had only
    looked at the source."""

    def setUp(self):
        super().setUp()
        self.july = Invoice.objects.create(
            business=self.business, customer=self.customer, invoice_number="JUL-1",
            invoice_date="2026-07-15", type_of_invoice="outward")
        LineItem.objects.create(
            invoice=self.july, customer=self.customer, product_name="Silver", hsn_code="711311",
            gst_tax_rate=D("0.03"), quantity=D("1"), rate=D("1000"), cgst=D("15"), sgst=D("15"),
            igst=0, amount=D("1030"))
        FiledPeriod.objects.create(business=self.business, year=2026, month=7)
        self.other = Customer.objects.create(name="Someone Else", state_name="MAHARASHTRA")

    def test_a_line_cannot_move_into_a_filed_invoice(self):
        r = self.client.patch(reverse("lineitem-detail", args=[self.line_item.id]),
                              {"invoice": self.july.id}, format="json")
        self.assertEqual(r.status_code, 400, r.data)
        self.line_item.refresh_from_db()
        self.assertEqual(self.line_item.invoice_id, self.invoice.id)
        self.july.refresh_from_db()
        self.assertEqual(self.july.total_amount, D("1030"))
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.total_amount, D("1180"))

    def test_a_line_cannot_move_into_an_open_invoice_either(self):
        aug = Invoice.objects.create(business=self.business, customer=self.customer, invoice_number="AUG-1",
                                     invoice_date="2026-08-15", type_of_invoice="outward")
        r = self.client.patch(reverse("lineitem-detail", args=[self.line_item.id]),
                              {"invoice": aug.id}, format="json")
        self.assertEqual(r.status_code, 400, r.data)
        self.line_item.refresh_from_db()
        self.assertEqual(self.line_item.invoice_id, self.invoice.id)

    def test_resending_its_own_invoice_is_fine(self):
        r = self.client.patch(reverse("lineitem-detail", args=[self.line_item.id]),
                              {"invoice": self.invoice.id, "product_name": "Renamed"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)

    def test_the_customer_is_always_the_invoices(self):
        r = self.client.patch(reverse("lineitem-detail", args=[self.line_item.id]),
                              {"customer": self.other.id}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.line_item.refresh_from_db()
        self.assertEqual(self.line_item.customer_id, self.customer.id)

    def test_a_new_line_takes_its_invoices_customer(self):
        r = self.client.post(reverse("lineitem-list"), {
            "invoice": self.invoice.id, "customer": self.other.id, "product_name": "Gold", "hsn_code": "711319",
            "quantity": "1", "rate": "1000", "gst_tax_rate": "0.18", "cgst": "90", "sgst": "90", "igst": "0",
            "amount": "1180",
        }, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(LineItem.objects.get(id=r.data["id"]).customer_id, self.customer.id)
