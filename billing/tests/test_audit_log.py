"""Tests for the Audit Log system."""
from decimal import Decimal
from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth.models import User, Group
from billing.models import AuditLog, Business, Customer, Invoice, Product


class AuditLogTestCase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="testuser", password="testpass123")
        admin_group, _ = Group.objects.get_or_create(name="admin")
        self.user.groups.add(admin_group)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        self.business = Business.objects.create(
            name="Test Business", gst_number="08AAKPL4741M1Z9",
            mobile_number="9876543210", workspace_id=1,
        )
        self.customer = Customer.objects.create(
            name="Test Customer", state_name="RAJASTHAN", workspace_id=1,
        )
        self.customer.businesses.add(self.business)

    def test_create_invoice_logs_audit(self):
        """Creating an invoice should create an audit log entry."""
        res = self.client.post("/api/invoices/", {
            "invoice_number": "1",
            "invoice_date": "2025-06-01",
            "customer": self.customer.id,
            "business": self.business.id,
            "type_of_invoice": "outward",
            "total_amount": "1000.00",
        })
        self.assertEqual(res.status_code, 201)
        log = AuditLog.objects.filter(action="created", entity="invoice").first()
        self.assertIsNotNone(log)
        self.assertEqual(log.user, self.user)

    def test_update_invoice_logs_changes(self):
        """Updating an invoice should log the changes."""
        inv = Invoice.objects.create(
            invoice_number="1", invoice_date="2025-06-01",
            customer=self.customer, business=self.business,
            type_of_invoice="outward", total_amount=Decimal("1000"), workspace_id=1,
        )
        self.client.patch(f"/api/invoices/{inv.id}/", {"total_amount": "2000.00"})
        log = AuditLog.objects.filter(action="updated", entity="invoice").first()
        self.assertIsNotNone(log)
        self.assertIn("total_amount", log.changes or {})

    def test_delete_invoice_logs_with_snapshot(self):
        """Deleting an invoice should log with a snapshot for undo."""
        inv = Invoice.objects.create(
            invoice_number="DEL1", invoice_date="2025-06-01",
            customer=self.customer, business=self.business,
            type_of_invoice="outward", total_amount=Decimal("500"), workspace_id=1,
        )
        self.client.delete(f"/api/invoices/{inv.id}/")
        log = AuditLog.objects.filter(action="deleted", entity="invoice").first()
        self.assertIsNotNone(log)
        self.assertIsNotNone(log.snapshot)

    def test_audit_log_list_endpoint(self):
        """GET /api/audit-logs/ should return paginated results."""
        AuditLog.objects.create(action="created", entity="invoice", entity_id=1, entity_name="Test")
        res = self.client.get("/api/audit-logs/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("results", res.data)

    def test_audit_log_filter_by_action(self):
        """Filter audit logs by action type."""
        AuditLog.objects.create(action="created", entity="invoice", entity_id=1, entity_name="A")
        AuditLog.objects.create(action="deleted", entity="invoice", entity_id=2, entity_name="B")
        res = self.client.get("/api/audit-logs/?action=created")
        self.assertEqual(len(res.data["results"]), 1)

    def test_audit_log_frontend_log_endpoint(self):
        """POST /api/audit-logs/log/ should create an entry."""
        res = self.client.post("/api/audit-logs/log/", {
            "action": "printed",
            "entity": "invoice",
            "entity_id": 1,
            "entity_name": "Test Invoice",
            "details": "Printed from bulk PDF",
        })
        self.assertEqual(res.status_code, 200)
        self.assertTrue(AuditLog.objects.filter(action="printed").exists())

    def test_profile_endpoint(self):
        """GET /api/profile/ should return user data."""
        res = self.client.get("/api/profile/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["username"], "testuser")

    def test_profile_update(self):
        """PATCH /api/profile/ should update user."""
        res = self.client.patch("/api/profile/", {"first_name": "Test", "last_name": "User"})
        self.assertEqual(res.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.first_name, "Test")


class GSTSummaryTestCase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="gstuser", password="testpass123")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        self.business = Business.objects.create(
            name="GST Business", gst_number="08AAKPL4741M1Z9",
            mobile_number="9876543210", workspace_id=1,
        )
        self.customer = Customer.objects.create(
            name="GST Customer", state_name="RAJASTHAN", workspace_id=1,
        )

    def test_gst_summary_endpoint(self):
        """GET /api/invoices/gst_summary/ should return rate slabs and HSN data."""
        res = self.client.get("/api/invoices/gst_summary/?start_date=2025-04-01&end_date=2026-03-31")
        self.assertEqual(res.status_code, 200)
        self.assertIn("rate_slabs", res.data)
        self.assertIn("hsn_summary", res.data)
        self.assertIn("gstr3b", res.data)

    def test_check_duplicate_endpoint(self):
        """GET /api/invoices/check_duplicate/ should detect duplicates in current FY."""
        from datetime import datetime
        # Use a date in the current FY so the FY-scoped check finds it
        today = datetime.now().date()
        fy_date = today.replace(month=max(today.month, 4), day=15) if today.month >= 4 else today.replace(year=today.year - 1, month=4, day=15)
        Invoice.objects.create(
            invoice_number="DUP1", invoice_date=fy_date,
            customer=self.customer, business=self.business,
            type_of_invoice="outward", total_amount=Decimal("1000"), workspace_id=1,
        )
        res = self.client.get(f"/api/invoices/check_duplicate/?invoice_number=DUP1&business_id={self.business.id}")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["exists"])

    def test_check_duplicate_not_found(self):
        """Non-existing invoice should return exists=False."""
        res = self.client.get(f"/api/invoices/check_duplicate/?invoice_number=NONEXIST&business_id={self.business.id}")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data["exists"])
