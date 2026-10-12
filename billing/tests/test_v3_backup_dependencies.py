"""X-40: real predecessor checks; run after the named plans land, without stand-ins."""

import csv
import json
from importlib import import_module
from io import StringIO
from pathlib import Path

import pytest
from rest_framework.test import APIRequestFactory, force_authenticate

from billing.models import AuditLog, Invoice, Product
from billing.tests.v3_helpers import buyer, firm, person

pytestmark = pytest.mark.django_db(transaction=True)


def predecessor(module, reason):
    """X-40: the named plans are on v3, so a missing module fails rather than skips."""
    return import_module(module)


def download(view, user, params=None, **kwargs):
    request = APIRequestFactory().get("/api/backup/full/", params or {})
    force_authenticate(request, user=user)
    return view.as_view()(request, **kwargs)


def test_real_filing_backup_provider_preserves_its_three_collections():
    filing = predecessor("billing.services.filing", "Runs after 3A's filing.backup_rows lands (X-40).")
    from billing.api.backups import BackupFullView
    from billing.services.backups import json_value

    expected = filing.backup_rows()
    assert set(expected) == {"filing_records", "filing_months", "opening_credits"}
    assert all(isinstance(value, list) for value in expected.values())
    owner = person("filing-backup-owner", "admin")
    data = json.loads(b"".join(download(BackupFullView, owner).streaming_content))
    assert data["v3"]["filing"] == json.loads(json.dumps(expected, default=json_value))


def test_real_catalog_kind_and_backup_stored_choice_are_distinct():
    catalog = predecessor("billing.services.catalog", "Runs after 4A Tasks 1 and 3 land (X-40).")
    from billing.api.backups import BackupFullView, RecordExportView

    assert "kind" in {field.name for field in Product._meta.concrete_fields}, "4A Task 1 must land before this integration test"
    inferred = Product.objects.create(name="Gold necklace", hsn_code="71131910", kind=None, purity="22K")
    explicit = Product.objects.create(name="Silver service", hsn_code="711311", kind="service")
    owner = person("catalog-backup-owner", "admin")
    response = download(RecordExportView, owner, kind="products")
    rows = list(csv.reader(StringIO(b"".join(response.streaming_content).decode("utf-8-sig"))))
    by_name = {row[0]: row for row in rows[1:]}
    assert by_name[inferred.name][4] == catalog.effective_kind(inferred) == "gold"
    assert by_name[explicit.name][4] == catalog.effective_kind(explicit) == "service"
    backup = json.loads(b"".join(download(BackupFullView, owner).streaming_content))
    products = {row["id"]: row for row in backup["products"]}
    assert products[inferred.pk]["kind"] is None
    assert products[inferred.pk]["kind_effective"] == "gold"
    assert products[inferred.pk]["purity"] == "22K"
    assert products[explicit.pk]["kind"] == products[explicit.pk]["kind_effective"] == "service"


def test_shared_audit_mapping_consumes_all_backup_export_producer_fixtures():
    audit = predecessor("billing.services.audit", "Runs after 4A Task 10 and 4E's X-27 mapping updates land.")
    # 4A Task 10 defines these exact entry points; 4E owns the cross-part mapping.
    fixtures = json.loads((Path(__file__).parent / "fixtures/v3_backup_audit.json").read_text())
    for fixture in fixtures:
        row = AuditLog.objects.create(**{key: fixture[key] for key in ("entity", "action", "entity_id", "entity_name")})
        shown = audit.entry_row(audit.read_entries().get(pk=row.pk), actions=False)
        assert {key: shown[key] for key in ("kind", "group", "words")} == {
            key: fixture[key] for key in ("kind", "group", "words")}



def test_real_purchase_credit_month_is_absent_before_ledger_and_defaults_later():
    from datetime import date

    credit = predecessor("billing.credit", "Runs after 2A's purchase fields and credit_month_of land (X-40).")
    from billing.api.backups import RecordExportView

    assert "itc_month" in {field.name for field in Invoice._meta.concrete_fields}, "2A purchase fields must land before this integration test"
    owner = person("credit-export-owner", "admin")
    biz, customer = firm(), buyer()
    old = Invoice.objects.create(business=biz, customer=customer, invoice_number="BEFORE", invoice_date=date(2025, 3, 31), type_of_invoice="inward", itc_month=None)
    new = Invoice.objects.create(business=biz, customer=customer, invoice_number="AFTER", invoice_date=date(2025, 4, 1), type_of_invoice="inward", itc_month=None)
    assert credit.credit_month_of(old) is None
    assert credit.credit_month_of(new) == date(2025, 4, 1)
    response = download(RecordExportView, owner, {"format": "csv", "fy": "all"}, kind="purchases")
    rows = list(csv.reader(StringIO(b"".join(response.streaming_content).decode("utf-8-sig"))))
    by_number = {row[1]: row for row in rows[1:-1]}
    assert by_number["BEFORE"][-2] == ""
    assert by_number["AFTER"][-2] == "2025-04"
