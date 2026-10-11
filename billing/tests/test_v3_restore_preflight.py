"""P4-8/P4-15: bounded restore writes and matching-only fingerprints."""

from datetime import date
from decimal import Decimal
from time import monotonic
from unittest.mock import patch

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from billing.cache import uncached
from billing.models import AuditLog, Invoice, LineItem
from billing.refusals import Refusal
from billing.services import backup_restore
from billing.tests.test_v3_backup_restore import payload, upload
from billing.tests.v3_helpers import buyer, client_for, firm, person, sale

pytestmark = pytest.mark.django_db


def many_bills(count=2000):
    data = payload()
    row = data["invoices"][0]
    data["invoices"] = [{**row, "invoice_number": str(n + 1)} for n in range(count)]
    return data


def test_two_thousand_bills_use_bounded_queries_and_finish_inside_budget():
    owner = person("budget-owner", "admin")
    business, customer = firm(), buyer()
    data = many_bills()
    data["businesses"][0]["name"] = business.name
    data["customers"][0]["name"] = customer.name
    answer = backup_restore.preview(upload(data))
    started = monotonic()
    with (CaptureQueriesContext(connection) as queries,
          patch.object(backup_restore, "assert_sales_open", wraps=backup_restore.assert_sales_open) as month):
        result = backup_restore.apply_restore(upload(data), answer["fingerprint"], owner)
    elapsed = monotonic() - started
    assert result["plan"]["bills"]["add_count"] == 2000
    assert Invoice.objects.count() == LineItem.objects.count() == 2000
    assert AuditLog.objects.filter(action="imported", entity="invoice").count() == 2000
    assert month.call_count <= 2, "one open/closed check per firm-month in planning and writing"
    assert len(queries) <= (120 if connection.vendor == "postgresql" else 600), len(queries)
    assert elapsed < 30, f"restore took {elapsed:.2f}s; CI must stay well inside 60s"
    first = AuditLog.objects.filter(action="imported", entity="invoice").first()
    assert first.snapshot["line_items"][0]["gst_tax_rate"] == "0.0025"
    print(f"2000 bills: {len(queries)} queries, {elapsed:.2f}s ({connection.vendor})")


def test_fingerprint_ignores_unrelated_invoice_edits_but_keeps_identity():
    owner = person("fingerprint-owner", "admin")
    existing = sale(firm(), buyer(), "9000", date(2026, 3, 31))
    data = payload()
    fingerprint = backup_restore.preview(upload(data))["fingerprint"]
    existing.notes = "An unrelated note"
    existing.save(update_fields=["notes", "updated_at"])
    assert backup_restore.preview(upload(data))["fingerprint"] == fingerprint
    existing.invoice_number = "9001"
    existing.save(update_fields=["invoice_number", "updated_at"])
    with pytest.raises(Refusal) as error:
        backup_restore.apply_restore(upload(data), fingerprint, owner)
    assert error.value.detail["code"] == "plan_changed"


def test_bulk_restore_keeps_one_history_entry_and_rolls_it_back_on_failure(monkeypatch):
    owner = person("history-owner", "admin")
    data = many_bills(2)
    answer = backup_restore.preview(upload(data))
    backup_restore.apply_restore(upload(data), answer["fingerprint"], owner)
    for invoice in Invoice.objects.all():
        entry = invoice.history.get()
        assert entry.history_type == "+" and entry.total_amount == invoice.total_amount
        assert entry.history_user_id == owner.pk
    before = Invoice.history.count()
    other = many_bills(1)
    other["invoices"][0]["invoice_number"] = "999"
    answer = backup_restore.preview(upload(other))
    def broken_audit(*args, **kwargs):
        raise RuntimeError("history rollback")
    monkeypatch.setattr(backup_restore, "_imported", broken_audit)
    with pytest.raises(RuntimeError, match="history rollback"):
        backup_restore.apply_restore(upload(other), answer["fingerprint"], owner)
    assert Invoice.history.count() == before
    assert not Invoice.objects.filter(invoice_number="999").exists()


@pytest.mark.parametrize("count", [20, 2000], ids=["small", "budget"])
def test_backup_bin_restore_uses_the_shared_batch(count):
    from billing.tests.test_v3_bin_bulk_restore import binned_rows

    owner = person("backup-bin-budget-owner", "admin")
    _, business, customer, _ = binned_rows(count)
    data = many_bills(count)
    data["businesses"][0]["name"] = business.name
    data["customers"][0]["name"] = customer.name
    for row in data["invoices"]:
        row["invoice_date"] = "2026-09-30"
    answer = backup_restore.preview(upload(data))
    started = monotonic()
    with CaptureQueriesContext(connection) as queries:
        result = backup_restore.apply_restore(upload(data), answer["fingerprint"], owner)
    elapsed = monotonic() - started
    assert result["plan"]["bills"]["add_count"] == count
    budget = 100 if count == 20 else (220 if connection.vendor == "postgresql" else 800)
    assert len(queries) <= budget, len(queries)
    assert elapsed < 30
    assert Invoice.objects.count() == Invoice.history.count() == count
    assert LineItem.objects.first().cgst == Decimal("0.025")
    assert AuditLog.objects.filter(action="imported", entity="invoice").count() == count
    print(f"{count} backup bin bills: {len(queries)} queries, {elapsed:.2f}s ({connection.vendor})")


def test_large_backup_requires_each_year_preview_and_rejects_other_year_fingerprint():
    client = client_for(person("years-owner", "admin"))
    data = many_bills(3001)
    for row in data["invoices"][1800:]:
        row["invoice_date"] = "2026-04-01"
    overview = client.post("/api/backup/restore/preview/", {"file": upload(data)}, format="multipart")
    assert overview.status_code == 200
    assert overview.data["years"] == [
        {"fy": "2025-26", "bills": 1800, "words": "Adding 2025-26: 1,800 bills…"},
        {"fy": "2026-27", "bills": 1201, "words": "Adding 2026-27: 1,201 bills…"},
    ]
    refusal = client.post("/api/backup/restore/", {
        "file": upload(data), "fingerprint": overview.data["fingerprint"],
    }, format="multipart")
    assert refusal.status_code == 409 and refusal.data["code"] == "restore_year_required"
    first = client.post("/api/backup/restore/preview/", {"file": upload(data), "fy": "2025-26"}, format="multipart")
    assert first.data["plan"]["bills"]["add_count"] == 1800
    wrong = client.post("/api/backup/restore/", {
        "file": upload(data), "fy": "2026-27", "fingerprint": first.data["fingerprint"],
    }, format="multipart")
    assert wrong.status_code == 409 and wrong.data["code"] == "plan_changed"
    assert not Invoice.objects.exists()
    for fy, expected in [("2025-26", 1800), ("2026-27", 1201)]:
        answer = client.post("/api/backup/restore/preview/", {"file": upload(data), "fy": fy}, format="multipart")
        response = client.post("/api/backup/restore/", {
            "file": upload(data), "fy": fy, "fingerprint": answer.data["fingerprint"],
        }, format="multipart")
        assert response.status_code == 200, response.data
        assert response.data["plan"]["bills"]["add_count"] == expected
    assert Invoice.objects.count() == 3001


@pytest.mark.parametrize("fy", ["2025-99", "garbage", "2024-25"])
def test_selected_year_is_validated(fy):
    client = client_for(person("invalid-year-owner", "admin"))
    response = client.post("/api/backup/restore/preview/", {"file": upload(), "fy": fy}, format="multipart")
    assert response.status_code == 400 and "fy" in response.data


def test_purchase_matcher_keeps_exclusion_and_narrow_queryset_together():
    from billing.api.inward_bills_service import find_duplicate

    business, customer = firm(), buyer()
    existing = sale(business, customer, "SUP-001", date(2026, 3, 31), kind="inward")
    queryset = uncached(Invoice).only("id", "invoice_number")
    assert find_duplicate(business, "SUP/001", customer, existing.invoice_date,
                          exclude_id=existing.pk, queryset=queryset) is None
    assert find_duplicate(business, "SUP/001", customer, existing.invoice_date,
                          exclude_id=existing.pk + 1, queryset=queryset).pk == existing.pk
