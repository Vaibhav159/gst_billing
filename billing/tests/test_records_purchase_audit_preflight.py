"""P4-9/4A.11b: Audit delegates purchase identity to 2A's own bin services."""
import importlib.util
import sys
from contextlib import contextmanager
from datetime import date
from types import ModuleType
from unittest.mock import Mock, patch

import pytest
from django.test import TestCase

from billing.models import AuditLog, FiledPeriod, Invoice
from billing.services.bin import bin_bill, restore_from_bin
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person, sale


@contextmanager
def purchase_contract():
    # Only tests dispatch here. Real identity/credit tests below wait for 2A (X-40).
    credit = ModuleType("billing.credit")
    credit.credit_month_of = Mock(side_effect=lambda bill: None if bill.invoice_date < date(2025, 4, 1)
                                  else bill.itc_month or bill.invoice_date.replace(day=1))
    service = ModuleType("billing.services.purchase_bin")
    service.bin_purchase = Mock(side_effect=lambda obj, user, reason="": bin_bill(obj, user, reason, check_month=False)[0])
    service.restore_purchase = Mock(side_effect=lambda row, user, via: restore_from_bin(row, user, check_month=False, via=via))
    with patch.dict(sys.modules, {"billing.credit": credit, "billing.services.purchase_bin": service}), \
            patch("billing.period_lock.assert_purchase_open", create=True) as guard:
        yield service, guard


class PurchaseAuditDispatchTest(TestCase):
    def setUp(self):
        self.owner = person("purchase-audit-owner", *ROLE_GROUPS["owner"])
        self.client = client_for(self.owner)
        self.business, self.supplier = firm(), buyer()
        self.bill = sale(self.business, self.supplier, "SUP-17", "2026-09-01", kind="inward")
        self.entry = AuditLog.objects.create(action="created", entity="invoice", entity_id=self.bill.pk,
                                            entity_name="Purchase SUP-17", user=self.owner)

    def test_purchase_undo_and_restore_dispatch_to_the_purchase_services(self):
        with purchase_contract() as (service, guard):
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
            self.assertTrue(guard.called)
            self.assertEqual(self.client.post(f"/api/audit/{deleted}/restore/").data["code"], "already_undone")

    def test_restore_enforces_the_credit_guard_it_offered(self):
        from billing.refusals import Refusal
        with purchase_contract() as (service, guard):
            deleted = self.client.post(f"/api/audit/{self.entry.pk}/undo/").data["new_entry"]["id"]
            guard.reset_mock()
            guard.side_effect = lambda business, day, action: (_ for _ in ()).throw(
                Refusal("September 2026's GSTR-3B is filed, so a deleted purchase can't go back into it.", "period_locked",
                        stage="gstr3b", locked_period="2026-09")) if action == "restore" else None
            response = self.client.post(f"/api/audit/{deleted}/restore/")
            self.assertEqual((response.status_code, response.data["code"], response.data["stage"]), (409, "period_locked", "gstr3b"))
            service.restore_purchase.assert_not_called()
            self.assertEqual(guard.call_args.args, (self.business.pk, date(2026, 9, 1), "restore"))
            self.assertFalse(Invoice.objects.filter(pk=self.bill.pk).exists())

    def test_list_offers_purchase_undo_and_uses_its_credit_guard(self):
        with purchase_contract() as (_service, guard):
            response = self.client.get("/api/audit/")
            self.assertEqual(response.data["results"][0]["can"]["kind"], "undo")
            guard.assert_called_once_with(self.business.pk, date(2026, 9, 1), "delete")


@pytest.mark.django_db
@pytest.mark.skipif(importlib.util.find_spec("billing.services.purchase_bin") is None,
                    reason="X-40: run 4A.11b against real 2A purchase identity and credit after it lands")
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
@pytest.mark.skipif(importlib.util.find_spec("billing.services.purchase_bin") is None,
                    reason="X-40: run 4A.11b against real 2A credit-month locks after it lands")
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
