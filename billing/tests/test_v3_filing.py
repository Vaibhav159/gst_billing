from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth.models import User
from rest_framework.exceptions import ValidationError

from billing.models import AuditLog, Business, FiledPeriod, FilingMonth, FilingRecord
from billing.refusals import Refusal
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
