"""Tests for the Inward Bills module."""

import json
from decimal import Decimal as D
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings
from django.urls import reverse

from billing.api.inward_bills_service import (
    compute_lines,
    gstin_matches,
    resolve_tax,
)
from billing.constants import INVOICE_TYPE_INWARD, INVOICE_TYPE_OUTWARD
from billing.models import Customer, Invoice, LineItem
from billing.tests.test_base import BaseAPITestCase


class InwardBillsServiceTest(SimpleTestCase):
    """Pure tax + validation helpers (no DB)."""

    def test_resolve_tax_intra(self):
        self.assertEqual(
            resolve_tax(D("468544"), D("0.03"), intra=True),
            (D("7028.16"), D("7028.16"), D("0")),
        )

    def test_resolve_tax_inter(self):
        self.assertEqual(
            resolve_tax(D("76889.09"), D("0.03"), intra=False),
            (D("0"), D("0"), D("2306.67")),
        )

    def test_compute_lines_intra_amounts(self):
        lines = [{"taxable": D("3883.5"), "rate": D("0.03")}]
        out, total = compute_lines(lines, intra=True)
        self.assertEqual(out[0]["cgst"], D("58.25"))
        self.assertEqual(out[0]["sgst"], D("58.25"))
        self.assertEqual(out[0]["amount"], D("4000.00"))
        self.assertEqual(total, D("4000.00"))

    def test_compute_lines_absorbs_roundoff_to_bill_total(self):
        # printed total 31533.00; natural sum 31533.24 -> last line absorbs -0.24
        lines = [
            {"taxable": D("5368.80"), "rate": D("0.03")},
            {"taxable": D("25246.00"), "rate": D("0.03")},
        ]
        out, total = compute_lines(lines, intra=True, bill_total=D("31533.00"))
        self.assertEqual(total, D("31533.00"))
        self.assertEqual(sum(l["amount"] for l in out), D("31533.00"))
        self.assertEqual(out[0]["cgst"], D("80.53"))
        self.assertEqual(out[1]["cgst"], D("378.69"))
        self.assertEqual(out[1]["amount"], D("26003.14"))

    def test_compute_lines_inter_sets_igst_only(self):
        lines = [{"taxable": D("76889.09"), "rate": D("0.03")}]
        out, _ = compute_lines(lines, intra=False)
        self.assertEqual(out[0]["igst"], D("2306.67"))
        self.assertEqual(out[0]["cgst"], D("0"))
        self.assertEqual(out[0]["sgst"], D("0"))

    def test_gstin_matches(self):
        self.assertTrue(gstin_matches("08AAGPL3375F1ZO", "08AAGPL3375F1ZO"))
        self.assertTrue(gstin_matches("08aagpl3375f1zo", "08AAGPL3375F1ZO"))
        self.assertFalse(gstin_matches("", "08AAGPL3375F1ZO"))  # B2C / unregistered
        self.assertFalse(gstin_matches(None, "08AAGPL3375F1ZO"))
        self.assertFalse(gstin_matches("27AABCR1718E1ZP", "08AAGPL3375F1ZO"))


class InwardBillAPITest(BaseAPITestCase):
    """List / detail / extract / create endpoints."""

    def _make_inward(self, number="P-1", supplier=None):
        supplier = supplier or self.customer
        inv = Invoice.objects.create(
            workspace_id=1, business=self.business, customer=supplier,
            invoice_number=number, invoice_date="2026-05-01",
            type_of_invoice=INVOICE_TYPE_INWARD, total_amount=0,
        )
        LineItem.objects.create(
            workspace_id=1, customer=supplier, invoice=inv, product_name="Silver",
            hsn_code="711319", gst_tax_rate="0.03", quantity="10", rate="100",
            cgst="15", sgst="15", igst="0", amount="1030", unit="gms",
        )
        inv.refresh_from_db()
        return inv

    def test_list_returns_only_inward(self):
        self._make_inward(number="P-1")
        Invoice.objects.create(
            workspace_id=1, business=self.business, customer=self.customer,
            invoice_number="S-1", invoice_date="2026-05-02",
            type_of_invoice=INVOICE_TYPE_OUTWARD, total_amount=0,
        )
        resp = self.client.get(reverse("inward-bill-list"))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["count"], 1)
        self.assertEqual(resp.data["results"][0]["invoice_number"], "P-1")
        self.assertEqual(resp.data["results"][0]["supplier"]["name"], self.customer.name)

    def test_list_filters(self):
        self._make_inward(number="P-1")
        self.assertEqual(self.client.get(reverse("inward-bill-list"), {"business": 999999}).data["count"], 0)
        self.assertEqual(self.client.get(reverse("inward-bill-list"), {"business": self.business.id}).data["count"], 1)
        self.assertEqual(self.client.get(reverse("inward-bill-list"), {"q": self.customer.name[:4]}).data["count"], 1)
        self.assertEqual(self.client.get(reverse("inward-bill-list"), {"q": "zzzznomatch"}).data["count"], 0)

    def test_detail_has_line_items_and_file_field(self):
        inv = self._make_inward(number="P-9")
        resp = self.client.get(reverse("inward-bill-detail", args=[inv.id]))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data["line_items"]), 1)
        self.assertIn("source_file_url", resp.data)

    def test_extract_maps_supplier_and_tax_type(self):
        fake = {
            "buyer_gst_number": self.business.gst_number, "buyer_name": "Us",
            "seller_gst_number": "27AABCR1718E1ZP", "seller_name": "ACME SUPPLIES",
            "invoice_number": "AC-1", "invoice_date": "2026-05-01",
            "customer_name": "", "customer_gst_number": "",
            "line_items": [{"product_name": "Gold", "quantity": 5, "rate": 100,
                            "hsn_code": "7108", "gst_tax_rate": 0.03, "amount": 500}],
        }
        f = SimpleUploadedFile("b.jpg", b"x", content_type="image/jpeg")
        with patch("billing.api.inward_bills.AIInvoiceProcessor.process_invoice_image", return_value=fake):
            resp = self.client.post(reverse("inward-bill-extract"),
                                    {"file": f, "business_id": self.business.id})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["supplier"]["gstin"], "27AABCR1718E1ZP")
        self.assertEqual(resp.data["supplier"]["name"], "ACME SUPPLIES")
        self.assertEqual(resp.data["tax_type"], "igst")  # 27 != 22
        self.assertFalse(resp.data["warnings"]["gstin_mismatch"])
        self.assertEqual(len(resp.data["line_items"]), 1)

    @override_settings(GEMINI_API_KEYS="", GEMINI_API_KEY="")
    def test_extract_works_without_api_keys_configured(self):
        # Regression guard: the processor must be constructible without keys so
        # that patching process_invoice_image is enough to test this view. When
        # the key check lived in __init__, these tests passed only on machines
        # with keys in .env and failed in CI.
        fake = {
            "buyer_gst_number": self.business.gst_number,
            "seller_gst_number": "27AABCR1718E1ZP", "seller_name": "ACME SUPPLIES",
            "invoice_number": "AC-2", "invoice_date": "2026-05-01", "line_items": [],
        }
        f = SimpleUploadedFile("b.jpg", b"x", content_type="image/jpeg")
        with patch("billing.api.inward_bills.AIInvoiceProcessor.process_invoice_image", return_value=fake):
            resp = self.client.post(reverse("inward-bill-extract"),
                                    {"file": f, "business_id": self.business.id})
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data["warnings"]["extraction_failed"])
        self.assertEqual(resp.data["supplier"]["gstin"], "27AABCR1718E1ZP")

    def test_extract_flags_gstin_mismatch(self):
        fake = {
            "buyer_gst_number": "99ZZZZZ0000Z1Z9",  # not our firm
            "seller_gst_number": "22XXXXX0000X1Z5", "seller_name": "S",
            "invoice_number": "M-1", "invoice_date": "2026-05-01", "line_items": [],
        }
        f = SimpleUploadedFile("b.jpg", b"x", content_type="image/jpeg")
        with patch("billing.api.inward_bills.AIInvoiceProcessor.process_invoice_image", return_value=fake):
            resp = self.client.post(reverse("inward-bill-extract"),
                                    {"file": f, "business_id": self.business.id})
        self.assertTrue(resp.data["warnings"]["gstin_mismatch"])
        self.assertEqual(resp.data["tax_type"], "cgst_sgst")  # 22 == 22

    def test_extract_missing_buyer_gstin_does_not_false_flag(self):
        # AI failed to read the buyer GSTIN -> we must NOT flag a mismatch
        # (would false-positive on clean bills addressed to the firm).
        fake = {
            "buyer_gst_number": "", "seller_gst_number": "27AABCR1718E1ZP",
            "seller_name": "ACME", "invoice_number": "AC-9",
            "invoice_date": "2026-05-01", "customer_name": "", "customer_gst_number": "",
            "line_items": [],
        }
        f = SimpleUploadedFile("b.jpg", b"x", content_type="image/jpeg")
        with patch("billing.api.inward_bills.AIInvoiceProcessor.process_invoice_image", return_value=fake):
            resp = self.client.post(reverse("inward-bill-extract"),
                                    {"file": f, "business_id": self.business.id})
        self.assertFalse(resp.data["warnings"]["gstin_mismatch"])

    def test_extract_pdf_falls_back_to_manual(self):
        f = SimpleUploadedFile("b.pdf", b"%PDF-1.4", content_type="application/pdf")
        resp = self.client.post(reverse("inward-bill-extract"),
                                {"file": f, "business_id": self.business.id})
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data["warnings"]["extraction_failed"])

    def test_create_intra_tax_file_and_supplier(self):
        f = SimpleUploadedFile("b.jpg", b"\xff\xd8\xffdata", content_type="image/jpeg")
        resp = self.client.post(reverse("inward-bill-list"), {
            "business_id": self.business.id,
            "supplier_name": "NEW SUPPLIER", "supplier_gstin": "22ZZZZZ0000Z1Z5",
            "invoice_number": "N-1", "invoice_date": "2026-05-05",
            "lines": json.dumps([{"product_name": "Silver", "hsn_code": "711319",
                                  "quantity": "20", "rate": "194.175", "gst_tax_rate": "0.03", "unit": "gms"}]),
            "bill_total": "4000.00", "file": f,
        })
        self.assertEqual(resp.status_code, 201, resp.data)
        inv = Invoice.objects.get(invoice_number="N-1", type_of_invoice=INVOICE_TYPE_INWARD)
        li = inv.lineitem_set.get()
        self.assertEqual(li.cgst, D("58.25"))
        self.assertEqual(li.sgst, D("58.25"))
        self.assertEqual(li.igst, D("0"))
        self.assertEqual(inv.total_amount, D("4000.00"))
        self.assertTrue(bool(inv.source_file))
        supplier = Customer.objects.get(gst_number="22ZZZZZ0000Z1Z5")
        self.assertIn(self.business, list(supplier.businesses.all()))

    def test_create_inter_state_sets_igst(self):
        f = SimpleUploadedFile("b.jpg", b"data", content_type="image/jpeg")
        resp = self.client.post(reverse("inward-bill-list"), {
            "business_id": self.business.id,
            "supplier_name": "MH SUP", "supplier_gstin": "27AABCR1718E1ZP",
            "invoice_number": "N-2", "invoice_date": "2026-05-05",
            "lines": json.dumps([{"product_name": "Gold", "hsn_code": "7108",
                                  "quantity": "2", "rate": "15085.815", "gst_tax_rate": "0.03", "unit": "gms"}]),
            "file": f,
        })
        self.assertEqual(resp.status_code, 201, resp.data)
        li = Invoice.objects.get(invoice_number="N-2").lineitem_set.get()
        self.assertEqual(li.igst, D("905.15"))
        self.assertEqual(li.cgst, D("0"))
        self.assertEqual(li.sgst, D("0"))

    def test_create_duplicate_409_then_override(self):
        self._make_inward(number="DUP-1")
        base = {
            "business_id": self.business.id, "supplier_gstin": "22ZZZZZ0000Z1Z5",
            "supplier_name": "DUPCO", "invoice_number": "DUP-1", "invoice_date": "2026-05-05",
            "lines": json.dumps([{"product_name": "A", "hsn_code": "1",
                                  "quantity": "1", "rate": "100", "gst_tax_rate": "0.03"}]),
        }
        r1 = self.client.post(reverse("inward-bill-list"),
                              {**base, "file": SimpleUploadedFile("a.jpg", b"d", content_type="image/jpeg")})
        self.assertEqual(r1.status_code, 409)
        r2 = self.client.post(reverse("inward-bill-list"),
                              {**base, "override_warnings": "true",
                               "file": SimpleUploadedFile("a.jpg", b"d", content_type="image/jpeg")})
        self.assertEqual(r2.status_code, 201, r2.data)
        self.assertEqual(Invoice.objects.filter(invoice_number="DUP-1",
                         type_of_invoice=INVOICE_TYPE_INWARD).count(), 2)
