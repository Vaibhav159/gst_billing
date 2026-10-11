"""Party validation must name its import row and never reinterpret a ref as a pk."""
from django.test import TestCase

from billing.models import AuditLog, Customer, Invoice
from billing.tests.test_v3_suppliers import gstin
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person


class ImportReviewTests(TestCase):
    def setUp(self):
        self.user = person("import-review-owner", *ROLE_GROUPS["owner"])
        self.client = client_for(self.user)
        self.business = firm(gstin=gstin())
        self.supplier = buyer("Existing supplier", gst_number=gstin("08ABCDE1234B1Z"))

    def bill(self, **more):
        return {"ref": "row 1", "business": self.business.pk, "supplier": self.supplier.pk,
            "customer": self.supplier.pk, "invoice_number": "1", "invoice_date": "2026-09-01", "lines": [
                {"product_name": "Synthetic", "hsn_code": "7108", "gst_percent": "0", "quantity": "1", "rate": "100", "unit": "nos"}], **more}

    def test_new_party_validation_errors_name_zero_based_row_and_roll_back(self):
        for route, key in (("purchases", "suppliers"), ("sales", "customers")):
            with self.subTest(route=route):
                response = self.client.post(f"/api/{route}/import/", {"dry_run": False, "bills": [self.bill()],
                    key: [{"ref": "first", "name": "First new party"}, {"ref": "bad", "name": ""}]}, format="json")
                self.assertEqual(response.status_code, 400, response.data)
                self.assertIn(f"{key}.1.name", response.data)
                self.assertFalse(Customer.objects.filter(name="First new party").exists())
                self.assertFalse(Invoice.objects.exists())
                self.assertFalse(AuditLog.objects.exists())

    def test_existing_party_name_errors_name_the_party_row(self):
        for route, key in (("purchases", "suppliers"), ("sales", "customers")):
            with self.subTest(route=route):
                response = self.client.post(f"/api/{route}/import/", {"bills": [self.bill()],
                    key: [{"ref": "duplicate", "name": self.supplier.name}]}, format="json")
                self.assertEqual(response.status_code, 400, response.data)
                self.assertIn(f"{key}.0.name", response.data)

    def test_supplier_gstin_conflict_names_the_party_row(self):
        self.supplier.is_supplier = True
        self.supplier.save(update_fields=["is_supplier"])
        response = self.client.post("/api/purchases/import/", {"bills": [self.bill()],
            "suppliers": [{"ref": "duplicate", "name": "Different name", "gst_number": self.supplier.gst_number}]}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("suppliers.0.gst_number", response.data)
        self.assertIn("This GSTIN belongs to Existing supplier", response.data["suppliers.0.gst_number"][0])
        self.assertFalse(Invoice.objects.exists())

    def test_unknown_numeric_string_is_a_ref_not_an_existing_party_id(self):
        for route, relation in (("purchases", "supplier"), ("sales", "customer")):
            with self.subTest(route=route):
                response = self.client.post(f"/api/{route}/import/", {"dry_run": False,
                    "bills": [self.bill(**{relation: str(self.supplier.pk)})]}, format="json")
                self.assertEqual(response.status_code, 200, response.data)
                self.assertFalse(response.data["ok"])
                self.assertEqual(response.data["bills"][0]["problems"][0]["field"], relation)
                self.assertFalse(Invoice.objects.exists())

    def test_declared_numeric_string_ref_is_resolved(self):
        response = self.client.post("/api/purchases/import/", {"dry_run": False,
            "suppliers": [{"ref": str(self.supplier.pk), "name": "New ref supplier"}],
            "bills": [self.bill(supplier=str(self.supplier.pk))]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["ok"])
        self.assertEqual(Invoice.objects.get().customer.name, "New ref supplier")
