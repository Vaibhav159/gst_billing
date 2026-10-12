from collections import Counter

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from billing.models import AuditLog, BinnedInvoice, InwardCapture
from billing.services import audit
from billing.tests.test_audit_mapping import CASES
from billing.tests.v3_helpers import buyer, firm, sale


class AuditMappingFixture:
    def setUp(self):
        self.business = firm()
        self.customer = buyer()
        self.bills = {
            "sales": sale(self.business, self.customer, "Purchase 100", "2026-10-08"),
            "purchases": sale(self.business, self.customer, "MO/2026-27/31", "2026-10-08", kind="inward"),
        }
        self.expected = {}
        for number, case in enumerate(CASES):
            entity, action, kind, _group, _text, _after, target, _link, details = case
            row = AuditLog.objects.create(
                entity=entity, action=action,
                entity_id=self.bills[kind].pk if entity == "invoice" else 10000 + number,
                entity_name="Full backup" if target == "the full backup" else "Today's rates" if entity == "rates" else target,
                details=details, changes={}, snapshot={"private": "NEVER_SELECT_THIS"},
            )
            self.expected[row.pk] = case


class MappingReadTest(AuditMappingFixture, TestCase):
    def test_all_pairs_use_one_narrow_query_then_zero_query_mapping(self):
        with CaptureQueriesContext(connection) as captured:
            entries = list(audit.read_entries())
        self.assertEqual(len(captured), 1)
        sql = captured[0]["sql"]
        self.assertNotIn('"billing_auditlog"."snapshot",', sql)
        self.assertNotIn('"billing_binnedinvoice"."data",', sql)
        with self.assertNumQueries(0):
            rows = [audit.entry_row(entry, actions=False) for entry in entries]
        for row in rows:
            entity, action, kind, group, text, after, target, _link, details = self.expected[row["id"]]
            with self.subTest(entity=entity, action=action, kind=kind):
                self.assertEqual((row["kind"], row["group"]), (kind, group))
                self.assertEqual(row["words"], {"text": text, "target": target, "after": after})
                self.assertEqual(row["details"], details)
                if entity == "invoice":
                    self.assertEqual(row["link"], f"/{kind}/{self.bills[kind].pk}")

    def test_kind_filters_counts_and_unknown_history_agree_with_rows(self):
        legacy = AuditLog.objects.create(entity="old_import", action="updated", entity_id=0, entity_name="Legacy workbook")
        expected = Counter(case[2] for case in CASES)
        expected["records"] += 1
        for kind, count in expected.items():
            with self.subTest(kind=kind):
                entries = list(audit.read_entries().filter(audit.kind_filter(kind)))
                self.assertEqual(len(entries), count)
                self.assertEqual({audit.entry_row(entry, actions=False)["kind"] for entry in entries}, {kind})
        self.assertTrue(audit.read_entries().filter(audit.kind_filter("records"), pk=legacy.pk).exists())
        self.assertEqual(sum(expected.values()), AuditLog.objects.count())

    def test_group_filters_include_every_producer_action(self):
        expected = Counter(case[3] for case in CASES)
        for group, count in expected.items():
            actions = [action for action, mapped in audit.GROUPS.items() if mapped == group]
            entries = list(audit.read_entries().filter(action__in=actions))
            with self.subTest(group=group):
                self.assertEqual(len(entries), count)
                self.assertEqual({audit.entry_row(entry, actions=False)["group"] for entry in entries}, {group})

    def test_bin_kind_and_note_are_kept_without_loading_snapshot_or_lines(self):
        entry = AuditLog.objects.create(entity="invoice", entity_id=99999, entity_name="Supplier 99", action="deleted")
        BinnedInvoice.objects.create(
            original_id=99999, audit_log_id=entry.pk, business=self.business, customer=self.customer,
            invoice_date="2026-10-08", invoice_number="Supplier 99", type_of_invoice="inward",
            data={"lines": [{"private": "NEVER_SELECT_THIS"}]},
        )
        fetched = audit.read_entries().get(pk=entry.pk)
        with self.assertNumQueries(0):
            row = audit.entry_row(fetched, actions=False)
        self.assertEqual(row["kind"], "purchases")
        self.assertEqual(row["link"], None)
        self.assertEqual(row["note"], "In the bin")
        self.assertTrue(audit.read_entries().filter(audit.kind_filter("purchases"), pk=entry.pk).exists())

    def test_capture_links_follow_discard_restore_and_purge(self):
        capture = InwardCapture.objects.create(image="synthetic-audit-photo.jpg")
        original = AuditLog.objects.create(entity="capture", entity_id=capture.pk, entity_name="Bill photo 1", action="captured")
        self.assertEqual(audit.entry_row(audit.read_entries().get(pk=original.pk), actions=False)["link"], f"/purchases/inbox/{capture.pk}")
        AuditLog.objects.create(entity="capture", entity_id=capture.pk, entity_name="Bill photo 1", action="discarded")
        self.assertIsNone(audit.entry_row(audit.read_entries().get(pk=original.pk), actions=False)["link"])
        AuditLog.objects.create(entity="capture", entity_id=capture.pk, entity_name="Bill photo 1", action="restored")
        self.assertEqual(audit.entry_row(audit.read_entries().get(pk=original.pk), actions=False)["link"], f"/purchases/inbox/{capture.pk}")
        capture.delete()
        self.assertIsNone(audit.entry_row(audit.read_entries().get(pk=original.pk), actions=False)["link"])

    def test_settled_bin_keeps_historical_purchase_kind_without_in_bin_note(self):
        entry = AuditLog.objects.create(entity="invoice", entity_id=88888, entity_name="Supplier 88", action="created")
        BinnedInvoice.objects.create(
            original_id=88888, business=self.business, customer=self.customer,
            invoice_date="2026-10-08", invoice_number="Supplier 88", type_of_invoice="inward",
            restored_at=timezone.now(), data={},
        )
        row = audit.entry_row(audit.read_entries().get(pk=entry.pk), actions=False)
        self.assertEqual(row["kind"], "purchases")
        self.assertEqual(row["words"]["text"], "Made purchase")
        self.assertEqual(row["note"], "")
        self.assertTrue(audit.read_entries().filter(audit.kind_filter("purchases"), pk=entry.pk).exists())
