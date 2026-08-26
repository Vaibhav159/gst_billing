"""Filed-period lock — filed numbers can never silently drift.

Once (business, month) is locked, every casual write path refuses:
create, edit, line-item replace, delete, inward capture, bulk import.
Other months stay writable; unlock restores everything; both transitions
leave audit rows.
"""

import json
from decimal import Decimal as D

from django.urls import reverse

from billing.models import AuditLog, FiledPeriod, Invoice, LineItem
from billing.tests.test_base import BaseAPITestCase

JULY = "2026-07-15"
AUG = "2026-08-15"


class PeriodLockTest(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.july_inv = Invoice.objects.create(
            workspace_id=1, business=self.business, customer=self.customer,
            invoice_number="JL-1", invoice_date=JULY,
            type_of_invoice="outward", total_amount=D("1030"))
        LineItem.objects.create(
            workspace_id=1, customer=self.customer, invoice=self.july_inv,
            product_name="Silver", hsn_code="711311", gst_tax_rate=D("0.03"),
            quantity=D("1000"), rate=D("1"), cgst=D("15"), sgst=D("15"),
            igst=0, unit="gms", amount=D("1030"))
        self.lock = FiledPeriod.objects.create(
            workspace_id=1, business=self.business, year=2026, month=7)

    def _create(self, date, number="NEW-1"):
        return self.client.post(reverse("invoice-list"), {
            "invoice_number": number, "invoice_date": date,
            "type_of_invoice": "outward", "customer": self.customer.id,
            "business": self.business.id, "total_amount": "500",
        }, format="json")

    def test_create_in_locked_month_is_refused(self):
        r = self._create(JULY)
        self.assertEqual(r.status_code, 400, r.data)
        self.assertIn("filed and locked", str(r.data))
        self.assertFalse(Invoice.objects.filter(invoice_number="NEW-1").exists())

    def test_create_in_open_month_still_works(self):
        r = self._create(AUG, "AUG-1")
        self.assertEqual(r.status_code, 201, r.data)

    def test_edit_of_locked_invoice_is_refused(self):
        r = self.client.patch(
            reverse("invoice-detail", args=[self.july_inv.id]),
            {"invoice_number": "JL-1-EDITED"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.july_inv.refresh_from_db()
        self.assertEqual(self.july_inv.invoice_number, "JL-1")

    def test_redating_an_open_invoice_into_a_locked_month_is_refused(self):
        aug = Invoice.objects.create(
            workspace_id=1, business=self.business, customer=self.customer,
            invoice_number="AUG-RD", invoice_date=AUG,
            type_of_invoice="outward", total_amount=D("100"))
        r = self.client.patch(
            reverse("invoice-detail", args=[aug.id]),
            {"invoice_date": JULY}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_update_line_items_is_refused(self):
        r = self.client.post(
            reverse("invoice-update-line-items", args=[self.july_inv.id]),
            {"line_items": []}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.july_inv.lineitem_set.count(), 1)

    def test_delete_is_refused_then_allowed_after_unlock(self):
        r = self.client.delete(reverse("invoice-detail", args=[self.july_inv.id]))
        self.assertEqual(r.status_code, 400)
        self.assertTrue(Invoice.objects.filter(id=self.july_inv.id).exists())

        self.client.delete(reverse("filedperiod-detail", args=[self.lock.id]))
        r2 = self.client.delete(reverse("invoice-detail", args=[self.july_inv.id]))
        self.assertIn(r2.status_code, (200, 204))
        self.assertFalse(Invoice.objects.filter(id=self.july_inv.id).exists())

    def test_inward_capture_in_locked_month_is_refused(self):
        r = self.client.post(reverse("inward-bill-list"), {
            "business_id": self.business.id,
            "supplier_name": "LOCKED SUPPLIER",
            "invoice_number": "LCK-IN-1", "invoice_date": JULY,
            "lines": json.dumps([{"product_name": "Silver", "hsn_code": "711311",
                                  "quantity": "10", "rate": "100",
                                  "gst_tax_rate": "0.03", "unit": "gms"}]),
        })
        self.assertEqual(r.status_code, 400, getattr(r, "data", None))
        self.assertFalse(Invoice.objects.filter(invoice_number="LCK-IN-1").exists())

    def test_bulk_import_skips_locked_rows_with_a_row_error(self):
        payload = {
            "business_id": self.business.id,
            "invoices": [
                {"invoiceNumber": "BLK-LCK", "invoice_date": JULY,
                 "customerName": self.customer.name, "type": "OUTWARD", "total": 100,
                 "items": [{"productName": "Silver", "hsn": "711311",
                            "qty": 10, "rate": 10, "gstRate": 3}]},
                {"invoiceNumber": "BLK-OK", "invoice_date": AUG,
                 "customerName": self.customer.name, "type": "OUTWARD", "total": 100,
                 "items": [{"productName": "Silver", "hsn": "711311",
                            "qty": 10, "rate": 10, "gstRate": 3}]},
            ],
        }
        r = self.client.post(reverse("bulk-invoice-import"), payload, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["created"], 1, r.data)
        self.assertTrue(any("filed & locked" in e for e in r.data["errors"]), r.data)
        self.assertFalse(Invoice.objects.filter(invoice_number="BLK-LCK").exists())
        self.assertTrue(Invoice.objects.filter(invoice_number="BLK-OK").exists())

    def test_lock_and_unlock_write_audit_rows(self):
        r = self.client.post(reverse("filedperiod-list"), {
            "business": self.business.id, "year": 2026, "month": 6,
            "note": "ARN AA0806260000000",
        }, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertTrue(AuditLog.objects.filter(action="locked", entity="period").exists())
        self.client.delete(reverse("filedperiod-detail", args=[r.data["id"]]))
        self.assertTrue(AuditLog.objects.filter(action="unlocked", entity="period").exists())

    def test_lock_is_per_business(self):
        from billing.models import Business
        other = Business.objects.create(
            workspace_id=1, name="OTHER FIRM", gst_number="08AAGPL1111F1Z1",
            state_name="RAJASTHAN")
        r = self.client.post(reverse("invoice-list"), {
            "invoice_number": "OTHER-JL", "invoice_date": JULY,
            "type_of_invoice": "outward", "customer": self.customer.id,
            "business": other.id, "total_amount": "500",
        }, format="json")
        self.assertEqual(r.status_code, 201, r.data)


class RateDrillDownTest(BaseAPITestCase):
    def test_gst_rate_filter_returns_only_matching_invoices(self):
        inv3 = Invoice.objects.create(
            workspace_id=1, business=self.business, customer=self.customer,
            invoice_number="R3", invoice_date=AUG,
            type_of_invoice="outward", total_amount=D("103"))
        LineItem.objects.create(
            workspace_id=1, customer=self.customer, invoice=inv3,
            product_name="Silver", hsn_code="711311", gst_tax_rate=D("0.03"),
            quantity=D("100"), rate=D("1"), cgst=D("1.5"), sgst=D("1.5"),
            igst=0, unit="gms", amount=D("103"))
        inv5 = Invoice.objects.create(
            workspace_id=1, business=self.business, customer=self.customer,
            invoice_number="R5", invoice_date=AUG,
            type_of_invoice="outward", total_amount=D("105"))
        LineItem.objects.create(
            workspace_id=1, customer=self.customer, invoice=inv5,
            product_name="Stone", hsn_code="7103", gst_tax_rate=D("0.05"),
            quantity=D("100"), rate=D("1"), cgst=D("2.5"), sgst=D("2.5"),
            igst=0, unit="gms", amount=D("105"))
        r = self.client.get(reverse("invoice-list"), {"gst_rate": "3"})
        numbers = [i["invoice_number"] for i in r.data["results"]]
        self.assertIn("R3", numbers)
        self.assertNotIn("R5", numbers)
