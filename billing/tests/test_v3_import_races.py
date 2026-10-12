"""The batch mutex and duplicate rule under PostgreSQL's real row locks."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest import skipUnless

from django.contrib.auth.models import User
from django.db import close_old_connections, connection, connections
from django.test import TransactionTestCase

from billing.models import AuditLog, Invoice, ShopSetting
from billing.tests.test_v3_suppliers import gstin
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person


@skipUnless(connection.vendor == "postgresql", "PostgreSQL row-lock test")
class ImportRaceTests(TransactionTestCase):
    def test_two_batches_sharing_a_number_commit_only_the_winners_whole_batch(self):
        owner = person("batch-race", *ROLE_GROUPS["owner"])
        business = firm(gstin=gstin())
        supplier = buyer("Race Supplier", gst_number=gstin("08ABCDE1234B1Z"))
        ShopSetting.objects.get_or_create(pk=1)
        ready = Barrier(2)

        def run(suffix):
            close_old_connections()
            try:
                client = client_for(User.objects.get(pk=owner.pk))
                def bill(number):
                    return {"ref": number, "business": business.pk, "supplier": supplier.pk,
                            "invoice_number": number, "invoice_date": "2026-09-01", "lines": [
                                {"product_name": "Gold", "hsn_code": "7108", "gst_percent": "3",
                                 "quantity": "1", "rate": "100", "unit": "gms"}]}
                ready.wait(timeout=15)
                response = client.post("/api/purchases/import/", {"dry_run": False, "file_name": "Race.csv",
                    "bills": [bill("SHARED/1"), bill(f"ONLY/{suffix}")]}, format="json")
                return response.status_code, response.data
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            first, second = pool.submit(run, "1"), pool.submit(run, "2")
            results = [first.result(timeout=30), second.result(timeout=30)]
        self.assertEqual([status for status, _data in results], [200, 200])
        self.assertEqual(sorted(data["ok"] for _status, data in results), [False, True])
        loser = next(data for _status, data in results if not data["ok"])
        self.assertTrue(all(row["id"] is None for row in loser["bills"]))
        self.assertEqual(Invoice.objects.purchases().count(), 2)
        self.assertEqual(AuditLog.objects.filter(action="imported").count(), 1)
        self.assertEqual(AuditLog.objects.filter(action="created", entity="invoice").count(), 2)
