from datetime import date
from io import StringIO

import pytest
from django.core.management import call_command

from billing.models import Business, FiledPeriod, FilingRecord

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
