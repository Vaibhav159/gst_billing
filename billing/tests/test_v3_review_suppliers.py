"""Review round: safe supplier collisions, auditable changes and bounded list reads."""
from unittest.mock import patch

from django.db import IntegrityError, connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from billing.models import AuditLog, Customer
from billing.tests.v3_helpers import buyer, client_for, firm, person, sale


class ReviewSupplierTests(TestCase):
    def setUp(self):
        self.owner = person("supplier-review", "admin")
        self.client = client_for(self.owner)
        self.business = firm()
        self.supplier = buyer("Review Supplier", is_supplier=True, city="Udaipur")

    def test_integrity_failure_without_visible_conflict_has_safe_400(self):
        with patch.object(Customer, "save", side_effect=IntegrityError("private database detail")):
            response = self.client.post("/api/suppliers/", {"name": "New supplier"}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data, {"name": ["This supplier couldn't be saved. Check the supplier details and try again."]})
        self.assertFalse(Customer.objects.filter(name="New supplier").exists())
        self.assertFalse(AuditLog.objects.exists())

    def test_supplier_update_audit_has_only_changed_fields(self):
        response = self.client.put(f"/api/suppliers/{self.supplier.pk}/",
                                   {"name": self.supplier.name, "city": "Jaipur"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        entry = AuditLog.objects.get(action="updated", entity="customer", entity_id=self.supplier.pk)
        self.assertEqual(entry.details, "Supplier details updated")
        self.assertEqual(entry.changes, {"city": {"old": "Udaipur", "new": "Jaipur"}})

    def test_supplier_list_reads_only_its_page_and_sums_all_matches(self):
        Customer.objects.bulk_create([Customer(name=f"Other supplier {index:03}", is_supplier=True) for index in range(50)])
        sale(self.business, self.supplier, "P1", "2026-09-01", kind="inward")
        self.client.get("/api/suppliers/", {"fy": "2026-27", "page_size": 2})
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get("/api/suppliers/", {"fy": "2026-27", "page_size": 2})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 51)
        self.assertEqual(len(response.data["results"]), 2)
        self.assertEqual(response.data["results"][0]["id"], self.supplier.pk)
        self.assertEqual(response.data["summary"], {"suppliers": 51, "bills": 1, "total": "10300.00", "tax": "300.00"})
        customer_rows = [query["sql"] for query in queries if query["sql"].startswith('SELECT "billing_customer".')]
        self.assertTrue(customer_rows)
        for sql in customer_rows:
            self.assertIn("LIMIT 2", sql)

    def test_legacy_purchase_without_flag_is_a_supplier_in_both_registers(self):
        legacy = buyer("Legacy supplier")
        sale(self.business, legacy, "OLD", "2026-09-01", kind="inward")
        self.assertFalse(Customer.objects.get(pk=legacy.pk).is_supplier)
        for path in ("/api/suppliers/", "/api/customers/"):
            response = self.client.get(path, {"role": "suppliers", "fy": "2026-27"})
            self.assertIn(legacy.pk, [row["id"] for row in response.data["results"]])
        response = self.client.get("/api/customers/", {"role": "customers"})
        self.assertNotIn(legacy.pk, [row["id"] for row in response.data["results"]])

    def test_plain_customer_gstin_can_be_a_separate_supplier(self):
        existing = buyer("Buyer", gst_number="08AACFU5521R1ZN")
        with patch("billing.gstin.enrich_customer"):
            response = self.client.post("/api/suppliers/", {"name": "Supplier", "gst_number": existing.gst_number}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertNotEqual(response.data["id"], existing.pk)
