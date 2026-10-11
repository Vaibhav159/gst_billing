from decimal import Decimal

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from billing.api.mixins import snapshot_of
from billing.models import AuditLog, Customer, FiledPeriod, LineItem, Product
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, line, person, sale


class AuditReadTest(TestCase):
    def setUp(self):
        self.owner = person("audit-owner", *ROLE_GROUPS["owner"], first_name="Kailash", last_name="Mehta")
        self.client = client_for(self.owner)
        self.customer = buyer()
        self.entry = AuditLog.objects.create(user=self.owner, entity="customer", entity_id=self.customer.pk, entity_name=self.customer.name, action="updated", changes={"mobile_number": {"old": "", "new": "9000000000"}}, snapshot={"private": "SENTINEL"})
        Customer.objects.filter(pk=self.customer.pk).update(mobile_number="9000000000")

    def test_rows_counts_words_and_narrow_snapshot_read(self):
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get("/api/audit/?counts=1")
        self.assertEqual(response.status_code, 200)
        row = response.data["results"][0]
        self.assertEqual(row["words"], {"text": "Edited customer", "target": self.customer.name, "after": ""})
        self.assertEqual(row["changes"][0], {"key": "mobile_number", "field": "Phone", "from": "None", "to": "9000000000"})
        self.assertEqual(row["can"]["kind"], "revert")
        self.assertEqual(response.data["counts"]["records"], 1)
        self.assertNotIn("snapshot", row)
        self.assertNotIn("SENTINEL", str(response.data))
        for query in queries:
            self.assertNotIn('"billing_auditlog"."snapshot",', query["sql"])

    def test_filters_bad_parameters_roles_and_csv(self):
        for field, value in [("kind", "bogus"), ("group", "bogus"), ("by", "999999999999999999999999"), ("entity_id", "[]")]:
            self.assertEqual(self.client.get("/api/audit/", {field: value}).status_code, 400)
        self.assertEqual(self.client.get("/api/audit/?page=99").status_code, 404)
        viewer = client_for(person("audit-viewer", *ROLE_GROUPS["viewer"]))
        self.assertEqual(viewer.get("/api/audit/").status_code, 403)
        self.entry.entity_name = "=SUM(1,2)"
        self.entry.save()
        self.assertEqual(self.client.head("/api/audit/export/").status_code, 200)
        self.assertFalse(AuditLog.objects.filter(entity="backup", action="exported").exists())
        response = self.client.get("/api/audit/export/")
        self.assertEqual(response.status_code, 200)
        # The download is on record as soon as it starts, even if the browser stops it half way.
        self.assertTrue(AuditLog.objects.filter(entity="backup", action="exported").exists())
        content = b"".join(response.streaming_content).decode("utf-8-sig")
        self.assertIn("'=SUM(1,2)", content)
        self.assertNotIn("Audit log ·", content)
        self.assertEqual(AuditLog.objects.filter(entity="backup", action="exported").count(), 1)


class AuditActionsTest(TestCase):
    def setUp(self):
        self.owner = person("undo-owner", *ROLE_GROUPS["owner"])
        self.client = client_for(self.owner)
        self.customer = buyer()

    def entry(self, action, instance, changes=None):
        entity = "product" if isinstance(instance, Product) else "customer"
        return AuditLog.objects.create(user=self.owner, entity=entity, entity_id=instance.pk, entity_name=instance.name, action=action, changes=changes, snapshot=snapshot_of(instance))

    def test_revert_changes_only_listed_fields_and_is_itself_revertible(self):
        entry = self.entry("updated", self.customer, {"mobile_number": {"old": "", "new": "9000000000"}})
        Customer.objects.filter(pk=self.customer.pk).update(mobile_number="9000000000", address="Keep this")
        response = self.client.post(f"/api/audit/{entry.pk}/revert/")
        self.assertEqual(response.status_code, 200, response.data)
        self.customer.refresh_from_db()
        self.assertEqual((self.customer.mobile_number, self.customer.address), ("", "Keep this"))
        again = response.data["new_entry"]["id"]
        self.assertEqual(self.client.post(f"/api/audit/{again}/revert/").status_code, 200)
        self.assertEqual(self.client.post(f"/api/audit/{entry.pk}/revert/").data["code"], "already_undone")

    def test_changed_since_refuses_all_fields(self):
        entry = self.entry("updated", self.customer, {"mobile_number": {"old": "", "new": "9000000000"}, "address": {"old": "", "new": "Somewhere"}})
        Customer.objects.filter(pk=self.customer.pk).update(mobile_number="9000000001", address="Somewhere")
        response = self.client.post(f"/api/audit/{entry.pk}/revert/")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["detail"], "Phone changed again since. Revert the later change first.")
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.address, "Somewhere")

    def test_undo_unused_product_and_restore_original_id(self):
        product = Product.objects.create(name="Unused gold")
        pk = product.pk
        entry = self.entry("created", product)
        response = self.client.post(f"/api/audit/{entry.pk}/undo/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(Product.objects.filter(pk=pk).exists())
        deletion = response.data["new_entry"]["id"]
        response = self.client.post(f"/api/audit/{deletion}/restore/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Product.objects.get(pk=pk).name, "Unused gold")
        self.assertEqual(response.data["link"], f"/products/{pk}")

    def test_restore_name_collision_and_owner_only(self):
        entry = self.entry("deleted", self.customer)
        self.customer.delete()
        buyer("ANIL GUPTA")
        response = self.client.post(f"/api/audit/{entry.pk}/restore/")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "name_taken")
        accountant = client_for(person("audit-accountant", *ROLE_GROUPS["accountant"]))
        self.assertEqual(accountant.post(f"/api/audit/{entry.pk}/restore/").status_code, 403)

    def test_sale_undo_restore_and_closed_month(self):
        business = firm()
        bill = sale(business, self.customer, "17", "2026-10-02")
        entry = AuditLog.objects.create(user=self.owner, action="created", entity="invoice", entity_id=bill.pk, entity_name=bill.invoice_number, snapshot=snapshot_of(bill))
        response = self.client.post(f"/api/audit/{entry.pk}/undo/")
        self.assertEqual(response.status_code, 200, response.data)
        deletion = response.data["new_entry"]["id"]
        FiledPeriod.objects.create(business=business, year=2026, month=10)
        response = self.client.post(f"/api/audit/{deletion}/restore/")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "month_closed")
        FiledPeriod.objects.all().delete()
        response = self.client.post(f"/api/audit/{deletion}/restore/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["link"], f"/sales/{bill.pk}")

    def test_firm_restore_and_revert_refuse_registration_or_short_name_taken(self):
        original = firm(name="First firm", short_name="First", invoice_prefix="F")
        entry = AuditLog.objects.create(user=self.owner, action="deleted", entity="business", entity_id=original.pk, entity_name=original.name, snapshot=snapshot_of(original))
        original.delete()
        firm(name="Second firm", short_name="First", invoice_prefix="S")
        response = self.client.post(f"/api/audit/{entry.pk}/restore/")
        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["code"], "name_taken")

    def test_head_has_the_same_audit_permission_as_get(self):
        viewer = client_for(person("head-viewer", *ROLE_GROUPS["viewer"]))
        self.assertEqual(viewer.head("/api/audit/").status_code, 403)
        self.assertEqual(viewer.head("/api/audit/export/").status_code, 403)

    def test_firm_revert_reports_the_holder_of_an_implicit_short_name(self):
        original = firm(name="KIRAN GOLD HOUSE", short_name="K", invoice_prefix="KGH")
        holder = firm(name="Other firm", short_name="Kiran", invoice_prefix="OTHER")
        entry = AuditLog.objects.create(user=self.owner, action="updated", entity="business", entity_id=original.pk, entity_name=original.name, changes={"short_name": {"old": "", "new": "K"}}, snapshot=snapshot_of(original))
        response = self.client.post(f"/api/audit/{entry.pk}/revert/")
        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["code"], "name_taken")
        self.assertEqual(response.data["holder"], {"id": holder.pk, "name": "Other firm", "short": "Kiran"})

    def test_sale_restore_names_the_amendment_in_a_previously_filed_month(self):
        from types import SimpleNamespace
        from unittest.mock import patch

        business = firm()
        bill = sale(business, self.customer, "18", "2026-10-02")
        entry = AuditLog.objects.create(user=self.owner, action="created", entity="invoice", entity_id=bill.pk, entity_name=bill.invoice_number, snapshot=snapshot_of(bill))
        deletion = self.client.post(f"/api/audit/{entry.pk}/undo/").data["new_entry"]["id"]
        with patch("billing.period_lock.month_status", create=True, return_value=SimpleNamespace(unlocked=True)):
            rows = self.client.get("/api/audit/").data["results"]
        row = next(row for row in rows if row["id"] == deletion)
        self.assertIn(" October 2026 was filed before and is open for a correction, so this change needs an amendment in the next return.", row["can"]["effect"])

    def test_legacy_heads_round_per_line_in_bill_and_restore_effect(self):
        business = firm()
        bill = sale(business, self.customer, "19", "2026-10-02", line(), line())
        LineItem.objects.filter(invoice=bill).update(cgst=Decimal("0.025"), sgst=Decimal("0.025"), igst=Decimal("0"))
        from billing.services.bill_reads import sums
        figures = sums(LineItem.objects.filter(invoice=bill))
        self.assertEqual(figures["cgst"], Decimal("0.06"))
        self.assertEqual(figures["sgst"], Decimal("0.06"))
        self.assertEqual(figures["tax"], Decimal("0.12"))
        entry = AuditLog.objects.create(user=self.owner, action="created", entity="invoice", entity_id=bill.pk, entity_name=bill.invoice_number, snapshot=snapshot_of(bill))
        deletion = self.client.post(f"/api/audit/{entry.pk}/undo/").data["new_entry"]["id"]
        rows = self.client.get("/api/audit/").data["results"]
        row = next(row for row in rows if row["id"] == deletion)
        self.assertIn("tax by ₹0.12.", row["can"]["effect"])
