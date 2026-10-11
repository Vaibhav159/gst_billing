"""X-40 integration gate: requires real 2A purchase fields, services and routes."""

import os
from datetime import date
from decimal import Decimal
from importlib import import_module
from importlib.util import find_spec

import pytest

from billing.models import BinnedInvoice, Invoice
from billing.tests.test_v3_backup_restore import purchase_payload, upload
from billing.tests.v3_helpers import buyer, client_for, firm, person

pytestmark = pytest.mark.django_db


@pytest.fixture
def part2_credit():
    if find_spec("billing.credit") is None:
        reason = "Requires 2A's billing.credit and real purchase create/bin integration (X-40)."
        if os.environ.get("GST_RESTORE_REQUIRE_PART2") == "1":
            pytest.fail(reason)
        pytest.skip(reason)
    assert "itc_month" in {field.name for field in Invoice._meta.concrete_fields}, "2A purchase fields must land"
    return import_module("billing.credit")


def restore(client, data):
    answer = client.post("/api/backup/restore/preview/", {"file": upload(data)}, format="multipart")
    assert answer.status_code == 200, answer.data
    result = client.post("/api/backup/restore/", {
        "file": upload(data), "fingerprint": answer.data["fingerprint"],
    }, format="multipart")
    assert result.status_code == 200, result.data
    return result.data


def registered_payload(number="SUP-001"):
    data = purchase_payload(number)
    data["businesses"][0]["gst_number"] = "08VRHFA2322D1ZI"
    data["customers"][0]["gst_number"] = "08WWUFP9975S1ZN"
    return data


@pytest.mark.parametrize("bill_date,effective_month", [
    (date(2025, 3, 31), None),
    (date(2025, 4, 1), date(2025, 4, 1)),
])
def test_real_purchase_restore_credit_starts_in_april_2025(part2_credit, bill_date, effective_month):
    client = client_for(person("credit-restore-owner", "admin"))
    data = registered_payload()
    data["invoices"][0].update(invoice_date=bill_date.isoformat(), itc_month=None, itc_eligible=True)
    result = restore(client, data)
    assert result["plan"]["purchases"]["add_count"] == 1
    restored = Invoice.objects.get(pk=result["added"]["purchases"][0])
    assert restored.type_of_invoice == "inward"
    assert restored.itc_month is None
    assert part2_credit.credit_month_of(restored) == effective_month
    if effective_month is None:
        options = client.get("/api/purchases/credit-months/", {
            "business_id": restored.business_id, "invoice_date": bill_date.isoformat(),
        })
        assert options.status_code == 200, options.data
        assert options.data["default"] is None
        assert options.data["options"] == []


def test_real_purchase_restore_keeps_suppliers_separate_and_sale_number_independent(part2_credit):
    client = client_for(person("identity-restore-owner", "admin"))
    data = registered_payload()
    data["customers"].append({"id": 912, "name": "Second supplier", "state_name": "RAJASTHAN",
                              "gst_number": "08DLTFT2681H1ZV"})
    first = data["invoices"][0]
    data["invoices"] = [first, {**first, "customer": 912},
                        {**first, "invoice_number": "sup/001"},
                        {**first, "type_of_invoice": "outward"}]
    result = restore(client, data)
    assert result["plan"]["purchases"]["add_count"] == 2
    assert result["plan"]["purchases"]["skip"] == [{"name": "sup/001", "why": "listed twice in the file"}]
    assert result["plan"]["bills"]["add_count"] == 1
    purchases = Invoice.objects.filter(pk__in=result["added"]["purchases"])
    assert purchases.count() == 2
    assert purchases.values("customer_id").distinct().count() == 2
    assert set(purchases.values_list("invoice_number", flat=True)) == {"SUP-001"}
    assert Invoice.objects.get(pk=result["added"]["bills"][0]).invoice_number == "SUP-001"
    again = restore(client, data)
    assert again["plan"]["purchases"]["add_count"] == 0
    assert again["plan"]["purchases"]["skip_count"] == 3
    assert Invoice.objects.count() == 3


def test_real_purchase_bin_restore_uses_supplier_identity_and_original_contents(part2_credit):
    client = client_for(person("bin-restore-owner", "admin"))
    business = firm(gstin="08VRHFA2322D1ZI")
    first = buyer("First supplier", gst_number="08WWUFP9975S1ZN")
    second = buyer("Second supplier", gst_number="08DLTFT2681H1ZV")
    originals = []
    for supplier in (first, second):
        created = client.post("/api/purchases/", {
            "business": business.pk, "supplier": supplier.pk,
            "invoice_number": "SUP-001", "invoice_date": "2025-03-31", "itc_month": None,
            "lines": [{"product_name": "Silver", "hsn_code": "711311", "gst_percent": "3",
                       "quantity": "1", "unit": "gms", "rate": "10000", "note": ""}],
        }, format="json")
        assert created.status_code == 201, created.data
        originals.append(created.data["id"])
        deleted = client.delete(f"/api/purchases/{created.data['id']}/", {"reason": "Backup restore test"}, format="json")
        assert deleted.status_code == 200, deleted.data
    assert not Invoice.objects.exists()
    data = registered_payload("sup/001")
    data["businesses"][0].update(name=business.name, gst_number=business.gst_number)
    data["customers"][0].update(name=second.name, gst_number=second.gst_number)
    data["invoices"][0].update(invoice_date="2025-03-31", itc_month=None)
    result = restore(client, data)
    assert result["added"]["purchases"] == [originals[1]]
    restored = Invoice.objects.get()
    assert restored.pk == originals[1]
    assert restored.customer_id == second.pk
    assert restored.invoice_number == "SUP-001"
    assert restored.total_amount == Decimal("10300.00")
    assert restored.itc_month is None
    assert part2_credit.credit_month_of(restored) is None
    assert BinnedInvoice.objects.live().filter(original_id=originals[0]).exists()
    assert not BinnedInvoice.objects.live().filter(original_id=originals[1]).exists()
