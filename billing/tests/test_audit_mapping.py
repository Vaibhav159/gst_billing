from types import SimpleNamespace

import pytest

from billing.services import audit

# One row per documented producer pair; invoices exercise both current kinds.
# Expected words come from part 4 §8.1, not from the implementation dictionaries.
INVOICE_CASES = [
    ("created", "add", "Made"), ("imported", "add", "Imported"),
    ("updated", "change", "Edited"), ("renumbered", "change", "Renumbered"),
    ("moved", "change", "Moved"), ("cancelled", "delete", "Cancelled"),
    ("deleted", "delete", "Deleted"), ("restored", "restore", "Restored"),
    ("merged", "merge", "Merged"), ("sent", "send", "Sent"),
    ("printed", "send", "Printed"), ("exported", "send", "Exported"),
]
RECORD_CASES = [
    ("created", "add", "Added"), ("imported", "add", "Imported"),
    ("updated", "change", "Edited"), ("reverted", "change", "Reverted"),
    ("deleted", "delete", "Deleted"), ("restored", "restore", "Restored"),
]
# entity, action, kind, group, prefix, suffix, target, current link, producer details
CASES = [
    ("invoice", action, kind, group, f"{verb} {noun}", "", "MO/2026-27/31", f"/{kind}/17", "Meera Ornaments · ₹1,31,830.52")
    for kind, noun in [("sales", "bill"), ("purchases", "purchase")]
    for action, group, verb in INVOICE_CASES
] + [
    (entity, action, "records", group, f"{verb} {noun}", "", name, f"/{path}/17", "Supplier details updated" if entity == "customer" else "")
    for entity, noun, name, path in [
        ("customer", "customer", "Priya Sharma", "customers"),
        ("product", "product", "Gold chain", "products"),
        ("business", "firm", "Meera Ornaments", "firms"),
    ]
    for action, group, verb in RECORD_CASES
] + [
    ("invoice", "checked", "purchases", "change", "Checked purchase", "", "MO/2026-27/31", "/purchases/17", "Checked against the photo"),
    ("invoice", "credit_set", "purchases", "change", "Changed the credit month of", "", "MO/2026-27/31", "/purchases/17", "Credit claimed in October 2026 (was September 2026)"),
    ("customer", "merged", "records", "merge", "Merged customers into", "", "Priya Sharma", "/customers/17", ""),
    ("capture", "captured", "purchases", "add", "Captured supplier bill", "", "Bill photo 1", "/purchases/inbox/17", "Firm to be decided · 1 page"),
    ("capture", "discarded", "purchases", "delete", "Removed photo", "", "Bill photo 1", None, "Photo removed from the inbox"),
    ("capture", "restored", "purchases", "restore", "Restored photo", "", "Bill photo 1", "/purchases/inbox/17", "Photo put back in the inbox"),
    ("filing", "filed", "filing", "file", "", "marked filed", "September 2026", "/gst", "Meera Ornaments · September 2026 · GSTR-1 filed 08 Oct 2026"),
    ("filing", "updated", "filing", "change", "Edited filing record", "", "September 2026", "/gst", "Changed the ARN and the cash paid"),
    ("filing", "removed", "filing", "delete", "Removed filing record", "", "September 2026", "/gst", "Meera Ornaments · September 2026"),
    ("period", "locked", "filing", "file", "Locked", "", "September 2026", "/gst", "Meera Ornaments · locked again"),
    ("period", "unlocked", "filing", "file", "Unlocked", "", "September 2026", "/gst", "Meera Ornaments · Correct the bill"),
    ("credit", "updated", "filing", "change", "Changed opening credit for", "", "Meera Ornaments", "/gst?tab=credit", "Meera Ornaments · as of 01 Apr 2025: ₹0.00 → ₹500.00"),
    ("gst_file", "downloaded", "filing", "send", "Downloaded", "", "GSTR-1 September 2026", "/gst", "Meera Ornaments · September 2026"),
    ("gst_file", "sent", "filing", "send", "Sent", "", "GSTR-1 September 2026", "/gst", "Meera Ornaments · September 2026"),
    ("report", "exported", "backup", "send", "Exported", "", "CA workbook", "/reports", "CA workbook, All firms, September 2026"),
    ("rates", "set", "admin", "change", "Set today's rates", "", "", "/", "Gold 22K ₹65,125.00 per 10 g · Silver 999 ₹78,500.00 per kg"),
    ("settings", "updated", "admin", "change", "Changed shop settings", "", "", "/settings", ""),
    ("user", "created", "admin", "add", "Added", "", "Rakesh Soni", "/users", ""),
    ("user", "updated", "admin", "change", "Edited", "", "Rakesh Soni", "/users", ""),
    ("user", "password", "admin", "change", "Changed password for", "", "Rakesh Soni", "/users", ""),
    ("user", "stopped", "admin", "delete", "Stopped", "signing in", "Rakesh Soni", "/users", ""),
    ("user", "allowed", "admin", "restore", "Allowed", "to sign in", "Rakesh Soni", "/users", ""),
    ("session", "signedout", "admin", "change", "Signed out", "", "Rakesh Soni", "/profile", "Signed out on Safari on Mac · session 00000000-0000-4000-8000-000000000001"),
    ("backup", "exported", "backup", "send", "Downloaded", "", "the full backup", "/backup", ""),
    ("backup", "downloaded", "backup", "send", "Downloaded", "", "the full backup", "/backup", ""),
    ("backup", "restored", "backup", "restore", "Restored from", "", "Shop-backup_2026-10-08.zip", "/backup", ""),
]


def entry_for(case):
    entity, action, kind, _group, _text, _after, target, _link, details = case
    name = "Full backup" if target == "the full backup" else "Shop settings" if entity == "settings" else target
    if entity == "rates":
        name = "Today's rates"  # Producer name remains present; the mapper clears its display target.
    return SimpleNamespace(
        pk=91, timestamp=None, user=None, entity=entity, entity_id=17,
        action=action, entity_name=name, details=details, changes={}, used=False,
        is_purchase=kind == "purchases" and entity == "invoice", was_purchase=False,
        has_invoice=entity == "invoice", has_customer=entity == "customer",
        has_product=entity == "product", has_business=entity == "business",
        has_capture=entity == "capture", capture_last_action=action, in_bin=False,
    )


@pytest.fixture(autouse=True)
def pure_rows(monkeypatch):
    monkeypatch.setattr(audit, "stamp", lambda _value: "2026-10-08T12:00:00+05:30")
    monkeypatch.setattr(audit, "person", lambda _value: None)


@pytest.mark.parametrize("case", CASES, ids=[f"{c[0]}-{c[1]}-{c[2]}" for c in CASES])
def test_every_documented_producer_pair(case):
    entity, action, kind, group, text, after, target, link, details = case
    row = audit.entry_row(entry_for(case), actions=False)
    assert (row["entity"], row["action"], row["kind"], row["group"]) == (entity, action, kind, group)
    assert row["words"] == {"text": text, "target": target, "after": after}
    assert row["link"] == link
    assert row["details"] == details
    assert row["entity_id"] == 17  # Session UUID stays in details, never the integer id.
    assert row["changes"] == []
    assert row["note"] == ""
    assert row["can"] is None


def test_role_change_uses_the_same_row_mapper():
    entry = entry_for(next(c for c in CASES if c[:2] == ("user", "updated")))
    entry.changes = {"role": {"old": "viewer", "new": "accountant"}}
    assert audit.entry_row(entry, actions=False)["words"]["text"] == "Changed the role of"


@pytest.mark.parametrize("kind", ["sales", "purchases"])
def test_deleted_bill_uses_bin_metadata_and_has_no_link(kind):
    entry = entry_for(next(c for c in CASES if c[:3] == ("invoice", "deleted", kind)))
    entry.has_invoice, entry.is_purchase, entry.in_bin = False, False, True
    entry.was_purchase = kind == "purchases"
    row = audit.entry_row(entry, actions=False)
    assert row["kind"] == kind
    assert row["link"] is None
    assert row["note"] == "In the bin"


@pytest.mark.parametrize("entity", ["customer", "product", "business"])
def test_removed_record_has_no_link(entity):
    entry = entry_for(next(c for c in CASES if c[:2] == (entity, "deleted")))
    setattr(entry, f"has_{entity}", False)
    row = audit.entry_row(entry, actions=False)
    assert row["link"] is None
    assert row["note"] == ""


def test_invoice_name_never_overrides_live_kind():
    entry = entry_for(CASES[0])
    entry.entity_name = "Purchase 100"
    row = audit.entry_row(entry, actions=False)
    assert row["kind"] == "sales"
    assert row["words"]["text"] == "Made bill"


def test_capture_links_follow_current_state_not_historical_action():
    entry = entry_for(next(c for c in CASES if c[:2] == ("capture", "captured")))
    entry.capture_last_action = "discarded"
    assert audit.entry_row(entry, actions=False)["link"] is None
    entry.capture_last_action = "restored"
    assert audit.entry_row(entry, actions=False)["link"] == "/purchases/inbox/17"
    entry.has_capture = False
    assert audit.entry_row(entry, actions=False)["link"] is None


def test_unknown_historical_entity_keeps_readable_records_fallback():
    entry = entry_for(CASES[0])
    entry.entity, entry.action, entry.entity_name = "old_import", "updated", "Legacy workbook"
    row = audit.entry_row(entry, actions=False)
    assert row["kind"] == "records"
    assert row["group"] == "change"
    assert row["words"] == {"text": "Edited record", "target": "Legacy workbook", "after": ""}
    assert row["link"] is None


# Actual 3D producer handoff: id 0 is deliberate, and details is the downloaded filename.
@pytest.mark.parametrize("target,filename", [
    ("CA workbook, All firms, Sep 2026", "GST_Report_All_firms_Sep_2026.xlsx"),
    ("Sales register, KIRAN GOLD HOUSE, Sep 2026", "Sales_register_KIRAN_GOLD_HOUSE_Sep_2026.csv"),
    ("Reconciliation, KIRAN GOLD HOUSE, FY 2026-27", "Reconciliation_FY2026-27_KIRAN_GOLD_HOUSE.xlsx"),
])
def test_actual_3d_report_producer_projection(target, filename):
    entry = entry_for(next(case for case in CASES if case[:2] == ("report", "exported")))
    entry.entity_id, entry.entity_name, entry.details = 0, target, filename
    row = audit.entry_row(entry, actions=False)
    expected_projection = {
        "action": "exported", "entity": "report", "entity_id": 0,
        "kind": "backup", "group": "send",
        "words": {"text": "Exported", "target": target, "after": ""},
        "link": "/reports", "note": "", "details": filename,
        "changes": [], "result": None, "can": None,
    }
    assert {key: row[key] for key in expected_projection} == expected_projection


def test_actual_3a_filing_producer_keeps_business_target_and_month_in_details():
    entry = entry_for(next(case for case in CASES if case[:2] == ("filing", "filed")))
    entry.entity_name = "Meera Ornaments"
    entry.details = "Meera Ornaments · September 2026 · GSTR-1 filed 08 Oct 2026"
    row = audit.entry_row(entry, actions=False)
    assert row["words"] == {"text": "", "target": "Meera Ornaments", "after": "marked filed"}
    assert (row["entity"], row["action"], row["kind"], row["group"], row["link"]) == (
        "filing", "filed", "filing", "file", "/gst",
    )
    assert row["details"] == "Meera Ornaments · September 2026 · GSTR-1 filed 08 Oct 2026"
    assert row["can"] is None
