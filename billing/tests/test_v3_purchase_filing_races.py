"""Every purchase mutation serializes with a filing on the same firm."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from datetime import date
from threading import Event
from unittest.mock import patch

import pytest
from django.db import close_old_connections, connection, connections, transaction
from django.test import override_settings

from billing.models import AuditLog, FiledPeriod, Invoice
from billing.numbering import lock_firms
from billing.services.bin import v2_snapshot
from billing.services.purchase_bin import bin_purchase
from billing.tests.test_v3_capture_files import upload
from billing.tests.v3_helpers import buyer, client_for, firm, person, sale


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("writer", [
    "create", "edit_old_firm", "edit_new_firm", "bin", "restore", "check",
    "credit_old_month", "credit_new_month", "attach", "remove",
    "undo_bin", "undo_legacy_delete", "undo_update", "undo_create",
])
def test_filing_commits_before_waiting_purchase_writer(writer, tmp_path):
    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL row-lock test")
    user = person("filing-race-owner", "admin")
    business, other = firm(), firm("SECOND FIRM")
    supplier = buyer("Filing race supplier", gst_number="08AACFU5521R1ZN")
    bill = sale(business, supplier, "SUP/17", date(2026, 8, 1), kind="inward",
                itc_month=date(2026, 9, 1), needs_review=True)
    client = client_for(user)
    payload = {"business": business.pk, "supplier": supplier.pk, "invoice_number": bill.invoice_number,
               "invoice_date": "2026-08-01", "itc_month": "2026-09", "lines": [
                   {"product_name": "Gold", "hsn_code": "7108", "quantity": "1", "rate": "100", "gst_percent": "3"}]}
    blocked_firm, blocked_month = business.pk, 9
    method, url, body, fmt = "post", "/api/purchases/", payload, "json"
    if writer == "create":
        payload["invoice_number"] = "NEW/18"
    elif writer.startswith("edit_"):
        method, url = "put", f"/api/purchases/{bill.pk}/"
        payload["business"] = other.pk
        if writer == "edit_new_firm":
            blocked_firm = other.pk
    elif writer == "bin":
        method, url, body = "delete", f"/api/purchases/{bill.pk}/", {}
    elif writer in ("restore", "undo_bin"):
        binned = bin_purchase(bill, user)
        url = (f"/api/purchases/bin/{binned.pk}/restore/" if writer == "restore"
               else f"/api/audit-logs/{binned.audit_log_id}/undo/")
        body = {}
    elif writer == "check":
        url, body = f"/api/purchases/{bill.pk}/checked/", {}
    elif writer.startswith("credit_"):
        method, url, body = "put", f"/api/purchases/{bill.pk}/credit-month/", {"itc_month": "2026-10"}
        if writer == "credit_new_month":
            blocked_month = 10
    elif writer == "attach":
        url, body, fmt = f"/api/purchases/{bill.pk}/files/", {"file": upload()}, "multipart"
    elif writer == "remove":
        Invoice.objects.filter(pk=bill.pk).update(source_file="invoices/synthetic.pdf")
        method, url, body = "delete", f"/api/purchases/{bill.pk}/files/src/", {}
    elif writer == "undo_legacy_delete":
        assert client.delete(f"/api/invoices/{bill.pk}/").status_code == 204
        entry = AuditLog.objects.get(entity="invoice", entity_id=bill.pk, action="deleted")
        url, body = f"/api/audit-logs/{entry.pk}/undo/", {}
    elif writer in ("undo_update", "undo_create"):
        entry = AuditLog.objects.create(entity="invoice", entity_id=bill.pk, user=user,
            action="updated" if writer == "undo_update" else "created", snapshot=v2_snapshot(bill))
        url, body = f"/api/audit-logs/{entry.pk}/undo/", {}

    reached, filing_committed = Event(), Event()

    def observed_check(original):
        def check(*args, **kwargs):
            result = original(*args, **kwargs)
            # A broken writer passed its month check without the firm lock. Hold it at
            # this exact point until the filing commits, then see whether it still writes.
            if original.__name__ != "assert_period_unlocked" or (
                    str(args[0]) == str(blocked_firm) and str(args[1])[:7] == f"2026-{blocked_month:02}"):
                reached.set()
                assert filing_committed.wait(15), "filing did not finish"
            return result
        return check

    def run():
        close_old_connections()
        def observe_firm_lock(execute, sql, params, many, context):
            if '"billing_business"' in sql and "FOR NO KEY UPDATE" in sql:
                reached.set()
            return execute(sql, params, many, context)
        try:
            with connection.execute_wrapper(observe_firm_lock):
                response = getattr(client_for(user), method)(url, body, format=fmt)
                return response.status_code, response.data
        finally:
            connections.close_all()

    with override_settings(MEDIA_ROOT=str(tmp_path)), ExitStack() as stack:
        from billing.api import purchase_files, views
        from billing.services import purchase_bin, purchases
        for module, name in [(purchases, "assert_purchase_open"), (purchase_bin, "assert_purchase_open"),
                             (purchase_files, "assert_purchase_open"), (views, "assert_inward_unlocked"),
                             (views, "assert_period_unlocked")]:
            stack.enter_context(patch.object(module, name, observed_check(getattr(module, name))))
        with ThreadPoolExecutor(max_workers=1) as pool:
            try:
                with transaction.atomic():
                    lock_firms(blocked_firm)
                    job = pool.submit(run)
                    assert reached.wait(15), "writer never reached the firm lock or month check"
                    FiledPeriod.objects.create(business_id=blocked_firm, year=2026, month=blocked_month)
            finally:
                filing_committed.set()
            status, data = job.result(timeout=25)
    assert status == (400 if writer.startswith("undo_") else 409), data
    if not writer.startswith("undo_"):
        assert data["code"] == "month_closed"
    if writer in ("restore", "undo_bin", "undo_legacy_delete"):
        assert not Invoice.objects.filter(type_of_invoice="inward").exists()
    else:
        saved = Invoice.objects.get(pk=bill.pk)
        assert (saved.business_id, saved.itc_month, saved.needs_review) == (business.pk, date(2026, 9, 1), True)
        assert Invoice.objects.filter(type_of_invoice="inward").count() == 1
        assert bool(saved.source_file) == (writer == "remove")
