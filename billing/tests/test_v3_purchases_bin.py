"""A purchase restore retains its id, lines, source file and capture linkage."""
from datetime import date

import pytest
from django.utils import timezone

from billing.models import AuditLog, BinnedInvoice, FiledPeriod, Invoice, InwardCapture
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person, sale

pytestmark = pytest.mark.django_db


@pytest.fixture
def setup(monkeypatch):
    monkeypatch.setattr(timezone, "localdate", lambda *a, **k: date(2026, 10, 8))
    owner = person("bin-owner", *ROLE_GROUPS["owner"])
    business, supplier = firm(), buyer("Supplier", gst_number="08AACFU5521R1ZN")
    bill = sale(business, supplier, "BIN-1", date(2026, 9, 4), kind="inward",
                itc_month=date(2026, 10, 1), itc_eligible=False, source="capture", needs_review=True,
                source_file="synthetic.pdf")
    capture = InwardCapture.objects.create(image="synthetic.jpg", status="converted", invoice=bill, captured_by=owner)
    return client_for(owner), bill, capture


def test_delete_restore_and_repeated_restore(setup):
    client, bill, capture = setup
    response = client.delete(f"/api/purchases/{bill.pk}/", {"reason": "Entered twice"}, format="json")
    assert response.status_code == 200
    assert response.data["type"] == "purchase"
    assert response.data["supplier"]["name"] == "Supplier"
    assert not Invoice.objects.filter(pk=bill.pk).exists()
    binned = response.data["id"]
    deleted = client.get(f"/api/purchases/{bill.pk}/")
    assert deleted.status_code == 404
    assert deleted.data["code"] == "deleted"
    assert deleted.data["binned"]["id"] == binned
    restored = client.post(f"/api/purchases/bin/{binned}/restore/")
    assert restored.status_code == 200, restored.data
    assert restored.data["id"] == bill.pk
    assert restored.data["credit"]["chosen"] == "2026-10"
    assert not restored.data["credit"]["eligible"]
    assert restored.data["needs_review"]
    assert restored.data["files"][0]["id"] == "src"
    capture.refresh_from_db()
    assert capture.invoice_id == bill.pk
    again = client.post(f"/api/purchases/bin/{binned}/restore/")
    assert again.status_code == 409
    assert again.data["code"] == "already_restored"
    assert again.data["purchase"]["id"] == bill.pk
    assert AuditLog.objects.filter(entity_id=bill.pk, action="restored").count() == 1


def test_restore_checks_credit_month_and_never_duplicate(setup):
    client, bill, _ = setup
    binned = client.delete(f"/api/purchases/{bill.pk}/", {}, format="json").data["id"]
    sale(bill.business, bill.customer, "BIN-1", bill.invoice_date, kind="inward")
    lock = FiledPeriod.objects.create(business=bill.business, year=2026, month=10)
    response = client.post(f"/api/purchases/bin/{binned}/restore/")
    assert response.status_code == 409
    assert response.data["code"] == "month_closed"
    lock.delete()
    assert client.post(f"/api/purchases/bin/{binned}/restore/").status_code == 200


@pytest.mark.parametrize("gone,code", [("customer", "supplier_gone"), ("business", "firm_gone")])
def test_restore_missing_party_is_readable(setup, gone, code):
    client, bill, _ = setup
    binned = client.delete(f"/api/purchases/{bill.pk}/", {}, format="json").data["id"]
    # Binned references are deliberately constraint-free; a rollback may remove either party.
    party = getattr(bill, gone)
    type(party).objects.filter(pk=party.pk)._raw_delete("default")
    response = client.post(f"/api/purchases/bin/{binned}/restore/")
    assert response.status_code == 409
    assert response.data["code"] == code


def test_purchase_restore_does_not_accept_sale_bin_and_reason_is_bounded(setup):
    client, bill, _ = setup
    response = client.delete(f"/api/purchases/{bill.pk}/", {"reason": "x"*81}, format="json")
    assert response.status_code == 400
    assert response.data["reason"] == ["Keep the reason to 80 characters."]
    assert client.post("/api/purchases/bin/999/restore/").status_code == 404
    binned = client.delete(f"/api/purchases/{bill.pk}/", {}, format="json").data["id"]
    BinnedInvoice.objects.filter(pk=binned).update(type_of_invoice="outward")
    assert client.post(f"/api/purchases/bin/{binned}/restore/").status_code == 404


def test_preledger_delete_and_restore_stay_outside_filed_credit_months(setup):
    client, bill, _ = setup
    Invoice.objects.filter(pk=bill.pk).update(invoice_date=date(2024, 3, 10), itc_month=None)
    FiledPeriod.objects.create(business=bill.business, year=2024, month=3)
    deleted = client.delete(f"/api/purchases/{bill.pk}/", {}, format="json")
    assert deleted.status_code == 200, deleted.data
    assert not deleted.data["locked"]
    restored = client.post(f"/api/purchases/bin/{deleted.data['id']}/restore/")
    assert restored.status_code == 200, restored.data
    assert restored.data["credit"]["month"] is None and restored.data["credit"]["state"] == "outside"
    assert not restored.data["locked"]
    assert AuditLog.objects.get(entity_id=bill.pk, action="restored").details == "Back in Purchases; outside the credit ledger"
