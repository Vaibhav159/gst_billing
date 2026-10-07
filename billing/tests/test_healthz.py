"""/healthz — the uptime monitor's view of the app.

Docker's healthchecks (the image's, the web container's and nginx's) call
/healthz every 30 seconds. It used to run SELECT 1 each time, so production's
Neon database got a query about every 15 seconds and never had the 5 idle
minutes it needs to scale to zero: from the v2.0.5 deploy (2 Sep 2026) it ran
around the clock, about 440 hours, and the free plan's monthly compute ran out
on about the 20th. Liveness now leaves the database alone; the database check
runs only when asked for (?db=1).
"""

from unittest.mock import patch

from django.test import Client, TestCase


class HealthzTest(TestCase):
    def test_liveness_never_touches_the_database(self):
        with self.assertNumQueries(0):
            resp = Client().get("/healthz")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"ok": True})

    def test_liveness_stays_up_while_the_database_is_down(self):
        # Restarting the web container never fixes Neon: down is for ?db=1.
        from django.db import connection

        with patch.object(connection, "cursor", side_effect=OSError("db down")):
            resp = Client().get("/healthz")
        self.assertEqual(resp.status_code, 200)

    def test_the_database_check_on_request(self):
        resp = Client().get("/healthz?db=1")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"ok": True, "db": True})

    def test_503_when_the_database_is_down_and_asked_about(self):
        from django.db import connection

        with patch.object(connection, "cursor", side_effect=OSError("db down")):
            resp = Client().get("/healthz?db=1")
        self.assertEqual(resp.status_code, 503)
        self.assertEqual(resp.json(), {"ok": False, "db": False})

    def test_no_auth_required_and_not_swallowed_by_spa_fallback(self):
        resp = Client().get("/healthz")
        self.assertEqual(resp["Content-Type"], "application/json")
