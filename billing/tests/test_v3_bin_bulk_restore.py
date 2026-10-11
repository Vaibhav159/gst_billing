"""P4-8: the bin keeps its saved values and undo markers during bulk restore."""

from datetime import date, timedelta
from decimal import Decimal
from time import monotonic
from unittest.mock import patch

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from billing.models import AuditLog, BinnedInvoice, Business, Customer, FiledPeriod, Invoice, LineItem
from billing.numbering import refuse_taken
from billing.refusals import Refusal
from billing.services import bin as bin_service
from billing.services.line_items import build_line_items
from billing.tests.v3_helpers import buyer, firm, line, person, sale

pytestmark = pytest.mark.django_db


def binned_rows(count=1, *, business=None, customer=None, number_start=1):
    business, customer = business or firm(), customer or buyer()
    invoices = [Invoice(business=business, customer=customer, invoice_number=str(n),
                        invoice_date=date(2026, 9, 30), total_amount=Decimal("100.050"),
                        notes="Saved in the bin", firm_snapshot={"name": "Printed firm"})
                for n in range(number_start, number_start + count)]
    Invoice.objects.bulk_create(invoices, batch_size=250)
    old = timezone.now() - timedelta(days=60)
    logs, rows = [], []
    for invoice in invoices:
        invoice.created_at = old
        lines, _ = build_line_items(invoice, [line(rate="100", gst="0.0025")], source="api")
        # Historic thirds of a paisa are kept exactly; a restore never recalculates them.
        lines[0].cgst = lines[0].sgst = Decimal("0.025")
        lines[0].amount = Decimal("100.050")
        logs.append(AuditLog(action="deleted", entity="invoice", entity_id=invoice.pk,
                             entity_name=invoice.invoice_number,
                             snapshot=bin_service.v2_snapshot(invoice, lines)))
        rows.append(BinnedInvoice(original_id=invoice.pk, business=business, customer=customer,
                                  invoice_number=invoice.invoice_number, invoice_date=invoice.invoice_date,
                                  total_amount=invoice.total_amount, data={
                                      "invoice": bin_service._row(invoice, skip={"id"}),
                                      "lines": [bin_service._row(row, skip={"id", "invoice_id", "customer_id"}) for row in lines],
                                      "business_name": business.name, "customer_name": customer.name}))
    AuditLog.objects.bulk_create(logs, batch_size=250)
    for row, log in zip(rows, logs, strict=True):
        row.audit_log_id = log.pk
    BinnedInvoice.objects.bulk_create(rows, batch_size=250)
    # These temporary rows reserved real sequence ids, as the original deletes did.
    Invoice.objects.filter(pk__in=[invoice.pk for invoice in invoices])._raw_delete("default")
    return rows, business, customer, old


def test_two_thousand_bin_rows_restore_with_bounded_queries_and_history():
    owner = person("bulk-bin-owner", "admin")
    rows, _, _, made = binned_rows(2000)
    started = monotonic()
    with CaptureQueriesContext(connection) as queries, \
            patch.object(bin_service, "assert_sales_open", wraps=bin_service.assert_sales_open) as month:
        restored = bin_service.restore_many_from_bin([row.pk for row in rows], owner)
        snapshots = [bin_service.v2_snapshot(invoice, invoice._restored_lines) for invoice in restored]
    elapsed = monotonic() - started
    assert len(restored) == 2000
    assert len(queries) <= (150 if connection.vendor == "postgresql" else 650), len(queries)
    assert elapsed < 30, f"2000 bin restores took {elapsed:.2f}s"
    assert month.call_count == 1
    assert [invoice.pk for invoice in restored] == [row.original_id for row in rows]
    assert Invoice.objects.count() == LineItem.objects.count() == Invoice.history.count() == 2000
    assert BinnedInvoice.objects.live().count() == 0
    assert Invoice.objects.exclude(created_at=made).count() == 0
    assert all(snapshot["line_items"][0]["cgst"] == "0.025" for snapshot in snapshots)
    assert all(invoice.created_at == made and invoice.total_amount == Decimal("100.050") for invoice in restored)
    assert all(invoice.history_user_id == owner.pk for invoice in Invoice.history.all())
    restored_logs = dict(AuditLog.objects.filter(action="restored").values_list("entity_id", "pk"))
    for entry in AuditLog.objects.filter(action="deleted"):
        marker = entry.snapshot["_undo"]
        assert marker["log"] == restored_logs[entry.entity_id]
        assert marker["by"] == owner.pk and marker["via"] == "bin"
    if connection.vendor == "postgresql":
        locks = [query["sql"] for query in queries if "FOR UPDATE" in query["sql"] or "FOR NO KEY UPDATE" in query["sql"]]
        assert '"billing_auditlog"' in locks[0]
        assert '"billing_binnedinvoice"' in locks[1]
        assert '"billing_business"' in locks[2]
    print(f"2000 bin bills: {len(queries)} queries, {elapsed:.2f}s ({connection.vendor})")


def test_original_ids_are_kept_when_free_and_never_stolen():
    owner = person("ids-owner", "admin")
    rows, business, customer, _ = binned_rows(2)
    occupied = Invoice.objects.create(pk=rows[1].original_id, business=business, customer=customer,
                                      invoice_number="999", invoice_date=date(2026, 9, 30), total_amount=Decimal("999"))
    restored = bin_service.restore_many_from_bin([row.pk for row in rows], owner, via="audit_log")
    assert restored[0].pk == rows[0].original_id
    assert restored[1].pk != occupied.pk
    occupied.refresh_from_db()
    assert occupied.invoice_number == "999" and occupied.total_amount == Decimal("999")
    marker = AuditLog.objects.get(pk=rows[1].audit_log_id).snapshot["_undo"]
    assert marker["via"] == "audit_log"
    assert AuditLog.objects.get(pk=marker["log"]).entity_id == restored[1].pk


def test_live_case_insensitive_number_refusal_uses_canonical_words():
    owner = person("taken-owner", "admin")
    rows, business, customer, _ = binned_rows()
    row = rows[0]
    row.invoice_number = "abc/2026-27/1"
    row.data["invoice"]["invoice_number"] = row.invoice_number
    row.save(update_fields=["invoice_number", "data"])
    sale(business, customer, "ABC/2026-27/1", date(2026, 8, 1))
    with pytest.raises(Refusal) as expected:
        refuse_taken(business, row.invoice_date, row.invoice_number, bins=False)
    with pytest.raises(Refusal) as actual:
        bin_service.restore_many_from_bin([row.pk], owner)
    assert actual.value.detail == expected.value.detail
    assert BinnedInvoice.objects.live().filter(pk=row.pk).exists()


def test_other_bin_rows_and_different_exact_numbers_keep_existing_restore_rule():
    owner = person("number-rule-owner", "admin")
    rows, business, customer, _ = binned_rows()
    # A differently formatted number with the same counter does not stop the bin helper.
    sale(business, customer, "KGH/2026-27/1", date(2026, 9, 30))
    other, _, _, _ = binned_rows(business=business, customer=customer)
    restored = bin_service.restore_many_from_bin([rows[0].pk], owner)
    assert restored[0].invoice_number == "1"
    assert BinnedInvoice.objects.live().filter(pk=other[0].pk).exists()


def test_two_requested_bins_with_the_same_number_refuse_atomically():
    owner = person("twins-owner", "admin")
    first, business, customer, _ = binned_rows()
    second, _, _, _ = binned_rows(business=business, customer=customer)
    with pytest.raises(Refusal) as error:
        bin_service.restore_many_from_bin([first[0].pk, second[0].pk], owner)
    assert error.value.detail["code"] == "number_taken"
    assert Invoice.objects.count() == LineItem.objects.count() == Invoice.history.count() == 0
    assert BinnedInvoice.objects.live().count() == 2
    assert not AuditLog.objects.filter(action="restored").exists()


@pytest.mark.parametrize("missing", ["business", "customer"])
def test_missing_parties_are_refused_before_any_batch_write(missing):
    owner = person("gone-owner", "admin")
    rows, business, customer, _ = binned_rows()
    model, pk = (Business, business.pk) if missing == "business" else (Customer, customer.pk)
    with connection.cursor() as cursor:
        cursor.execute(f"DELETE FROM {connection.ops.quote_name(model._meta.db_table)} WHERE id = %s", [pk])
    with pytest.raises(Refusal) as error:
        bin_service.restore_many_from_bin([rows[0].pk], owner)
    assert error.value.detail["code"] == ("firm_gone" if missing == "business" else "customer_gone")
    assert not Invoice.objects.exists()


def test_closed_month_refuses_and_explicit_bypass_keeps_bin_date():
    owner = person("month-owner", "admin")
    rows, business, _, _ = binned_rows(2)
    FiledPeriod.objects.create(business=business, year=2026, month=9)
    with pytest.raises(Refusal) as error:
        bin_service.restore_many_from_bin([row.pk for row in rows], owner)
    assert error.value.detail["code"] == "month_closed"
    assert not Invoice.objects.exists()
    restored = bin_service.restore_many_from_bin([row.pk for row in rows], owner, check_month=False)
    assert all(invoice.invoice_date == date(2026, 9, 30) for invoice in restored)


def test_v2_undo_marker_is_respected_and_names_its_new_invoice_id():
    owner = person("undo-owner", "admin")
    rows, business, customer, _ = binned_rows()
    invoice = sale(business, customer, "renumbered-7", date(2026, 9, 30))
    log = AuditLog.objects.create(action="created", entity="invoice", entity_id=invoice.pk, entity_name="Back")
    entry = AuditLog.objects.get(pk=rows[0].audit_log_id)
    bin_service.mark_undone(entry, owner, log)
    with pytest.raises(Refusal) as error:
        bin_service.restore_many_from_bin([rows[0].pk], owner)
    assert error.value.detail["code"] == "already_restored"
    assert error.value.detail["bill"]["id"] == invoice.pk
    assert "Audit log" in error.value.detail["detail"]


def test_late_audit_failure_rolls_back_all_rows_markers_and_history():
    owner = person("rollback-owner", "admin")
    rows, _, _, _ = binned_rows(3)
    with patch.object(AuditLog.objects, "bulk_update", side_effect=RuntimeError("late audit failure")), \
            pytest.raises(RuntimeError, match="late audit failure"):
        bin_service.restore_many_from_bin([row.pk for row in rows], owner)
    assert Invoice.objects.count() == LineItem.objects.count() == Invoice.history.count() == 0
    assert BinnedInvoice.objects.filter(restored_at__isnull=True).count() == 3
    assert not AuditLog.objects.filter(action="restored").exists()
    assert all("_undo" not in row.snapshot for row in AuditLog.objects.filter(action="deleted"))


def test_empty_restore_is_a_noop():
    with CaptureQueriesContext(connection) as queries:
        assert bin_service.restore_many_from_bin([], None) == []
    assert len(queries) == 0


def test_sales_bulk_helper_refuses_purchase_bins_before_any_writes():
    owner = person("sales-only-owner", "admin")
    rows, _, _, _ = binned_rows(2)
    inward = rows[1]
    inward.type_of_invoice = "inward"
    inward.data["invoice"]["type_of_invoice"] = "inward"
    inward.save(update_fields=["type_of_invoice", "data"])
    with pytest.raises(BinnedInvoice.DoesNotExist):
        bin_service.restore_many_from_bin([row.pk for row in rows], owner)
    assert not Invoice.objects.exists()
    assert BinnedInvoice.objects.live().count() == 2
