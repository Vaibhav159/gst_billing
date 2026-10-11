"""The restore plan is read-only, bounded, and based on file contents and books."""

import json
from datetime import date

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.exceptions import ValidationError

from billing.models import AuditLog, Business, FiledPeriod
from billing.services.backup_restore import preview
from billing.tests.v3_helpers import buyer, firm, line, sale

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
