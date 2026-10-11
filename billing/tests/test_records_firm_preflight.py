"""P4-1/P4-2/P4-15: grouped filing carrier and immutable old bill identity."""
from datetime import date
from types import ModuleType
from unittest.mock import Mock, patch

from django.db.models import QuerySet
from django.test import TestCase

from billing.api.mixins import snapshot_of
from billing.models import AuditLog, Invoice
from billing.services.bill_reads import firm_block
from billing.services.bin import bin_bill, restore_from_bin
from billing.services.sales import firm_snapshot
from billing.tests.v3_helpers import buyer, client_for, firm, person, sale


class FirmPreflightTests(TestCase):
    def setUp(self):
        self.owner = person("firm-preflight", "admin")
        self.client = client_for(self.owner)
        self.business = firm(bank_account_number="123456789")
        self.customer = buyer()

    @patch("billing.services.firms.timezone.localdate", return_value=date(2026, 10, 8))
    def test_optional_grouped_blockers_are_reused(self, today):
        from billing.services.firms import read_filings

        key = (self.business.pk, "2026-09")
        filing, checks = ModuleType("billing.services.filing"), ModuleType("billing.services.gst_checks")
        filing.month_stages = Mock(return_value={
            "stages": {key: "blocked"}, "latest_gstr1": {self.business.pk: None},
            "blockers": {key: {"count": 1, "first_two": ["A line needs its HSN"]}},
        })
        checks.gstr1_blockers = Mock(side_effect=AssertionError("Already read by the grouped helper"))
        with patch.dict("sys.modules", {filing.__name__: filing, checks.__name__: checks}):
            result = read_filings([self.business.pk], [key[1]])
        self.assertEqual(result["blockers"], {key: "A line needs its HSN"})
        checks.gstr1_blockers.assert_not_called()

    def test_v2_firm_undo_freezes_current_identity_before_reverting(self):
        before = snapshot_of(self.business)
        self.business.name = "CURRENT LEGAL NAME"
        self.business.address = "Current registered address"
        self.business.save()
        entry = AuditLog.objects.create(action="updated", entity="business", entity_id=self.business.pk,
            entity_name=self.business.name, user=self.owner, snapshot=before)
        bill = sale(self.business, self.customer, "1", "2026-09-01")
        already = sale(self.business, self.customer, "2", "2026-09-02", firm_snapshot={**firm_snapshot(self.business), "name": "EVEN OLDER NAME"})
        purchase = sale(self.business, self.customer, "P1", "2026-09-03", kind="inward")
        response = self.client.post(f"/api/audit-logs/{entry.pk}/undo/")
        self.assertEqual(response.status_code, 200, response.data)
        bill = Invoice.objects.select_related("business").get(pk=bill.pk)
        self.assertEqual(bill.business.name, before["name"])
        self.assertEqual(firm_block(bill)["name"], "CURRENT LEGAL NAME")
        self.assertEqual(firm_block(bill)["address"], "Current registered address")
        already.refresh_from_db()
        purchase.refresh_from_db()
        self.assertEqual(already.firm_snapshot["name"], "EVEN OLDER NAME")
        self.assertIsNone(purchase.firm_snapshot)

    def test_v2_bank_only_undo_does_not_freeze_unchanged_identity(self):
        before = snapshot_of(self.business)
        self.business.bank_account_number = "987654321"
        self.business.save()
        entry = AuditLog.objects.create(action="updated", entity="business", entity_id=self.business.pk,
            entity_name=self.business.name, user=self.owner, snapshot=before)
        bill = sale(self.business, self.customer, "1", "2026-09-01")
        response = self.client.post(f"/api/audit-logs/{entry.pk}/undo/")
        self.assertEqual(response.status_code, 200, response.data)
        bill.refresh_from_db()
        self.assertIsNone(bill.firm_snapshot)

    def test_identity_edit_freezes_null_and_missing_bin_snapshots_once_before_restore(self):
        old = firm_snapshot(self.business)
        bins = []
        for number in ("1", "2", "3"):
            bill = sale(self.business, self.customer, number, "2026-09-01",
                        firm_snapshot=old if number == "3" else None)
            binned, _entry = bin_bill(bill, self.owner)
            if number == "2":
                del binned.data["invoice"]["firm_snapshot"]
                binned.save(update_fields=["data"])
            bins.append(binned)
        response = self.client.put(f"/api/firms/{self.business.pk}/", {
            "name": "NEW LEGAL NAME", "address": "New registered address", "bank_account_number": "987654321",
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["frozen_bills"], 2)
        for binned in bins:
            binned.refresh_from_db()
            self.assertEqual(binned.data["invoice"]["firm_snapshot"], old)
        response = self.client.put(f"/api/firms/{self.business.pk}/", {"name": "THIRD LEGAL NAME"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["frozen_bills"], 0)
        for binned in bins:
            restored = restore_from_bin(binned, self.owner)
            self.assertEqual(firm_block(restored)["name"], old["name"])
            self.assertEqual(firm_block(restored)["address"], old["address"])
            self.assertEqual(firm_block(restored)["bank_account_number"], "987654321")

    def test_v2_undo_freezes_bin_identity_for_legacy_restore(self):
        before = snapshot_of(self.business)
        self.business.name = "CURRENT LEGAL NAME"
        self.business.save()
        edited = AuditLog.objects.create(action="updated", entity="business", entity_id=self.business.pk,
            entity_name=self.business.name, user=self.owner, snapshot=before)
        bill = sale(self.business, self.customer, "1", "2026-09-01")
        binned, deleted = bin_bill(bill, self.owner)
        response = self.client.post(f"/api/audit-logs/{edited.pk}/undo/")
        self.assertEqual(response.status_code, 200, response.data)
        response = self.client.post(f"/api/audit-logs/{deleted.pk}/undo/")
        self.assertEqual(response.status_code, 200, response.data)
        restored = Invoice.objects.select_related("business").get(pk=binned.original_id)
        self.assertEqual(firm_block(restored)["name"], "CURRENT LEGAL NAME")

    def test_bank_only_edit_leaves_bin_snapshot_unfrozen(self):
        binned, _entry = bin_bill(sale(self.business, self.customer, "1", "2026-09-01"), self.owner)
        response = self.client.put(f"/api/firms/{self.business.pk}/", {"bank_account_number": "987654321"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["frozen_bills"], 0)
        binned.refresh_from_db()
        self.assertIsNone(binned.data["invoice"]["firm_snapshot"])

    def test_restore_locks_firm_before_bin_to_match_identity_freezing(self):
        binned, _entry = bin_bill(sale(self.business, self.customer, "1", "2026-09-01"), self.owner)
        locked = []
        original = QuerySet.select_for_update
        def record(queryset, *args, **kwargs):
            locked.append(queryset.model.__name__)
            return original(queryset, *args, **kwargs)
        with patch.object(QuerySet, "select_for_update", record):
            restore_from_bin(binned, self.owner)
        self.assertEqual(locked[:3], ["AuditLog", "Business", "BinnedInvoice"])
