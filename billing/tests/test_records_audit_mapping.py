"""Contract §8.1 / X-27: one mapper for every producer, list, CSV and Dashboard."""
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from billing.api.audit import AuditExportView, AuditView
from billing.models import AuditLog, InwardCapture
from billing.services.audit import GROUPS, entry_row, event_words, kind_for
from billing.tests.v3_helpers import ROLE_GROUPS, person

# Each row is a documented producer pair and its exact words, not a call to the implementation's table.
CASES = []
for kind, noun, route in (("sales", "bill", "sales"), ("purchases", "purchase", "purchases")):
    for action, group, text in (
        ("created", "add", f"Made {noun}"), ("imported", "add", f"Imported {noun}"),
        ("updated", "change", f"Edited {noun}"), ("renumbered", "change", f"Renumbered {noun}"),
        ("moved", "change", f"Moved {noun}"), ("cancelled", "delete", f"Cancelled {noun}"),
        ("deleted", "delete", f"Deleted {noun}"), ("restored", "restore", f"Restored {noun}"),
        ("merged", "merge", f"Merged {noun}"), ("sent", "send", f"Sent {noun}"),
        ("printed", "send", f"Printed {noun}"), ("exported", "send", f"Exported {noun}"),
    ):
        CASES.append(("invoice", action, kind, group, text, "", f"/{route}/17"))
for entity, noun, route in (("customer", "customer", "customers"), ("product", "product", "products"), ("business", "firm", "firms")):
    for action, group, text in (
        ("created", "add", f"Added {noun}"), ("imported", "add", f"Imported {noun}"),
        ("updated", "change", f"Edited {noun}"), ("reverted", "change", f"Reverted {noun}"),
        ("deleted", "delete", f"Deleted {noun}"), ("restored", "restore", f"Restored {noun}"),
    ):
        CASES.append((entity, action, "records", group, text, "", f"/{route}/17"))
CASES += [
    ("invoice", "checked", "purchases", "change", "Checked purchase", "", "/purchases/17"),
    ("invoice", "credit_set", "purchases", "change", "Changed the credit month of", "", "/purchases/17"),
    ("customer", "merged", "records", "merge", "Merged customers into", "", "/customers/17"),
    ("capture", "captured", "purchases", "add", "Captured supplier bill", "", "/purchases/inbox/17"),
    ("capture", "discarded", "purchases", "delete", "Removed photo", "", "/purchases/inbox/17"),
    ("capture", "restored", "purchases", "restore", "Restored photo", "", "/purchases/inbox/17"),
    ("filing", "filed", "filing", "file", "", "marked filed", "/gst"),
    ("filing", "updated", "filing", "change", "Edited filing record", "", "/gst"),
    ("filing", "removed", "filing", "delete", "Removed filing record", "", "/gst"),
    ("period", "locked", "filing", "file", "Locked", "", "/gst"),
    ("period", "unlocked", "filing", "file", "Unlocked", "", "/gst"),
    ("credit", "updated", "filing", "change", "Changed opening credit for", "", "/gst?tab=credit"),
    ("gst_file", "downloaded", "filing", "send", "Downloaded", "", "/gst"),
    ("gst_file", "sent", "filing", "send", "Sent", "", "/gst"),
    ("report", "exported", "backup", "send", "Exported", "", "/reports"),
    ("rates", "set", "admin", "change", "Set today's rates", "", "/"),
    ("settings", "updated", "admin", "change", "Changed shop settings", "", "/settings"),
    ("user", "created", "admin", "add", "Added", "", "/users"),
    ("user", "updated", "admin", "change", "Edited", "", "/users"),
    ("user", "password", "admin", "change", "Changed password for", "", "/users"),
    ("user", "stopped", "admin", "delete", "Stopped", "signing in", "/users"),
    ("user", "allowed", "admin", "restore", "Allowed", "to sign in", "/users"),
    ("session", "signedout", "admin", "change", "Signed out", "", "/profile"),
    ("backup", "exported", "backup", "send", "Downloaded", "", "/backup"),
    ("backup", "downloaded", "backup", "send", "Downloaded", "", "/backup"),
    ("backup", "restored", "backup", "restore", "Restored from", "", "/backup"),
]


def event(entity, action, kind, **more):
    return SimpleNamespace(pk=1, entity=entity, action=action, entity_id=17, entity_name="Record", changes={},
                           user=None, timestamp=timezone.now(), details="Producer's exact details", used=False,
                           is_purchase=entity == "invoice" and kind == "purchases", was_purchase=False, **more)


@pytest.mark.parametrize("entity,action,kind,group,text,after,link", CASES)
def test_documented_words_table(entity, action, kind, group, text, after, link):
    entry = event(entity, action, kind)
    actual_kind = kind_for(entry)
    words, actual_link = event_words(entry, actual_kind, target_present=True)
    assert actual_kind == kind
    assert GROUPS[action] == group
    assert words == {"text": text, "target": "" if entity in {"settings", "rates"} else "Record", "after": after}
    assert actual_link == link
    with patch("billing.services.audit.record_for") as record, patch("billing.services.audit.capture_present") as capture:
        row = entry_row(entry, actions=False)
    record.assert_not_called()
    capture.assert_not_called()
    assert row["words"] == words
    assert row["kind"] == kind
    assert row["group"] == group
    assert row["details"] == "Producer's exact details"


def test_role_full_backup_and_missing_or_discarded_targets():
    entry = event("user", "updated", "admin")
    entry.changes = {"role": {"old": "viewer", "new": "staff"}}
    assert event_words(entry, "admin", True)[0]["text"] == "Changed the role of"
    entry = event("backup", "exported", "backup")
    entry.entity_name = "Full backup"
    assert event_words(entry, "backup", True)[0] == {"text": "Downloaded", "target": "the full backup", "after": ""}
    for entity in ("invoice", "customer", "product", "business", "capture"):
        entry = event(entity, "deleted", "sales")
        assert event_words(entry, kind_for(entry), False)[1] is None
    for action in ("checked", "credit_set"):
        entry = event("invoice", action, "sales")
        assert kind_for(entry) == "purchases"


class AuditMappingIntegrationTest(TestCase):
    def setUp(self):
        self.owner = person("audit-mapping-owner", *ROLE_GROUPS["owner"])
        self.entries = [AuditLog.objects.create(user=self.owner, entity=entity, action=action, entity_id=17,
            entity_name="Record", details="Producer's exact details") for entity, action in (
                ("credit", "updated"), ("gst_file", "downloaded"), ("report", "exported"),
                ("rates", "set"), ("session", "signedout"), ("invoice", "credit_set"))]

    def request(self, view, params=None):
        request = APIRequestFactory().get("/api/audit/", params or {})
        force_authenticate(request, self.owner)
        return view.as_view()(request)

    def test_new_producers_match_kind_and_group_filters_and_csv(self):
        response = self.request(AuditView, {"counts": "1"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["counts"], {"all": 6, "sales": 0, "purchases": 1,
            "records": 0, "filing": 2, "admin": 2, "backup": 1})
        for kind, expected in (("filing", 2), ("purchases", 1), ("backup", 1), ("admin", 2)):
            with self.subTest(kind=kind):
                rows = self.request(AuditView, {"kind": kind}).data["results"]
                self.assertEqual(len(rows), expected)
                self.assertTrue(all(row["kind"] == kind for row in rows))
        change = self.request(AuditView, {"group": "change"}).data["results"]
        self.assertEqual({row["action"] for row in change}, {"updated", "set", "signedout", "credit_set"})
        export = self.request(AuditExportView, {"kind": "filing"})
        csv = b"".join(export.streaming_content).decode("utf-8-sig")
        self.assertIn("Changed opening credit for Record", csv)
        self.assertIn("Downloaded Record", csv)
        self.assertNotIn("Credit_set", csv)

    def test_capture_link_uses_its_current_presence_without_reading_files(self):
        capture = InwardCapture.objects.create(image="synthetic.jpg")
        entry = AuditLog.objects.create(user=self.owner, entity="capture", action="captured", entity_id=capture.pk,
                                        entity_name="Bill photo 1")
        row = self.request(AuditView, {"entity": "capture"}).data["results"][0]
        self.assertEqual(row["link"], f"/purchases/inbox/{capture.pk}")
        capture.delete()
        row = self.request(AuditView, {"entity_id": str(entry.entity_id)}).data["results"][0]
        self.assertIsNone(row["link"])


def test_product_kind_changes_read_as_the_picker_words():
    from billing.models import Product
    from billing.services.audit import change_rows
    rows = change_rows(Product, {"kind": {"old": "gold", "new": None}, "purity": {"old": "", "new": "22K"}})
    assert [(row["from"], row["to"]) for row in rows] == [("Gold", "Worked out from the name"), ("None", "22K")]
