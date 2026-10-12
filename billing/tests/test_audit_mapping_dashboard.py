from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from billing.models import AuditLog
from billing.services import audit
from billing.tests.test_audit_mapping_reads import AuditMappingFixture
from billing.tests.v3_helpers import ROLE_GROUPS, client_for, person


class DashboardAdapterMappingTest(AuditMappingFixture, TestCase):
    def test_latest_four_use_shared_words_and_only_the_dashboard_exclusions(self):
        from billing.services.dashboard import latest_changes

        eligible = [pk for pk, case in self.expected.items()
                    if case[0] not in {"backup", "report", "gst_file"}
                    and case[1] not in {"printed", "exported", "downloaded"}]
        expected_ids = sorted(eligible, reverse=True)[:4]
        with self.assertNumQueries(1):
            actual = latest_changes()
        expected = [audit.entry_row(entry, actions=False)
                    for entry in audit.read_entries().filter(pk__in=expected_ids)]
        for row in expected:
            row.pop("changes")
        self.assertEqual(actual, expected)
        # P5-10 is a Dashboard projection rule. Audit and CSV keep these events.
        suppressed_ids = [pk for pk, case in self.expected.items()
                          if case[0] in {"backup", "report", "gst_file"}]
        self.assertEqual(audit.read_entries().filter(pk__in=suppressed_ids).count(), len(suppressed_ids))

    def test_actual_adapter_never_transfers_changes_or_unbounded_details(self):
        from billing.services.dashboard import latest_changes

        entry = AuditLog.objects.create(
            entity="user", entity_id=9, entity_name="Rakesh Soni", action="updated",
            details="Role changed. " + "x" * 20000,
            changes={"role": {"old": "viewer", "new": "accountant"}, "large": {"old": "PRIVATE" * 20000, "new": ""}},
            snapshot={"private": "PRIVATE" * 20000},
        )
        with CaptureQueriesContext(connection) as captured:
            rows = latest_changes()
        self.assertEqual(len(captured), 1)
        self.assertEqual(rows[0]["id"], entry.pk)
        self.assertEqual(rows[0]["words"]["text"], "Changed the role of")
        self.assertEqual(rows[0]["details"], entry.details[:160])
        self.assertNotIn("changes", rows[0])
        select = captured[0]["sql"].split(' FROM "billing_auditlog"', 1)[0]
        self.assertNotIn('"billing_auditlog"."changes",', select)
        self.assertNotIn('"billing_auditlog"."details", "billing_auditlog"', select)
        self.assertNotIn('"billing_auditlog"."snapshot",', select)
        self.assertNotIn("PRIVATE", str(rows))


class DashboardMappingTest(AuditMappingFixture, TestCase):
    def test_owner_receives_shared_whole_shop_words_and_bounded_details(self):
        from billing.services.dashboard import latest_changes

        entry = AuditLog.objects.create(
            entity="rates", action="set", entity_id=5, entity_name="Today's rates",
            details="Gold 22K ₹65,125.00 per 10 g · Silver 999 ₹78,500.00 per kg" + "x" * 200,
        )
        expected = latest_changes()
        client = client_for(person("dashboard-mapping-owner", *ROLE_GROUPS["owner"]))
        response = client.get("/api/dashboard/", {"fy": "2026-27", "business_id": self.business.pk})
        self.assertEqual(response.status_code, 200, response.data)
        actual = response.data["changes"]
        keys = ("id", "at", "by", "kind", "action", "entity", "entity_id", "words", "details", "link")
        self.assertEqual([{key: row[key] for key in keys} for row in actual], [{key: row[key] for key in keys} for row in expected])
        self.assertLessEqual(max(len(row["details"]) for row in actual), 160)
        rates = next(row for row in actual if row["id"] == entry.pk)
        self.assertEqual(rates["words"], {"text": "Set today's rates", "target": "", "after": ""})

    def test_viewer_has_no_latest_changes(self):
        client = client_for(person("dashboard-mapping-viewer", *ROLE_GROUPS["viewer"]))
        response = client.get("/api/dashboard/", {"fy": "2026-27"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(response.data["changes"])
