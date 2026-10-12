from datetime import date
from io import StringIO

import pytest
from django.core.management import call_command

from billing.models import Business, FiledPeriod, FilingMonth, FilingRecord
from billing.period_lock import credit_month_closed, month_status
from billing.services.filing import month_record

pytestmark = pytest.mark.django_db


def test_rollback_reports_and_protects_gstr1_only_month_then_reverses():
    firm = Business.objects.create(name="Kiran")
    FilingRecord.objects.create(business=firm, year=2026, month=9, kind="gstr1", filed_on=date(2026, 10, 8))
    out = StringIO()
    call_command("prepare_v2_rollback", stdout=out)
    assert "2026-09: GSTR-1 only" in out.getvalue()
    assert not FiledPeriod.objects.exists()
    call_command("prepare_v2_rollback", apply=True, stdout=StringIO())
    assert FiledPeriod.objects.get().note.startswith("GSTR-1 only: protected for v2 rollback")
    call_command("prepare_v2_rollback", reverse=True, apply=True, stdout=StringIO())
    assert not FiledPeriod.objects.exists()


def test_rollback_skips_unlocked_and_gstr3b_months_and_names_firms():
    from billing.models import FilingMonth

    firm = Business.objects.create(name="Kiran")
    for month in (7, 8, 9):
        FilingRecord.objects.create(business=firm, year=2026, month=month, kind="gstr1", filed_on=date(2026, month + 1, 8))
    FilingRecord.objects.create(business=firm, year=2026, month=8, kind="gstr3b", filed_on=date(2026, 9, 20))
    FilingMonth.objects.create(business=firm, year=2026, month=7, unlocked_at="2026-08-20T10:00:00Z")
    out = StringIO()
    call_command("prepare_v2_rollback", apply=True, stdout=out)
    assert "  Kiran 2026-09: GSTR-1 only" in out.getvalue()
    assert "2026-07" not in out.getvalue() and "2026-08" not in out.getvalue()
    assert list(FiledPeriod.objects.values_list("month", flat=True)) == [9]


def test_reverse_lists_each_month_it_removes_and_dry_run_keeps_them():
    firm = Business.objects.create(name="Kiran")
    FiledPeriod.objects.create(business=firm, year=2026, month=9, note="GSTR-1 only: protected for v2 rollback")
    FiledPeriod.objects.create(business=firm, year=2026, month=8, note="Filed on v2")
    out = StringIO()
    call_command("prepare_v2_rollback", reverse=True, stdout=out)
    assert "  Kiran 2026-09: v2 rollback lock to remove" in out.getvalue()
    assert "2026-08" not in out.getvalue()
    assert FiledPeriod.objects.count() == 2
    out = StringIO()
    call_command("prepare_v2_rollback", reverse=True, apply=True, stdout=out)
    assert "  Kiran 2026-09: v2 rollback lock removed" in out.getvalue()
    assert list(FiledPeriod.objects.values_list("month", flat=True)) == [8]


def reverse(*, apply=False):
    out = StringIO()
    call_command("prepare_v2_rollback", reverse=True, apply=apply, stdout=out)
    return out.getvalue()


def test_reverse_restores_3b_lock_deleted_by_v2_without_changing_filing_records():
    firm = Business.objects.create(name="Kiran")
    for kind in ("gstr1", "gstr3b"):
        FilingRecord.objects.create(business=firm, year=2026, month=9, kind=kind, filed_on=date(2026, 10, 8),
                                    figures={"kept": kind}, bills={"kept": kind}, file={"kept": kind})
    before = list(FilingRecord.objects.order_by("pk").values())
    assert "Kiran 2026-09: GSTR-3B whole-month lock to restore" in reverse()
    assert not FiledPeriod.objects.exists() and not FilingMonth.objects.exists()
    assert "Kiran 2026-09: GSTR-3B whole-month lock restored" in reverse(apply=True)
    state = month_status(firm.pk, 2026, 9, include_checks=False)
    assert state.stage == "filed" and state.sales_closed and state.credit_closed
    assert credit_month_closed(firm.pk, (2026, 9))
    locked = FiledPeriod.objects.get().pk
    assert "whole-month lock" not in reverse(apply=True)
    assert FiledPeriod.objects.get().pk == locked
    assert list(FilingRecord.objects.order_by("pk").values()) == before


@pytest.mark.parametrize("kind", [None, "gstr1", "gstr3b"])
def test_reverse_recognizes_v2_relocking_a_month_v3_had_unlocked(kind):
    from django.utils import timezone

    firm = Business.objects.create(name="Kiran")
    if kind:
        FilingRecord.objects.create(business=firm, year=2026, month=9, kind=kind, filed_on=date(2026, 10, 8))
    FilingMonth.objects.create(business=firm, year=2026, month=9, unlocked_at=timezone.now(), unlock_reason="Fix a bill")
    lock = FiledPeriod.objects.create(business=firm, year=2026, month=9, note="Filed in v2")
    before = FilingMonth.objects.values().get()
    assert "Kiran 2026-09: month locked again in v2; to record as relocked" in reverse()
    assert FilingMonth.objects.values().get() == before
    assert "Kiran 2026-09: month locked again in v2; recorded as relocked" in reverse(apply=True)
    state = FilingMonth.objects.get()
    assert state.unlocked_at is None and state.unlocked_by_id is None and state.unlock_reason == ""
    assert state.relocked_at is not None and state.relocked_by_id is None
    assert FiledPeriod.objects.get().pk == lock.pk
    after = FilingMonth.objects.values().get()
    reverse(apply=True)
    assert FilingMonth.objects.values().get() == after
    assert month_status(firm.pk, 2026, 9, include_checks=False).stage == "filed"


def test_reverse_keeps_v2_replacement_lock_as_legacy_3b_beside_gstr1():
    firm = Business.objects.create(name="Kiran")
    record = FilingRecord.objects.create(business=firm, year=2026, month=9, kind="gstr1", filed_on=date(2026, 10, 8))
    call_command("prepare_v2_rollback", apply=True, stdout=StringIO())
    FiledPeriod.objects.all().delete()  # v2.0.9 unlock has no v3 bridge.
    lock = FiledPeriod.objects.create(business=firm, year=2026, month=9, note="CA filed during rollback")
    for apply in (False, True, True):
        output = reverse(apply=apply)
        assert "Kiran 2026-09: GSTR-3B filed before the app; lock kept; add its filing details in v3" in output
        assert FiledPeriod.objects.get().pk == lock.pk
        assert FiledPeriod.objects.get().note == "CA filed during rollback"
        assert list(FilingRecord.objects.values_list("pk", "kind", "filed_on")) == [(record.pk, "gstr1", date(2026, 10, 8))]
        status = month_status(firm.pk, 2026, 9, include_checks=False)
        assert status.legacy and status.credit_closed and status.sales_closed and status.gstr3b is None
        payload = month_record(firm.pk, 2026, 9)
        assert payload["legacy"] and payload["gstr3b"] is None


@pytest.mark.parametrize("kind", ["gstr1", "gstr3b"])
def test_reverse_preserves_a_deliberate_v3_unlock_unchanged_by_v2(kind):
    from django.utils import timezone

    firm = Business.objects.create(name="Kiran")
    FilingRecord.objects.create(business=firm, year=2026, month=9, kind=kind, filed_on=date(2026, 10, 8))
    FilingMonth.objects.create(business=firm, year=2026, month=9, unlocked_at=timezone.now(), unlock_reason="Owner's correction")
    before = FilingMonth.objects.values().get()
    for apply in (False, True):
        assert "2026-09" not in reverse(apply=apply)
        assert not FiledPeriod.objects.exists()
        assert FilingMonth.objects.values().get() == before
        assert month_status(firm.pk, 2026, 9, include_checks=False).stage == "unlocked"


def test_reverse_preserves_lock_id_when_3b_was_recorded_after_rollback_protection():
    firm = Business.objects.create(name="Kiran")
    for kind in ("gstr1", "gstr3b"):
        FilingRecord.objects.create(business=firm, year=2026, month=9, kind=kind, filed_on=date(2026, 10, 8))
    lock = FiledPeriod.objects.create(business=firm, year=2026, month=9, note="GSTR-1 only: protected for v2 rollback")
    assert "GSTR-3B whole-month lock to restore" in reverse()
    assert FiledPeriod.objects.get().note == lock.note
    reverse(apply=True)
    lock.refresh_from_db()
    assert lock.note != "GSTR-1 only: protected for v2 rollback"
    assert FiledPeriod.objects.get().pk == lock.pk
    assert month_status(firm.pk, 2026, 9, include_checks=False).credit_closed


def test_own_rollback_protection_does_not_claim_gstr3b_was_filed():
    firm = Business.objects.create(name="Kiran")
    FilingRecord.objects.create(business=firm, year=2026, month=9, kind="gstr1", filed_on=date(2026, 10, 8))
    call_command("prepare_v2_rollback", apply=True, stdout=StringIO())
    assert not month_status(firm.pk, 2026, 9, include_checks=False).legacy
    assert not month_record(firm.pk, 2026, 9)["legacy"]
    assert "GSTR-3B filed before the app" not in reverse(apply=True)
    assert not FiledPeriod.objects.exists()


@pytest.mark.parametrize("lock_kind", ["v2", "protected", "unlocked"])
def test_next_gstr1_carries_customer_correction_from_partial_legacy_without_unlock(lock_kind):
    from unittest.mock import patch

    from django.utils import timezone

    from billing.gstin import check_digit
    from billing.services.filing import mark_filed, pending_amendments
    from billing.tests.v3_helpers import buyer, client_for, firm, person, sale

    business, owner = firm(), person("rollback-correction-owner", "admin")
    old = "08AAAAA0000A1Z" + check_digit("08AAAAA0000A1Z")
    new = "08BBBBB0000B1Z" + check_digit("08BBBBB0000B1Z")
    customer = buyer(gst_number=old, customer_type="business")
    bill = sale(business, customer, "1", date(2026, 8, 2))
    with patch("django.utils.timezone.localdate", return_value=date(2026, 10, 12)):
        original = mark_filed(business, date(2026, 8, 1), owner, {
            "kind": "gstr1", "filed_on": "2026-09-08", "confirm_checks": True})[0]
        before = FilingRecord.objects.values().get(pk=original.pk)
        note = "GSTR-1 only: protected for v2 rollback" if lock_kind == "protected" else "Filed in v2"
        FiledPeriod.objects.create(business=business, year=2026, month=8, note=note)
        if lock_kind == "unlocked":
            FilingMonth.objects.create(business=business, year=2026, month=8, unlocked_at=timezone.now())
        elif lock_kind == "v2":
            reverse(apply=True)
        response = client_for(owner).patch(f"/api/customers/{customer.pk}/", {"gst_number": new}, format="json")
        assert response.status_code == 200, response.content
        next_return = mark_filed(business, date(2026, 9, 1), owner, {
            "kind": "gstr1", "filed_on": "2026-10-08", "confirm_checks": True})[0]
        if lock_kind == "v2":
            carried = next_return.figures["amendments"]
            assert len(carried) == 1
            assert carried[0]["month"] == "2026-08"
            assert carried[0]["before"]["gstin"] == old and carried[0]["after"]["gstin"] == new
            assert carried[0]["before"]["id"] == bill.pk
            assert next_return.file["b2ba"]  # Real portal-file amendment, not just the page's plan.
            assert not FilingMonth.objects.filter(business=business, year=2026, month=8).exists()
            assert pending_amendments(business, 2026, 10) == []  # Consumed exactly once.
        else:
            assert next_return.figures["amendments"] == []
            assert not next_return.file.get("b2ba")
        assert FilingRecord.objects.values().get(pk=original.pk) == before
