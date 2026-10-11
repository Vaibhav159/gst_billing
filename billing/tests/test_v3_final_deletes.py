"""Final 1A: deletion and Undo agree about records already back in Sales."""

from datetime import date
from unittest.mock import patch
from uuid import uuid4

from django.test import Client, TestCase
from django.urls import reverse
from django.utils import timezone

from billing.constants import BILL_CANCELLED
from billing.models import AuditLog, BinnedInvoice, Business, Customer, Invoice, SaleDraft, SavedDraft
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person, sale


class FinalPartyDeleteTest(TestCase):
    def setUp(self):
        self.owner = person("owner", *ROLE_GROUPS["owner"], superuser=True)
        self.owner.is_staff = True
        self.owner.save(update_fields=["is_staff"])
        self.client = client_for(self.owner)
        self.admin = Client()
        self.admin.force_login(self.owner)
        self.biz, self.customer = firm(), buyer()

    def settled(self, **more):
        return BinnedInvoice.objects.create(
            business=self.biz, customer=self.customer, original_id=100,
            invoice_number="100", invoice_date=date(2026, 9, 30),
            restored_at=timezone.now(), **more,
        )

    def created(self, obj, entity):
        return AuditLog.objects.create(action="created", entity=entity, entity_id=obj.pk, entity_name=str(obj))

    def test_failed_delete_audit_never_rolls_back_a_successful_delete(self):
        for entity, obj, view in (("customer", self.customer, "CustomerViewSet"),
                                  ("business", self.biz, "BusinessViewSet")):
            with self.subTest(entity=entity), patch(f"billing.api.views.{view}.get_entity_name", return_value=None):
                response = self.client.delete(reverse(f"{entity}-detail", args=[obj.pk]))
            self.assertEqual(response.status_code, 204)
            self.assertFalse(type(obj).objects.filter(pk=obj.pk).exists())

    def test_undo_created_customer_clears_settled_bin(self):
        binned = self.settled()
        entry = self.created(self.customer, "customer")
        response = self.client.post(reverse("auditlog-undo", args=[entry.pk]))
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(Customer.objects.filter(pk=self.customer.pk).exists())
        self.assertFalse(BinnedInvoice.objects.filter(pk=binned.pk).exists())
        entry.refresh_from_db()
        self.assertIn("_undo", entry.snapshot)

    def test_undo_created_firm_clears_settled_bin_and_saved_draft(self):
        self.settled()
        key = uuid4()
        SaleDraft.objects.create(id=key, business=self.biz)
        SavedDraft.objects.create(id=key, invoice_number="100")
        entry = self.created(self.biz, "business")
        response = self.client.post(reverse("auditlog-undo", args=[entry.pk]))
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(Business.objects.filter(pk=self.biz.pk).exists())
        self.assertFalse(SaleDraft.objects.filter(pk=key).exists())
        self.assertTrue(SavedDraft.objects.filter(pk=key).exists())

    def test_protected_undo_is_v2s_409_and_rolls_back_cleanup(self):
        stale = self.settled()
        live = self.settled()
        BinnedInvoice.objects.filter(pk=live.pk).update(restored_at=None)
        entry = self.created(self.customer, "customer")
        response = self.client.post(reverse("auditlog-undo", args=[entry.pk]))
        self.assertEqual((response.status_code, response.data), (409, {
            "error": "Cannot delete: 1 bill(s) in the bin still reference this record. Restore and reassign them first.",
            "protected": 1,
        }))
        self.assertTrue(BinnedInvoice.objects.filter(pk=stale.pk).exists())
        entry.refresh_from_db()
        self.assertNotIn("_undo", entry.snapshot or {})

    def test_undo_created_firm_with_live_draft_is_v2s_409(self):
        SaleDraft.objects.create(id=uuid4(), business=self.biz)
        entry = self.created(self.biz, "business")
        response = self.client.post(reverse("auditlog-undo", args=[entry.pk]))
        self.assertEqual((response.status_code, response.data), (409, {
            "error": "Cannot delete: 1 unfinished bill(s) still name this firm. Finish or discard them first.",
            "protected": 1,
        }))

    def test_admin_customer_confirmation_reads_only_and_delete_cleans_settled_rows(self):
        row = self.settled()
        url = reverse("admin:billing_customer_delete", args=[self.customer.pk])
        response = self.admin.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["protected"], [])
        self.assertTrue(BinnedInvoice.objects.filter(pk=row.pk).exists())
        self.assertEqual(self.admin.post(url, {"post": "yes"}).status_code, 302)
        self.assertFalse(Customer.objects.filter(pk=self.customer.pk).exists())
        self.assertFalse(BinnedInvoice.objects.filter(pk=row.pk).exists())

    def test_admin_firm_bulk_delete_cleans_saved_drafts(self):
        row = self.settled()
        key = uuid4()
        SaleDraft.objects.create(id=key, business=self.biz)
        SavedDraft.objects.create(id=key)
        response = self.admin.post(reverse("admin:billing_business_changelist"), {
            "action": "delete_selected", "_selected_action": [self.biz.pk], "post": "yes",
        })
        self.assertEqual(response.status_code, 302)
        self.assertFalse(Business.objects.filter(pk=self.biz.pk).exists())
        self.assertFalse(SaleDraft.objects.filter(pk=key).exists())
        self.assertFalse(BinnedInvoice.objects.filter(pk=row.pk).exists())

    def test_admin_delete_keeps_live_bin_and_settled_rows_when_protected(self):
        stale = self.settled()
        live = self.settled()
        BinnedInvoice.objects.filter(pk=live.pk).update(restored_at=None)
        response = self.admin.post(reverse("admin:billing_customer_delete", args=[self.customer.pk]), {"post": "yes"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.context["protected"])
        self.assertTrue(Customer.objects.filter(pk=self.customer.pk).exists())
        self.assertTrue(BinnedInvoice.objects.filter(pk=stale.pk).exists())

    def test_v2_undo_cancelled_answer_has_both_error_and_code(self):
        bill = sale(self.biz, self.customer, "123", "2026-09-30", status=BILL_CANCELLED)
        entry = AuditLog.objects.create(action="updated", entity="invoice", entity_id=bill.pk,
                                        entity_name="123", snapshot={"invoice_number": "122"})
        response = self.client.post(reverse("auditlog-undo", args=[entry.pk]))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data.get("code"), "cancelled")
        self.assertEqual(response.data["error"], "cancelled")
        self.assertEqual(Invoice.objects.get(pk=bill.pk).invoice_number, "123")
