"""Ruling X-64: v2's sale-create doors freeze the firm at create, as v3's do, under the firm's lock."""
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import wait as wait_for
from datetime import date
from decimal import Decimal
from io import StringIO
from threading import Event
from unittest.mock import patch

import pytest
from django.contrib import admin
from django.core.management import call_command
from django.db import close_old_connections, connection, connections, transaction
from django.test import RequestFactory, TestCase
from django.urls import reverse

from billing.models import AuditLog, Business, Invoice
from billing.numbering import lock_firms
from billing.services.bill_reads import firm_block
from billing.services.sales import firm_snapshot
from billing.tests.v3_helpers import buyer, client_for, firm, line, person, sale
from billing.utils import process_invoice_csv

LINE = {"productName": "Gold ring", "hsn": "711319", "qty": 1, "rate": 10000, "gstRate": 3}


def v2_sale(client, business, customer, number):
    return client.post("/api/invoices/", {"invoice_number": number, "invoice_date": "2026-09-01", "customer": customer.pk,
                                          "business": business.pk, "type_of_invoice": "outward"}, format="json")


class V2CreateFreezesFirmTests(TestCase):
    def setUp(self):
        self.client = client_for(person("x64-owner", "admin"))
        self.business = firm()
        self.customer = buyer()
        self.customer.businesses.add(self.business)

    def frozen(self, number):
        return Invoice.objects.get(invoice_number=number).firm_snapshot

    def test_form_create_freezes_a_sale_and_leaves_a_purchase_live(self):
        self.assertEqual(v2_sale(self.client, self.business, self.customer, "1").status_code, 201)
        self.assertEqual(self.frozen("1"), firm_snapshot(self.business))
        purchase = self.client.post("/api/invoices/", {"invoice_number": "SUP-1", "invoice_date": "2026-09-01",
                                                       "customer": self.customer.pk, "business": self.business.pk,
                                                       "type_of_invoice": "inward"}, format="json")
        self.assertEqual(purchase.status_code, 201, purchase.data)
        self.assertIsNone(self.frozen("SUP-1"))

    def test_csv_import_freezes_each_sale(self):
        header = "invoice_number,invoice_date,customer_name,product_name,quantity,rate,hsn_code,gst_tax_rate\n"
        process_invoice_csv((header + "C-1,2026-09-01,Anil Gupta,Gold ring,1,10000,711319,0.03\n").encode(), self.business.pk)
        self.assertEqual(self.frozen("C-1"), firm_snapshot(self.business))

    def test_bulk_import_freezes_sales_only(self):
        rows = [{"invoiceNumber": "B-1", "invoice_date": "2026-09-01", "customerName": "Anil Gupta", "type": "OUTWARD",
                 "total": 10300, "items": [LINE]},
                {"invoiceNumber": "SUP-2", "invoice_date": "2026-09-01", "customerName": "SJ GOLD", "type": "INWARD",
                 "customerGST": "08AACFU5521R1ZN", "total": 10300, "items": [LINE]}]
        response = self.client.post(reverse("bulk-invoice-import"), {"business_id": self.business.pk, "invoices": rows}, format="json")
        self.assertEqual((response.status_code, response.data["created"]), (201, 2), response.data)
        self.assertEqual(self.frozen("B-1"), firm_snapshot(self.business))
        self.assertIsNone(self.frozen("SUP-2"))

    def test_ai_create_freezes_a_sale(self):
        response = self.client.post(reverse("ai-invoice-create"), {
            "business_id": self.business.pk, "type_of_invoice": "outward",
            "invoice_data": {"customer_name": "Anil Gupta", "invoice_number": "A-1", "invoice_date": "2026-09-01",
                             "line_items": [{"product_name": "Gold ring", "hsn_code": "711319", "quantity": 1,
                                             "rate": 10000, "gst_tax_rate": 0.03}]},
        }, format="json")
        self.assertIn(response.status_code, (200, 201), response.data)
        self.assertEqual(self.frozen("A-1"), firm_snapshot(self.business))

    def test_a_later_identity_edit_never_reaches_a_v2_sale(self):
        self.assertEqual(v2_sale(self.client, self.business, self.customer, "1").status_code, 201)
        response = self.client.put(f"/api/firms/{self.business.pk}/", {"name": "KIRAN NEW NAME"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        bill = Invoice.objects.select_related("business").get(invoice_number="1")
        self.assertEqual((bill.business.name, firm_block(bill)["name"]), ("KIRAN NEW NAME", "KIRAN GOLD HOUSE"))

    def test_admin_create_freezes_an_outward_bill(self):
        request = RequestFactory().post("/admin/billing/invoice/add/")
        request.user = person("admin-creator", "admin", superuser=True)
        bill = Invoice(business=self.business, customer=self.customer, invoice_number="ADMIN-1",
                       invoice_date=date(2026, 9, 1))
        admin.site._registry[Invoice].save_model(request, bill, None, change=False)
        bill.refresh_from_db()
        self.assertEqual(bill.firm_snapshot, firm_snapshot(self.business))


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("first", ["v2_create", "firm_edit"])
def test_v2_sale_made_during_a_firm_edit_prints_the_identity_it_was_made_under(first):
    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL row-lock test")
    owner = person("x64-race-owner", "admin")
    business, customer = firm(), buyer()
    customer.businesses.add(business)
    holding, release = Event(), Event()

    def in_thread(call):
        def run():
            close_old_connections()
            try:
                response = call()
                return response.status_code, response.data
            finally:
                connections.close_all()
        return run

    create = in_thread(lambda: v2_sale(client_for(owner), business, customer, "RACE-1"))
    with ThreadPoolExecutor(max_workers=2) as pool:
        if first == "v2_create":
            from billing.api import views
            original = views.assert_period_unlocked

            def paused(*args, **kwargs):
                # The create holds the firm's lock here, before its insert; the edit must wait for its commit.
                holding.set()
                assert release.wait(15), "the test never released the create"
                return original(*args, **kwargs)

            with patch.object(views, "assert_period_unlocked", paused):
                made = pool.submit(create)
                assert holding.wait(15), "the create never reached its month check"
                edit = pool.submit(in_thread(lambda: client_for(owner).put(
                    f"/api/firms/{business.pk}/", {"name": "KIRAN NEW NAME"}, format="json")))
                done, _ = wait_for([edit], timeout=1.5)
                release.set()
                assert not done, "the firm edit ran while a v2 sale was being made"
                assert made.result(timeout=25)[0] == 201
                assert edit.result(timeout=25)[0] == 200
            expected = "KIRAN GOLD HOUSE"
        else:
            with transaction.atomic():
                lock_firms(business.pk)
                Business.objects.filter(pk=business.pk).update(name="KIRAN NEW NAME")
                made = pool.submit(create)
                done, _ = wait_for([made], timeout=1.5)
                assert not done, "a v2 sale froze its firm while the firm was being edited"
            assert made.result(timeout=25)[0] == 201
            expected = "KIRAN NEW NAME"
    bill = Invoice.objects.select_related("business").get(invoice_number="RACE-1")
    assert bill.firm_snapshot["name"] == expected
    assert firm_block(bill)["name"] == expected
    assert Business.objects.get(pk=business.pk).name == "KIRAN NEW NAME"


@pytest.mark.django_db(transaction=True)
def test_v2_move_waits_for_new_firm_identity_and_freezes_it():
    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL row-lock test")
    from billing.tests.test_v3_restore_lock_order import wait_for_lock_waiter

    original, target, customer = firm(), firm("TARGET FIRM"), buyer()
    bill = Invoice.objects.create(business=original, customer=customer, invoice_number="MOVE-1",
                                   invoice_date="2026-09-01", firm_snapshot=firm_snapshot(original))
    started = Event()

    def move():
        close_old_connections()
        try:
            row = Invoice.objects.get(pk=bill.pk)
            row.business_id = target.pk
            started.set()
            row.save_from_v2()
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=1) as pool:
        with transaction.atomic():
            lock_firms(target.pk)
            Business.objects.filter(pk=target.pk).update(name="NEW TARGET NAME")
            moved = pool.submit(move)
            assert started.wait(10)
            waited = wait_for_lock_waiter()
        moved.result(timeout=20)
    assert waited, "The v2 move did not wait for the firm's identity edit"
    bill.refresh_from_db()
    assert bill.firm_snapshot["name"] == "NEW TARGET NAME"


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("door", ["move", "form", "csv", "bulk", "ai", "admin"])
def test_v2_bill_heads_and_snapshot_use_the_firm_after_its_identity_lock(door):
    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL row-lock test")
    from billing.services.line_items import build_line_items
    from billing.tests.test_v3_restore_lock_order import wait_for_lock_waiter

    owner = person("firm-tax-race-owner", "admin", superuser=True)
    original, target, customer = firm(), firm("TARGET FIRM"), buyer()
    customer.businesses.add(target)
    number = "TAX-RACE"
    if door == "move":
        existing = sale(original, customer, number, date(2026, 9, 1), firm_snapshot=firm_snapshot(original))

    def write():
        close_old_connections()
        try:
            client = client_for(owner)
            if door == "move":
                row = Invoice.objects.get(pk=existing.pk)
                row.business = target
                row.save_from_v2()
            elif door == "form":
                response = client.post("/api/invoices/", {"invoice_number": number, "invoice_date": "2026-09-01",
                    "customer": customer.pk, "business": target.pk, "type_of_invoice": "outward",
                    "line_items": [{**line(), "cgst": "150", "sgst": "150", "igst": "0", "amount": "10300"}]}, format="json")
                assert response.status_code == 201, response.data
            elif door == "csv":
                header = "invoice_number,invoice_date,customer_name,product_name,quantity,rate,hsn_code,gst_tax_rate\n"
                result = process_invoice_csv((header + f"{number},2026-09-01,Anil Gupta,Silver,1,10000,711311,0.03\n").encode(), target.pk)
                assert result["invoices_created"] == 1, result
            elif door == "bulk":
                response = client.post(reverse("bulk-invoice-import"), {"business_id": target.pk, "invoices": [{
                    "invoiceNumber": number, "invoice_date": "2026-09-01", "customerName": customer.name,
                    "type": "OUTWARD", "total": 10300, "items": [LINE]}]}, format="json")
                assert (response.status_code, response.data["created"]) == (201, 1), response.data
            elif door == "ai":
                response = client.post(reverse("ai-invoice-create"), {"business_id": target.pk, "type_of_invoice": "outward",
                    "invoice_data": {"customer_name": customer.name, "invoice_number": number, "invoice_date": "2026-09-01", "line_items": [line()]}}, format="json")
                assert response.status_code in (200, 201), response.data
            else:
                request = RequestFactory().post("/admin/billing/invoice/add/")
                request.user = owner
                row = Invoice(business=target, customer=customer, invoice_number=number, invoice_date=date(2026, 9, 1))
                with transaction.atomic():
                    admin.site._registry[Invoice].save_model(request, row, None, change=False)
                    lines, total = build_line_items(row, [line()], source="api")
                    row.lineitem_set.bulk_create(lines)
                    Invoice.objects.filter(pk=row.pk).update(total_amount=total)
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=1) as pool:
        with transaction.atomic():
            lock_firms(target.pk)
            Business.objects.filter(pk=target.pk).update(gst_number="27AAPFU0939F1ZV", state_name="MAHARASHTRA")
            written = pool.submit(write)
            waited = wait_for_lock_waiter()
        written.result(timeout=20)
    assert waited, f"{door} did not wait for the firm's identity edit"
    bill = Invoice.objects.get(invoice_number=number)
    assert bill.firm_snapshot["gst_number"] == "27AAPFU0939F1ZV"
    item = bill.lineitem_set.get()
    assert (item.cgst, item.sgst, item.igst) == (Decimal("0"), Decimal("0"), Decimal("300"))


@pytest.mark.django_db
@pytest.mark.parametrize("stored", ["omitted", None, {"name": "Earlier firm"}])
def test_legacy_deleted_undo_after_freezing_never_reintroduces_a_null_sale_snapshot(stored):
    from billing.services.bin import v2_snapshot

    owner, business, customer = person("legacy-undo-owner", "admin"), firm(), buyer()
    bill = sale(business, customer, "LEGACY-1", date(2026, 9, 1))
    snapshot = v2_snapshot(bill)
    if stored == "omitted":
        snapshot.pop("firm_snapshot")
    else:
        snapshot["firm_snapshot"] = stored
    entry = AuditLog.objects.create(action="deleted", entity="invoice", entity_id=bill.pk,
                                    entity_name=bill.invoice_number, snapshot=snapshot, user=owner)
    bill.delete()
    call_command("freeze_firm_snapshots", apply=True, stdout=StringIO())
    response = client_for(owner).post(f"/api/audit-logs/{entry.pk}/undo/")
    assert response.status_code == 200, response.data
    restored = Invoice.objects.get(pk=response.data["new_id"])
    assert restored.firm_snapshot == (stored if isinstance(stored, dict) else firm_snapshot(business))
    assert restored.lineitem_set.count() == 1
