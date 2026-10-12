"""Final part-4 regressions: cheap firm saves and consistent record safeguards."""
from datetime import date
from io import BytesIO, StringIO
from unittest.mock import patch

import pytest
from django.contrib import admin
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.db import connection
from django.test import RequestFactory
from django.test.utils import CaptureQueriesContext
from PIL import Image

from billing.admin import BusinessAdmin
from billing.api.mixins import snapshot_of
from billing.models import AuditLog, Business, FilingRecord, InwardCapture, Product
from billing.services import gst_checks
from billing.services.audit import entry_rows, read_entries
from billing.services.firms import IDENTITY_FIELDS
from billing.services.sales import firm_snapshot
from billing.tests.v3_helpers import buyer, client_for, firm, line, person, sale

pytestmark = pytest.mark.django_db


def picture(name="signature.html"):
    output = BytesIO()
    Image.new("RGB", (2, 2)).save(output, format="PNG")
    return SimpleUploadedFile(name, output.getvalue(), content_type="image/png")


def test_firm_save_never_runs_filing_checks():
    business = firm()
    client = client_for(person("cheap-save", "admin"))
    with patch("billing.services.firms.read_filings", side_effect=AssertionError("save read the filing grid")):
        result = client.put(f"/api/firms/{business.pk}/", {"bank_name": "State Bank"}, format="json")
    assert result.status_code == 200
    assert result.data["bank_name"] == "State Bank"
    assert result.data["changes"][0]["key"] == "bank_name"
    assert "figures" not in result.data and "months" not in result.data


def test_bulk_checks_build_one_annotation_tree_for_a_financial_year():
    business, customer = firm(), buyer()
    sale(business, customer, "one", date(2026, 4, 2), line(hsn=""))
    sale(business, customer, "two", date(2026, 9, 2), line(hsn=""))
    with patch.object(gst_checks, "checked_bills", wraps=gst_checks.checked_bills) as checked:
        result = gst_checks.gstr1_blockers([business.pk], ["2026-04", "2026-09"])
    assert checked.call_count == 1
    assert result[business.pk, "2026-04"]["count"] == 1
    assert result[business.pk, "2026-09"]["first_two"] == ["two: a line has no HSN code"]


def test_bulk_checks_keep_fiscal_boundaries_distinct_bills_and_two_witnesses():
    business, customer = firm(), buyer(customer_type="business")
    sale(business, customer, "Dup", date(2025, 9, 1))
    sale(business, customer, "dup", date(2026, 3, 1), line(hsn=""))
    for number in ("dup", "two", "three"):
        sale(business, customer, number, date(2026, 4, 1), line(hsn=""))
    result = gst_checks.gstr1_blockers([business.pk], ["2026-03", "2026-04"])
    assert result[business.pk, "2026-03"] == {"count": 3, "bills": 1,
        "first_two": ["Bill number dup is used twice", "dup: business customer without a GSTIN"]}
    assert result[business.pk, "2026-04"]["count"] == 6
    assert result[business.pk, "2026-04"]["bills"] == 3
    assert result[business.pk, "2026-04"]["first_two"] == [
        "dup: business customer without a GSTIN", "three: business customer without a GSTIN"]


@pytest.mark.parametrize("door", ["v2", "undo"])
def test_purchase_photo_protects_firm_at_legacy_doors(door):
    owner, business = person("photo-owner", "admin"), firm()
    capture = InwardCapture.objects.create(business=business, image="inward/test.png")
    entry = AuditLog.objects.create(action="created", entity="business", entity_id=business.pk,
                                    entity_name=business.name, user=owner, snapshot=snapshot_of(business))
    client = client_for(owner)
    result = client.delete(f"/api/businesses/{business.pk}/") if door == "v2" else client.post(f"/api/audit-logs/{entry.pk}/undo/")
    assert result.status_code == 409
    capture.refresh_from_db()
    assert capture.business_id == business.pk


def test_admin_cannot_delete_firm_or_edit_issued_identity():
    business = firm()
    request = RequestFactory().get("/admin/")
    request.user = person("firm-admin", "admin", superuser=True)
    model_admin = BusinessAdmin(Business, admin.site)
    assert not model_admin.has_delete_permission(request, business)
    assert set(model_admin.get_readonly_fields(request, business)) >= IDENTITY_FIELDS


def test_product_hsn_fix_list_excludes_gstr1_filed_month():
    business, customer = firm(), buyer()
    product = Product.objects.create(name="Silver", hsn_code="711311")
    sale(business, customer, "1", date(2026, 9, 1), line(hsn=""))
    FilingRecord.objects.create(business=business, year=2026, month=9, kind="gstr1", filed_on=date(2026, 10, 1))
    from billing.services.catalog import hsn_on_bills
    assert hsn_on_bills(product, [product.name])["blocking"] == []


@pytest.mark.parametrize("snapshot", [None, {}])
def test_deleted_record_without_snapshot_offers_no_restore(snapshot):
    entry = AuditLog.objects.create(action="deleted", entity="customer", entity_id=99, entity_name="Gone", snapshot=snapshot)
    result = entry_rows(list(read_entries().filter(pk=entry.pk)))[0]
    assert not result["can"]


def test_audit_load_more_does_not_count_the_whole_log():
    client = client_for(person("audit-counter", "admin"))
    AuditLog.objects.create(action="created", entity="customer", entity_id=1, entity_name="One")
    with CaptureQueriesContext(connection) as queries:
        result = client.get("/api/audit/", {"page": "1"})
    assert result.status_code == 200
    assert "total" not in result.data
    assert sum("COUNT(*)" in query["sql"] and "billing_auditlog" in query["sql"] for query in queries) == 1


def test_signature_uses_detected_extension(tmp_path, settings):
    settings.MEDIA_ROOT = str(tmp_path)
    business = firm()
    result = client_for(person("sign-owner", "admin")).put(f"/api/firms/{business.pk}/signature/", {"image": picture()}, format="multipart")
    assert result.status_code == 200
    business.refresh_from_db()
    assert business.signature_image.name.endswith(".png")
    assert "signature.html" not in business.signature_image.name


def test_v2_multipart_omitted_booleans_keep_defaults_and_existing_values(tmp_path, settings):
    settings.MEDIA_ROOT = str(tmp_path)
    client = client_for(person("multipart-owner", "admin"))
    payload = {"name": "Firm", "gst_number": "08AAGPL3375F1ZO", "address": "Bazaar", "mobile_number": "9000000000", "signature_image": picture("sign.png")}
    response = client.post("/api/businesses/", payload, format="multipart")
    assert response.status_code == 201, response.data
    business = Business.objects.get(pk=response.data["id"])
    assert business.signature_on_bills is True
    payload.pop("signature_image")
    response = client.put(f"/api/businesses/{business.pk}/", payload, format="multipart")
    assert response.status_code == 200
    business.refresh_from_db()
    assert business.signature_on_bills is True
    product = Product.objects.create(name="Bullion", hsn_code="7108", purchase_only=True)
    response = client.put(f"/api/products/{product.pk}/", {"name": "Bullion", "hsn_code": "7108", "gst_tax_rate": "0.03"}, format="multipart")
    assert response.status_code == 200, response.data
    product.refresh_from_db()
    assert product.purchase_only is True


def test_freeze_command_defaults_to_dry_run_and_fills_only_missing_snapshots():
    business, customer = firm(), buyer()
    bill = sale(business, customer, "1", date(2026, 9, 1))
    purchase = sale(business, customer, "P1", date(2026, 9, 1), kind="inward")
    kept = sale(business, customer, "2", date(2026, 9, 1), firm_snapshot={"name": "Earlier"})
    from billing.services.bin import bin_bill
    binned, _ = bin_bill(sale(business, customer, "3", date(2026, 9, 1)), person("bin-owner", "admin"))
    call_command("freeze_firm_snapshots", stdout=StringIO())
    bill.refresh_from_db()
    assert bill.firm_snapshot is None
    call_command("freeze_firm_snapshots", apply=True, stdout=StringIO())
    for row in (bill, purchase):
        row.refresh_from_db()
        assert row.firm_snapshot == firm_snapshot(business)
    binned.refresh_from_db()
    assert binned.data["invoice"]["firm_snapshot"] == firm_snapshot(business)
    kept.refresh_from_db()
    assert kept.firm_snapshot == {"name": "Earlier"}
    business.name = "Changed later"
    business.save()
    call_command("freeze_firm_snapshots", apply=True, stdout=StringIO())
    bill.refresh_from_db()
    assert bill.firm_snapshot["name"] != business.name


def test_v2_move_freezes_new_firm():
    business, target, customer = firm(), firm("New firm"), buyer()
    bill = sale(business, customer, "1", date(2026, 9, 1), firm_snapshot=firm_snapshot(business))
    bill.business = target
    bill.save_from_v2()
    bill.refresh_from_db()
    assert bill.firm_snapshot == firm_snapshot(target)


def test_duplicate_banner_excludes_legacy_walkin_name():
    buyer("Walk-in Customer", mobile_number="9000000001")
    buyer("Real person", mobile_number="9000000001")
    from billing.services.customer_merge import duplicates
    assert duplicates()["groups"] == []
