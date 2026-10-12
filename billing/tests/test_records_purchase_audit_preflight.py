"""P4-9/4A.11b: Audit delegates purchase identity to 2A's own bin services."""
import os
import subprocess
import sys
from contextlib import contextmanager
from datetime import date
from textwrap import dedent
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.test import TestCase

from billing import period_lock
from billing.models import AuditLog, FiledPeriod, Invoice
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person, sale


@contextmanager
def purchase_spies():
    # Spies on 2A's real purchase services and credit guard: Audit must dispatch to them.
    from billing.services import audit, purchase_bin
    with patch("billing.services.purchase_bin.bin_purchase", wraps=purchase_bin.bin_purchase) as bin_purchase, \
            patch("billing.services.purchase_bin.restore_purchase", wraps=purchase_bin.restore_purchase) as restore_purchase, \
            patch("billing.services.purchase_bin.assert_purchase_open", wraps=period_lock.assert_purchase_open) as guard, \
            patch("billing.services.purchases.assert_purchase_open", guard), \
            patch("billing.services.audit.assert_invoice_open", wraps=audit.assert_invoice_open) as audit_guard:
        yield SimpleNamespace(bin_purchase=bin_purchase, restore_purchase=restore_purchase, audit_guard=audit_guard), guard


def test_purchase_spies_do_not_leak_guard_into_a_later_service_import():
    # A fresh interpreter reproduces a partial suite that has not loaded the URLs yet.
    result = subprocess.run([sys.executable, "-c", dedent("""
        import sys
        import django
        django.setup()
        from billing import period_lock
        from billing.tests.test_records_purchase_audit_preflight import purchase_spies
        original = period_lock.assert_purchase_open
        assert 'billing.services.purchases' not in sys.modules
        with purchase_spies():
            from billing.services import purchase_bin, purchases
        assert purchases.assert_purchase_open is original
        assert purchase_bin.assert_purchase_open is original
        assert period_lock.assert_purchase_open is original
    """)], env={**os.environ, "DJANGO_SETTINGS_MODULE": "gst_billing.test_settings"},
        capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr


class PurchaseAuditDispatchTest(TestCase):
    def setUp(self):
        self.owner = person("purchase-audit-owner", *ROLE_GROUPS["owner"])
        self.client = client_for(self.owner)
        self.business, self.supplier = firm(), buyer()
        self.bill = sale(self.business, self.supplier, "SUP-17", "2026-09-01", kind="inward")
        self.entry = AuditLog.objects.create(action="created", entity="invoice", entity_id=self.bill.pk,
                                            entity_name="Purchase SUP-17", user=self.owner)

    def offered(self, entry_id):
        return next(row for row in self.client.get("/api/audit/").data["results"] if row["id"] == entry_id)["can"]

    def test_purchase_undo_and_restore_dispatch_to_the_purchase_services(self):
        with purchase_spies() as (service, guard):
            undone = self.client.post(f"/api/audit/{self.entry.pk}/undo/")
            self.assertEqual(undone.status_code, 200, undone.data)
            service.bin_purchase.assert_called_once()
            self.assertFalse(Invoice.objects.filter(pk=self.bill.pk).exists())
            deleted = undone.data["new_entry"]["id"]
            restored = self.client.post(f"/api/audit/{deleted}/restore/")
            self.assertEqual(restored.status_code, 200, restored.data)
            service.restore_purchase.assert_called_once()
            self.assertEqual(service.restore_purchase.call_args.kwargs, {"via": "audit_log"})
            self.assertEqual(restored.data["link"], f"/purchases/{self.bill.pk}")
            self.assertEqual(restored.data["new_entry"]["kind"], "purchases")
            guard.assert_called_once_with(self.business.pk, date(2026, 9, 1), "delete")
            self.assertEqual(self.client.post(f"/api/audit/{deleted}/restore/").data["code"], "already_undone")

    def test_restore_enforces_the_credit_guard_it_offered(self):
        with purchase_spies() as (service, guard):
            deleted = self.client.post(f"/api/audit/{self.entry.pk}/undo/").data["new_entry"]["id"]
            FiledPeriod.objects.create(business=self.business, year=2026, month=9)
            offered = self.offered(deleted)
            guard.reset_mock()
            response = self.client.post(f"/api/audit/{deleted}/restore/")
            self.assertEqual((response.status_code, response.data["code"]), (409, "month_closed"))
            self.assertEqual(response.data["detail"], offered["disabled"])
            self.assertIn("September 2026's GSTR-3B is filed", offered["disabled"])
            service.restore_purchase.assert_not_called()
            guard.assert_not_called()  # Audit refuses before dispatching to the purchase service.
            self.assertEqual(service.audit_guard.call_args.args[0], "restore")
            self.assertTrue(service.audit_guard.call_args.args[3])  # Purchase credit, not sales filing.
            self.assertFalse(Invoice.objects.filter(pk=self.bill.pk).exists())

    def test_list_offers_purchase_undo_and_uses_its_credit_guard(self):
        with purchase_spies() as (_service, guard):
            offered = self.offered(self.entry.pk)
            self.assertEqual((offered["kind"], offered["disabled"]), ("undo", ""))
            guard.assert_not_called()
            FiledPeriod.objects.create(business=self.business, year=2026, month=9)
            offered = self.offered(self.entry.pk)
            guard.assert_not_called()  # Offering an action does not dispatch a purchase writer.
        self.assertEqual(offered["disabled"], "September 2026's GSTR-3B is filed for KIRAN GOLD HOUSE, with this bill's credit "
                                              "in it, so it can't be deleted. Have the owner unlock September 2026 in GST returns first.")

    def test_preledger_purchase_restore_is_refused_in_a_locked_bill_month_as_offered(self):
        old = sale(self.business, self.supplier, "OLD-9", "2024-09-01", kind="inward")
        entry = AuditLog.objects.create(action="created", entity="invoice", entity_id=old.pk,
                                        entity_name="Purchase OLD-9", user=self.owner)
        undone = self.client.post(f"/api/audit/{entry.pk}/undo/")
        self.assertEqual(undone.status_code, 200, undone.data)
        deleted = undone.data["new_entry"]["id"]
        lock = FiledPeriod.objects.create(business=self.business, year=2024, month=9)
        words = ("September 2024 is filed and locked for KIRAN GOLD HOUSE, so a deleted bill can't go back into it. "
                 "Have the owner unlock September 2024 in GST returns first.")
        self.assertEqual(self.offered(deleted)["disabled"], words)
        refused = self.client.post(f"/api/audit/{deleted}/restore/")
        self.assertEqual((refused.status_code, refused.data["code"], refused.data["detail"]), (409, "month_closed", words))
        self.assertEqual(refused.data["locked_period"]["id"], lock.pk)
        self.assertFalse(Invoice.objects.filter(pk=old.pk).exists())
        lock.delete()
        self.assertEqual(self.offered(deleted)["disabled"], "")
        self.assertEqual(self.client.post(f"/api/audit/{deleted}/restore/").status_code, 200)
        self.assertTrue(Invoice.objects.filter(pk=old.pk).exists())


@pytest.mark.django_db
def test_real_purchase_restore_keeps_identity_beside_another_suppliers_same_number():
    owner = person("real-purchase-audit", *ROLE_GROUPS["owner"])
    client = client_for(owner)
    business, supplier = firm(), buyer("First supplier")
    original = sale(business, supplier, "DUP-17", "2024-09-01", kind="inward")
    original_pk = original.pk
    entry = AuditLog.objects.create(action="created", entity="invoice", entity_id=original.pk,
                                    entity_name="Purchase DUP-17", user=owner)
    undone = client.post(f"/api/audit/{entry.pk}/undo/")
    assert undone.status_code == 200, undone.data
    # X-7: restore its original identity even while a different supplier uses that number.
    other = sale(business, buyer("Other supplier"), "DUP-17", "2024-09-01", kind="inward")
    restored = client.post(f"/api/audit/{undone.data['new_entry']['id']}/restore/")
    assert restored.status_code == 200, restored.data
    assert restored.data["link"] == f"/purchases/{original_pk}"
    assert Invoice.objects.get(pk=original_pk).customer_id == supplier.pk
    assert Invoice.objects.get(pk=other.pk).customer_id != supplier.pk


@pytest.mark.django_db
def test_real_purchase_audit_uses_credit_month_for_both_undo_and_restore():
    owner = person("real-purchase-credit", *ROLE_GROUPS["owner"])
    client = client_for(owner)
    business, supplier = firm(), buyer()
    original = sale(business, supplier, "CREDIT-17", "2026-09-01", kind="inward", itc_month=date(2026, 10, 1))
    entry = AuditLog.objects.create(action="created", entity="invoice", entity_id=original.pk,
                                    entity_name="Purchase CREDIT-17", user=owner)
    lock = FiledPeriod.objects.create(business=business, year=2026, month=10)
    refused = client.post(f"/api/audit/{entry.pk}/undo/")
    assert refused.status_code == 409 and refused.data["code"] == "month_closed"
    assert Invoice.objects.filter(pk=original.pk).exists()
    lock.delete()
    undone = client.post(f"/api/audit/{entry.pk}/undo/")
    assert undone.status_code == 200, undone.data
    lock = FiledPeriod.objects.create(business=business, year=2026, month=10)
    refused = client.post(f"/api/audit/{undone.data['new_entry']['id']}/restore/")
    assert refused.status_code == 409 and refused.data["code"] == "month_closed"
    assert not Invoice.objects.filter(pk=original.pk).exists()
    lock.delete()
    restored = client.post(f"/api/audit/{undone.data['new_entry']['id']}/restore/")
    assert restored.status_code == 200, restored.data
    assert Invoice.objects.get(pk=original.pk).itc_month == date(2026, 10, 1)
