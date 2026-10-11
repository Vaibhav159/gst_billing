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
