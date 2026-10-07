"""The /line-items/ API keeps the rules the invoice paths keep (H5, M14).

The SPA doesn't call this endpoint, but any editor can, and it wrote whatever
it was sent.
"""

from decimal import Decimal as D

from django.db import connection
from django.test.utils import CaptureQueriesContext
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


class LineItemBuilderRulesTest(BaseAPITestCase):
    """M14: /line-items/ writes skipped the builder, so IGST on an intra-state
    invoice and a raw rate of "3" were stored as sent; nowhere was tax
    compared with the rate, and moving an invoice to another party left its
    heads where they were."""

    def setUp(self):
        super().setUp()
        # The base business and customer share state code 22: intra-state.
        self.mumbai = Customer.objects.create(name="MUMBAI BUYER", gst_number="27ABCDE1234A1Z5", state_name="MAHARASHTRA")

    def _post(self, **over):
        data = {"invoice": self.invoice.id, "product_name": "Gold", "hsn_code": "711319", "quantity": "10",
                "rate": "1000", "gst_tax_rate": "0.03", "cgst": "150", "sgst": "150", "igst": "0", "amount": "10300"}
        data.update(over)
        return self.client.post(reverse("lineitem-list"), data, format="json")

    def test_igst_on_an_intra_state_invoice_is_refiled(self):
        r = self._post(cgst="0", sgst="0", igst="300")
        self.assertEqual(r.status_code, 201, r.data)
        li = LineItem.objects.get(id=r.data["id"])
        self.assertEqual((li.cgst, li.sgst, li.igst), (D("150"), D("150"), D("0")))

    def test_a_rate_sent_as_a_percent_is_stored_as_a_fraction(self):
        r = self._post(gst_tax_rate="3")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(LineItem.objects.get(id=r.data["id"]).gst_tax_rate, D("0.03"))

    def test_tax_that_is_not_the_rate_is_refused(self):
        r = self._post(quantity="100", rate="1000", cgst="0", sgst="0", igst="0", amount="100000")
        self.assertEqual(r.status_code, 400, r.data)
        self.assertFalse(LineItem.objects.filter(amount=D("100000")).exists())

    def test_a_patch_that_changes_the_rate_without_the_tax_is_refused(self):
        r = self.client.patch(reverse("lineitem-detail", args=[self.line_item.id]), {"gst_tax_rate": "0.03"}, format="json")
        self.assertEqual(r.status_code, 400, r.data)

    def test_an_invoice_create_with_untaxed_three_percent_lines_is_refused(self):
        r = self.client.post(reverse("invoice-list"), {
            "business": self.business.id, "customer": self.customer.id, "invoice_number": "M14-1",
            "invoice_date": "2026-08-05", "type_of_invoice": "outward",
            "line_items": [{"product_name": "Gold", "hsn_code": "711319", "gst_tax_rate": "0.03", "quantity": "100",
                            "rate": "1000", "unit": "gms", "cgst": "0", "sgst": "0", "igst": "0", "amount": "100000"}],
        }, format="json")
        self.assertEqual(r.status_code, 400, r.data)
        self.assertFalse(Invoice.objects.filter(invoice_number="M14-1").exists())

    def test_moving_an_invoice_to_an_out_of_state_party_refiles_its_heads(self):
        r = self.client.patch(reverse("invoice-detail", args=[self.invoice.id]), {"customer": self.mumbai.id}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.line_item.refresh_from_db()
        self.assertEqual((self.line_item.cgst, self.line_item.sgst, self.line_item.igst), (D("0"), D("0"), D("180")))
        self.assertEqual(self.line_item.amount, D("1180"))
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.total_amount, D("1180"))

    def test_a_save_outside_the_api_refiles_too(self):
        # Django admin and undo save the header without the API's help.
        inv = Invoice.objects.get(pk=self.invoice.pk)
        inv.customer = self.mumbai
        inv.save()
        self.line_item.refresh_from_db()
        self.assertEqual(self.line_item.igst, D("180"))


class PartiesSentAsStringsTest(BaseAPITestCase):
    """The SPA sends an edit's parties as strings ("5"). Compared with the ints
    the invoice was loaded with, every edit looked like a move, so each line
    was saved once more and the total re-summed after each: 18 queries became
    61 on a 10-line edit (review of M14/H6)."""

    def _lines(self, n):
        return [{"product_name": f"Gold {i}", "hsn_code": "711319", "gst_tax_rate": "0.03", "quantity": "1",
                 "rate": "1000", "unit": "gms", "cgst": "15", "sgst": "15", "igst": "0", "amount": "1030"}
                for i in range(n)]

    def _edit(self, parties, n=10):
        return self.client.post(reverse("invoice-update-line-items", args=[self.invoice.id]),
                                {"invoice": parties, "line_items": self._lines(n)}, format="json")

    @staticmethod
    def _line_updates(ctx):
        return [q["sql"] for q in ctx.captured_queries if q["sql"].startswith('UPDATE "billing_lineitem"')]

    def test_an_edit_that_keeps_its_parties_saves_no_line_again(self):
        with CaptureQueriesContext(connection) as ctx:
            r = self._edit({"customer": str(self.customer.id), "business": str(self.business.id)})
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(self._line_updates(ctx), [])
        self.assertEqual(LineItem.objects.filter(invoice=self.invoice).count(), 10)

    def test_a_party_that_is_not_an_id_is_a_400(self):
        for bad in ("abc", "999999"):
            with self.subTest(customer=bad):
                r = self._edit({"customer": bad}, n=1)
                self.assertEqual(r.status_code, 400, getattr(r, "data", None))
                self.invoice.refresh_from_db()
                self.assertEqual(self.invoice.customer_id, self.customer.id)

    def test_a_save_with_the_same_parties_as_strings_is_not_a_move(self):
        inv = Invoice.objects.get(pk=self.invoice.pk)
        inv.customer_id, inv.business_id = str(inv.customer_id), str(inv.business_id)
        with CaptureQueriesContext(connection) as ctx:
            inv.save()
        self.assertEqual(self._line_updates(ctx), [])
