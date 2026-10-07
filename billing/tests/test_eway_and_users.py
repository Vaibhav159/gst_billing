"""E-way bill and user-management writes (audit F5.5)."""

from django.contrib.auth.models import Group, User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from billing.models import AuditLog, Business, Customer, FiledPeriod, Invoice


def _client_as(role, name=None):
    user = User.objects.create_user(username=name or f"{role}_x", password="pw")
    user.groups.add(Group.objects.get_or_create(name=role)[0])
    client = APIClient()
    client.force_authenticate(user=user)
    return client


class EwayBillTests(TestCase):
    def setUp(self):
        for g in ("admin", "editor", "viewer"):
            Group.objects.get_or_create(name=g)
        self.client = _client_as("editor")
        self.biz = Business.objects.create(name="LODHA JEWELLERS", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN")
        self.cust = Customer.objects.create(name="LOCAL BUYER", state_name="RAJASTHAN")
        self.inv = Invoice.objects.create(business=self.biz, customer=self.cust, invoice_number="1",
                                          invoice_date="2026-05-10", type_of_invoice="outward", total_amount=60000)
        self.url = reverse("invoice-eway-bill", args=[self.inv.id])

    def test_get_reports_the_threshold(self):
        r = self.client.get(self.url)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["requires_eway"])
        self.inv.total_amount = 40000
        self.inv.save()
        self.assertFalse(self.client.get(self.url).data["requires_eway"])

    def test_post_saves_the_transport_details_and_logs(self):
        r = self.client.post(self.url, {"eway_bill_number": "EWB123", "transporter_name": "FAST", "vehicle_number": "RJ14AB1234", "distance_km": 320}, format="json")
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.inv.refresh_from_db()
        self.assertEqual((self.inv.eway_bill_number, self.inv.transporter_name, self.inv.vehicle_number), ("EWB123", "FAST", "RJ14AB1234"))
        self.assertEqual(self.inv.distance_km, 320)
        self.assertTrue(AuditLog.objects.filter(entity="invoice", entity_id=self.inv.id, entity_name__icontains="E-way").exists())

    def test_post_in_a_filed_period_is_refused(self):
        FiledPeriod.objects.create(business=self.biz, year=2026, month=5, workspace_id=1)
        r = self.client.post(self.url, {"eway_bill_number": "EWB999"}, format="json")
        self.assertGreaterEqual(r.status_code, 400)
        self.inv.refresh_from_db()
        self.assertNotEqual(self.inv.eway_bill_number, "EWB999")


class UserManagementTests(TestCase):
    def setUp(self):
        for g in ("admin", "editor", "viewer"):
            Group.objects.get_or_create(name=g)
        self.admin = _client_as("admin", "boss")
        self.url = reverse("user-management")

    def test_admin_creates_a_user_with_a_role(self):
        r = self.admin.post(self.url, {"username": "clerk", "password": "s3cret-pw", "role": "viewer", "email": "c@x.in"}, format="json")
        self.assertEqual(r.status_code, 201, getattr(r, "data", None))
        u = User.objects.get(username="clerk")
        self.assertTrue(u.check_password("s3cret-pw"))
        self.assertEqual([g.name for g in u.groups.all()], ["viewer"])
        self.assertEqual(r.data["role"], "viewer")

    def test_duplicate_bad_role_and_missing_password_are_400s(self):
        ok = self.admin.post(self.url, {"username": "clerk", "password": "Ledger-Lamp-42", "role": "viewer"}, format="json")
        self.assertEqual(ok.status_code, 201, getattr(ok, "data", None))
        self.assertEqual(self.admin.post(self.url, {"username": "clerk", "password": "Ledger-Lamp-42", "role": "viewer"}, format="json").status_code, 400)
        self.assertEqual(self.admin.post(self.url, {"username": "x", "password": "Ledger-Lamp-42", "role": "owner"}, format="json").status_code, 400)
        self.assertEqual(self.admin.post(self.url, {"username": "y", "role": "viewer"}, format="json").status_code, 400)
        self.assertFalse(User.objects.filter(username__in=["x", "y"]).exists())

    def test_admin_changes_role_status_and_password(self):
        r = self.admin.post(self.url, {"username": "clerk", "password": "Ledger-Lamp-42", "role": "viewer"}, format="json")
        uid = r.data["id"]
        r = self.admin.patch(self.url, {"user_id": uid, "role": "editor", "is_active": False, "password": "Teak-Drawer-77"}, format="json")
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        u = User.objects.get(id=uid)
        self.assertEqual([g.name for g in u.groups.all()], ["editor"])
        self.assertFalse(u.is_active)
        self.assertTrue(u.check_password("Teak-Drawer-77"))
        self.assertEqual(self.admin.patch(self.url, {"user_id": 999999, "role": "editor"}, format="json").status_code, 404)

    def test_weak_password_is_refused_on_create(self):
        """H3: users created through the API skipped AUTH_PASSWORD_VALIDATORS."""
        r = self.admin.post(self.url, {"username": "clerk", "password": "password", "role": "editor"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("too common", r.data["error"])
        self.assertFalse(User.objects.filter(username="clerk").exists())

    def test_weak_password_is_refused_on_reset_and_nothing_changes(self):
        clerk = User.objects.create_user(username="clerk", password="Ledger-Lamp-42")
        clerk.groups.add(Group.objects.get(name="viewer"))
        r = self.admin.patch(self.url, {"user_id": clerk.id, "password": "12345678", "role": "editor"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("entirely numeric", r.data["error"])
        clerk.refresh_from_db()
        self.assertTrue(clerk.check_password("Ledger-Lamp-42"))
        self.assertEqual([g.name for g in clerk.groups.all()], ["viewer"])

    def test_non_admins_are_locked_out(self):
        for role in ("editor", "viewer"):
            c = _client_as(role)
            self.assertEqual(c.get(self.url).status_code, 403, role)
            self.assertEqual(c.post(self.url, {"username": "z", "password": "pw", "role": "admin"}, format="json").status_code, 403, role)
            self.assertEqual(c.patch(self.url, {"user_id": 1, "role": "admin"}, format="json").status_code, 403, role)
        self.assertFalse(User.objects.filter(username="z").exists())
