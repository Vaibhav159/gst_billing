"""AI invoice create and the inter-firm mirror (audit F5.3)."""

from decimal import Decimal

from django.contrib.auth.models import Group, User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from billing.constants import INVOICE_TYPE_INWARD
from billing.models import Business, Customer, Invoice


def _client_as(role):
    user = User.objects.create_user(username=f"{role}_ai", password="pw")
    user.groups.add(Group.objects.get_or_create(name=role)[0])
    client = APIClient()
    client.force_authenticate(user=user)
    return client


class AICreateTests(TestCase):
    def setUp(self):
        self.seller = Business.objects.create(name="LODHA JEWELLERS", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN")
        self.client = _client_as("editor")

    def _payload(self, **over):
        data = {
            "business_id": self.seller.id,
            "type_of_invoice": "outward",
            "invoice_data": {
                "customer_name": "MUMBAI BUYER",
                "customer_gst_number": "27ABCDE1234A1Z5",
                "invoice_number": "AI-1",
                "invoice_date": "2026-05-10",
                "line_items": [
                    {"product_name": "Silver", "hsn_code": "711311", "quantity": 2, "rate": 5000, "gst_tax_rate": 0.03},
                ],
            },
        }
        data.update(over)
        return data

    def _post(self, **over):
        r = self.client.post(reverse("ai-invoice-create"), self._payload(**over), format="json")
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        return r.data

    def test_creates_the_invoice_with_heads_by_direction_and_the_customer_from_the_scan(self):
        data = self._post()
        inv = Invoice.objects.get(id=data["invoice_id"])
        self.assertEqual(inv.invoice_number, "AI-1")
        self.assertEqual(inv.customer.gst_number, "27ABCDE1234A1Z5")
        li = inv.lineitem_set.get()
        self.assertEqual((li.cgst, li.sgst, li.igst), (Decimal("0"), Decimal("0"), Decimal("300")))
        self.assertEqual(inv.total_amount, Decimal("10300"))
        self.assertEqual(data["line_items_created"], 1)

    def test_rate_from_the_model_goes_through_the_allowlist(self):
        """The model returns 3 as often as 0.03; unnormalised that billed 300%."""
        data = self._post(invoice_data={**self._payload()["invoice_data"], "invoice_number": "AI-2",
                                        "line_items": [{"product_name": "Diamond", "quantity": 1, "rate": 100000, "gst_tax_rate": 0.25}]})
        li = Invoice.objects.get(id=data["invoice_id"]).lineitem_set.get()
        self.assertEqual(li.gst_tax_rate, Decimal("0.0025"))
        self.assertEqual(li.igst, Decimal("250"))

    def test_an_inward_line_read_at_0_books_no_itc(self):
        """C1, the AI Import door: Gemini answers 0 when the bill prints no
        per-line rate, and the default turned that into 3% input credit."""
        data = self._post(type_of_invoice="inward", invoice_data={
            **self._payload()["invoice_data"], "invoice_number": "AI-IN-0",
            "line_items": [{"product_name": "Making Charges", "hsn_code": "998892", "quantity": 1, "rate": 1500, "gst_tax_rate": 0}],
        })
        li = Invoice.objects.get(id=data["invoice_id"]).lineitem_set.get()
        self.assertEqual((li.gst_tax_rate, li.cgst + li.sgst + li.igst), (Decimal("0"), Decimal("0")))

    def _supplier(self, name, gstin):
        sup = Customer.objects.create(name=name, gst_number=gstin)
        sup.businesses.add(self.seller)
        return sup

    def _purchase(self, number, supplier, gstin_on_bill, rate):
        return self.client.post(reverse("ai-invoice-create"), self._payload(
            type_of_invoice="inward",
            invoice_data={"customer_name": supplier, "customer_gst_number": gstin_on_bill,
                          "invoice_number": number, "invoice_date": "2026-05-10",
                          "line_items": [{"product_name": "Gold Ornaments", "hsn_code": "711319",
                                          "quantity": 1, "rate": 10000, "gst_tax_rate": rate}]},
        ), format="json")

    def test_gst_on_a_purchase_from_a_supplier_without_a_gstin_is_refused(self):
        """C1b on the AI Import door: no GSTIN on the bill or on file, no ITC."""
        self._supplier("LOCAL KARIGAR", None)
        for i, gstin in enumerate(["", "URP", "NA"]):
            with self.subTest(gstin=gstin):
                r = self._purchase(f"AI-U-{i}", "LOCAL KARIGAR", gstin, 0.03)
                self.assertEqual(r.status_code, 400, getattr(r, "data", None))
                self.assertIn("Line 1", r.data["error"])
                self.assertIn("GSTIN", r.data["error"])
        self.assertFalse(Invoice.objects.filter(invoice_number__startswith="AI-U-").exists())
        r = self._purchase("AI-U-ZERO", "LOCAL KARIGAR", "URP", 0)
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertIn(Customer.objects.get(name="LOCAL KARIGAR").gst_number, (None, ""), "URP is not a GSTIN")

    def test_a_registered_supplier_on_file_keeps_its_itc_when_the_scan_missed_the_gstin(self):
        self._supplier("SURAT DIAMOND EXCHANGE", "24AABCS1234A1Z5")
        r = self._purchase("AI-R-1", "SURAT DIAMOND EXCHANGE", "", 0.03)
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        li = Invoice.objects.get(invoice_number="AI-R-1").lineitem_set.get()
        self.assertEqual(li.igst, Decimal("300"))

    def test_re_uploading_the_same_bill_returns_the_existing_invoice(self):
        first = self._post()
        second = self._post()
        self.assertEqual(first["invoice_id"], second["invoice_id"])
        self.assertEqual(Invoice.objects.filter(invoice_number="AI-1").count(), 1)

    def test_inter_firm_upload_writes_the_buyer_s_inward_mirror(self):
        buyer = Business.objects.create(name="LODHA MUMBAI", gst_number="27ABCDE1234A1Z5", state_name="MAHARASHTRA")
        data = self._post(inter_firm=True, inter_firm_buyer_business_id=buyer.id)
        self.assertIsNotNone(data["inward_invoice_id"])
        self.assertFalse(data["inward_duplicate"])
        mirror = Invoice.objects.get(id=data["inward_invoice_id"])
        self.assertEqual(mirror.business, buyer)
        self.assertEqual(mirror.type_of_invoice, INVOICE_TYPE_INWARD)
        self.assertEqual(mirror.invoice_number, "AI-1")
        self.assertEqual(mirror.total_amount, Decimal("10300"))
        self.assertEqual(mirror.lineitem_set.count(), 1)
        # The supplier on the mirror is the seller firm, matched by GSTIN.
        self.assertEqual(mirror.customer.gst_number, self.seller.gst_number)
        self.assertEqual(Customer.objects.filter(gst_number=self.seller.gst_number).count(), 1)

    def test_re_uploading_an_inter_firm_bill_does_not_duplicate_the_mirror(self):
        buyer = Business.objects.create(name="LODHA MUMBAI", gst_number="27ABCDE1234A1Z5", state_name="MAHARASHTRA")
        first = self._post(inter_firm=True, inter_firm_buyer_business_id=buyer.id)
        second = self._post(inter_firm=True, inter_firm_buyer_business_id=buyer.id)
        self.assertEqual(first["inward_invoice_id"], second["inward_invoice_id"])
        self.assertTrue(second["inward_duplicate"])
        self.assertEqual(Invoice.objects.filter(business=buyer).count(), 1)

    def test_missing_fields_are_a_400_not_a_500(self):
        r = self.client.post(reverse("ai-invoice-create"), {"business_id": self.seller.id}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_viewer_cannot_create(self):
        r = _client_as("viewer").post(reverse("ai-invoice-create"), self._payload(), format="json")
        self.assertEqual(r.status_code, 403)
