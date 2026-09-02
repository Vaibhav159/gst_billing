"""/healthz — the uptime monitor's view of the app."""

from unittest.mock import patch

from django.test import Client, TestCase


class HealthzTest(TestCase):
    def test_ok_when_db_answers(self):
        resp = Client().get("/healthz")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"ok": True, "db": True})

    def test_503_when_db_is_down(self):
        from django.db import connection

        with patch.object(connection, "cursor", side_effect=OSError("db down")):
            resp = Client().get("/healthz")
        self.assertEqual(resp.status_code, 503)
        self.assertEqual(resp.json(), {"ok": False, "db": False})

    def test_no_auth_required_and_not_swallowed_by_spa_fallback(self):
        resp = Client().get("/healthz")
        self.assertEqual(resp["Content-Type"], "application/json")
