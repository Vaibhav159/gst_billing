"""X-89: every legacy sales writer respects GSTR-1 without locking purchases."""
from datetime import date
from types import SimpleNamespace

import pytest
from django.contrib import admin
from django.core.exceptions import PermissionDenied
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from billing.models import AuditLog, FilingMonth, FilingRecord, Invoice, LineItem
from billing.period_lock import assert_period_unlocked
from billing.services.bin import bin_bill, v2_snapshot
from billing.services.purchase_bin import bin_purchase
from billing.tests.v3_helpers import buyer, client_for, firm, person, sale

pytestmark = pytest.mark.django_db
DAY = date(2026, 9, 1)
RAW_LINE = {"product_name": "Gold", "hsn_code": "7108", "quantity": "1", "rate": "100",
            "gst_tax_rate": "0.03", "cgst": "1.50", "sgst": "1.50", "amount": "103"}
WRITERS = ["create", "patch", "put", "delete", "replace", "line_body", "line_url", "line_action",
           "line_update", "line_delete", "eway", "merge", "ai", "bulk", "undo_create", "undo_update",
           "undo_delete", "undo_bin", "admin_create", "admin_update", "admin_delete", "admin_batch",
           "admin_line_create", "admin_line_update", "admin_line_delete", "admin_formset"]


def filed(business):
    return FilingRecord.objects.create(business=business, year=2026, month=9, kind="gstr1",
                                       filed_on=date(2026, 10, 1))


@pytest.mark.parametrize("kind", ["outward", "inward"])
@pytest.mark.parametrize("writer", WRITERS)
def test_legacy_writer_obeys_only_its_sales_lock(writer, kind):
    user = person("legacy-owner", "admin")
    client = client_for(user)
    business = firm()
    customer = buyer(gst_number="08AACFU5521R1ZN")
    customer.businesses.add(business)
    bill = sale(business, customer, "OLD-1", DAY, kind=kind)
    line = bill.lineitem_set.first()
    method, url, body = "post", "/api/invoices/", {}
    header = {"business": business.pk, "customer": customer.pk, "invoice_number": "NEW-1",
              "invoice_date": DAY.isoformat(), "type_of_invoice": kind}
    callback = None
    if writer == "create":
        body = {**header, "line_items": [RAW_LINE]}
    elif writer in ("patch", "put"):
        method, url, body = writer, f"/api/invoices/{bill.pk}/", {**header, "payment_mode": "cash"}
    elif writer == "delete":
        method, url = "delete", f"/api/invoices/{bill.pk}/"
    elif writer == "replace":
        url, body = f"/api/invoices/{bill.pk}/update_line_items/", {"line_items": [RAW_LINE]}
    elif writer == "line_body":
        url, body = "/api/line-items/", {"invoice": bill.pk, **RAW_LINE}
    elif writer == "line_url":
        url, body = f"/api/invoices/{bill.pk}/line-items/", RAW_LINE
    elif writer == "line_action":
        url, body = "/api/line-items/create_for_invoice/", {"invoice_id": bill.pk, "item_name": "Gold", "qty": "1", "rate": "100"}
    elif writer == "line_update":
        method, url, body = "patch", f"/api/line-items/{line.pk}/", {"product_name": "Changed"}
    elif writer == "line_delete":
        method, url = "delete", f"/api/line-items/{line.pk}/"
    elif writer == "eway":
        url, body = f"/api/invoices/{bill.pk}/eway_bill/", {"eway_bill_number": "1234"}
    elif writer == "merge":
        target = buyer("New customer", gst_number=customer.gst_number)
        url, body = "/api/customers/merge/", {"source_id": customer.pk, "target_id": target.pk}
    elif writer == "ai":
        url, body = "/api/ai/create-invoice/", {"business_id": business.pk, "type_of_invoice": kind,
            "invoice_data": {"customer_name": customer.name, "customer_gst_number": customer.gst_number,
                "invoice_number": "NEW-1", "invoice_date": DAY.isoformat(), "line_items": [RAW_LINE]}}
        from django.urls import reverse
        url = reverse("ai-invoice-create")
    elif writer == "bulk":
        from django.urls import reverse
        url = reverse("bulk-invoice-import")
        body = {"business_id": business.pk, "invoices": [{"invoiceNumber": "NEW-1", "invoice_date": DAY.isoformat(),
            "customerName": customer.name, "customerGST": customer.gst_number, "type": kind.upper(), "total": "103",
            "items": [{"productName": "Gold", "hsn": "7108", "qty": 1, "rate": 100, "gstRate": 3, "amount": 103}]}]}
    elif writer.startswith("undo_"):
        if writer == "undo_bin":
            binned = bin_purchase(bill, user) if kind == "inward" else bin_bill(bill, user)[0]
            entry = AuditLog.objects.get(pk=binned.audit_log_id)
        else:
            action = {"undo_create": "created", "undo_update": "updated", "undo_delete": "deleted"}[writer]
            entry = AuditLog.objects.create(action=action, entity="invoice", entity_id=bill.pk,
                                            snapshot=v2_snapshot(bill), user=user)
            if writer == "undo_delete":
                bill.delete()
        url = f"/api/audit-logs/{entry.pk}/undo/"
    elif writer.startswith("admin_"):
        def callback():
            request = SimpleNamespace(user=user)
            invoice_admin, line_admin = admin.site._registry[Invoice], admin.site._registry[LineItem]
            if writer == "admin_create":
                made = Invoice(business=business, customer=customer, invoice_number="NEW-1", invoice_date=DAY, type_of_invoice=kind)
                invoice_admin.save_model(request, made, None, False)
            elif writer == "admin_update":
                bill.payment_mode = "cash"
                invoice_admin.save_model(request, bill, None, True)
            elif writer == "admin_delete":
                invoice_admin.delete_model(request, bill)
            elif writer == "admin_batch":
                invoice_admin.delete_queryset(request, Invoice.objects.filter(pk=bill.pk))
            elif writer == "admin_formset":
                made = LineItem(invoice=bill, customer=customer, **RAW_LINE)
                invoice_admin.save_formset(request, SimpleNamespace(instance=bill), SimpleNamespace(save=lambda: made.save()), True)
            elif writer == "admin_line_delete":
                line_admin.delete_model(request, line)
            else:
                made = LineItem(invoice=bill, customer=customer, **RAW_LINE) if writer == "admin_line_create" else line
                made.product_name = "Changed"
                line_admin.save_model(request, made, None, writer == "admin_line_update")

    filed(business)
    before = (list(Invoice.objects.values()), list(LineItem.objects.values()), list(AuditLog.objects.values()))
    if callback:
        if kind == "outward":
            with pytest.raises(PermissionDenied, match="filed and locked"):
                callback()
        else:
            callback()
    else:
        response = getattr(client, method)(url, body, format="json")
        if writer == "bulk":
            assert response.status_code == 201, response.data
            assert response.data["created"] == (0 if kind == "outward" else 1), response.data
            if kind == "outward":
                assert "filed & locked" in str(response.data["errors"])
        elif kind == "outward":
            assert response.status_code == 400, response.data
            assert set(response.data) == {"detail", "locked_period"}, response.data
            assert "filed and locked" in str(response.data)
            assert int(response.data["locked_period"]["business"]) == business.pk
        else:
            assert 200 <= response.status_code < 300, response.data
    if kind == "outward":
        assert before[:2] == (list(Invoice.objects.values()), list(LineItem.objects.values()))
        if writer != "bulk":  # Bulk keeps its existing audit row for each refused import row.
            assert before[2] == list(AuditLog.objects.values())


def test_csv_keeps_its_error_shape_and_rolls_back():
    business, customer = firm(), buyer()
    customer.businesses.add(business)
    filed(business)
    content = ("invoice_number,invoice_date,customer_name,product_name,quantity,rate,hsn_code,gst_tax_rate\n"
               f"CSV-1,2026-09-01,{customer.name},Gold,1,100,7108,0.03\n").encode()
    response = client_for(person("csv-owner", "admin")).post("/api/csv/import/", {
        "business_id": business.pk, "file": SimpleUploadedFile("bills.csv", content, content_type="text/csv")}, format="multipart")
    assert response.status_code == 400, response.data
    assert set(response.data) == {"error"}
    assert "filed and locked" in response.data["error"]
    assert not Invoice.objects.exists()


@pytest.mark.parametrize("writer", ["patch", "replace", "admin", "undo"])
@pytest.mark.parametrize("conversion", ["from_sale", "to_sale", "source_month", "target_month", "source_firm", "target_firm"])
def test_source_and_destination_both_checked(writer, conversion):
    user, business, customer = person("move-owner", "admin"), firm(), buyer()
    kind = "inward" if conversion == "to_sale" else "outward"
    day = date(2026, 10, 1) if conversion == "target_month" else DAY
    bill = sale(business, customer, "MOVE-1", day, kind=kind)
    other = firm("OTHER")
    changes = ({"business": other.pk} if conversion.endswith("_firm") else
               {"type_of_invoice": "inward"} if conversion == "from_sale" else
               {"type_of_invoice": "outward"} if conversion == "to_sale" else
               {"invoice_date": "2026-10-01"} if conversion == "source_month" else {"invoice_date": "2026-09-01"})
    filed(other if conversion == "target_firm" else business)
    if writer == "admin":
        for field, value in changes.items():
            setattr(bill, "business_id" if field == "business" else field, value)
        with pytest.raises(PermissionDenied, match="filed and locked"):
            admin.site._registry[Invoice].save_model(SimpleNamespace(user=user), bill, None, True)
        return
    client = client_for(user)
    if writer == "undo":
        snapshot = {**v2_snapshot(bill), **changes}
        entry = AuditLog.objects.create(action="updated", entity="invoice", entity_id=bill.pk, snapshot=snapshot, user=user)
        response = client.post(f"/api/audit-logs/{entry.pk}/undo/")
    elif writer == "replace":
        response = client.post(f"/api/invoices/{bill.pk}/update_line_items/", {"invoice": changes, "line_items": []}, format="json")
    else:
        response = client.patch(f"/api/invoices/{bill.pk}/", changes, format="json")
    assert response.status_code == 400, response.data
    assert "locked_period" in response.data
    bill.refresh_from_db()
    assert (bill.invoice_date, bill.type_of_invoice, bill.business_id) == (day, kind, business.pk)


@pytest.mark.parametrize("day", [DAY, "20260901", "2026-W36-2"])
def test_unlock_and_relock_handle_string_ids_and_supported_dates(day):
    from rest_framework.exceptions import ValidationError
    business = firm()
    filed(business)
    with pytest.raises(ValidationError, match="filed and locked"):
        assert_period_unlocked(str(business.pk), day)
    month = FilingMonth.objects.create(business=business, year=2026, month=9, unlocked_at=timezone.now())
    assert_period_unlocked(str(business.pk), day)
    month.unlocked_at = None
    month.save()
    with pytest.raises(ValidationError, match="filed and locked"):
        assert_period_unlocked(str(business.pk), day)


@pytest.mark.parametrize("closed_party", ["seller", "buyer"])
def test_ai_pair_checks_sales_only_for_the_seller(closed_party):
    from django.urls import reverse
    seller, purchaser = firm(), firm("BUYER", gstin="27AAPFU0939F1ZV")
    customer = buyer(gst_number=purchaser.gst_number)
    customer.businesses.add(seller)
    filed(seller if closed_party == "seller" else purchaser)
    response = client_for(person("pair-owner", "admin")).post(reverse("ai-invoice-create"), {
        "business_id": seller.pk, "inter_firm": True, "inter_firm_buyer_business_id": purchaser.pk,
        "invoice_data": {"customer_name": customer.name, "customer_gst_number": customer.gst_number,
            "invoice_number": "PAIR-1", "invoice_date": DAY.isoformat(), "line_items": [RAW_LINE]}}, format="json")
    assert response.status_code == (400 if closed_party == "seller" else 200), response.data
    assert Invoice.objects.count() == (0 if closed_party == "seller" else 2)


def test_inward_capture_remains_open_after_gstr1():
    import json
    business = firm()
    filed(business)
    response = client_for(person("inward-owner", "admin")).post("/api/inward-bills/", {
        "business_id": business.pk, "supplier_name": "Supplier", "supplier_gstin": "08AACFU5521R1ZN",
        "invoice_number": "IN-1", "invoice_date": DAY.isoformat(), "lines": json.dumps([RAW_LINE])}, format="multipart")
    assert response.status_code == 201, response.data


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("writer", ["patch", "line", "undo", "admin"])
def test_legacy_sale_waits_for_filing_and_rechecks(writer):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from unittest.mock import patch

    from django.db import close_old_connections, connection, connections, transaction

    from billing.numbering import lock_firms

    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL row-lock test")
    user, business, customer = person("race-owner", "admin"), firm(), buyer()
    bill = sale(business, customer, "RACE-1", DAY)
    line = bill.lineitem_set.first()
    entry = AuditLog.objects.create(action="updated", entity="invoice", entity_id=bill.pk,
                                    snapshot=v2_snapshot(bill), user=user)
    reached, committed = Event(), Event()

    def observed_check(*args, **kwargs):
        result = assert_period_unlocked(*args, **kwargs)
        reached.set()
        assert committed.wait(15), "filing never committed"
        return result

    def run():
        close_old_connections()
        def observe_lock(execute, sql, params, many, context):
            if '"billing_business"' in sql and "FOR NO KEY UPDATE" in sql:
                reached.set()
            return execute(sql, params, many, context)
        try:
            with connection.execute_wrapper(observe_lock):
                client = client_for(user)
                if writer == "admin":
                    try:
                        bill.payment_mode = "cash"
                        admin.site._registry[Invoice].save_model(SimpleNamespace(user=user), bill, None, True)
                    except PermissionDenied:
                        return 403
                    return 200
                if writer == "undo":
                    return client.post(f"/api/audit-logs/{entry.pk}/undo/").status_code
                url, body = (f"/api/line-items/{line.pk}/", {"product_name": "Changed"}) if writer == "line" else (
                    f"/api/invoices/{bill.pk}/", {"payment_mode": "cash"})
                return client.patch(url, body, format="json").status_code
        finally:
            connections.close_all()

    with patch("billing.api.views.assert_period_unlocked", observed_check), \
            patch("billing.admin.assert_period_unlocked", observed_check), ThreadPoolExecutor(max_workers=1) as pool:
        try:
            with transaction.atomic():
                lock_firms(business.pk)
                job = pool.submit(run)
                assert reached.wait(15), "writer reached neither firm lock nor period check"
                filed(business)
        finally:
            committed.set()
        assert job.result(timeout=25) == (403 if writer == "admin" else 400)
    bill.refresh_from_db()
    line.refresh_from_db()
    entry.refresh_from_db()
    assert bill.payment_mode == ""
    assert line.product_name == "Silver"
    assert "_undo" not in entry.snapshot
