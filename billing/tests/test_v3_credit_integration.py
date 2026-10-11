"""Credit reads through the actual 2A fields and 3A filing, unlocking and opening reader."""

from datetime import date, datetime
from datetime import timezone as datetime_timezone
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from billing.api.gst import opening_data
from billing.credit import credit_month_of, open_credit_months
from billing.models import FiledPeriod, FilingMonth, FilingRecord, Invoice, LineItem, OpeningCredit
from billing.period_lock import credit_month_closed
from billing.services.filing import mark_filed, unlock_month
from billing.services.v3_credit import credit_data, on_record_months
from billing.tests.v3_helpers import buyer, firm, line, person, sale

pytestmark = pytest.mark.django_db
TODAY = date(2026, 10, 8)


@pytest.fixture(autouse=True)
def today(monkeypatch):
    monkeypatch.setattr("django.utils.timezone.localdate", lambda *args, **kwargs: TODAY)


@pytest.fixture
def shop():
    return firm(gstin="08VRHFA2322D1ZI"), buyer("Supplier", gst_number="08ABCDE1234A1Z5"), person("owner", "admin")


def purchase(business, supplier, number, day="2026-02-18", month=date(2026, 10, 1), **changes):
    return sale(business, supplier, number, day, line(rate="30080"), kind="inward",
                itc_month=month, **changes)


def record(business, owner, month):
    return mark_filed(business, date(2026, month, 1), owner, {
        "kind": "both", "gstr1_filed_on": "2026-10-04", "filed_on": "2026-10-05", "cash_total": "0.00"})


def read(business, fy=2026, *, today=TODAY):
    return credit_data(business, fy, opening=opening_data(business), today=today)


def test_real_filing_then_unlock_keeps_credit_claimed_but_reopens_write_month(shop):
    business, supplier, owner = shop
    purchase(business, supplier, "recorded", month=date(2026, 9, 1))
    current = purchase(business, supplier, "risk")
    records = record(business, owner, 9)
    assert FilingRecord.objects.filter(pk=records[-1].pk, kind="gstr3b").exists()
    assert credit_month_closed(business.pk, date(2026, 9, 1))
    unlock_month(business, date(2026, 9, 1), owner, "Correct the supplier bill")
    assert not credit_month_closed(business.pk, date(2026, 9, 1))
    assert date(2026, 9, 1) in open_credit_months(business.pk, date(2026, 2, 18), TODAY)
    out = read(business)
    assert [bill["id"] for bill in out["at_risk"]["bills"]] == [current.pk]
    assert "2026-09" not in {choice["month"] for choice in out["at_risk"]["bills"][0]["claim_months"]}
    old = read(business, 2025, today=date(2026, 12, 1))
    assert old["buckets"]["claimed"] == {"bills": 1, "tax": "902.40"}
    assert old["buckets"]["lapsed"] == {"bills": 1, "tax": "902.40"}


def test_legacy_unlock_keeps_frozen_credit_claimed_without_a_filing_record(shop):
    business, supplier, owner = shop
    purchase(business, supplier, "legacy", month=date(2026, 8, 1))
    FiledPeriod.objects.create(business=business, year=2026, month=8)
    unlock_month(business, date(2026, 8, 1), owner, "Correct an old supplier bill")
    assert not FilingRecord.objects.filter(business=business, year=2026, month=8).exists()
    assert FilingMonth.objects.get(business=business, year=2026, month=8).legacy_frozen_at is not None
    assert not credit_month_closed(business.pk, date(2026, 8, 1))
    assert read(business)["at_risk"]["count"] == 0
    assert read(business, 2025)["buckets"]["claimed"] == {"bills": 1, "tax": "902.40"}


def test_batch_claim_history_includes_only_requested_firms_and_deduplicates_sources(shop):
    business, supplier, owner = shop
    purchase(business, supplier, "recorded", month=date(2026, 9, 1))
    record(business, owner, 9)
    other = firm("MEERA ORNAMENTS")
    FiledPeriod.objects.create(business=other, year=2026, month=8)
    with CaptureQueriesContext(connection) as queries:
        assert on_record_months([business.pk]) == {(business.pk, "2026-09")}
    assert len(queries) == 1
    assert on_record_months([business.pk, other.pk]) == {(business.pk, "2026-09"), (other.pk, "2026-08")}
    assert on_record_months([]) == set()


def test_gstr1_alone_never_claims_or_closes_purchase_credit(shop):
    business, supplier, owner = shop
    bill = purchase(business, supplier, "only-1", month=date(2026, 9, 1))
    mark_filed(business, date(2026, 9, 1), owner, {"kind": "gstr1", "filed_on": "2026-10-04"})
    assert not credit_month_closed(business.pk, date(2026, 9, 1))
    out = read(business)["at_risk"]["bills"]
    assert [row["id"] for row in out] == [bill.pk]
    assert "2026-09" in {choice["month"] for choice in out[0]["claim_months"]}


def test_other_firm_counts_do_not_multiply_lines_or_count_unlocked_records(shop):
    business, supplier, owner = shop
    other = firm("MEERA ORNAMENTS")
    sale(other, supplier, "two-lines", "2026-02-18", line(), line(), kind="inward", itc_month=date(2026, 10, 1))
    purchase(other, supplier, "filed", month=date(2026, 9, 1))
    record(other, owner, 9)
    unlock_month(other, date(2026, 9, 1), owner, "Correct the bill")
    out = read(business)
    assert out["others_at_risk"] == [{"business": other.pk, "short": "Meera", "count": 1}]


def test_null_month_uses_bill_month_and_entered_day_is_ist(shop):
    business, supplier, _ = shop
    bill = purchase(business, supplier, "null", month=None)
    Invoice.objects.filter(pk=bill.pk).update(created_at=datetime(2026, 10, 4, 19, tzinfo=datetime_timezone.utc))
    out = read(business)["at_risk"]["bills"][0]
    assert out["credit_month"] == "2026-02"
    assert out["entered_on"] == "2026-10-05"


def test_before_ledger_credit_month_is_none_and_never_a_claim_choice(shop):
    business, supplier, _ = shop
    old = purchase(business, supplier, "old", day="2025-03-31", month=None)
    assert credit_month_of(old) is None
    assert open_credit_months(business.pk, old.invoice_date, TODAY) == []
    assert read(business, 2025, today=date(2025, 10, 8))["at_risk"]["count"] == 0
    assert read(business, 2024)["buckets"]["lapsed"] == {"bills": 1, "tax": "902.40"}
    recent = purchase(business, supplier, "first", day="2025-04-01", month=None)
    out = read(business)["at_risk"]["bills"]
    assert [row["id"] for row in out] == [recent.pk]
    assert out[0]["claim_months"][0]["month"] == "2025-04"


def test_x36_rounds_each_historical_line_before_adding_and_other_risk_uses_rounded_tax(shop):
    business, supplier, _ = shop
    bill = sale(business, supplier, "fractional", "2026-02-18", line(), line(), kind="inward")
    LineItem.objects.filter(invoice=bill).update(igst=Decimal("0.025"), cgst=0, sgst=0)
    assert read(business)["at_risk"]["tax"] == "0.06"
    other = firm("MEERA ORNAMENTS")
    tiny = sale(other, supplier, "sub-paisa", "2026-02-18", line(), kind="inward")
    LineItem.objects.filter(invoice=tiny).update(igst=Decimal("0.004"), cgst=0, sgst=0)
    assert read(business)["others_at_risk"] == []
    LineItem.objects.filter(invoice=tiny).update(igst=Decimal("0.005"))
    assert read(business)["others_at_risk"] == [{"business": other.pk, "short": "Meera", "count": 1}]


def test_opening_is_the_real_3a_reader_body_without_a_second_balance_model(shop):
    business, _, owner = shop
    OpeningCredit.objects.create(business=business, igst=Decimal("10.25"), cgst=Decimal("3.10"),
                                 sgst=Decimal("3.10"), updated_by=owner)
    opening = opening_data(business)
    out = credit_data(business, 2026, opening=opening, today=TODAY)
    assert out["opening"] == opening
    assert out["opening"]["typed"] is True
    assert out["opening"]["total"] == "16.45"
    assert out["opening"]["carried_out_of_first_month"]["heads"]["total"] == "16.45"


def test_deadline_and_claim_month_due_are_separate_and_inclusive(shop):
    business, supplier, _ = shop
    purchase(business, supplier, "october", month=date(2026, 10, 1))
    out = read(business, today=date(2026, 11, 30))["at_risk"]
    assert out["days_left"] == 0 and out["count"] == 1
    assert out["bills"][0]["claim_months"][-1] == {
        "month": "2026-11", "state": "running", "gstr3b_due": "2026-12-20", "too_late": True}
    assert read(business, today=date(2026, 12, 1))["at_risk"]["count"] == 0


def test_credit_read_stays_narrow_and_constant_for_three_hundred_bills(shop):
    business, supplier, _ = shop
    bills = Invoice.objects.bulk_create([
        Invoice(business=business, customer=supplier, invoice_number=str(index), invoice_date=date(2026, 2, 18),
                type_of_invoice="inward", itc_month=date(2026, 10, 1), total_amount=Decimal("30982.40"))
        for index in range(300)])
    LineItem.objects.bulk_create([
        LineItem(invoice=bill, customer=supplier, product_name="Silver", hsn_code="711311", quantity=1, rate=Decimal("30080"),
                 gst_tax_rate=Decimal("0.03"), unit="gms", cgst=Decimal("451.20"), sgst=Decimal("451.20"), igst=0, amount=Decimal("30982.40"))
        for bill in bills])
    opening = opening_data(business)
    with CaptureQueriesContext(connection) as queries:
        out = credit_data(business, 2026, opening=opening, today=TODAY)
    assert out["at_risk"]["count"] == 300
    assert out["at_risk"]["tax"] == "270720.00"
    assert len(queries) <= 5
    sql = " ".join(query["sql"].lower() for query in queries)
    for field in ('"figures"', '"bills"', '"file"', '"legacy_snapshot"', '"source_file"', '"notes"', '"firm_snapshot"', '"address"'):
        assert field not in sql
