"""The tax split must be decided by the server, not by whatever the browser sent.

An interstate sale saved as CGST+SGST still shows the right grand total, so
nothing on screen looks wrong — but GSTR-1 and GSTR-3B report the wrong heads
and the buyer's ITC won't reconcile. These tests post a deliberately wrong
split and assert the server re-files it.
"""

from decimal import Decimal as D

from django.urls import reverse

from billing.constants import INVOICE_TYPE_OUTWARD
from billing.models import Business, Customer, Invoice, LineItem
from billing.tax_rules import is_interstate, normalize_tax_heads
from billing.tests.test_base import BaseAPITestCase


class IsInterstateTest(BaseAPITestCase):
    def _pair(self, b_gstin, b_state, c_gstin, c_state):
        b = Business(gst_number=b_gstin, state_name=b_state)
        c = Customer(gst_number=c_gstin, state_name=c_state)
        return is_interstate(b, c)

    def test_gstin_state_codes_decide_when_both_present(self):
        self.assertTrue(self._pair("08AAGPL3375F1ZO", "RAJASTHAN", "27AABCR1718E1ZP", "MAHARASHTRA"))
        self.assertFalse(self._pair("08AAGPL3375F1ZO", "RAJASTHAN", "08AAECD1234K1Z2", "RAJASTHAN"))

    def test_falls_back_to_state_name_for_unregistered_customer(self):
        # B2C interstate: no customer GSTIN. The GSTIN-only check used to call
        # this intra-state and book CGST+SGST on an interstate sale.
        self.assertTrue(self._pair("08AAGPL3375F1ZO", "RAJASTHAN", "", "MAHARASHTRA"))
        self.assertFalse(self._pair("08AAGPL3375F1ZO", "RAJASTHAN", "", "RAJASTHAN"))

    def test_unknown_on_both_counts_defaults_to_intra(self):
        self.assertFalse(self._pair("", "", "", ""))

    def test_gstin_wins_over_a_stale_state_name(self):
        self.assertFalse(self._pair("08AAGPL3375F1ZO", "RAJASTHAN", "08AAECD1234K1Z2", "GUJARAT"))


class NormalizeTaxHeadsTest(BaseAPITestCase):
    def test_interstate_moves_everything_to_igst_keeping_the_total(self):
        self.assertEqual(normalize_tax_heads(D("50"), D("50"), D("0"), True), (D("0"), D("0"), D("100")))

    def test_intra_splits_evenly_keeping_the_total(self):
        self.assertEqual(normalize_tax_heads(D("0"), D("0"), D("100"), False), (D("50"), D("50"), D("0")))

    def test_already_correct_input_is_unchanged(self):
        self.assertEqual(normalize_tax_heads(D("15"), D("15"), D("0"), False), (D("15"), D("15"), D("0")))


class InvoiceWriteTaxHeadsTest(BaseAPITestCase):
    """POST /api/invoices/ and update_line_items with a wrong split."""

    def setUp(self):
        super().setUp()
        self.out_of_state = Customer.objects.create(
            workspace_id=1, name="ACME SILVER MUMBAI",
            gst_number="27AABCR1718E1ZP", state_name="MAHARASHTRA",
        )
        self.out_of_state.businesses.add(self.business)

    def _payload(self, customer, cgst, sgst, igst):
        return {
            "business": self.business.id,
            "customer": customer.id,
            "invoice_number": "TAXHEAD-1",
            "invoice_date": "2026-08-05",
            "type_of_invoice": INVOICE_TYPE_OUTWARD,
            "line_items": [{
                "product_name": "Gold", "hsn_code": "711319", "gst_tax_rate": "0.03",
                "quantity": "10", "rate": "1000", "unit": "gms",
                "cgst": cgst, "sgst": sgst, "igst": igst, "amount": "10300",
            }],
        }

    def test_interstate_invoice_sent_as_cgst_sgst_is_stored_as_igst(self):
        # The browser bug: state comparison silently failed, so it sent a
        # CGST+SGST split for a Rajasthan → Maharashtra sale.
        resp = self.client.post(
            reverse("invoice-list"),
            self._payload(self.out_of_state, "150", "150", "0"),
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        li = LineItem.objects.get(invoice_id=resp.data["id"])
        self.assertEqual(li.igst, D("300.000"))
        self.assertEqual(li.cgst, D("0.000"))
        self.assertEqual(li.sgst, D("0.000"))
        self.assertEqual(li.amount, D("10300.000"))  # total the user saw is preserved

    def test_intra_invoice_sent_as_igst_is_stored_as_cgst_sgst(self):
        resp = self.client.post(
            reverse("invoice-list"),
            self._payload(self.customer, "0", "0", "300"),
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        li = LineItem.objects.get(invoice_id=resp.data["id"])
        self.assertEqual(li.cgst, D("150.000"))
        self.assertEqual(li.sgst, D("150.000"))
        self.assertEqual(li.igst, D("0.000"))

    def test_update_line_items_also_refiles_the_heads(self):
        inv = Invoice.objects.create(
            workspace_id=1, business=self.business, customer=self.out_of_state,
            invoice_number="TAXHEAD-2", invoice_date="2026-08-05",
            type_of_invoice=INVOICE_TYPE_OUTWARD, total_amount=0,
        )
        resp = self.client.post(
            reverse("invoice-update-line-items", args=[inv.id]),
            {"line_items": [{
                "product_name": "Gold", "hsn_code": "711319", "gst_tax_rate": "0.03",
                "quantity": "5", "rate": "1000", "unit": "gms",
                "cgst": "75", "sgst": "75", "igst": "0", "amount": "5150",
            }]},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        li = LineItem.objects.get(invoice=inv)
        self.assertEqual(li.igst, D("150.000"))
        self.assertEqual(li.cgst, D("0.000"))

    def test_invoice_total_is_unaffected_by_refiling(self):
        resp = self.client.post(
            reverse("invoice-list"),
            self._payload(self.out_of_state, "150", "150", "0"),
            format="json",
        )
        inv = Invoice.objects.get(id=resp.data["id"])
        self.assertEqual(inv.total_amount, D("10300.000"))


class DefaultRoleTest(BaseAPITestCase):
    """An account nobody put in a group must be read-only, not an editor."""

    def test_ungrouped_user_cannot_write(self):
        from django.contrib.auth.models import User
        from rest_framework.test import APIClient
        u = User.objects.create_user(username="ungrouped", password="x")
        c = APIClient()
        c.force_authenticate(user=u)
        self.assertEqual(c.get(reverse("invoice-list")).status_code, 200)
        resp = c.post(reverse("invoice-list"), {
            "business": self.business.id, "customer": self.customer.id,
            "invoice_number": "NOPE-1", "invoice_date": "2026-08-01",
            "type_of_invoice": INVOICE_TYPE_OUTWARD,
        }, format="json")
        self.assertEqual(resp.status_code, 403)
