import os
import tempfile
from io import StringIO
from unittest import mock

from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connections
from django.test import TestCase, override_settings

from billing.constants import B2CL_THRESHOLD
from billing.management.commands.seed_sandbox import Command
from billing.models import Business, FiledPeriod, Invoice, InwardCapture, LineItem, UserPreference
from billing.roles import ROLES as V3_ROLES
from billing.roles import role_of
from billing.tax_rules import is_interstate


@override_settings(MEDIA_ROOT=tempfile.mkdtemp(prefix="seed-sandbox-"))
class SeedSandboxTest(TestCase):
    def _seed(self, *args):
        # The guard admits SQLite or the sandbox's own Postgres. CircleCI and
        # the release gate run pytest on Postgres, whose test database
        # (test_circle_test) is neither, so these tests step past it; the
        # guard has tests of its own below.
        out = StringIO()
        with mock.patch.object(Command, "_assert_sandbox"):
            call_command("seed_sandbox", "--scale", "0.1", *args, stdout=out, stderr=StringIO())
        return out.getvalue()

    def test_refuses_outside_the_sandbox(self):
        with mock.patch.dict(os.environ, {"GST_SANDBOX": ""}), self.assertRaises(CommandError):
            call_command("seed_sandbox", stdout=StringIO(), stderr=StringIO())
        self.assertFalse(Business.objects.exists())

    def test_refuses_any_postgres_but_the_sandbox_database(self):
        db = connections["default"]
        with mock.patch.dict(os.environ, {"GST_SANDBOX": "1"}), mock.patch.object(db, "vendor", "postgresql"):
            for name, host in (("neondb", "ep-cool-dew.neon.tech"), ("gst_billing", "db"), ("gst_sandbox", "10.0.0.5")):
                with self.subTest(name=name, host=host), \
                        mock.patch.dict(db.settings_dict, {"NAME": name, "HOST": host}), \
                        self.assertRaises(CommandError):
                    Command()._assert_sandbox()
            with mock.patch.dict(db.settings_dict, {"NAME": "gst_sandbox", "HOST": "db"}):
                Command()._assert_sandbox()  # the sandbox's own database is admitted

    def test_books_are_internally_consistent(self):
        logins = self._seed("--print-credentials").strip().splitlines()
        self.assertEqual(len(logins), 7)
        roles = [line.split("\t")[0] for line in logins]
        self.assertIn("accountant", roles)
        self.assertIn("staff", roles)
        self.assertEqual(role_of(User.objects.get(username="sandbox_accountant")), "accountant")
        staff = User.objects.get(username="sandbox_staff")
        self.assertEqual(role_of(staff), "staff")
        kiran = Business.objects.get(name="KIRAN GOLD HOUSE (SANDBOX)")
        self.assertEqual(UserPreference.objects.get(user=staff).data["defaultBusinessId"], str(kiran.id))
        for username, role in (
            ("sandbox_owner", "owner"), ("sandbox_accountant", "accountant"), ("sandbox_staff", "staff"),
        ):
            # The groups v3 assigns each role (roles.ROLES), v2's included, so v2 and a rollback agree.
            groups = User.objects.get(username=username).groups.values_list("name", flat=True)
            self.assertCountEqual(groups, V3_ROLES[role]["groups"], username)

        for inv in Invoice.objects.prefetch_related("lineitem_set"):
            lines = list(inv.lineitem_set.all())
            self.assertTrue(lines, inv.invoice_number)
            self.assertEqual(inv.total_amount, sum(li.amount for li in lines), inv.invoice_number)

        for li in LineItem.objects.select_related("invoice__business", "invoice__customer"):
            if is_interstate(li.invoice.business, li.invoice.customer):
                self.assertEqual(li.cgst + li.sgst, 0)
            else:
                self.assertEqual(li.igst, 0)

        b2cl = Invoice.objects.get(customer__name="Arjun Nair")
        self.assertGreater(b2cl.total_amount, B2CL_THRESHOLD)
        self.assertTrue(FiledPeriod.objects.exists())
        self.assertEqual(InwardCapture.objects.count(), 3)

    def test_second_run_needs_reset(self):
        self._seed()
        with self.assertRaises(CommandError):
            self._seed()
        self._seed("--reset")
        self.assertEqual(Business.objects.count(), 3)
