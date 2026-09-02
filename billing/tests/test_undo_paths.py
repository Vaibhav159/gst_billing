"""Audit-log undo, all three branches on the success path (audit F5.2).

Batch 3 covered the role gate and the filed-period refusals; nothing asserted
that an undo actually puts the record back.
"""

from decimal import Decimal

from django.contrib.auth.models import Group, User
from django.test import TestCase
from django.urls import NoReverseMatch, reverse
from rest_framework.test import APIClient

from billing.models import AuditLog, Business, Customer, Invoice, LineItem


def _undo_url(pk):
    try:
        return reverse("auditlog-undo", args=[pk])
    except NoReverseMatch:
        return f"/api/audit-logs/{pk}/undo/"


class UndoPathTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="admin_undo", password="pw")
        self.user.groups.add(Group.objects.get_or_create(name="admin")[0])
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.biz = Business.objects.create(name="LODHA JEWELLERS", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN")
        self.cust = Customer.objects.create(name="LOCAL BUYER", state_name="RAJASTHAN")

    def _create_invoice(self, number="1"):
        r = self.client.post(reverse("invoice-list"), {
            "business": self.biz.id, "customer": self.cust.id, "invoice_number": number,
            "invoice_date": "2026-05-10", "type_of_invoice": "outward",
            "line_items": [{"product_name": "Silver", "hsn_code": "711311", "gst_tax_rate": "0.03",
                            "quantity": "1", "rate": "10000", "cgst": "150", "sgst": "150", "igst": "0", "amount": "10300"}],
        }, format="json")
        self.assertEqual(r.status_code, 201, getattr(r, "data", None))
        return Invoice.objects.get(id=r.data["id"])

    def _entry(self, action, invoice_id):
        return AuditLog.objects.filter(entity="invoice", action=action, entity_id=invoice_id).latest("timestamp")

    def test_undo_of_a_create_deletes_the_record_and_logs_it(self):
        inv = self._create_invoice()
        r = self.client.post(_undo_url(self._entry("created", inv.id).pk))
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertFalse(Invoice.objects.filter(id=inv.id).exists())
        self.assertFalse(LineItem.objects.filter(invoice_id=inv.id).exists())
        self.assertTrue(AuditLog.objects.filter(action="deleted", entity_id=inv.id, details__icontains="undo").exists())

    def test_undo_of_an_update_reverts_the_field(self):
        inv = self._create_invoice()
        r = self.client.patch(reverse("invoice-detail", args=[inv.id]), {"invoice_number": "77"}, format="json")
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        inv.refresh_from_db()
        self.assertEqual(inv.invoice_number, "77")
        r = self.client.post(_undo_url(self._entry("updated", inv.id).pk))
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        inv.refresh_from_db()
        self.assertEqual(inv.invoice_number, "1")
        self.assertEqual(inv.lineitem_set.count(), 1)
        self.assertEqual(inv.total_amount, Decimal("10300"))

    def test_undo_of_a_delete_restores_the_invoice_with_its_lines(self):
        inv = self._create_invoice()
        r = self.client.delete(reverse("invoice-detail", args=[inv.id]))
        self.assertIn(r.status_code, (200, 204), getattr(r, "data", None))
        self.assertFalse(Invoice.objects.filter(id=inv.id).exists())
        r = self.client.post(_undo_url(self._entry("deleted", inv.id).pk))
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        restored = Invoice.objects.get(id=r.data["new_id"])
        self.assertEqual(restored.invoice_number, "1")
        self.assertEqual(restored.customer, self.cust)
        li = restored.lineitem_set.get()
        self.assertEqual((li.cgst, li.sgst, li.igst), (Decimal("150"), Decimal("150"), Decimal("0")))
        self.assertEqual(restored.total_amount, Decimal("10300"))

    def test_undoing_a_delete_twice_does_not_restore_twice(self):
        inv = self._create_invoice()
        self.client.delete(reverse("invoice-detail", args=[inv.id]))
        entry = self._entry("deleted", inv.id)
        first = self.client.post(_undo_url(entry.pk))
        self.assertEqual(first.status_code, 200)
        second = self.client.post(_undo_url(entry.pk))
        # A clean refusal — this used to be an IntegrityError 500 — and one copy.
        self.assertEqual(second.status_code, 409, getattr(second, "data", None))
        self.assertEqual(Invoice.objects.filter(invoice_number="1", business=self.biz).count(), 1)
