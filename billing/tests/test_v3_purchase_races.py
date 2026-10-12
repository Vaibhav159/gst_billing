"""Purchase duplicate and capture claims under PostgreSQL row locks."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from threading import Barrier
from unittest import skipUnless

from django.contrib.auth.models import User
from django.db import close_old_connections, connection, connections
from django.test import TransactionTestCase

from billing.models import Invoice, InwardCapture
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person


@skipUnless(connection.vendor == "postgresql", "PostgreSQL row-lock test")
class PurchaseRaceTests(TransactionTestCase):
    def setUp(self):
        self.owner = person("purchase-race", *ROLE_GROUPS["owner"])
        self.business = firm()
        self.supplier = buyer("Race Supplier", gst_number="08AACFU5521R1ZN")

    def race(self, payloads):
        ready = Barrier(2)

        def run(payload):
            close_old_connections()
            try:
                client = client_for(User.objects.get(pk=self.owner.pk))
                ready.wait(timeout=30)
                result = client.post("/api/purchases/", payload, format="json")
                return result.status_code, result.data
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            jobs = [pool.submit(run, payload) for payload in payloads]
            return [job.result(timeout=60) for job in jobs]

    def bill(self, number, **extra):
        return {"business": self.business.pk, "supplier": self.supplier.pk,
                "invoice_number": number, "invoice_date": date(2026, 9, 1).isoformat(),
                "lines": [{"product_name": "Gold", "hsn_code": "7108", "gst_percent": "3",
                           "quantity": "1", "rate": "100", "unit": "gms"}], **extra}

    def test_simultaneous_duplicate_saves_make_one_bill(self):
        results = self.race([self.bill("ONE/1"), self.bill("ONE-1")])
        self.assertEqual(sorted(status for status, _ in results), [201, 409])
        self.assertEqual(next(data for status, data in results if status == 409)["code"], "duplicate")
        self.assertEqual(Invoice.objects.filter(type_of_invoice="inward").count(), 1)

    def test_capture_can_be_filled_once_even_across_firms(self):
        capture = InwardCapture.objects.create(image="synthetic.jpg")
        other = firm("OTHER FIRM")
        results = self.race([self.bill("ONE/1", capture=capture.pk),
                             self.bill("TWO/2", business=other.pk, capture=capture.pk)])
        self.assertEqual(sorted(status for status, _ in results), [201, 409])
        self.assertEqual(next(data for status, data in results if status == 409)["code"], "capture_used")
        self.assertEqual(Invoice.objects.filter(type_of_invoice="inward").count(), 1)
        capture.refresh_from_db()
        self.assertEqual(capture.status, "converted")
        self.assertEqual(capture.invoice_id, next(data for status, data in results if status == 201)["id"])
