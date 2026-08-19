"""The token endpoints must rate-limit — they are the only unauthenticated
POST surface, and production ran without any throttle until 19 Aug 2026."""

from django.core.cache import cache
from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from billing.tests.test_base import BaseAPITestCase

TIGHT = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_THROTTLE_CLASSES": [],
    "DEFAULT_THROTTLE_RATES": {"login": "3/min", "token_refresh": "3/min"},
}


class LoginThrottleTest(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        cache.clear()          # throttle history lives in the cache
        self.anon = APIClient()

    def tearDown(self):
        cache.clear()
        super().tearDown()

    @override_settings(REST_FRAMEWORK=TIGHT)
    def test_login_throttles_after_the_configured_rate(self):
        url = reverse("token_obtain_pair")
        for i in range(3):
            resp = self.anon.post(url, {"username": "nobody", "password": "wrong"})
            self.assertEqual(resp.status_code, 401, f"attempt {i+1}")
        resp = self.anon.post(url, {"username": "nobody", "password": "wrong"})
        self.assertEqual(resp.status_code, 429)
        self.assertIn("Retry-After", resp.headers)

    @override_settings(REST_FRAMEWORK=TIGHT)
    def test_valid_login_inside_the_limit_still_works(self):
        resp = self.anon.post(reverse("token_obtain_pair"),
                              {"username": "testuser", "password": "testpassword"})
        self.assertEqual(resp.status_code, 200)
        self.assertIn("access", resp.data)

    @override_settings(REST_FRAMEWORK=TIGHT)
    def test_refresh_throttles_independently(self):
        login = self.anon.post(reverse("token_obtain_pair"),
                               {"username": "testuser", "password": "testpassword"})
        refresh = login.data["refresh"]
        url = reverse("token_refresh")
        cache.clear()          # spend the whole budget on refresh alone
        seen = []
        for _ in range(4):
            seen.append(self.anon.post(url, {"refresh": refresh}).status_code)
        self.assertEqual(seen[-1], 429, seen)
