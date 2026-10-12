"""A backup restore takes its locks in the order a purchase restore does, so the two can't deadlock."""
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from unittest import skipUnless
from unittest.mock import patch

from django.contrib.auth.models import User
from django.db import close_old_connections, connection, connections, transaction
from django.test import TransactionTestCase

from billing.models import BinnedInvoice
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, firm, person, sale


def wait_for_lock_waiter(seconds=10):
    end = time.monotonic() + seconds
    with connection.cursor() as cursor:
        while time.monotonic() < end:
            # Inside a transaction Postgres keeps one snapshot of the activity view unless told to drop it.
            cursor.execute("SELECT pg_stat_clear_snapshot()")
            cursor.execute("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND pid <> pg_backend_pid()")
            if cursor.fetchone()[0]:
                return True
            time.sleep(0.05)
    return False


@skipUnless(connection.vendor == "postgresql", "PostgreSQL row-lock test")
class RestoreLockOrderTests(TransactionTestCase):
    def setUp(self):
        from billing.services.purchase_bin import bin_purchase

        self.owner = person("restore-lock-owner", *ROLE_GROUPS["owner"])
        self.business = firm()
        bill = sale(self.business, buyer("Lock Supplier", gst_number="08AACFU5521R1ZN"), "SUP-9", "2026-09-01", kind="inward")
        self.binned = bin_purchase(bill, self.owner)
        # v2 bin rows may have no audit entry, so the backup restore can't reach the row through one.
        BinnedInvoice.objects.filter(pk=self.binned.pk).update(audit_log_id=None)
        self.binned.refresh_from_db()

    def test_backup_restore_and_purchase_restore_do_not_deadlock(self):
        from billing.services import purchase_bin
        from billing.services.backup_restore import _restore_locks

        holding_bin = Event()
        real_lock_firms = purchase_bin.lock_firms
        waited = []

        def lock_firms_after_backup_waits(*ids):
            # The purchase restore holds its bin row; let the backup restore reach its next lock first.
            holding_bin.set()
            waited.append(wait_for_lock_waiter())
            return real_lock_firms(*ids)

        def purchase():
            close_old_connections()
            try:
                with patch.object(purchase_bin, "lock_firms", lock_firms_after_backup_waits):
                    purchase_bin.restore_purchase(self.binned, User.objects.get(pk=self.owner.pk))
            finally:
                connections.close_all()

        def backup():
            close_old_connections()
            try:
                holding_bin.wait(timeout=30)
                with transaction.atomic():
                    _restore_locks()
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            jobs = [pool.submit(purchase), pool.submit(backup)]
            errors = [job.exception(timeout=60) for job in jobs]
        self.assertEqual(errors, [None, None])
        self.assertEqual(waited, [True])
        self.assertIsNotNone(BinnedInvoice.objects.get(pk=self.binned.pk).restored_at)
