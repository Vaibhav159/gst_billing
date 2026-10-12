from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth.models import User
from rest_framework.exceptions import ValidationError

from billing.models import AuditLog, Business, FiledPeriod, FilingMonth, FilingRecord
from billing.refusals import Refusal
from billing.services.filing import _snapshot as real_snapshot
from billing.services.filing import edit_filing, filed_before, mark_filed, relock_month, remove_filing, unlock_month

pytestmark = pytest.mark.django_db
DAY = date(2026, 9, 1)
TODAY = date(2026, 10, 11)
HEADS = {"igst": "0.00", "cgst": "15.00", "sgst": "15.00", "total": "30.00"}


@pytest.fixture
def shop():
    return Business.objects.create(name="KIRAN GOLD HOUSE"), User.objects.create_user("owner")


@pytest.fixture(autouse=True)
def today():
    with patch("billing.services.filing.timezone.localdate", return_value=TODAY), patch(
        "billing.services.filing._snapshot", return_value=({"cash": HEADS, "carry_on": HEADS}, {"1": {"total": "1030.00"}}, {"fp": "092026"})
    ), patch("billing.services.filing._blockers", return_value=[]):
        yield


def test_both_is_atomic_and_freezes_snapshot(shop):
    firm, user = shop
    with pytest.raises(ValidationError):
        mark_filed(firm, DAY, user, {"kind": "both", "gstr1_filed_on": "2026-10-10", "filed_on": "2026-10-09"})
    assert not FilingRecord.objects.exists()
    assert not AuditLog.objects.exists()
    rows = mark_filed(firm, DAY, user, {"kind": "both", "gstr1_filed_on": "2026-10-08", "filed_on": "2026-10-09", "cash_total": "31.00"})
    assert [row.kind for row in rows] == ["gstr1", "gstr3b"]
    assert rows[1].cash_total == Decimal("31.00")
    assert rows[1].cash_cgst is None
    assert FiledPeriod.objects.filter(business=firm, year=2026, month=9).exists()
    assert AuditLog.objects.filter(entity="filing", action="filed").count() == 2
    before = rows[1].figures.copy()
    edit_filing(rows[1], user, {"cash": {"igst": "0", "cgst": "10", "sgst": "10"}, "arn": " aa0810260345671 "})
    rows[1].refresh_from_db()
    assert rows[1].figures == before
    assert rows[1].arn == "AA0810260345671"
    assert rows[1].cash_total == Decimal("20.00")


def test_running_month_and_duplicate_and_odd_cash_refuse(shop):
    firm, user = shop
    with pytest.raises(Refusal) as exc:
        mark_filed(firm, date(2026, 10, 1), user, {"kind": "gstr1", "filed_on": "2026-10-11"})
    assert exc.value.detail["code"] == "month_running"
    row = mark_filed(firm, DAY, user, {"kind": "gstr1", "filed_on": "2026-10-08"})[0]
    with pytest.raises(Refusal) as exc:
        mark_filed(firm, DAY, user, {"kind": "gstr1", "filed_on": "2026-10-08"})
    assert exc.value.detail["code"] == "already_filed"
    with pytest.raises(ValidationError):
        mark_filed(firm, DAY, user, {"kind": "gstr3b", "filed_on": "2026-10-09", "cash_total": "NaN"})
    assert FilingRecord.objects.count() == 1
    assert row.kind == "gstr1"


def test_noop_edit_writes_nothing_and_date_chain_is_validated(shop):
    firm, user = shop
    rows = mark_filed(firm, DAY, user, {"kind": "both", "gstr1_filed_on": "2026-10-08", "filed_on": "2026-10-09"})
    count = AuditLog.objects.count()
    edit_filing(rows[0], user, {"arn": ""})
    assert AuditLog.objects.count() == count
    with pytest.raises(ValidationError):
        edit_filing(rows[0], user, {"filed_on": "2026-10-10"})


def test_unlock_relock_keeps_snapshots_and_removal_dependencies(shop):
    firm, user = shop
    rows = mark_filed(firm, DAY, user, {"kind": "both", "gstr1_filed_on": "2026-10-08", "filed_on": "2026-10-09"})
    with pytest.raises(Refusal) as exc:
        remove_filing(rows[0], user, "Wrong month")
    assert exc.value.detail["code"] == "record_in_use"
    unlock_month(firm, DAY, user, "Wrong GSTIN")
    assert not FiledPeriod.objects.exists()
    assert FilingMonth.objects.get().unlocked_at
    relock_month(firm, DAY, user)
    assert FiledPeriod.objects.exists()
    assert FilingMonth.objects.get().unlocked_at is None
    rows[0].refresh_from_db()
    assert rows[0].file == {"fp": "092026"}
    remove_filing(rows[1], user, "Wrong month")
    assert not FiledPeriod.objects.exists()
    remove_filing(rows[0], user, "Wrong month")
    assert not FilingRecord.objects.exists()


def test_legacy_unlock_freezes_before_deleting_lock(shop):
    firm, user = shop
    FiledPeriod.objects.create(business=firm, year=2026, month=9)
    unlock_month(firm, DAY, user, "Correct GSTIN")
    assert FilingRecord.objects.count() == 0
    state = FilingMonth.objects.get()
    assert state.legacy_frozen_at is not None
    assert state.legacy_snapshot["gstr1"]["file"] == {"fp": "092026"}
    assert not FiledPeriod.objects.exists()
    relock_month(firm, DAY, user)
    assert FiledPeriod.objects.exists()
    assert not FilingRecord.objects.exists()


def test_filed_before_is_idempotent_and_does_not_touch_existing_records(shop):
    firm, user = shop
    result = filed_before(firm, date(2025, 6, 1), user)
    assert result == {"months": ["2025-04", "2025-05", "2025-06"], "count": 3}
    assert filed_before(firm, date(2025, 6, 1), user)["count"] == 0
    assert set(FiledPeriod.objects.values_list("note", flat=True)) == {"Filed before the app kept filing records"}


def test_latest_3b_removal_only(shop):
    firm, user = shop
    rows = mark_filed(firm, DAY, user, {"kind": "both", "gstr1_filed_on": "2026-10-08", "filed_on": "2026-10-09"})
    FilingRecord.objects.create(business=firm, year=2026, month=10, kind="gstr3b", filed_on=date(2026, 11, 1))
    with pytest.raises(Refusal) as exc:
        remove_filing(rows[1], user, "Wrong month")
    assert exc.value.detail["code"] == "record_in_use"


def test_unlock_invalid_reason_has_contract_words(shop):
    firm, user = shop
    mark_filed(firm, DAY, user, {"kind": "gstr1", "filed_on": "2026-10-08"})
    with pytest.raises(ValidationError) as exc:
        unlock_month(firm, DAY, user, " ")
    assert "Write why September needs unlocking" in str(exc.value.detail)


def test_marking_3b_finishes_an_unlocked_gstr1_correction(shop):
    firm, user = shop
    mark_filed(firm, DAY, user, {"kind": "gstr1", "filed_on": "2026-10-08"})
    unlock_month(firm, DAY, user, "Correct the GSTIN")
    with patch("billing.services.filing.changes_for_month", return_value=[{"month": "2026-09", "before": {}, "after": {"id": 1}}]):
        mark_filed(firm, DAY, user, {"kind": "gstr1a", "filed_on": "2026-10-09"})
    mark_filed(firm, DAY, user, {"kind": "gstr3b", "filed_on": "2026-10-10"})
    state = FilingMonth.objects.get()
    assert state.unlocked_at is None
    assert state.relocked_by_id == user.pk
    assert state.relocked_at is not None
    assert FiledPeriod.objects.filter(business=firm, year=2026, month=9).exists()
    assert AuditLog.objects.filter(entity="period", action="locked").count() == 1


@pytest.mark.parametrize("value", ["1e999999999", "-1e999999999", "NaN", "Infinity", "0.001"])
def test_odd_cash_amount_is_a_field_error_and_never_partial_filing(shop, value):
    firm, user = shop
    mark_filed(firm, DAY, user, {"kind": "gstr1", "filed_on": "2026-10-08"})
    with pytest.raises(ValidationError) as exc:
        mark_filed(firm, DAY, user, {"kind": "gstr3b", "filed_on": "2026-10-09", "cash_total": value})
    assert exc.value.detail == {"cash_total": ["Type the cash paid with GSTR-3B, or 0."]}
    assert FilingRecord.objects.count() == 1
    assert not FiledPeriod.objects.exists()


def test_second_legacy_unlock_keeps_the_first_books_snapshot(shop):
    from copy import deepcopy

    from billing.models import Customer, Invoice

    firm, user = shop
    customer = Customer.objects.create(name="Synthetic buyer")
    bill = Invoice.objects.create(business=firm, customer=customer, invoice_number="LEGACY-1", invoice_date=DAY,
                                  type_of_invoice="outward", total_amount="1030.00")
    FiledPeriod.objects.create(business=firm, year=2026, month=9)

    def current_books(_business, _month, _kind):
        amount = format(Invoice.objects.get(pk=bill.pk).total_amount, ".2f")
        return {"cash": HEADS, "carry_on": HEADS}, {str(bill.pk): {"id": bill.pk, "total": amount}}, {"total": amount}

    with patch("billing.services.filing._snapshot", side_effect=current_books):
        unlock_month(firm, DAY, user, "Correct the old bill")
        first = FilingMonth.objects.get()
        frozen = deepcopy(first.legacy_snapshot)
        frozen_at = first.legacy_frozen_at
        Invoice.objects.filter(pk=bill.pk).update(total_amount="2060.00")
        relock_month(firm, DAY, user)
        unlock_month(firm, DAY, user, "Correct the GSTIN too")
    state = FilingMonth.objects.get()
    assert state.legacy_snapshot == frozen
    assert state.legacy_frozen_at == frozen_at
    assert state.legacy_snapshot["gstr1"]["bills"][str(bill.pk)]["total"] == "1030.00"
    assert state.unlock_reason == "Correct the GSTIN too"
    assert not FilingRecord.objects.exists()
    assert not FiledPeriod.objects.exists()


def test_gstr3b_record_keeps_late_fee_and_interest_worked_out_to_its_filing_day(shop):
    # R3A-4: the record holds the figures the month shows; typed ones win.
    firm, user = shop
    late = {"gstr1": {"fee": "0.00"}, "gstr3b": {"fee": "150.00"}, "interest": "4.93"}
    snapshot = ({"cash": HEADS, "carry_on": HEADS, "tables": {"late": late}}, {}, {})
    mark_filed(firm, DAY, user, {"kind": "gstr1", "filed_on": "2026-10-08"})
    with patch("billing.services.filing._snapshot", return_value=snapshot):
        record = mark_filed(firm, DAY, user, {"kind": "gstr3b", "filed_on": "2026-10-11"})[0]
    assert (record.late_fee, record.interest) == (Decimal("150.00"), Decimal("4.93"))
    FilingRecord.objects.filter(kind="gstr3b").delete()
    with patch("billing.services.filing._snapshot", return_value=snapshot):
        record = mark_filed(firm, DAY, user, {"kind": "gstr3b", "filed_on": "2026-10-11", "late_fee": "0"})[0]
    assert (record.late_fee, record.interest) == (Decimal("0"), Decimal("4.93"))
    seen = {}

    def position(*args, **kwargs):
        seen["position"] = kwargs["today"]
        return {}

    def tables(*args, **kwargs):
        seen["tables"] = kwargs["today"]
        return {}

    with patch("billing.services.ledger.month_position", side_effect=position), patch(
            "billing.services.ledger.gstr3b_tables", side_effect=tables):
        real_snapshot(firm, DAY, "gstr3b", filing_date=date(2026, 10, 11))
    assert seen == {"position": date(2026, 10, 11), "tables": date(2026, 10, 11)}


@pytest.mark.parametrize("frozen", [False, True])
def test_legacy_month_records_both_returns_only(shop, frozen):
    # R3A-6: GSTR-1 alone on a legacy month would drop its lock.
    firm, user = shop
    FiledPeriod.objects.create(business=firm, year=2026, month=9, note="v2")
    if frozen:
        unlock_month(firm, DAY, user, "Correct the GSTIN")
    with pytest.raises(Refusal) as exc:
        mark_filed(firm, DAY, user, {"kind": "gstr1", "filed_on": "2026-10-08"})
    assert exc.value.detail["code"] == "legacy_both"
    assert "record both returns together" in str(exc.value.detail)
    assert FiledPeriod.objects.exists() is not frozen
    assert not FilingRecord.objects.exists()


def test_filed_before_skips_months_the_owner_unlocked(shop):
    from billing.period_lock import month_status

    firm, user = shop
    FiledPeriod.objects.create(business=firm, year=2026, month=8, note="v2")
    unlock_month(firm, date(2026, 8, 1), user, "Fix a bill")
    result = filed_before(firm, DAY, user)
    assert "2026-08" not in result["months"] and "2026-09" in result["months"]
    assert not FiledPeriod.objects.filter(year=2026, month=8).exists()
    assert month_status(firm.pk, 2026, 8, include_checks=False).stage == "unlocked"


def test_recording_an_unlocked_legacy_month_files_its_frozen_books(shop):
    firm, user = shop
    FiledPeriod.objects.create(business=firm, year=2026, month=9, note="v2")
    books = {"total": "1030.00"}

    def current_books(_business, _month, kind, **kwargs):
        return {"cash": HEADS, "carry_on": HEADS, "kind": kind}, {"1": dict(books)}, dict(books)

    with patch("billing.services.filing._snapshot", side_effect=current_books):
        unlock_month(firm, DAY, user, "Correct the old bill")
        books["total"] = "2060.00"
        rows = mark_filed(firm, DAY, user, {"kind": "both", "gstr1_filed_on": "2026-10-08", "filed_on": "2026-10-09"})
    state = FilingMonth.objects.get()
    for row in rows:
        assert row.bills == state.legacy_snapshot[row.kind]["bills"] == {"1": {"total": "1030.00"}}
        assert row.file == {"total": "1030.00"}
        assert row.figures["legacy"] is True and row.figures["kind"] == row.kind
    assert state.unlocked_at is None
    assert FiledPeriod.objects.exists()


def test_unlock_hint_names_the_month_that_carries_the_correction(shop):
    firm, user = shop
    with patch("billing.services.filing.timezone.localdate", return_value=date(2026, 12, 2)):
        mark_filed(firm, DAY, user, {"kind": "both", "gstr1_filed_on": "2026-10-08", "filed_on": "2026-10-09"})
        mark_filed(firm, date(2026, 10, 1), user, {"kind": "both", "gstr1_filed_on": "2026-11-08", "filed_on": "2026-11-09"})
        with pytest.raises(ValidationError) as exc:
            unlock_month(firm, DAY, user, " ")
    assert "amend in November's GSTR-1" in str(exc.value.detail)


def test_gstr1a_details_with_gstr3b_are_refused_when_gstr1a_is_on_record(shop):
    firm, user = shop
    mark_filed(firm, DAY, user, {"kind": "gstr1", "filed_on": "2026-10-08"})
    with patch("billing.services.filing.changes_for_month", return_value=[{"month": "2026-09", "before": {}, "after": {"id": 1}}]):
        mark_filed(firm, DAY, user, {"kind": "gstr1a", "filed_on": "2026-10-09"})
    with pytest.raises(ValidationError) as exc:
        mark_filed(firm, DAY, user, {"kind": "gstr3b", "filed_on": "2026-10-10", "gstr1a_filed_on": "2026-10-10"})
    assert "GSTR-1A is already on record" in str(exc.value.detail["gstr1a_filed_on"])
    assert not FilingRecord.objects.filter(kind="gstr3b").exists()


def test_removing_the_last_record_keeps_the_legacy_freeze_and_lock(shop):
    firm, user = shop
    FiledPeriod.objects.create(business=firm, year=2026, month=9, note="v2")
    unlock_month(firm, DAY, user, "Correct the old bill")
    frozen = FilingMonth.objects.get().legacy_snapshot
    rows = mark_filed(firm, DAY, user, {"kind": "both", "gstr1_filed_on": "2026-10-08", "filed_on": "2026-10-09"})
    remove_filing(rows[1], user, "Wrong ARN")
    remove_filing(rows[0], user, "Wrong ARN")
    state = FilingMonth.objects.get()
    assert state.legacy_snapshot == frozen and state.legacy_frozen_at is not None
    assert FiledPeriod.objects.filter(business=firm, year=2026, month=9).exists()


@pytest.mark.parametrize("unlocked", [False, True])
def test_partial_legacy_3b_can_add_only_missing_filing_details_using_its_frozen_books(shop, unlocked):
    firm, user = shop
    first = mark_filed(firm, DAY, user, {"kind": "gstr1", "filed_on": "2026-10-08"})[0]
    original = FilingRecord.objects.values().get(pk=first.pk)
    lock = FiledPeriod.objects.create(business=firm, year=2026, month=9, note="Filed in v2")
    edit_filing(first, user, {"arn": "AA0810260345671"})
    assert FiledPeriod.objects.get().pk == lock.pk  # Editing GSTR-1 must retain the legacy 3B lock.
    first.refresh_from_db()
    assert first.figures == original["figures"] and first.bills == original["bills"] and first.file == original["file"]
    if unlocked:
        unlock_month(firm, DAY, user, "Correct the old bill")
        frozen = FilingMonth.objects.get().legacy_snapshot
        with patch("billing.services.filing._snapshot", side_effect=AssertionError("Legacy books must stay frozen")):
            made = mark_filed(firm, DAY, user, {"kind": "gstr3b", "filed_on": "2026-10-09"})[0]
        assert made.bills == frozen["gstr3b"]["bills"]
    else:
        made = mark_filed(firm, DAY, user, {"kind": "gstr3b", "filed_on": "2026-10-09"})[0]
    assert made.figures["legacy"] is True
    assert made.filed_on == date(2026, 10, 9)
    assert FilingRecord.objects.filter(kind="gstr1").count() == 1
    assert FiledPeriod.objects.filter(business=firm, year=2026, month=9).exists()


def test_partial_legacy_unlock_relock_keeps_3b_baseline_and_routes_corrections_later(shop):
    from billing.period_lock import month_status
    from billing.services.filing import _has_3b, changes_since_filing, month_record

    firm, user = shop
    first = mark_filed(firm, DAY, user, {"kind": "gstr1", "filed_on": "2026-10-08"})[0]
    FiledPeriod.objects.create(business=firm, year=2026, month=9, note="Filed in v2")
    assert _has_3b(firm.pk, DAY)
    unlock_month(firm, DAY, user, "Correct a bill after the rollback")
    state = FilingMonth.objects.get()
    assert state.legacy_frozen_at is not None
    assert state.legacy_snapshot["gstr1"]["bills"] == first.bills
    frozen = state.legacy_snapshot
    for data in ({"kind": "gstr1a", "filed_on": "2026-10-09"},
                 {"kind": "gstr3b", "filed_on": "2026-10-09", "gstr1a_filed_on": "2026-10-09"}):
        with pytest.raises(Refusal) as refused:
            mark_filed(firm, DAY, user, data)
        assert refused.value.detail["code"] == "gstr3b_filed"
    before = {"id": 1, "invoice_number": "1", "table": "b2b", "pos": "08", "taxable": "1000", "cgst": "15", "sgst": "15", "igst": "0", "total": "1030"}
    after = {**before, "taxable": "2000", "cgst": "30", "sgst": "30", "total": "2060"}
    changes = changes_since_filing(firm, 2026, 9, changes=[{"month": "2026-09", "before": before, "after": after}])
    assert "October's GSTR-1" in changes["rows"][0]["goes_in"]
    relock_month(firm, DAY, user)
    assert FilingMonth.objects.get().legacy_snapshot == frozen
    status = month_status(firm.pk, 2026, 9, include_checks=False)
    assert status.legacy and status.credit_closed and status.sales_closed
    assert month_record(firm.pk, 2026, 9)["legacy"]
    assert not FilingRecord.objects.filter(kind="gstr3b").exists()


def test_gstr1_snapshot_checks_the_amendment_deadline_on_its_filing_day(shop):
    from billing.services import filing

    firm, _user = shop
    seen = {}
    with patch("billing.services.gstr1_file.build_gstr1", return_value={"figures": {}, "sections": {}, "bills": {}}), \
            patch.object(filing, "pending_amendments", side_effect=lambda *a, **k: seen.setdefault("pending", k["today"]) and []), \
            patch("billing.services.gstr1_file.attach_amendments",
                  side_effect=lambda built, *a, **k: seen.setdefault("attach", k["today"]) and {**built, "file": {}}):
        real_snapshot(firm, DAY, "gstr1", filing_date=date(2026, 11, 28))
    assert seen == {"pending": date(2026, 11, 28), "attach": date(2026, 11, 28)}


def test_pending_amendments_use_the_given_day_for_the_30_november_deadline(shop):
    from billing.services.filing import pending_amendments

    firm, _user = shop
    FilingRecord.objects.create(business=firm, year=2025, month=9, kind="gstr3b", filed_on=date(2025, 10, 20))
    day = date(2025, 10, 1)
    while day < date(2026, 11, 1):
        FiledPeriod.objects.create(business=firm, year=day.year, month=day.month)
        day = date(day.year + (day.month == 12), day.month % 12 + 1, 1)
    change = [{"month": "2025-09", "before": {}, "after": {"id": 1}}]
    with patch("billing.services.filing.timezone.localdate", return_value=date(2026, 12, 2)), \
            patch("billing.services.filing.changes_for_month", return_value=change):
        assert pending_amendments(firm, 2026, 11) == []
        assert pending_amendments(firm, 2026, 11, today=date(2026, 11, 28)) == change


@patch("billing.services.filing.timezone.localdate", return_value=date(2026, 12, 5))
def test_changing_a_gstr3b_date_refreshes_late_costs_and_16_4_credit(_today, shop):
    # R3A-7 on real purchase SQL: a 2025-26 bill (IGST 30) claimed in October 2026. Its GSTR-3B
    # (due 20 Nov) moves from 20 Nov to 2 Dec 2026, past Sec 16(4)'s 30 November: the 30 moves
    # to 4(D)(2), cash 1000 + 30 = 1030, 12 days x 50 = 600 fee (under 1.5 Cr) and
    # 18% on 1030 for 12 days = 6.095... -> 6.10.
    from billing.models import LineItem
    from billing.tests.v3_helpers import buyer, line, sale

    firm, user = shop
    october = date(2026, 10, 1)
    bill = sale(firm, buyer(gst_number="27ABCDE1234A1Z5"), "P1", date(2026, 3, 10), line(rate="1000"),
                kind="inward", itc_month=october)
    LineItem.objects.filter(invoice=bill).update(igst=Decimal(30), cgst=0, sgst=0)
    figures = {"cash": {"igst": "1000.00", "cgst": "0.00", "sgst": "0.00", "total": "1000.00"},
               "setoff_output": {"igst": "1100.00", "cgst": "0.00", "sgst": "0.00", "total": "1100.00"},
               "output": {"igst": "1100.00", "cgst": "0.00", "sgst": "0.00", "total": "1100.00"},
               "available": {"igst": "100.00", "cgst": "0.00", "sgst": "0.00", "total": "100.00"},
               "credit": {"igst": "100.00", "cgst": "0.00", "sgst": "0.00", "total": "100.00"},
               "base_credit": {"igst": "100.00", "cgst": "0.00", "sgst": "0.00", "total": "100.00"},
               "carry_on": {"igst": "0.00", "cgst": "0.00", "sgst": "0.00", "total": "0.00"}, "amendments": [],
               "tables": {"late": None, "t31a": {"taxable": "1100.00", "igst": "1100.00"}, "t31c": {"taxable": "0.00"},
                          "t4a5": {"heads": {"igst": "100.00"}}, "t4b1": {"heads": {}}, "t4d2": {"heads": {}, "list": []}}}
    mark_filed(firm, october, user, {"kind": "gstr1", "filed_on": "2026-11-08"})
    with patch("billing.services.filing._snapshot", return_value=(figures, {}, {})):
        record = mark_filed(firm, october, user, {"kind": "gstr3b", "filed_on": "2026-11-20"})[0]
    assert (record.late_fee, record.interest) == (Decimal(0), Decimal(0))
    edit_filing(record, user, {"filed_on": "2026-12-02"})
    record.refresh_from_db()
    late = record.figures["tables"]["late"]
    assert (late["gstr3b"]["days"], late["gstr3b"]["fee"]) == (12, "600.00")
    assert record.figures["credit"]["igst"] == record.figures["base_credit"]["igst"] == "70.00"
    assert record.figures["cash"]["igst"] == "1030.00"
    assert record.figures["tables"]["t4d2"]["heads"]["igst"] == "30.00"
    assert [entry["bill_no"] for entry in record.figures["tables"]["t4d2"]["list"]] == ["P1"]
    assert record.figures["tables"]["t4a5"]["heads"]["igst"] == "70.00"
    assert late["interest"] == "6.10"
    assert (record.late_fee, record.interest) == (Decimal("600.00"), Decimal("6.10"))
