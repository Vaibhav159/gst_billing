"""Ruling X-64: v2's sale-create doors freeze the firm at create, as v3's do, under the firm's lock."""
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import wait as wait_for
from threading import Event
from unittest.mock import patch

import pytest
from django.db import close_old_connections, connection, connections, transaction
from django.test import TestCase
from django.urls import reverse

from billing.models import Business, Invoice
from billing.numbering import lock_firms
from billing.services.bill_reads import firm_block
from billing.services.sales import firm_snapshot
from billing.tests.v3_helpers import buyer, client_for, firm, person
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
