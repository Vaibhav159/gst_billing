"""/api/preferences/ — per-user settings blob so Settings roams across devices."""

from django.contrib.auth.models import User
from django.urls import reverse

from billing.models import UserPreference
from billing.tests.test_base import BaseAPITestCase


class PreferencesAPITest(BaseAPITestCase):
    def test_empty_by_default(self):
        resp = self.client.get(reverse("preferences"))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["data"], {})

    def test_patch_merges_shallowly(self):
        self.client.patch(reverse("preferences"), {"defaultBusinessId": "3"}, format="json")
        resp = self.client.patch(reverse("preferences"), {"defaultGstRate": 3}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            resp.data["data"], {"defaultBusinessId": "3", "defaultGstRate": 3}
        )

    def test_null_removes_a_key(self):
        self.client.patch(reverse("preferences"), {"showHSN": True}, format="json")
        resp = self.client.patch(reverse("preferences"), {"showHSN": None}, format="json")
        self.assertEqual(resp.data["data"], {})

    def test_rejects_non_object_and_oversize(self):
        resp = self.client.patch(reverse("preferences"), ["not", "an", "object"], format="json")
        self.assertEqual(resp.status_code, 400)
        resp = self.client.patch(
            reverse("preferences"), {"blob": "x" * 9000}, format="json"
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("too large", resp.data["error"])

    def test_isolated_per_user(self):
        self.client.patch(reverse("preferences"), {"invoicePrefix": "SGJ"}, format="json")
        other = User.objects.create_user(username="other", password="x")
        self.client.force_authenticate(user=other)
        resp = self.client.get(reverse("preferences"))
        self.assertEqual(resp.data["data"], {})
        self.assertEqual(UserPreference.objects.count(), 1)

    def test_requires_auth(self):
        self.client.force_authenticate(user=None)
        self.assertIn(
            self.client.get(reverse("preferences")).status_code, (401, 403)
        )
