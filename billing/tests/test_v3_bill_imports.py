from unittest.mock import patch

from django.test import TestCase
from rest_framework.exceptions import PermissionDenied

from billing.models import AuditLog, Customer, Invoice, LineItem
from billing.tests.test_v3_suppliers import gstin
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person


class BillImportsTests(TestCase):
    def setUp(self):
        self.owner = person("import-owner", *ROLE_GROUPS["owner"])
        self.client = client_for(self.owner)
        self.firm = firm(gstin=gstin())
        self.supplier = buyer("Bullion", gst_number=gstin("08ABCDE1234B1Z"))

    def bill(self, **more):
        return {"ref": "Sheet K rows 4–5", "business": self.firm.pk, "supplier": self.supplier.pk,
                "invoice_number": "UB/001", "invoice_date": "2026-09-01", "lines": [
                    {"product_name": "Gold", "hsn_code": "7108", "gst_percent": "3", "quantity": "2",
                     "rate": "10000", "unit": "gms"}], **more}

    def post(self, bills=None, **more):
        return self.client.post("/api/purchases/import/", {"bills": bills if bills is not None else [self.bill()],
                                "file_name": "October.xlsx", "dry_run": True, **more}, format="json")

    def test_dry_run_uses_real_money_and_writes_nothing(self):
        before = (Invoice.objects.count(), Customer.objects.count(), AuditLog.objects.count(), LineItem.objects.count())
        response = self.post()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["totals"], {"bills": 1, "total_amount": "20600.00", "credit": "600.00"})
        self.assertTrue(response.data["ok"])
        self.assertIsNone(response.data["bills"][0]["id"])
        self.assertEqual(response.data["bills"][0]["credit"]["month"], "2026-09")
        self.assertEqual(before, (Invoice.objects.count(), Customer.objects.count(), AuditLog.objects.count(), LineItem.objects.count()))

    def test_committed_batch_source_ids_and_audit(self):
        response = self.post(dry_run=False)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["ok"])
        bill = Invoice.objects.get(pk=response.data["bills"][0]["id"])
        self.assertEqual((bill.source, bill.needs_review), ("excel", False))
        self.assertIn(" · from October.xlsx, Sheet K rows 4–5", AuditLog.objects.get(entity="invoice", entity_id=bill.pk, action="created").details)
        self.assertEqual(AuditLog.objects.get(action="imported").details, "From October.xlsx · ₹20,600.00 · ITC ₹600.00")

    def test_one_invalid_row_rolls_back_valid_rows_parties_and_logs(self):
        response = self.post([self.bill(supplier="s1"), self.bill(invoice_number="UB/002", lines=[])], dry_run=False,
            suppliers=[{"ref": "s1", "name": "New Supplier", "gst_number": gstin("08ABCDE1234C1Z")}])
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["ok"])
        self.assertTrue(response.data["bills"][0]["ok"])
        self.assertFalse(response.data["bills"][1]["ok"])
        self.assertIsNone(response.data["bills"][0]["id"])
        self.assertIsNone(response.data["suppliers"][0]["id"])
        self.assertFalse(Invoice.objects.exists())
        self.assertFalse(Customer.objects.filter(name="New Supplier").exists())
        self.assertFalse(AuditLog.objects.exists())

    def test_duplicate_in_batch_or_database_is_a_problem(self):
        response = self.post([self.bill(), self.bill(ref="second", invoice_number="UB-001")], dry_run=False)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["ok"])
        self.assertIsNone(response.data["bills"][1]["duplicate"])
        self.assertTrue(response.data["bills"][1]["problems"])
        self.assertFalse(Invoice.objects.exists())
        self.post(dry_run=False)
        response = self.post([self.bill(duplicate_ok=True)], dry_run=False)
        self.assertFalse(response.data["ok"])
        self.assertEqual(Invoice.objects.count(), 1)

    def test_row_errors_keep_zero_based_paths(self):
        bad = self.bill()
        bad["lines"][0]["gst_percent"] = "2.5"
        response = self.post([bad])
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["ok"])
        self.assertEqual(response.data["bills"][0]["problems"][0]["field"], "lines.0.gst_percent")

    def test_party_refs_and_registry_are_atomic(self):
        parties = [{"ref": "s1", "name": "New Supplier", "gst_number": gstin("08ABCDE1234C1Z")}]
        with patch("billing.gstin.enrich_customer") as enrich, self.captureOnCommitCallbacks(execute=True):
            response = self.post([self.bill(supplier="s1")], suppliers=parties)
        self.assertEqual(response.status_code, 200, response.data)
        enrich.assert_not_called()
        with patch("billing.gstin.enrich_customer") as enrich, self.captureOnCommitCallbacks(execute=True):
            response = self.post([self.bill(supplier="s1")], suppliers=parties, dry_run=False)
        self.assertTrue(response.data["ok"])
        enrich.assert_called_once()
        self.assertEqual(Invoice.objects.get().customer_id, response.data["suppliers"][0]["id"])

    def test_sales_paper_rows_and_new_customer_refs(self):
        payload = {"file_name": "Sales.csv", "dry_run": False, "customers": [{"ref": "c1", "name": "New Buyer"}],
                   "bills": [{**self.bill(), "customer": "c1", "invoice_number": "1", "paper": False}]}
        response = self.client.post("/api/sales/import/", payload, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["ok"])
        bill = Invoice.objects.get()
        self.assertTrue(bill.paper)
        self.assertEqual(bill.type_of_invoice, "outward")
        self.assertFalse(bill.customer.is_supplier)
        self.assertEqual(response.data["totals"]["credit"], "0.00")
        self.assertEqual(response.data["customers"][0]["id"], bill.customer_id)

    def test_between_firms_pair_makes_one_sale_and_one_linked_purchase(self):
        seller = firm("Seller", gstin=self.supplier.gst_number)
        response = self.post([self.bill(pair={"seller": seller.pk, "invoice_number": "31"})], dry_run=False, file_name="")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["ok"])
        purchase = Invoice.objects.get(type_of_invoice="inward")
        sale = Invoice.objects.get(type_of_invoice="outward")
        self.assertEqual((purchase.linked_sale, purchase.source, sale.business_id), (sale.pk, "photos", seller.pk))
        self.assertEqual(sale.customer.gst_number, self.firm.gst_number)
        self.assertEqual(AuditLog.objects.filter(action="created", entity="invoice").count(), 2)

    def test_pair_sale_failure_rolls_back_both_sides(self):
        seller = firm("Seller", gstin=self.supplier.gst_number)
        response = self.post([self.bill(pair={"seller": seller.pk, "invoice_number": "bad number"})], dry_run=False)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["ok"])
        self.assertFalse(Invoice.objects.exists())
        self.assertEqual(Customer.objects.count(), 1)

    def test_pairs_and_sales_enforce_bill_create(self):
        self.client = client_for(person("import-accountant", *ROLE_GROUPS["accountant"]))
        self.assertEqual(self.post().status_code, 200)
        for dry_run in (True, False):
            pair = self.post([self.bill(pair={"seller": self.firm.pk, "invoice_number": "1"})], dry_run=dry_run)
            self.assertEqual((pair.status_code, pair.data["needs"]), (403, "bill.create"))
        self.assertEqual(self.client.post("/api/sales/import/", {"bills": [self.bill()]}, format="json").status_code, 403)

    def test_limits_unknown_refs_and_odd_json_are_400_or_row_problems(self):
        for bills, words in [([], "There are no bills to import."), ([{}] * 301, "An import can hold at most 300 bills. Split the file.")]:
            response = self.post(bills)
            self.assertEqual((response.status_code, response.data), (400, {"bills": [words]}))
        for data in [[], None, "bad", {"bills": {}}, {"bills": [True]}, {"bills": [self.bill(supplier=[])]}]:
            response = self.client.post("/api/purchases/import/", data, format="json")
            self.assertIn(response.status_code, (200, 400))
            if response.status_code == 200:
                self.assertFalse(response.data["ok"])
        self.assertEqual(self.post(suppliers=[{"ref": "s", "name": "N"}] * 101).status_code, 400)
        self.assertEqual(self.post(suppliers=[{"ref": "s", "name": "N"}, {"ref": "s", "name": "M"}]).status_code, 400)
        response = self.post([self.bill(supplier="missing")])
        self.assertFalse(response.data["ok"])

    def test_review_capture_and_client_source_cannot_be_injected(self):
        response = self.post([self.bill(needs_review=True, capture=999, source="capture")], dry_run=False, file_name="")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["ok"])
        bill = Invoice.objects.get()
        self.assertEqual((bill.needs_review, bill.source), (False, "photos"))

    def test_pair_service_rejects_preview_and_commit_before_writes(self):
        from billing.api.bill_imports import ImportSerializer
        from billing.api.body import valid
        from billing.services.purchase_imports import import_bills

        accountant = person("service-accountant", *ROLE_GROUPS["accountant"])
        seller = firm("Pair Seller", gstin=self.supplier.gst_number)
        for dry_run in (True, False):
            data = valid(ImportSerializer, {"dry_run": dry_run, "bills": [
                self.bill(pair={"seller": seller.pk, "invoice_number": "1"})]})
            with self.assertRaises(PermissionDenied) as refused:
                import_bills(data, accountant)
            self.assertEqual(refused.exception.detail["needs"], "bill.create")
            self.assertFalse(Invoice.objects.exists())
            self.assertFalse(AuditLog.objects.exists())
