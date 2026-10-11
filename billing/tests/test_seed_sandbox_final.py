"""The seed records its cancellation through the same service as the app."""

import tempfile
from datetime import date
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.test import TestCase, override_settings

from billing.management.commands.seed_sandbox import Command
from billing.models import AuditLog, Invoice


class SeedFinalTest(TestCase):
    def seed(self, today, *args):
        with tempfile.TemporaryDirectory(prefix="seed-final-") as media, override_settings(MEDIA_ROOT=media), \
                mock.patch.object(Command, "_assert_sandbox"), \
                mock.patch("billing.management.commands.seed_sandbox.timezone.localdate", return_value=today):
            call_command("seed_sandbox", "--scale", "0.1", *args, stdout=StringIO(), stderr=StringIO())

    def test_the_cancelled_paper_bill_has_its_audit_entry(self):
        self.seed(date(2026, 10, 15))
        cancelled = Invoice.objects.get(status="cancelled")
        audit = AuditLog.objects.filter(entity="invoice", entity_id=cancelled.pk, action="cancelled").first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.details, "Customer returned the piece the same day")
        self.assertEqual(audit.changes, {"status": {"old": "active", "new": "cancelled"}})
        self.assertIsNone(audit.user_id)
        self.assertIsNone(cancelled.cancelled_by_id)
