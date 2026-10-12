import re
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from billing.models import Business, FiledPeriod, FilingMonth, FilingRecord, OpeningCredit
from billing.services.filing import backup_rows, changes_for_month, month_stages, pending_amendments, year_filings

pytestmark = pytest.mark.django_db


def test_bulk_stages_and_latest_use_two_reads_without_snapshots():
    from django.utils import timezone
    firm = Business.objects.create(name="Kiran")
    FilingRecord.objects.create(business=firm, year=2026, month=8, kind="gstr1", filed_on=date(2026, 9, 1))
    FiledPeriod.objects.create(business=firm, year=2026, month=7)
    FilingMonth.objects.create(business=firm, year=2026, month=9, unlocked_at=timezone.now())
    with patch("billing.services.gst_checks.gstr1_blockers", return_value={}) as blockers, CaptureQueriesContext(connection) as queries:
        result = month_stages([firm.pk], ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11"], date(2026, 10, 11))
    assert len(queries) == 2
    assert list(result["stages"].values()) == ["filed", "gstr1", "unlocked", "open", "future"]
    assert result["latest_gstr1"] == {firm.pk: "2026-08"}
    assert all('"bills"' not in query["sql"] and '"figures"' not in query["sql"] and '"file"' not in query["sql"] for query in queries)
    blockers.assert_not_called()


def test_latest_gstr1_includes_a_later_v2_lock_even_when_its_books_fail_checks():
    from billing.services.gst_checks import gstr1_blockers
    from billing.tests.v3_helpers import buyer, firm

    business = firm()
    from billing.models import Invoice
    Invoice.objects.create(business=business, customer=buyer(), invoice_number="EMPTY",
                           invoice_date=date(2026, 9, 1), type_of_invoice="outward")
    assert gstr1_blockers([business.pk], ["2026-09"])[business.pk, "2026-09"]["count"] > 0
    FilingRecord.objects.create(business=business, year=2026, month=8, kind="gstr1", filed_on=date(2026, 9, 1))
    FiledPeriod.objects.create(business=business, year=2026, month=9)
    with CaptureQueriesContext(connection) as queries:
        result = month_stages([business.pk], ["2026-08", "2026-09"], date(2026, 10, 11))
    assert len(queries) == 2
    assert result["stages"][business.pk, "2026-09"] == "filed"
    assert result["latest_gstr1"][business.pk] == "2026-09"
    # Latest means all available history, not only the requested month window.
    FilingRecord.objects.create(business=business, year=2026, month=10, kind="gstr1", filed_on=date(2026, 11, 1))
    assert month_stages([business.pk], ["2026-09"])["latest_gstr1"][business.pk] == "2026-10"


def test_year_filings_counts_legacy_once_and_only_in_fy():
    firm = Business.objects.create(name="Kiran")
    FilingRecord.objects.create(business=firm, year=2026, month=8, kind="gstr3b", filed_on=date(2026, 9, 19), cash_total="30.00")
    FiledPeriod.objects.create(business=firm, year=2026, month=8)
    FiledPeriod.objects.create(business=firm, year=2026, month=7)
    FiledPeriod.objects.create(business=firm, year=2026, month=3)
    with CaptureQueriesContext(connection) as queries:
        result = year_filings([firm.pk], "2026-27")
    assert len(queries) == 1
    assert result[firm.pk] == {"months_filed": 2, "last_gstr3b_filed_on": date(2026, 9, 19), "cash_paid": Decimal("30.00")}


def test_backup_rows_reads_all_three_new_tables_once():
    firm = Business.objects.create(name="Kiran")
    OpeningCredit.objects.create(business=firm, cgst="9500.00", sgst="9500.00")
    with CaptureQueriesContext(connection) as queries:
        rows = backup_rows()
    assert len(queries) == 3
    assert rows["opening_credits"][0]["cgst"] == "9500.00"
    assert rows["opening_credits"][0]["as_of"] == "2025-04-01"


def test_actual_filing_day_reaches_3b_capture_before_the_record_exists():
    from django.contrib.auth.models import User

    from billing.services.filing import mark_filed

    business = Business.objects.create(name="Kiran")
    owner = User.objects.create_user("actual-filing-day")
    FilingRecord.objects.create(business=business, year=2025, month=10, kind="gstr1", filed_on=date(2025, 11, 8))
    zero = {"igst": "0.00", "cgst": "0.00", "sgst": "0.00", "total": "0.00"}

    def position(*args, **kwargs):
        assert not FilingRecord.objects.filter(kind="gstr3b").exists()
        assert kwargs["filing_date"] == date(2026, 12, 2)
        return {"cash": zero, "carry_on": zero}

    with patch("django.utils.timezone.localdate", return_value=date(2026, 12, 3)), \
            patch("billing.services.ledger.month_position", side_effect=position), \
            patch("billing.services.ledger.gstr3b_tables", return_value={}) as tables:
        made = mark_filed(business, date(2025, 10, 1), owner, {"kind": "gstr3b", "filed_on": "2026-12-02"})
    assert made[0].filed_on == date(2026, 12, 2)
    assert tables.call_args.kwargs["filing_date"] == date(2026, 12, 2)


def test_consumed_bill_amendment_does_not_repeat():
    firm = Business.objects.create(name="Kiran")
    before = {"id": 7, "total": "1030.00"}
    after = {"id": 7, "total": "2060.00"}
    FilingRecord.objects.create(business=firm, year=2026, month=8, kind="gstr1", filed_on=date(2026, 9, 8), bills={"7": before})
    FilingRecord.objects.create(business=firm, year=2026, month=8, kind="gstr3b", filed_on=date(2026, 9, 19))
    with patch("billing.services.gstr1_file.build_gstr1", return_value={"bills": {"7": after}}):
        changes = changes_for_month(firm, 2026, 8)
        assert changes == [{"month": "2026-08", "before": before, "after": after}]
        FilingRecord.objects.create(business=firm, year=2026, month=9, kind="gstr1", filed_on=date(2026, 10, 8), figures={"amendments": changes})
        assert changes_for_month(firm, 2026, 8) == []
        assert pending_amendments(firm, 2026, 10) == []


def test_amendment_deadline_excludes_late_changes_and_unlocks():
    firm = Business.objects.create(name="Kiran")
    FilingRecord.objects.create(business=firm, year=2025, month=4, kind="gstr1", filed_on=date(2025, 5, 1), bills={})
    FilingRecord.objects.create(business=firm, year=2025, month=4, kind="gstr3b", filed_on=date(2025, 5, 1))
    with patch("billing.services.filing.timezone.localdate", return_value=date(2026, 12, 1)), patch("billing.services.gstr1_file.build_gstr1", return_value={"bills": {"7": {"id": 7}}}):
        assert pending_amendments(firm, 2025, 5) == []


@pytest.mark.parametrize("cash_total", ["30.00", None])
def test_edit_filing_leaves_large_snapshots_deferred(cash_total):
    from django.contrib.auth.models import User

    from billing.services.filing import edit_filing, filing_data

    firm = Business.objects.create(name="Kiran", address="Large firm address " * 10)
    user = User.objects.create_user("narrow-filing-owner")
    heads = {"igst": "0.00", "cgst": "15.00", "sgst": "15.00", "total": "30.00"}
    FilingRecord.objects.create(business=firm, year=2026, month=9, kind="gstr1", filed_on=date(2026, 10, 8))
    record = FilingRecord.objects.create(
        business=firm, year=2026, month=9, kind="gstr3b", filed_on=date(2026, 10, 9),
        cash_total=cash_total, figures={"cash": heads, "large_tables": "x" * 250000},
        bills={"large_bill_snapshot": "y" * 250000}, file={"large_portal_file": "z" * 250000}, marked_by=user,
    )
    stub = FilingRecord(pk=record.pk, business_id=firm.pk)
    with CaptureQueriesContext(connection) as queries:
        updated = edit_filing(stub, user, {"arn": "AA0810260345671"})
        body = filing_data(updated)
    assert body["arn"] == "AA0810260345671"
    assert body["cash_worked_out"] == heads
    assert body["cash"]["total"] == "30.00"
    assert {"figures", "bills", "file"} <= updated.get_deferred_fields()
    selects = [row["sql"] for row in queries if row["sql"].lstrip().startswith("SELECT")]
    assert all('"billing_filingrecord"."bills"' not in sql and '"billing_filingrecord"."file"' not in sql for sql in selects)
    assert all(not re.search(r'(?:SELECT |, )"billing_filingrecord"\."figures"(?:,| FROM)', sql) for sql in selects)
    assert all('"billing_business"."address"' not in sql for sql in selects)
    record.refresh_from_db()
    assert record.figures["large_tables"] == "x" * 250000
    assert record.bills == {"large_bill_snapshot": "y" * 250000}
    assert record.file == {"large_portal_file": "z" * 250000}
