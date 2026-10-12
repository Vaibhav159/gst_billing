from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from billing.models import FiledPeriod, FilingRecord, Invoice, LineItem, OpeningCredit
from billing.services.filing import mark_filed, relock_month, unlock_month
from billing.tests.v3_helpers import buyer, client_for, firm, line, person, sale

pytestmark = pytest.mark.django_db
TODAY = date(2026, 12, 10)


@pytest.fixture(autouse=True)
def today():
    with patch("django.utils.timezone.localdate", return_value=TODAY):
        yield


@pytest.fixture
def books():
    business = firm()
    owner = person("report-owner", "admin")
    customer = buyer(gst_number="08ABCDE1234F1Z5", customer_type="business")
    return business, owner, customer


def get(client, kind, business, start="2026-09-01", end="2026-09-30", **extra):
    response = client.get("/api/reports/" + kind + "/", {
        "business_id": business.pk, "from": start, "to": end, **extra,
    })
    assert response.status_code == 200, response.content
    return response.json()


def test_real_routes_share_line_paise_and_workbook_return_shapes(books):
    business, owner, customer = books
    bill = sale(business, customer, "HALF-1", date(2026, 9, 5), line(rate="1.667"), line(rate="1.667"))
    LineItem.objects.filter(invoice=bill).update(cgst=Decimal("0.025"), sgst=Decimal("0.025"))
    client = client_for(owner)
    sales = get(client, "sales", business)
    assert sales["totals"]["cgst"] == "0.06"
    workbook = get(client, "ca-workbook", business, split="1")
    sheet = workbook["firms"][0]
    assert sheet["months"][0]["sales"]["totals"]["cgst"] == "0.06"
    assert sum(Decimal(row[12]) for row in sheet["months"][0]["sales"]["rows"]) == Decimal("0.06")
    assert sheet["gstr1"][0]["sections"]["b2b"][0]["cgst"] == "0.06"
    assert "customer" not in sheet["gstr1"][0]["sections"]["b2b"][0]
    assert sheet["gstr3b"][0]["tables"]["t31a"]["cgst"] == "0.06"
    assert sheet["gstr3b"][0]["filing"] is None
    assert sheet["gstr3b"][0]["tables"]["t5_note"] == "Includes purchases from unregistered suppliers with no GST charged."


def test_reconciliation_uses_1a_then_subsequent_filed_amendments(books):
    from billing.services.report_context import reconciliation_payload
    business, owner, customer = books
    bill = sale(business, customer, "CORRECTION-1", date(2026, 9, 5), line(rate="1000"))
    mark_filed(business, date(2026, 9, 1), owner, {"kind": "gstr1", "filed_on": "2026-10-02", "confirm_checks": True})
    unlock_month(business, date(2026, 9, 1), owner, "Correct the line")
    LineItem.objects.filter(invoice=bill).update(rate=2000, cgst=30, sgst=30)
    Invoice.objects.filter(pk=bill.pk).update(total_amount=2060)
    mark_filed(business, date(2026, 9, 1), owner, {"kind": "gstr1a", "filed_on": "2026-10-03"})
    mark_filed(business, date(2026, 9, 1), owner, {"kind": "gstr3b", "filed_on": "2026-10-04"})
    result = reconciliation_payload(business, 2026, split=False)
    september = next(row for row in result["filed"] if row["month"] == "2026-09")
    assert september["gstr1"]["taxable"] == "2000.00"
    assert not september["differs"]
    unlock_month(business, date(2026, 9, 1), owner, "Correct the value again")
    LineItem.objects.filter(invoice=bill).update(rate=3000, cgst=45, sgst=45)
    Invoice.objects.filter(pk=bill.pk).update(total_amount=3090)
    relock_month(business, date(2026, 9, 1), owner)
    result = reconciliation_payload(business, 2026, split=False)
    assert "2026-09" in result["differs"]
    mark_filed(business, date(2026, 10, 1), owner, {"kind": "gstr1", "filed_on": "2026-11-02", "confirm_checks": True})
    result = reconciliation_payload(business, 2026, split=False)
    september = next(row for row in result["filed"] if row["month"] == "2026-09")
    assert september["gstr1"]["taxable"] == "3000.00"
    assert september["gstr3b"]["cgst"] == "30.00"
    assert september["amended_in"] == "2026-10"
    assert not september["differs"]

    unlock_month(business, date(2026, 9, 1), owner, "Replace the mistaken bill")
    Invoice.objects.filter(pk=bill.pk).delete()
    sale(business, customer, "ADDED-1", date(2026, 9, 6), line(rate="1000"))
    sale(business, customer, "ADDED-2", date(2026, 9, 7), line(rate="500"))
    relock_month(business, date(2026, 9, 1), owner)
    mark_filed(business, date(2026, 11, 1), owner, {"kind": "gstr1", "filed_on": "2026-12-02", "confirm_checks": True})
    result = reconciliation_payload(business, 2026, split=False)
    september = next(row for row in result["filed"] if row["month"] == "2026-09")
    assert september["gstr1"]["taxable"] == "1500.00"
    assert september["gstr1"]["bills"] == 2
    assert september["amended_in"] == "2026-11"
    assert not september["differs"]


def test_unlocked_record_stays_claimed_and_workbook_uses_filing_serializer(books):
    business, owner, customer = books
    purchase = sale(business, customer, "BUY-1", date(2026, 9, 4), kind="inward")
    records = mark_filed(business, date(2026, 9, 1), owner, {
        "kind": "both", "gstr1_filed_on": "2026-10-02", "filed_on": "2026-10-03", "cash_total": "123.45",
    })
    unlock_month(business, date(2026, 9, 1), owner, "Correct the books")
    client = client_for(owner)
    register = get(client, "purchases", business)
    assert register["bills"][0]["id"] == purchase.pk
    assert register["bills"][0]["credit_state"] == "claimed"
    workbook = get(client, "ca-workbook", business)
    result = workbook["firms"][0]["gstr3b"][0]
    assert result["stage"] == "unlocked"
    assert result["filing"]["id"] == records[1].pk
    assert result["filing"]["cash"]["total"] == "123.45"
    assert result["tables"]["filed"] is False


def test_credit_endpoint_reuses_opening_reader_and_real_purchase_fields(books):
    business, owner, customer = books
    sale(business, customer, "BUY-2", date(2026, 9, 4), kind="inward", needs_review=True)
    OpeningCredit.objects.create(business=business, cgst=10, sgst=20)
    response = client_for(owner).get("/api/gst/credit/", {"business_id": business.pk, "fy": "2026-27"})
    assert response.status_code == 200, response.content
    result = response.json()
    assert result["buckets"]["open"] == {"bills": 1, "tax": "300.00"}
    assert result["opening"]["typed"] is True
    assert result["opening"]["total"] == "30.00"
    assert result["opening"]["carried_out_of_first_month"]["heads"]["total"] == "30.00"


def test_tax_expands_months_and_marks_pre_ledger_without_cash(books):
    business, owner, customer = books
    sale(business, customer, "OLD-S", date(2025, 3, 2), line(rate="1000"))
    sale(business, customer, "OLD-P", date(2025, 3, 3), line(rate="100"), kind="inward")
    client = client_for(owner)
    tax = get(client, "tax", business, "2025-03-15", "2025-04-02")
    assert tax["note"] == "Shown for whole months: 01 Mar 2025 to 30 Apr 2025."
    march, april = tax["firms"][0]["rows"]
    assert march["state"] == "before_ledger"
    assert march["output"]["total"] == "30.00"
    assert march["credit"]["total"] == "3.00"
    assert march["cash"] is None and march["carry_on"] is None
    assert april["state"] == "to_pay"
    assert get(client, "sales", business, "2025-03-15", "2025-04-02")["totals"]["bills"] == 0
    historical = get(client, "purchases", business, "2025-03-01", "2025-03-31")["bills"][0]
    assert historical["credit_month"] is None
    assert historical["credit_state"] == "outside"


def test_legacy_unlock_keeps_reconciliation_baseline(books):
    from billing.services.report_context import reconciliation_payload
    business, owner, customer = books
    bill = sale(business, customer, "LEGACY", date(2026, 9, 4), line(rate="1000"))
    FiledPeriod.objects.create(business=business, year=2026, month=9)
    unlock_month(business, date(2026, 9, 1), owner, "Correct an old bill")
    LineItem.objects.filter(invoice=bill).update(rate=2000, cgst=30, sgst=30)
    result = reconciliation_payload(business, 2026, split=False)
    september = next(row for row in result["filed"] if row["month"] == "2026-09")
    assert september["gstr1"]["taxable"] == "1000.00"
    assert september["diff"]["taxable"] == "1000.00"
    assert september["stage"] == "unlocked"


def test_reconciliation_projection_does_not_fetch_file_or_bill_snapshots(books):
    from billing.services.report_context import reconciliation_payload
    business, owner, customer = books
    sale(business, customer, "NARROW", date(2026, 9, 1), line(rate="1000"))
    mark_filed(business, date(2026, 9, 1), owner, {"kind": "gstr1", "filed_on": "2026-10-02", "confirm_checks": True})
    FilingRecord.objects.update(file={"large": "x" * 10000}, bills={"large": "y" * 10000})
    with CaptureQueriesContext(connection) as queries:
        result = reconciliation_payload(business, 2026, split=False)
    assert not result["differs"]
    sql = "\n".join(row["sql"] for row in queries.captured_queries)
    assert '"billing_filingrecord"."file"' not in sql
    assert '"billing_filingrecord"."bills"' not in sql
    assert not any('"figures"' in row["sql"].split(" FROM ")[0] and "JSON" not in row["sql"] and " -> " not in row["sql"] and " #> " not in row["sql"] for row in queries.captured_queries if '"billing_filingrecord"' in row["sql"])


def test_tax_uses_actual_cash_without_inventing_its_heads(books):
    business, owner, customer = books
    sale(business, customer, "PAID", date(2026, 9, 1), line(rate="1000"))
    mark_filed(business, date(2026, 9, 1), owner, {
        "kind": "both", "gstr1_filed_on": "2026-10-02", "filed_on": "2026-10-03",
        "cash_total": "123.45", "confirm_checks": True,
    })
    tax = get(client_for(owner), "tax", business)
    expected = {"igst": None, "cgst": None, "sgst": None, "total": "123.45"}
    assert tax["firms"][0]["rows"][0]["cash"] == expected
    assert tax["firms"][0]["totals"]["cash"] == expected
    assert tax["firms"][0]["rows"][0]["gstr3b_filed_on"] == "2026-10-03"


def test_legacy_lock_after_gstr1_supplies_the_missing_3b_baseline(books):
    from billing.services.report_context import reconciliation_payload
    business, owner, customer = books
    sale(business, customer, "MIXED", date(2026, 9, 1), line(rate="1000"))
    mark_filed(business, date(2026, 9, 1), owner, {"kind": "gstr1", "filed_on": "2026-10-02", "confirm_checks": True})
    FiledPeriod.objects.create(business=business, year=2026, month=9)
    result = reconciliation_payload(business, 2026, split=False)
    september = next(row for row in result["filed"] if row["month"] == "2026-09")
    assert september["gstr3b"] == {"igst": "0.00", "cgst": "15.00", "sgst": "15.00"}
    assert september["stage"] == "filed"
