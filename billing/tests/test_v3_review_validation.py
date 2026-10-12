"""Review round: input words, no-op saves, and read-only legacy projections."""
from datetime import date, timedelta
from unittest.mock import patch

from django.test import TestCase
from rest_framework.exceptions import ValidationError

from billing.api.serializers import CustomerSerializer, InvoiceListSerializer, InwardBillListSerializer
from billing.credit import credit_month_choices, default_credit_month
from billing.models import AuditLog, Customer, Invoice
from billing.tests.v3_helpers import buyer, client_for, firm, person


class ReviewValidationTests(TestCase):
    def setUp(self):
        self.today = date(2026, 10, 8)
        self.owner = person("review-owner", "admin")
        self.client = client_for(self.owner)
        self.business = firm()
        self.supplier = buyer("Review supplier", gst_number="08AACFU5521R1ZN")
        self.payload = {"business": self.business.pk, "supplier": self.supplier.pk, "invoice_number": "REVIEW-1",
                        "invoice_date": "2026-09-04", "lines": [{"product_name": "Gold", "hsn_code": "7108",
                        "quantity": "2", "unit": "gms", "rate": "100", "gst_percent": "3"}]}

    def test_unknown_customer_role_is_a_plain_400(self):
        response = self.client.get("/api/customers/", {"role": "supplier"})
        self.assertEqual((response.status_code, response.data),
                         (400, {"role": ["Choose customers or suppliers for the role."]}))

    def test_future_date_helpers_use_contract_words_even_in_same_month(self):
        for helper in (default_credit_month, credit_month_choices):
            for future in (self.today + timedelta(days=1), date(2026, 11, 1)):
                with self.subTest(helper=helper.__name__, future=future), self.assertRaises(ValidationError) as refused:
                    helper(self.business.pk, future, today=self.today)
                self.assertEqual(refused.exception.detail, {"invoice_date": [
                    "That's after today (08 Oct 2026). Check the date on the bill."]})

    def test_legacy_lists_and_customer_mark_are_read_only(self):
        fields = ("itc_month", "itc_eligible", "needs_review", "buyer_gstin", "source", "linked_sale")
        for serializer in (InvoiceListSerializer(), InwardBillListSerializer()):
            for field in fields:
                self.assertTrue(serializer.fields[field].read_only, f"{serializer.__class__.__name__}.{field}")
        self.assertTrue(CustomerSerializer().fields["is_supplier"].read_only)

    def test_noop_survives_changed_supplier_and_firm_gstins_but_edits_are_validated(self):
        with patch("billing.services.purchases.timezone.localdate", return_value=self.today):
            self.payload["buyer_gstin"] = self.business.gst_number
            response = self.client.post("/api/purchases/", self.payload, format="json")
            self.assertEqual(response.status_code, 201, response.data)
            bill = Invoice.objects.get(pk=response.data["id"])
            original = list(bill.lineitem_set.values())
            logs = AuditLog.objects.count()
            for gstin in ("bad", ""):
                Customer.objects.filter(pk=self.supplier.pk).update(gst_number=gstin)
                response = self.client.put(f"/api/purchases/{bill.pk}/", self.payload, format="json")
                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual(list(bill.lineitem_set.values()), original)
                self.assertEqual(AuditLog.objects.count(), logs)
                edited = self.client.put(f"/api/purchases/{bill.pk}/", {**self.payload, "payment_mode": "cash"}, format="json")
                self.assertEqual(edited.status_code, 400, edited.data)
            Customer.objects.filter(pk=self.supplier.pk).update(gst_number="08AACFU5521R1ZN")
            self.business.gst_number = "27ABCDE1234A1Z5"
            self.business.save(update_fields=["gst_number"])
            response = self.client.put(f"/api/purchases/{bill.pk}/", self.payload, format="json")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(AuditLog.objects.count(), logs)
            edited = self.client.put(f"/api/purchases/{bill.pk}/", {**self.payload, "payment_mode": "cash"}, format="json")
            self.assertEqual(edited.status_code, 400, edited.data)

    def test_amount_only_note_is_the_contract_marker(self):
        response = self.client.post("/api/purchases/", {**self.payload, "lines": [{"product_name": "Gold",
            "gst_percent": "3", "amount_only": True, "taxable": "100", "note": "A user note"}]}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["lines"][0]["note"], "Amount only")
        self.assertTrue(response.data["first_line"]["amount_only"])
