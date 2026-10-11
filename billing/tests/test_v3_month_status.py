from datetime import date

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from billing.models import Business, FiledPeriod, FilingMonth, FilingRecord
from billing.period_lock import closed_months, credit_month_closed, month_status, next_open_credit_month

pytestmark = pytest.mark.django_db


def test_gstr1_closes_sales_but_not_credit():
    firm = Business.objects.create(name="KIRAN GOLD HOUSE")
    record = FilingRecord.objects.create(business=firm, year=2026, month=9, kind="gstr1", filed_on=date(2026, 10, 1))
    with CaptureQueriesContext(connection) as queries:
        status = month_status(firm.pk, 2026, 9)
    assert len(queries) <= 3
    assert status.stage == "gstr1"
    assert status.sales_closed and not status.credit_closed
    assert status.gstr1.pk == record.pk
    assert not credit_month_closed(firm.pk, date(2026, 9, 1))
    with CaptureQueriesContext(connection) as queries:
        assert closed_months([firm.pk]) == {(firm.pk, 2026, 9)}
    assert len(queries) == 1


def test_legacy_and_unlocked_stages():
    from django.utils import timezone
    firm = Business.objects.create(name="KIRAN GOLD HOUSE")
    FiledPeriod.objects.create(business=firm, year=2026, month=9)
    status = month_status(firm.pk, 2026, 9)
    assert status.stage == "filed" and status.legacy
    FiledPeriod.objects.all().delete()
    FilingMonth.objects.create(business=firm, year=2026, month=9, unlocked_at=timezone.now())
    assert month_status(firm.pk, 2026, 9).stage == "unlocked"
    assert closed_months([firm.pk]) == set()


def test_next_credit_month_uses_one_bounded_query():
    firm = Business.objects.create(name="KIRAN GOLD HOUSE")
    FiledPeriod.objects.create(business=firm, year=2026, month=9)
    with CaptureQueriesContext(connection) as queries:
        assert next_open_credit_month(firm.pk, date(2026, 9, 23), date(2026, 10, 11)) == date(2026, 10, 1)
    assert len(queries) == 1


def test_open_sales_write_does_not_run_return_checks():
    from unittest.mock import patch

    from billing.period_lock import assert_sales_open

    firm = Business.objects.create(name="KIRAN GOLD HOUSE")
    with patch("billing.period_lock.month_status") as checks:
        with CaptureQueriesContext(connection) as queries:
            assert_sales_open(firm, date(2025, 9, 1))
        checks.assert_not_called()
    assert len(queries) <= 2


def test_sales_closed_stages_keep_legacy_refusal_compatible():
    from billing.period_lock import assert_sales_open
    from billing.refusals import Refusal

    firm = Business.objects.create(name="KIRAN GOLD HOUSE")
    day = date(2026, 9, 1)
    FiledPeriod.objects.create(business=firm, year=2026, month=9)
    with pytest.raises(Refusal) as legacy:
        assert_sales_open(firm, day)
    assert "stage" not in legacy.value.detail
    FilingRecord.objects.create(business=firm, year=2026, month=9, kind="gstr1", filed_on=date(2026, 10, 8))
    FilingRecord.objects.create(business=firm, year=2026, month=9, kind="gstr3b", filed_on=date(2026, 10, 9))
    with pytest.raises(Refusal) as filed:
        assert_sales_open(firm, day)
    assert filed.value.detail["stage"] == "filed"
    FiledPeriod.objects.all().delete()
    FilingRecord.objects.filter(kind="gstr3b").delete()
    with pytest.raises(Refusal) as gstr1:
        assert_sales_open(firm, day)
    assert gstr1.value.detail["stage"] == "gstr1"


def test_next_credit_month_never_precedes_ledger_start():
    firm = Business.objects.create(name="KIRAN GOLD HOUSE")
    with CaptureQueriesContext(connection) as queries:
        first = next_open_credit_month(firm.pk, date(2000, 1, 15), date(2026, 10, 11))
    assert first == date(2025, 4, 1)
    assert len(queries) == 1
    FiledPeriod.objects.create(business=firm, year=2025, month=4)
    assert next_open_credit_month(firm.pk, date(2022, 3, 1), date(2026, 10, 11)) == date(2025, 5, 1)
