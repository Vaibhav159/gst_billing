"""The restore plan is read-only, bounded, and based on file contents and books."""

import json
from datetime import date
from decimal import Decimal

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.exceptions import ValidationError

from billing.models import AuditLog, Business, Customer, FiledPeriod, Invoice
from billing.services.backup_restore import preview
from billing.tests.v3_helpers import buyer, firm, line, person, sale

pytestmark = pytest.mark.django_db


def payload(version="4.0"):
    return {
        "version": version, "exportedAt": "2026-03-12T19:40:00+05:30",
        "businesses": [{"id": 901, "name": "NEW GOLD", "gst_number": "", "state_name": "RAJASTHAN"}],
        "customers": [{"id": 902, "name": "New Buyer", "state_name": "RAJASTHAN"}],
        "products": [{"name": "Diamond", "hsn_code": "7102", "gst_tax_rate": "0.0025"}],
        "invoices": [{"business": 901, "customer": 902, "invoice_number": "001", "invoice_date": "2026-03-31",
                      "type_of_invoice": "outward", "total_amount": "999999",
                      "line_items": [line(rate="100", gst="0.0025", hsn="7102", name="Diamond")]}],
    }


def upload(data=None, name="gst-backup-2026-03-12.json"):
    return SimpleUploadedFile(name, json.dumps(payload() if data is None else data).encode(), "application/json")


def test_preview_v4_is_read_only_and_deterministic():
    first = preview(upload())
    assert first == preview(upload())
    assert first["file"]["kind"] == "old_v4"
    assert first["file"]["kind_words"] == "Old app backup (v4.0)"
    assert first["plan"]["adds"] == 4
    assert first["plan"]["words"] == "1 firm, 1 customer, 1 product and 1 sales bill"
    assert not Business.objects.exists()
    assert not AuditLog.objects.exists()


@pytest.mark.parametrize("data", [[], {}, {"businesses": []}, {"version": "4.0", "businesses": [False], "customers": [], "products": [], "invoices": []}])
def test_bad_file_is_words_not_an_exception(data):
    with pytest.raises(ValidationError) as error:
        preview(upload(data))
    assert "file" in error.value.detail


def test_missing_wrong_extension_and_size_words():
    with pytest.raises(ValidationError, match="Choose the backup file"):
        preview(None)
    with pytest.raises(ValidationError, match="isn't a backup file"):
        preview(upload(name="backup.txt"))
    file = upload()
    file.size = 25 * 1024 * 1024 + 1
    with pytest.raises(ValidationError, match="at most 25 MB"):
        preview(file)


def test_match_by_gstin_then_name_not_source_id_and_duplicate_rows():
    existing = firm("Existing firm", gstin="08VRHFA2322D1ZI")
    customer = buyer("Existing customer", gst_number="08WWUFP9975S1ZN")
    data = payload()
    data["businesses"][0].update(id=existing.pk + 100, name="Other name", gst_number=existing.gst_number)
    data["customers"][0].update(id=customer.pk + 100, name="Other customer", gst_number=customer.gst_number)
    data["invoices"] = []
    data["products"] *= 2
    plan = preview(upload(data))["plan"]
    assert plan["firms"]["skip"][0]["why"] == "same GSTIN as Existing firm"
    assert plan["customers"]["skip"][0]["why"] == "same GSTIN as Existing customer"
    assert plan["products"]["skip"][0]["why"] == "listed twice in the file"


def test_same_number_part_closed_month_missing_fields_and_old_purchase_reasons():
    business, customer = firm(), buyer()
    sale(business, customer, "108", date(2026, 3, 1))
    FiledPeriod.objects.create(business=business, year=2026, month=2)
    data = payload()
    data["businesses"][0]["name"] = business.name
    base = data["invoices"][0]
    data["invoices"] = [
        {**base, "invoice_number": "KGH/2025-26/108"},
        {**base, "invoice_number": "109", "invoice_date": "2026-02-01"},
        {**base, "invoice_number": "110", "invoice_date": "2026-02-30"},
        {**base, "invoice_number": "111", "customer": None},
        {**base, "invoice_number": "112", "type_of_invoice": "inward"},
    ]
    plan = preview(upload(data))["plan"]
    assert plan["bills"]["skip"][0]["why"] == "same number part as 108 on file"
    assert plan["bills"]["fail"][0]["why"] == "February 2026 is filed for KIRAN GOLD HOUSE. Have the owner unlock February 2026 in GST returns first."
    assert [row["why"] for row in plan["bills"]["fail"]][1:] == ["No bill date", "No customer name on the bill"]
    assert plan["purchases"]["fail"][0]["why"] == "Purchase bills from the old app go through Purchases → Import, which checks each supplier's GSTIN and the credit month"


def test_cap_only_limits_display_and_fingerprint_includes_hidden_rows():
    data = payload()
    data["invoices"] = []
    data["customers"] = [{"name": f"Buyer {n}"} for n in range(205)]
    first = preview(upload(data))
    assert len(first["plan"]["customers"]["add"]) == 200
    assert first["plan"]["customers"]["add_count"] == 205
    data["customers"][-1]["name"] = "Changed hidden row"
    assert preview(upload(data))["fingerprint"] != first["fingerprint"]


def test_old_v3_uses_percent_and_string_ids():
    data = payload("3.0")
    data["businesses"][0]["id"] = "b1"
    data["customers"][0]["id"] = "c1"
    data["products"] = [{"name": "Diamond", "hsn": "7102", "gstRate": "0.25"}]
    data["invoices"] = [{"businessId": "b1", "customerId": "c1", "invoiceNumber": "007", "invoice_date": "2026-03-31",
                         "type": "OUTWARD", "items": [{"productName": "Diamond", "hsn": "7102", "gstRate": "0.25", "qty": "2", "rate": "100"}]}]
    result = preview(upload(data))
    assert result["file"]["kind"] == "old_v3"
    assert result["plan"]["bills"]["add_count"] == 1


@pytest.mark.parametrize("bad", ["NaN", "Infinity", "1e400", {}, True, "-1"])
def test_bad_money_refuses_file_before_any_write(bad):
    data = payload()
    data["invoices"][0]["line_items"][0]["rate"] = bad
    with pytest.raises(ValidationError):
        preview(upload(data))
    assert not Business.objects.exists()


def apply(data, owner, fingerprint=None):
    from billing.services.backup_restore import apply_restore
    return apply_restore(upload(data), fingerprint or preview(upload(data))["fingerprint"], owner)


def test_apply_recomputes_diamond_total_keeps_number_and_does_not_copy_secrets():
    owner = person("owner", "admin")
    data = payload("5.0")
    data["app"] = "gst-billing"
    data["businesses"][0].update(invoice_prefix="GOLD", paper_full_number_from="2026-01-01")
    data["v3"] = {"people": [{"username": "hacker", "password": "ignored"}], "shop_settings": {"anything": "ignored"}}
    result = apply(data, owner)
    invoice = Invoice.objects.get(pk=result["added"]["bills"][0])
    assert invoice.invoice_number == "001"
    assert invoice.total_amount == Decimal("100.25")
    assert invoice.lineitem_set.get().gst_tax_rate == Decimal("0.0025")
    assert invoice.customer.name == "New Buyer"
    assert AuditLog.objects.filter(action="imported").count() == 4
    assert AuditLog.objects.filter(action="restored", entity="backup").count() == 1
    assert set(AuditLog.objects.values_list("entity", "action")) == {
        ("business", "imported"), ("customer", "imported"), ("product", "imported"),
        ("invoice", "imported"), ("backup", "restored"),
    }
    assert all(entry.snapshot for entry in AuditLog.objects.filter(action="imported"))
    assert not type(owner).objects.filter(username="hacker").exists()
    second = apply(data, owner)
    assert second["plan"]["adds"] == 0
    assert second["plan"]["skips"] == 4


def test_stale_preview_and_changed_file_roll_back_everything():
    from billing.refusals import Refusal
    owner = person("owner", "admin")
    data = payload()
    fingerprint = preview(upload(data))["fingerprint"]
    buyer("Someone added since")
    with pytest.raises(Refusal) as error:
        apply(data, owner, fingerprint)
    assert error.value.detail["code"] == "plan_changed"
    assert error.value.detail["detail"] == "The books changed since the preview. Check the new plan, then restore."
    assert "plan" in error.value.detail
    assert not Business.objects.exists()
    fingerprint = preview(upload(data))["fingerprint"]
    data["invoices"][0]["line_items"][0]["rate"] = "110"
    with pytest.raises(Refusal):
        apply(data, owner, fingerprint)
    assert not AuditLog.objects.exists()


def test_old_v3_apply_and_same_counter_inside_file():
    owner = person("owner", "admin")
    data = payload("3.0")
    data["products"] = [{"name": "Diamond", "hsn": "7102", "gstRate": "0.25"}]
    raw = {"businessId": 901, "customerId": 902, "invoiceNumber": "007", "invoice_date": "2026-03-31",
           "items": [{"productName": "Diamond", "hsn": "7102", "gstRate": "0.25", "qty": "2", "rate": "100"}]}
    data["invoices"] = [raw, {**raw, "invoiceNumber": "G/2025-26/7"}]
    result = apply(data, owner)
    assert result["plan"]["bills"]["add_count"] == 1
    assert result["plan"]["bills"]["skip_count"] == 1
    assert Invoice.objects.get().total_amount == Decimal("200.50")


def test_current_bin_is_restored_and_its_saved_values_win():
    from billing.services.bin import bin_bill
    owner = person("owner", "admin")
    business, customer = firm(), buyer()
    original = sale(business, customer, "001", date(2026, 3, 31))
    binned, deleted = bin_bill(original, owner)
    data = payload()
    data["businesses"][0]["name"] = business.name
    data["customers"][0]["name"] = customer.name
    result = apply(data, owner)
    assert result["added"]["bills"] == [binned.original_id]
    assert "comes back from the bin" in result["plan"]["bills"]["add"][0]["detail"]
    assert Invoice.objects.get().total_amount == Decimal("10300")
    deleted.refresh_from_db()
    assert deleted.snapshot["_undo"]
    binned.refresh_from_db()
    assert binned.restored_at is not None
    assert AuditLog.objects.filter(action="restored", entity="invoice", entity_id=binned.original_id).exists()
    assert AuditLog.objects.filter(action="imported", entity="invoice", entity_id=binned.original_id).exists()


def test_new_customer_from_bill_name_is_in_plan_and_made_once():
    owner = person("owner", "admin")
    data = payload()
    data["customers"] = []
    raw = data["invoices"][0]
    raw.update(customer=None, customer_name="Walked in buyer")
    data["invoices"].append({**raw, "invoice_number": "002"})
    result = apply(data, owner)
    assert result["plan"]["customers"]["add_count"] == 1
    assert Customer.objects.count() == 1
    assert Invoice.objects.count() == 2


def test_added_id_lists_cap_at_50_but_all_records_are_created():
    owner = person("owner", "admin")
    data = payload()
    data["customers"] = [{"name": f"Buyer {n}"} for n in range(55)]
    data["invoices"] = []
    result = apply(data, owner)
    assert len(result["added"]["customers"]) == 50
    assert Customer.objects.count() == 55


def test_failure_during_apply_rolls_back_records_and_audits(monkeypatch):
    import billing.services.backup_restore as service
    owner = person("owner", "admin")
    def refuse(*args, **kwargs):
        raise RuntimeError("synthetic write failure")
    monkeypatch.setattr(service, "_imported", refuse)
    with pytest.raises(RuntimeError, match="synthetic write failure"):
        apply(payload(), owner)
    assert not Business.objects.exists()
    assert not AuditLog.objects.exists()


def test_preview_and_apply_are_owner_only_api_views():
    from rest_framework.test import APIRequestFactory, force_authenticate

    from billing.api.backup_restore import BackupRestoreApply, BackupRestorePreview
    for view in (BackupRestoreApply, BackupRestorePreview):
        for role in ("viewer", "editor", "accountant", "counter_staff"):
            user = person(f"{view.__name__}-{role}", role)
            request = APIRequestFactory().post("/", {"file": upload()}, format="multipart")
            force_authenticate(request, user=user)
            response = view.as_view()(request)
            assert response.status_code == 403
            assert response.data["needs"] == "backup.restore"
    owner = person("owner", "admin")
    request = APIRequestFactory().post("/", {"file": upload()}, format="multipart")
    force_authenticate(request, user=owner)
    assert BackupRestorePreview.as_view()(request).status_code == 200


def test_missing_reference_never_matches_an_unidentified_master():
    data = payload()
    data["customers"] = [{"name": "Not the bill's buyer"}]
    data["invoices"][0]["customer"] = None
    assert preview(upload(data))["plan"]["bills"]["fail"] == [{"name": "001", "why": "No customer name on the bill"}]


def test_same_counter_in_bin_is_not_added_as_another_bill():
    from billing.services.bin import bin_bill
    owner = person("owner", "admin")
    business, customer = firm(), buyer()
    bin_bill(sale(business, customer, "001", date(2026, 3, 31)), owner)
    data = payload()
    data["businesses"][0]["name"] = business.name
    data["invoices"][0]["invoice_number"] = "KGH/2025-26/1"
    assert preview(upload(data))["plan"]["bills"]["skip"] == [{"name": "KGH/2025-26/1", "why": "same number part as 001 on file"}]


@pytest.mark.parametrize("rate", ["-0.03", "1000"])
def test_negative_or_impossible_tax_rate_is_a_file_error(rate):
    data = payload()
    data["invoices"][0]["line_items"][0]["gst_tax_rate"] = rate
    with pytest.raises(ValidationError):
        preview(upload(data))


def test_existing_parties_are_unchanged_and_local_id_collision_is_ignored():
    owner = person("owner", "admin")
    existing = buyer("Existing Buyer", mobile_number="9000000001")
    data = payload()
    data["customers"][0].update(id=existing.pk, mobile_number="9000000002")
    result = apply(data, owner)
    existing.refresh_from_db()
    assert existing.name == "Existing Buyer"
    assert existing.mobile_number == "9000000001"
    assert result["added"]["customers"] != [existing.pk]


def test_ids_and_names_have_separate_namespaces():
    owner = person("owner", "admin")
    data = payload()
    data["businesses"].append({"id": 999, "name": "901", "gst_number": "", "state_name": "GUJARAT"})
    result = apply(data, owner)
    assert Invoice.objects.get(pk=result["added"]["bills"][0]).business.name == "NEW GOLD"


def test_new_customer_keeps_only_its_mapped_usual_firms():
    owner = person("owner", "admin")
    data = payload()
    data["customers"][0]["businesses"] = [901]
    apply(data, owner)
    assert list(Customer.objects.get().businesses.values_list("name", flat=True)) == ["NEW GOLD"]


def test_cancelled_and_sent_metadata_stays_on_restored_new_sale():
    owner = person("owner", "admin")
    data = payload("5.0")
    data["app"] = "gst-billing"
    data["invoices"][0].update(status="cancelled", cancel_reason="Written twice", paper=True,
                               sent_at="2026-03-31T15:00:00+05:30", sent_count=1,
                               sent_via="whatsapp", sent_to="9000000001", notes="Keep this")
    apply(data, owner)
    invoice = Invoice.objects.get()
    assert invoice.status == "cancelled"
    assert invoice.cancel_reason == "Written twice"
    assert invoice.paper
    assert invoice.sent_count == 1
    assert invoice.notes == "Keep this"
    assert invoice.sent_at is not None


@pytest.mark.django_db(transaction=True)
def test_two_owners_cannot_apply_the_same_preview_twice():
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection

    from billing.refusals import Refusal
    from billing.services.backup_restore import apply_restore

    if connection.vendor != "postgresql":
        pytest.skip("Row-lock serialization is verified on Postgres 16")
    first, second = person("first", "admin"), person("second", "admin")
    data = payload()
    fingerprint = preview(upload(data))["fingerprint"]
    start = Barrier(2)

    def restore(owner):
        close_old_connections()
        try:
            start.wait(timeout=10)
            try:
                apply_restore(upload(data), fingerprint, owner)
                return "added"
            except Refusal as error:
                return error.detail["code"]
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(restore, (first, second)))
    assert sorted(results) == ["added", "plan_changed"]
    assert Invoice.objects.count() == 1
    assert AuditLog.objects.filter(action="restored", entity="backup").count() == 1


def test_actual_v5_stream_restores_into_empty_books():
    from django.utils import timezone

    from billing.models import Product
    from billing.services.backups import full_stream

    owner = person("owner", "admin")
    business, customer = firm(gstin="08VRHFA2322D1ZI"), buyer()
    customer.businesses.add(business)
    Product.objects.create(name="Diamond", hsn_code="7102", gst_tax_rate=Decimal("0.0025"))
    sale(business, customer, "007", date(2026, 3, 31), line(rate="100", gst="0.0025"))
    data = json.loads(b"".join(full_stream(owner, timezone.localtime(), "roundtrip.json")))
    Invoice.objects.all().delete()
    Customer.objects.all().delete()
    Business.objects.all().delete()
    Product.objects.all().delete()
    result = apply(data, owner)
    assert result["plan"]["adds"] == 4
    assert Invoice.objects.get().total_amount == Decimal("100.25")
    assert Customer.objects.get().businesses.get().name == business.name


def test_frozen_firm_never_imports_a_media_path_or_unknown_json():
    owner = person("owner", "admin")
    data = payload("5.0")
    data["app"] = "gst-billing"
    data["invoices"][0]["firm_snapshot"] = {"name": "Earlier firm", "signature_image": "private/signature.png", "unknown": 1.5}
    apply(data, owner)
    assert Invoice.objects.get().firm_snapshot == {"name": "Earlier firm", "signature_image": ""}


@pytest.mark.parametrize("invalid", [["bad"], "bad\x00", "bad\ud800"])
def test_nested_frozen_firm_text_is_refused_before_writes(invalid):
    data = payload()
    data["invoices"][0]["firm_snapshot"] = {"name": invalid}
    with pytest.raises(ValidationError):
        preview(upload(data))
    assert not Business.objects.exists()


def test_bin_uses_its_actual_month_even_when_backup_date_is_different():
    from billing.services.bin import bin_bill
    owner = person("owner", "admin")
    business, customer = firm(), buyer()
    bin_bill(sale(business, customer, "001", date(2026, 3, 31)), owner)
    FiledPeriod.objects.create(business=business, year=2026, month=3)
    data = payload()
    data["businesses"][0]["name"] = business.name
    data["invoices"][0]["invoice_date"] = "2026-02-01"
    result = preview(upload(data))
    assert result["plan"]["bills"]["fail"] == [{"name": "001", "why": "March 2026 is filed for KIRAN GOLD HOUSE. Have the owner unlock March 2026 in GST returns first."}]
    assert not Invoice.objects.exists()



def purchase_payload(number="SUP/001"):
    data = payload("5.0")
    data["app"] = "gst-billing"
    data["invoices"][0].update(type_of_invoice="inward", invoice_number=number)
    return data


def test_purchase_saved_match_uses_supplier_normalization_and_fy():
    business, supplier = firm(), buyer("Supplier", gst_number="08WWUFP9975S1ZN")
    same_registration = buyer("Supplier twin", gst_number=" 08wwufp9975s1zn ")
    sale(business, same_registration, "SUP-001", date(2026, 3, 1), kind="inward")
    data = purchase_payload()
    data["businesses"][0]["name"] = business.name
    data["customers"][0].update(name=supplier.name, gst_number=supplier.gst_number)
    plan = preview(upload(data))["plan"]
    assert plan["purchases"]["skip"] == [{"name": "SUP/001", "why": "already on file as SUP-001"}]
    assert plan["purchases"]["fail"] == []


def test_purchase_file_identity_keeps_supplier_firm_fy_and_digit_separators():
    data = purchase_payload("SUP-001")
    data["businesses"].append({"id": 911, "name": "Second firm"})
    data["customers"].append({"id": 912, "name": "Second supplier"})
    first = data["invoices"][0]
    data["invoices"] = [first, {**first, "invoice_number": "sup/001"},
                        {**first, "customer": 912}, {**first, "business": 911},
                        {**first, "invoice_date": "2026-04-01"},
                        {**first, "invoice_number": "12-3"}, {**first, "invoice_number": "1-23"},
                        {**first, "invoice_number": "ABC"}]
    plan = preview(upload(data))["plan"]
    assert plan["purchases"]["skip"] == [{"name": "sup/001", "why": "listed twice in the file"}]
    assert plan["purchases"]["fail_count"] == 7
    assert all(row["why"] == "can't add yet" for row in plan["purchases"]["fail"])


def test_purchase_bin_match_uses_shared_identity_and_never_claims_a_sale():
    from billing.models import BinnedInvoice
    from billing.services.backup_restore import _purchase_match

    business, first, second = firm(), buyer("First supplier"), buyer("Second supplier")
    binned = BinnedInvoice.objects.create(original_id=801, business=business, customer=second,
        invoice_date=date(2026, 3, 31), invoice_number="SUP-001", type_of_invoice="inward", data={})
    for supplier, expected in ((first, None), (second, binned.pk)):
        live, deleted = _purchase_match({"id": business.pk}, {"id": supplier.pk, "gst_number": ""}, "SUP/001", date(2026, 3, 1))
        assert live is None
        assert (deleted.pk if deleted else None) == expected
    data = payload()
    data["businesses"][0]["name"] = business.name
    data["invoices"][0]["invoice_number"] = "SUP/001"
    assert preview(upload(data))["plan"]["bills"]["add_count"] == 1


@pytest.mark.django_db(transaction=True)
def test_purchase_duplicate_matcher_reads_narrowly_without_cacheops():
    from unittest.mock import patch

    from django.db import connection
    from django.test.utils import CaptureQueriesContext

    from billing.api.inward_bills_service import find_duplicate
    from billing.services.backup_restore import _purchase_match
    from billing.tests.test_v3_cacheops import cacheops_on

    business, supplier = firm(), buyer("Supplier")
    sale(business, supplier, "SUP-001", date(2026, 3, 31), kind="inward")
    with (cacheops_on() as touched,
          patch("billing.services.backup_restore.find_duplicate", wraps=find_duplicate) as match,
          CaptureQueriesContext(connection) as queries):
        live, binned = _purchase_match({"id": business.pk}, {"id": supplier.pk, "gst_number": ""}, "SUP/001", date(2026, 3, 1))
    assert live is not None
    assert binned is None
    assert match.call_count == 1
    assert touched == []
    sql = " ".join(query["sql"] for query in queries)
    for unused in ("firm_snapshot", "notes", "source_file", "source_preview", "total_amount"):
        assert f'"{unused}"' not in sql


def test_apply_rechecks_purchase_identity_without_crossing_sale_numbers():
    from billing.refusals import Refusal

    owner = person("owner", "admin")
    business, supplier = firm(), buyer("Supplier")
    data = purchase_payload("001")
    data["businesses"][0]["name"] = business.name
    data["customers"][0]["name"] = supplier.name
    first = data["invoices"][0]
    data["invoices"].append({**first, "type_of_invoice": "outward"})
    answer = preview(upload(data))
    assert answer["plan"]["bills"]["add_count"] == 1
    assert answer["plan"]["purchases"]["fail_count"] == 1
    sale(business, supplier, "001", date(2026, 3, 31), kind="inward")
    with pytest.raises(Refusal) as error:
        apply(data, owner, answer["fingerprint"])
    assert error.value.detail["plan"]["purchases"]["skip_count"] == 1
    assert not Invoice.objects.filter(type_of_invoice="outward").exists()


def test_filing_object_is_archival_and_never_adds_closed_periods():
    data = payload("5.0")
    data["app"] = "gst-billing"
    data["v3"] = {"filing": {
        "filing_records": [{"business": 901, "year": 2026, "month": 3, "kind": "gstr1"}],
        "filing_months": [{"business": 901, "year": 2026, "month": 3}],
        "opening_credits": [{"business": 901, "cgst": "100.00"}],
    }, "filed_periods": [{"business": 901, "year": 2026, "month": 3}]}
    owner = person("owner", "admin")
    result = apply(data, owner)
    assert result["plan"]["bills"]["add_count"] == 1
    assert not FiledPeriod.objects.exists()
