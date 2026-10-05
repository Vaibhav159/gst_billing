"""The token endpoints must rate-limit — they are the only unauthenticated
POST surface, and production ran without any throttle until 19 Aug 2026."""

from django.core.cache import cache
from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from billing.tests.test_base import BaseAPITestCase, production_throttling

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


class LoginThrottleBehindProxiesTest(BaseAPITestCase):
    """H3: production sits behind two proxies, Cosmos then nginx, and each
    appends to X-Forwarded-For. With NUM_PROXIES unset DRF keyed the login
    throttle on the whole header, which the client starts: a new made-up
    first entry on each attempt was a fresh 10-a-minute bucket, so password
    guessing was unlimited."""

    NGINX = "172.18.0.5"    # REMOTE_ADDR as gunicorn sees it: the nginx container
    COSMOS = "172.18.0.1"   # what nginx appends: the Cosmos proxy, as nginx sees it

    def _attempt(self, xff):
        return APIClient().post(
            reverse("token_obtain_pair"), {"username": "testuser", "password": "wrong"},
            REMOTE_ADDR=self.NGINX, HTTP_X_FORWARDED_FOR=xff,
        ).status_code

    def _budget(self, prod):
        return int(prod.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["login"].split("/")[0])

    def test_rotating_x_forwarded_for_does_not_reset_the_login_limit(self):
        with production_throttling() as prod:
            budget = self._budget(prod)
            # A forged first hop on every attempt; Cosmos appends the real
            # client (203.0.113.7), nginx appends Cosmos.
            codes = [self._attempt(f"198.51.100.{i}, 203.0.113.7, {self.COSMOS}") for i in range(budget + 1)]
        self.assertEqual(codes, [401] * budget + [429])

    def test_each_real_client_keeps_its_own_budget(self):
        with production_throttling() as prod:
            for _ in range(self._budget(prod)):
                self._attempt(f"203.0.113.7, {self.COSMOS}")
            other_client = self._attempt(f"203.0.113.8, {self.COSMOS}")
            same_client = self._attempt(f"203.0.113.7, {self.COSMOS}")
        self.assertEqual((other_client, same_client), (401, 429))

    def _login_as(self, username, xff=None):
        extra = {"HTTP_X_FORWARDED_FOR": xff} if xff is not None else {}
        return APIClient().post(
            reverse("token_obtain_pair"), {"username": username, "password": "wrong"},
            REMOTE_ADDR=self.NGINX, **extra,
        ).status_code

    def test_if_the_edge_stops_naming_the_client_one_person_cannot_lock_everyone_out(self):
        """With fewer X-Forwarded-For hops than proxies (Cosmos not adding the
        client), DRF's key would be the edge's own address: one login bucket for
        everybody. The throttle falls back to the username instead."""
        for xff in (self.COSMOS, None):   # only nginx's hop / no header at all
            with self.subTest(xff=xff), production_throttling() as prod:
                for _ in range(self._budget(prod)):
                    self._login_as("testuser", xff)
                same_account = self._login_as("testuser", xff)
                other_account = self._login_as("someone-else", xff)
                self.assertEqual((same_account, other_account), (429, 401))
