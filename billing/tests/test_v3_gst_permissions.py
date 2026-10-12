from pathlib import Path

from django.test import TestCase

from billing.roles import ACTION_WHAT, can, why_not
from billing.tests.v3_helpers import ROLE_GROUPS, person


class GstPermissionsTest(TestCase):
    def test_only_owner_unlocks_and_words_match_client(self):
        for role, groups in ROLE_GROUPS.items():
            user = person(role, *groups)
            self.assertEqual(can(user, "gst.unlock"), role == "owner")
            self.assertEqual(can(user, "gst.lock"), role in ("owner", "accountant"))
            if role != "owner":
                self.assertEqual(why_not(user, "gst.unlock"),
                                 "Only the owner can unlock a filed month. Ask the owner if you need it.")
        self.assertEqual(ACTION_WHAT["gst.lock"], "lock a month again")
        client = (Path(__file__).resolve().parents[2] / "web/src/core/auth/permissions.ts").read_text()
        self.assertIn('"gst.unlock": "unlock a filed month"', client)
        self.assertIn('"gst.lock": "lock a month again"', client)
