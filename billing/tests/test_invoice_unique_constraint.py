"""DB-level guard: one outward number per business per financial year.

next_invoice_number is a read-then-write suggestion, so two counters saving at
the same moment can take the same number. The constraint turns that race from
silent duplicate data into an IntegrityError, which the API maps to a 409.
"""

from django.db import IntegrityError, transaction
from django.urls import reverse

from billing.constants import INVOICE_TYPE_INWARD, INVOICE_TYPE_OUTWARD
from billing.models import Customer, Invoice
from billing.tests.test_base import BaseAPITestCase


class OutwardNumberConstraintTest(BaseAPITestCase):
    def _mk(self, number, date, inv_type=INVOICE_TYPE_OUTWARD, customer=None):
        return Invoice.objects.create(
            workspace_id=1, business=self.business, customer=customer or self.customer,
            invoice_number=number, invoice_date=date,
            type_of_invoice=inv_type, total_amount=0,
        )

    def test_same_number_same_fy_is_rejected_by_the_db(self):
        self._mk("42", "2026-05-01")
        with self.assertRaises(IntegrityError), transaction.atomic():
            self._mk("42", "2026-11-30")          # same FY 2026-27

    def test_same_number_next_fy_is_fine(self):
        self._mk("42", "2026-05-01")               # FY 2026-27
        self._mk("42", "2027-04-01")               # FY 2027-28 — numbering restarts
        self.assertEqual(Invoice.objects.filter(invoice_number="42").count(), 2)

    def test_fy_boundary_march_vs_april(self):
        self._mk("7", "2026-03-31")                # FY 2025-26
        self._mk("7", "2026-04-01")                # FY 2026-27
        self.assertEqual(Invoice.objects.filter(invoice_number="7").count(), 2)

    def test_inward_bills_are_not_constrained(self):
        # Two suppliers both issuing "001" in the same year is ordinary.
        other = Customer.objects.create(workspace_id=1, name="OTHER SUPPLIER",
                                        gst_number="27AABCR1718E1ZP", state_name="MAHARASHTRA")
        other.businesses.add(self.business)
        self._mk("001", "2026-05-01", inv_type=INVOICE_TYPE_INWARD)
        self._mk("001", "2026-06-01", inv_type=INVOICE_TYPE_INWARD, customer=other)
        self.assertEqual(Invoice.objects.filter(invoice_number="001").count(), 2)

    def test_empty_numbers_are_exempt(self):
        self._mk("", "2026-05-01")
        self._mk("", "2026-06-01")                 # drafts/imports without numbers
        self.assertEqual(Invoice.objects.filter(invoice_number="").count(), 2)

    def test_api_race_maps_to_409_not_500(self):
        self._mk("RACE-9", "2026-05-01")
        resp = self.client.post(reverse("invoice-list"), {
            "business": self.business.id, "customer": self.customer.id,
            "invoice_number": "RACE-9", "invoice_date": "2026-08-01",
            "type_of_invoice": INVOICE_TYPE_OUTWARD,
            "line_items": [{"product_name": "Gold", "hsn_code": "711319",
                            "gst_tax_rate": "0.03", "quantity": "1", "rate": "100",
                            "cgst": "1.5", "sgst": "1.5", "igst": "0",
                            "amount": "103", "unit": "gms"}],
        }, format="json")
        self.assertEqual(resp.status_code, 409, resp.data)
        self.assertEqual(resp.data["error"], "duplicate_invoice_number")
