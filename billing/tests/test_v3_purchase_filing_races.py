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


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("writer", [
    "invoice_create", "invoice_delete", "invoice_edit_old", "invoice_edit_new", "invoice_to_inward",
    "inward_create", "line_body", "line_url", "line_action", "line_update", "line_delete", "line_replace",
    "eway", "merge", "ai_inward", "ai_pair", "bulk", "gstr2a",
    "undo_old_firm", "undo_new_firm", "undo_to_inward",
    "admin_create", "admin_delete", "admin_line_create", "admin_line_update", "admin_line_delete", "admin_formset",
])
def test_legacy_purchase_writer_waits_for_filing(writer, tmp_path):
    """The legacy doors retain their own error/report shape after waiting for a filing."""
    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL row-lock test")
    import json
    from types import SimpleNamespace

    from django.contrib import admin
    from django.core.exceptions import PermissionDenied
    from django.urls import reverse
    from rest_framework.exceptions import APIException

    from billing.models import LineItem
    from billing.tests.test_gstr2a_import import portal_file

    user = person("legacy-filing-owner", "admin")
    business, other = firm(), firm("LEGACY SECOND FIRM", gstin="27AAPFU0939F1ZV")
    supplier = buyer("Legacy filing supplier", gst_number="08AACFU5521R1ZN")
    supplier.businesses.add(business)
    bill = sale(business, supplier, "LEG/17", date(2026, 8, 1), kind="inward",
                itc_month=date(2026, 9, 1), needs_review=True)
    line = bill.lineitem_set.first()
    blocked_firm, blocked_month = business.pk, 9
    method, url, body, expected = "post", "/api/invoices/", {}, 400
    callback = None
    raw_line = {"product_name": "Gold", "hsn_code": "7108", "quantity": "1", "rate": "100", "gst_tax_rate": "0.03", "cgst": "1.50", "sgst": "1.50", "amount": "103"}
    if writer == "invoice_create":
        body = {"business": business.pk, "customer": supplier.pk, "type_of_invoice": "inward",
                "invoice_number": "NEW/18", "invoice_date": "2026-09-01", "line_items": [raw_line]}
    elif writer == "invoice_delete":
        method, url = "delete", f"/api/invoices/{bill.pk}/"
    elif writer in ("invoice_edit_old", "invoice_edit_new", "invoice_to_inward"):
        method, url, body = "patch", f"/api/invoices/{bill.pk}/", {"business": other.pk}
        if writer == "invoice_edit_new":
            blocked_firm, blocked_month = other.pk, 8
        elif writer == "invoice_to_inward":
            Invoice.objects.filter(pk=bill.pk).update(type_of_invoice="outward")
            body, blocked_month = {"type_of_invoice": "inward"}, 8
    elif writer == "inward_create":
        url, body = "/api/inward-bills/", {"business_id": business.pk, "supplier_name": supplier.name,
            "supplier_gstin": supplier.gst_number, "invoice_number": "NEW/18", "invoice_date": "2026-09-01",
            "lines": json.dumps([raw_line])}
    elif writer.startswith("line_"):
        if writer == "line_body":
            url, body = "/api/line-items/", {"invoice": bill.pk, **raw_line, "amount": "103"}
        elif writer == "line_url":
            url, body = f"/api/invoices/{bill.pk}/line-items/", raw_line
        elif writer == "line_action":
            url, body = "/api/line-items/create_for_invoice/", {"invoice_id": bill.pk, "item_name": "Gold", "qty": "1", "rate": "100"}
        elif writer == "line_update":
            method, url, body = "patch", f"/api/line-items/{line.pk}/", {"product_name": "Changed"}
        elif writer == "line_delete":
            method, url = "delete", f"/api/line-items/{line.pk}/"
        else:
            url, body = f"/api/invoices/{bill.pk}/update_line_items/", {"line_items": [raw_line]}
    elif writer == "eway":
        url, body, blocked_month = f"/api/invoices/{bill.pk}/eway_bill/", {"eway_bill_number": "1234"}, 8
    elif writer == "merge":
        target = buyer("Merged supplier", gst_number=supplier.gst_number)
        url, body, blocked_month = "/api/customers/merge/", {"source_id": supplier.pk, "target_id": target.pk}, 8
    elif writer.startswith("ai_"):
        url = reverse("ai-invoice-create")
        body = {"business_id": business.pk, "type_of_invoice": "inward", "invoice_data": {
            "customer_name": supplier.name, "customer_gst_number": supplier.gst_number,
            "invoice_number": "NEW/18", "invoice_date": "2026-09-01", "line_items": [raw_line]}}
        if writer == "ai_pair":
            body.update(type_of_invoice="outward", inter_firm=True, inter_firm_buyer_business_id=other.pk)
            blocked_firm = other.pk
    elif writer == "bulk":
        url, expected = reverse("bulk-invoice-import"), 201
        body = {"business_id": business.pk, "invoices": [{"invoiceNumber": "NEW/18", "invoice_date": "2026-09-01",
            "customerName": supplier.name, "customerGST": supplier.gst_number, "type": "INWARD", "total": "103",
            "items": [{"productName": "Gold", "hsn": "7108", "qty": 1, "rate": 100, "gstRate": 3, "amount": 103}]}]}
    elif writer == "gstr2a":
        from billing.services.gstr2a_import import import_file
        expected = 200
        def callback():
            result = import_file(portal_file(recipient_gstin=business.gst_number, rows=[[
                supplier.gst_number, supplier.name, "NEW/18", date(2026, 9, 1), 103, 100, 0, 1.5, 1.5, 0,
                "Filed", "No", "Rajasthan", "08-Rajasthan"]]), filename="2A.xlsx", dry_run=False)
            assert len(result.skipped_locked) == 1, result
            return {"created": result.created_invoices}
    elif writer.startswith("undo_"):
        snapshot = v2_snapshot(bill)
        if writer == "undo_to_inward":
            Invoice.objects.filter(pk=bill.pk).update(type_of_invoice="outward")
            blocked_month = 8
        else:
            snapshot["business"] = str(other.pk)
            if writer == "undo_new_firm":
                blocked_firm, blocked_month = other.pk, 8
        entry = AuditLog.objects.create(entity="invoice", entity_id=bill.pk, user=user,
                                       action="updated", snapshot=snapshot)
        url = f"/api/audit-logs/{entry.pk}/undo/"
    elif writer.startswith("admin_"):
        expected = 403
        request = SimpleNamespace(user=user)
        def callback():
            invoice_admin = admin.site._registry[Invoice]
            line_admin = admin.site._registry[LineItem]
            # Django admin's change/delete views wrap these hooks in one transaction.
            with transaction.atomic():
                if writer == "admin_create":
                    made = Invoice(business=business, customer=supplier, invoice_number="NEW/18",
                                   invoice_date=date(2026, 9, 1), type_of_invoice="inward")
                    invoice_admin.save_model(request, made, None, False)
                elif writer == "admin_delete":
                    invoice_admin.delete_model(request, Invoice.objects.get(pk=bill.pk))
                elif writer == "admin_formset":
                    made = LineItem(invoice=bill, customer=supplier, **raw_line)
                    formset = SimpleNamespace(save=lambda: made.save())
                    invoice_admin.save_formset(request, SimpleNamespace(instance=bill), formset, True)
                elif writer == "admin_line_delete":
                    line_admin.delete_model(request, LineItem.objects.get(pk=line.pk))
                else:
                    made = (LineItem(invoice=bill, customer=supplier, **raw_line) if writer == "admin_line_create"
                            else LineItem.objects.get(pk=line.pk))
                    made.product_name = "Changed"
                    line_admin.save_model(request, made, None, writer == "admin_line_update")
            return {}

    original_rows = list(Invoice.objects.values("pk", "business_id", "customer_id", "type_of_invoice", "itc_month", "total_amount"))
    original_lines = list(LineItem.objects.values())
    unguarded_checks = []
    firm_lock_seen = Event()
    reached, filing_committed = Event(), Event()

    def observed_check(original):
        def check(*args, **kwargs):
            matches = original.__name__ == "assert_inward_unlocked" or (
                str(args[0]) == str(blocked_firm) and str(args[1])[:7] == f"2026-{blocked_month:02}")
            if matches and not firm_lock_seen.is_set():
                unguarded_checks.append(original.__name__)
            result = original(*args, **kwargs)
            if matches:
                reached.set()
                assert filing_committed.wait(15), "filing did not finish"
            return result
        return check

    def run():
        close_old_connections()
        def observe_lock(execute, sql, params, many, context):
            firm_query = '"billing_business"' in sql and "FOR NO KEY UPDATE" in sql
            if firm_query:
                reached.set()
            result = execute(sql, params, many, context)
            if firm_query:
                firm_lock_seen.set()
            return result
        try:
            with connection.execute_wrapper(observe_lock):
                if callback:
                    try:
                        return 200, callback()
                    except APIException as error:
                        return error.status_code, error.detail
                    except PermissionDenied as error:
                        return 403, str(error)
                response = getattr(client_for(user), method)(url, body, format="multipart" if writer == "inward_create" else "json")
                return response.status_code, response.data
        finally:
            connections.close_all()

    with override_settings(MEDIA_ROOT=str(tmp_path)), ExitStack() as stack:
        from billing import admin as billing_admin
        from billing.api import inward_bills, views
        from billing.services import ai_import, bulk_import, gstr2a_import
        for module, name in [(views, "assert_period_unlocked"), (views, "assert_inward_unlocked"),
                             (inward_bills, "assert_period_unlocked"), (ai_import, "assert_period_unlocked"),
                             (bulk_import, "locked_period_or_none"), (gstr2a_import, "locked_period_or_none"),
                             (billing_admin, "assert_period_unlocked"), (billing_admin, "assert_inward_unlocked")]:
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
    assert not unguarded_checks, unguarded_checks
    assert status == expected, data
    if expected == 400:
        assert "locked_period" in data, data
    assert list(Invoice.objects.values("pk", "business_id", "customer_id", "type_of_invoice", "itc_month", "total_amount")) == original_rows
    assert list(LineItem.objects.values()) == original_lines
