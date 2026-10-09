"""/api/me/: who is signed in and what they may do (v3 reads this instead of the token's claims)."""

from django.contrib.auth.models import Group, User
from django.urls import reverse
from rest_framework.test import APIClient

from billing.tests.test_base import BaseAPITestCase


class MeAPITest(BaseAPITestCase):
    def test_owner(self):
        resp = self.client.get(reverse("me"))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["username"], "testuser")
        self.assertEqual(resp.data["role"], "owner")
        self.assertEqual(resp.data["role_label"], "Owner")
        self.assertEqual(resp.data["permissions"], "*")
        self.assertEqual(resp.data["v2_role"], "admin")
        self.assertFalse(resp.data["needs_role_choice"])

    def test_counter_staff(self):
        u = User.objects.create_user(username="rakesh", password="x", first_name="Rakesh", last_name="Soni")
        for g in ("counter_staff", "editor"):
            u.groups.add(Group.objects.get_or_create(name=g)[0])
        c = APIClient()
        c.force_authenticate(user=u)
        resp = c.get(reverse("me"))
        self.assertEqual(resp.data["role"], "staff")
        self.assertEqual(resp.data["full_name"], "Rakesh Soni")
        self.assertIn("bill.create", resp.data["permissions"])
        self.assertNotIn("bill.edit", resp.data["permissions"])
        self.assertEqual(resp.data["v2_role"], "editor")

    def test_unplaced_editor_needs_a_choice(self):
        u = User.objects.create_user(username="old_editor", password="x")
        u.groups.add(Group.objects.get_or_create(name="editor")[0])
        c = APIClient()
        c.force_authenticate(user=u)
        self.assertTrue(c.get(reverse("me")).data["needs_role_choice"])

    def test_signed_out_is_401(self):
        self.assertEqual(APIClient().get(reverse("me")).status_code, 401)
