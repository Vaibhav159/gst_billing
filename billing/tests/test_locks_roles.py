"""Batch 3 of the Fresh Eyes Audit: locks, roles and one-way doors (C1-C9, A9)."""

import shutil
import tempfile
from decimal import Decimal as D

from django.contrib.auth.models import Group, User
from django.core.exceptions import PermissionDenied
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import RequestFactory, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from billing.models import AuditLog, Customer, FiledPeriod, Invoice, LineItem
from billing.tests.test_base import BaseAPITestCase


def _client_as(role):
    user = User.objects.create_user(username=f"{role}_user", password="pw")
    user.groups.add(Group.objects.get_or_create(name=role)[0])
    client = APIClient()
    client.force_authenticate(user=user)
    return client


class RoleGateTests(BaseAPITestCase):
    """C1: seven endpoints fell through to bare IsAuthenticated."""

    def _created_entry(self):
        return AuditLog.objects.create(
            action="created", entity="invoice", entity_id=self.invoice.pk,
            entity_name="INV-001", user=self.user,
        )

    def test_viewer_cannot_undo(self):
        entry = self._created_entry()
        resp = _client_as("viewer").post(reverse("auditlog-undo", args=[entry.pk]))
        self.assertEqual(resp.status_code, 403)
        self.assertTrue(Invoice.objects.filter(pk=self.invoice.pk).exists())

    def test_editor_cannot_undo_either(self):
        """Undo deletes; editors are denied DELETE; the primitive must match."""
        entry = self._created_entry()
        resp = _client_as("editor").post(reverse("auditlog-undo", args=[entry.pk]))
        self.assertEqual(resp.status_code, 403)

    def test_admin_can_undo(self):
        entry = self._created_entry()
        resp = self.client.post(reverse("auditlog-undo", args=[entry.pk]))
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertFalse(Invoice.objects.filter(pk=self.invoice.pk).exists())

    def test_viewer_cannot_bulk_import(self):
        resp = _client_as("viewer").post(reverse("bulk-invoice-import"), {"invoices": []}, format="json")
        self.assertEqual(resp.status_code, 403)

    def test_viewer_and_editor_cannot_merge_customers(self):
        other = Customer.objects.create(workspace_id=1, name="OTHER")
        for role in ("viewer", "editor"):
            resp = _client_as(role).post(reverse("customer-merge"), {"source_id": other.id, "target_id": self.customer.id}, format="json")
            self.assertEqual(resp.status_code, 403, role)

    def test_viewer_can_still_record_a_print(self):
        """The log endpoint is the one write a viewer legitimately makes."""
        resp = _client_as("viewer").post(reverse("auditlog-log"), {"action": "printed", "entity": "invoice", "entity_id": self.invoice.pk, "entity_name": "INV-001"}, format="json")
        self.assertNotEqual(resp.status_code, 403, resp.data)


_MEDIA = tempfile.mkdtemp(prefix="capture_test_")


@override_settings(MEDIA_ROOT=_MEDIA)
class CaptureUploadTests(BaseAPITestCase):
    """C2: the capture inbox accepted any file at all."""

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(_MEDIA, ignore_errors=True)
        super().tearDownClass()

    def _upload(self, name, content, content_type):
        return self.client.post(
            reverse("inward-capture-list"),
            {"image": SimpleUploadedFile(name, content, content_type=content_type), "business_id": self.business.id},
            format="multipart",
        )

    def test_html_is_refused(self):
        resp = self._upload("evil.html", b"<script>alert(1)</script>", "text/html")
        self.assertEqual(resp.status_code, 400)

    def test_svg_is_refused(self):
        resp = self._upload("evil.svg", b"<svg onload=alert(1)/>", "image/svg+xml")
        self.assertEqual(resp.status_code, 400)

    def test_oversize_is_refused(self):
        resp = self._upload("big.jpg", b"x" * (20 * 1024 * 1024 + 1), "image/jpeg")
        self.assertEqual(resp.status_code, 400)

    def test_a_photo_is_accepted(self):
        resp = self._upload("bill.jpg", b"\xff\xd8\xff\xe0 fake jpeg", "image/jpeg")
        self.assertEqual(resp.status_code, 201, resp.data)


class MergeTests(BaseAPITestCase):
    """C3: merge was non-transactional and ignored filed periods."""

    def test_merge_in_a_filed_period_is_refused_and_moves_nothing(self):
        target = Customer.objects.create(workspace_id=1, name="TARGET")
        FiledPeriod.objects.create(workspace_id=1, business=self.business, year=2023, month=1)
        resp = self.client.post(reverse("customer-merge"), {"source_id": self.customer.id, "target_id": target.id}, format="json")
        self.assertEqual(resp.status_code, 400, resp.data)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.customer_id, self.customer.id)
        self.assertTrue(Customer.objects.filter(pk=self.customer.pk).exists())

    def test_merge_moves_invoices_and_lines_together(self):
        target = Customer.objects.create(workspace_id=1, name="TARGET")
        resp = self.client.post(reverse("customer-merge"), {"source_id": self.customer.id, "target_id": target.id}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.customer_id, target.id)
        self.assertEqual(LineItem.objects.filter(customer=target).count(), 1)
        self.assertFalse(Customer.objects.filter(pk=self.customer.pk).exists())


class UndoTests(BaseAPITestCase):
    """C4: undo recreated empty-shell invoices and ignored period locks."""

    def _delete_fixture_invoice(self):
        total = self.invoice.total_amount
        lines = self.invoice.lineitem_set.count()
        resp = self.client.delete(reverse("invoice-detail", args=[self.invoice.pk]))
        self.assertEqual(resp.status_code, 204)
        entry = AuditLog.objects.filter(action="deleted", entity="invoice").latest("id")
        return entry, total, lines

    def test_a_deleted_invoice_comes_back_with_its_lines(self):
        entry, total, lines = self._delete_fixture_invoice()
        self.assertGreater(lines, 0)
        self.assertEqual(len(entry.snapshot.get("line_items") or []), lines, "delete must snapshot the lines")

        resp = self.client.post(reverse("auditlog-undo", args=[entry.pk]))
        self.assertEqual(resp.status_code, 200, resp.data)
        restored = Invoice.objects.get(pk=resp.data["new_id"])
        self.assertEqual(restored.lineitem_set.count(), lines)
        self.assertEqual(restored.total_amount, total)

    def test_undo_of_a_delete_respects_the_lock(self):
        entry, _, _ = self._delete_fixture_invoice()
        FiledPeriod.objects.create(workspace_id=1, business=self.business, year=2023, month=1)
        resp = self.client.post(reverse("auditlog-undo", args=[entry.pk]))
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertFalse(Invoice.objects.filter(invoice_number="INV-001").exists())

    def test_undo_of_a_create_respects_the_lock(self):
        entry = AuditLog.objects.create(action="created", entity="invoice", entity_id=self.invoice.pk, entity_name="INV-001")
        FiledPeriod.objects.create(workspace_id=1, business=self.business, year=2023, month=1)
        resp = self.client.post(reverse("auditlog-undo", args=[entry.pk]))
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertTrue(Invoice.objects.filter(pk=self.invoice.pk).exists())


class UnlockedWritePathsTests(BaseAPITestCase):
    """C6: four write paths skipped the period lock."""

    def setUp(self):
        super().setUp()
        FiledPeriod.objects.create(workspace_id=1, business=self.business, year=2023, month=1)

    def _line(self):
        return {"invoice": self.invoice.pk, "customer": self.customer.pk, "product_name": "Silver",
                "hsn_code": "711311", "gst_tax_rate": "0.03", "quantity": "1", "rate": "1000",
                "cgst": "15", "sgst": "15", "igst": "0", "amount": "1030", "unit": "gms", "workspace_id": 1}

    def test_plain_line_item_post_is_refused(self):
        before = LineItem.objects.count()
        resp = self.client.post(reverse("lineitem-list"), self._line(), format="json")
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(LineItem.objects.count(), before)

    def test_create_for_invoice_is_refused(self):
        resp = self.client.post(reverse("lineitem-create-for-invoice"), {"invoice_id": self.invoice.pk, "item_name": "Silver", "qty": "1", "rate": "100"}, format="json")
        self.assertEqual(resp.status_code, 400, resp.data)

    def test_create_for_invoice_with_a_bad_id_is_404_not_500(self):
        resp = self.client.post(reverse("lineitem-create-for-invoice"), {"invoice_id": 999999, "item_name": "Silver", "qty": "1", "rate": "100"}, format="json")
        self.assertEqual(resp.status_code, 404)

    def test_eway_bill_post_is_refused(self):
        resp = self.client.post(reverse("invoice-eway-bill", args=[self.invoice.pk]), {"eway_bill_number": "EWB-1"}, format="json")
        self.assertEqual(resp.status_code, 400, resp.data)
        self.invoice.refresh_from_db()
        self.assertFalse(self.invoice.eway_bill_number)


class EditPathTests(BaseAPITestCase):
    """C9 and A9: the main edit path and the money the server trusts."""

    def _line(self, amount="1030"):
        return {"product_name": "Silver", "hsn_code": "711311", "gst_tax_rate": "0.03", "quantity": "1",
                "rate": "1000", "cgst": "15", "sgst": "15", "igst": "0", "amount": amount, "unit": "gms"}

    def test_duplicate_number_on_the_edit_path_is_a_409(self):
        Invoice.objects.create(workspace_id=1, business=self.business, customer=self.customer,
                               invoice_number="TAKEN", invoice_date="2023-01-05", type_of_invoice="outward", total_amount=D("1"))
        resp = self.client.post(reverse("invoice-update-line-items", args=[self.invoice.pk]),
                                {"invoice": {"invoice_number": "TAKEN"}, "line_items": [self._line()]}, format="json")
        self.assertEqual(resp.status_code, 409, resp.data)

    def test_patching_the_total_is_ignored(self):
        before = self.invoice.total_amount
        resp = self.client.patch(reverse("invoice-detail", args=[self.invoice.pk]), {"total_amount": "99999.99"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.total_amount, before)

    def test_a_line_whose_amount_is_not_its_own_arithmetic_is_refused(self):
        payload = {"invoice_number": "A9-1", "invoice_date": "2026-05-10", "type_of_invoice": "outward",
                   "customer": self.customer.id, "business": self.business.id,
                   "line_items": [self._line(amount="5000")]}
        resp = self.client.post(reverse("invoice-list"), payload, format="json")
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertFalse(Invoice.objects.filter(invoice_number="A9-1").exists())

    def test_an_honest_line_is_accepted(self):
        payload = {"invoice_number": "A9-2", "invoice_date": "2026-05-10", "type_of_invoice": "outward",
                   "customer": self.customer.id, "business": self.business.id,
                   "line_items": [self._line(amount="1030")]}
        resp = self.client.post(reverse("invoice-list"), payload, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)


class AdminTests(BaseAPITestCase):
    """C5: the admin bypassed the lock and its search box raised FieldError."""

    def _staff(self):
        from django.test import Client
        u = User.objects.create_superuser(username="root", password="pw", email="r@x")
        c = Client()
        c.force_login(u)
        return c, u

    def test_search_no_longer_500s(self):
        client, _ = self._staff()
        resp = client.get("/admin/billing/invoice/?q=INV")
        self.assertEqual(resp.status_code, 200)

    def test_admin_save_respects_the_lock(self):
        from django.contrib import admin

        from billing.admin import InvoiceAdmin
        FiledPeriod.objects.create(workspace_id=1, business=self.business, year=2023, month=1)
        _, user = self._staff()
        request = RequestFactory().post("/admin/")
        request.user = user
        with self.assertRaises(PermissionDenied):
            InvoiceAdmin(Invoice, admin.site).save_model(request, self.invoice, form=None, change=True)
