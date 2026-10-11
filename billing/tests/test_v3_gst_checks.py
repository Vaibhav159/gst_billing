from datetime import date
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from billing.gstin import check_digit
from billing.models import Customer, Invoice, LineItem
from billing.services.gst_checks import gstr1_blockers, month_checks
from billing.tests.v3_helpers import buyer, firm, line, sale

pytestmark = pytest.mark.django_db


def test_month_checks_exact_gstin_hsn_head_words_and_notes():
    b = firm(invoice_prefix="KGH")
    c = buyer(customer_type="business")
    inv = sale(b, c, "KGH/2026-27/1", date(2026, 9, 1), line(hsn=""), place_of_supply="24")
    LineItem.objects.filter(invoice=inv).update(igst=0, cgst=150, sgst=150)
    result = month_checks(b, 2026, 9)
    assert {r["kind"]: r["text"] for r in result["blockers"]} == {
        "gstin": "KGH/2026-27/1: business customer without a GSTIN",
        "hsn": "KGH/2026-27/1: a line has no HSN code",
        "head": "KGH/2026-27/1: CGST + SGST charged on an inter-state sale"}
    assert all(r["bills"][0]["id"] == inv.pk for r in result["blockers"])
    assert gstr1_blockers([b.pk], ["2026-09"])[b.pk, "2026-09"]["count"] == 3


def test_bad_gstin_and_empty_are_blockers_but_cancelled_bill_is_not():
    b = firm()
    c = buyer(name="Rathore", gst_number="08ABCDE1234F1Z5")
    assert check_digit(c.gst_number[:14]) != c.gst_number[-1]
    inv = Invoice.objects.create(business=b, customer=c, invoice_number="1", invoice_date=date(2026, 9, 1))
    sale(b, c, "2", date(2026, 9, 1), status="cancelled")
    result = month_checks(b, 2026, 9)
    assert {r["kind"] for r in result["blockers"]} == {"badgstin", "empty"}
    assert all(r["bills"][0]["id"] == inv.pk for r in result["blockers"])
    assert gstr1_blockers([b.pk], ["2026-09"])[b.pk, "2026-09"]["count"] == 2


def test_duplicate_is_case_insensitive_across_fy_and_suggests_typed_later_bill():
    b, c = firm(invoice_prefix="KGH"), buyer()
    old = sale(b, c, "KGH/2026-27/1", date(2026, 8, 1))
    new = sale(b, c, "kgh/2026-27/1", date(2026, 9, 1), replaces=old.pk, paper=True)
    checks = month_checks(b, 2026, 9)
    duplicate = next(r for r in checks["blockers"] if r["kind"] == "duplicate")
    assert [r["id"] for r in duplicate["bills"]] == [old.pk, new.pk]
    assert duplicate["suggested"] == new.pk
    assert duplicate["bills"][1]["typed"] is True
    assert gstr1_blockers([b.pk], ["2026-09"])[b.pk, "2026-09"] == {
        "count": 1, "bills": 1, "first_two": ["Bill number kgh/2026-27/1 is used twice"]}


def test_bulk_checks_use_aggregates_no_lines_or_customer_payloads():
    b, c = firm(), buyer()
    for i in range(20):
        sale(b, c, str(i + 1), date(2026, 9, 1))
    with CaptureQueriesContext(connection) as captured:
        result = gstr1_blockers([b.pk], ["2026-09"])
    assert result[b.pk, "2026-09"] == {"count": 0, "bills": 0, "first_two": []}
    assert len(captured) <= 2
    assert all("COUNT(" in q["sql"] for q in captured)
    assert all('"product_name"' not in q["sql"] and '"address"' not in q["sql"] for q in captured)


def test_rate_mismatch_note_and_unknown_state_blocker():
    b, c = firm(), buyer()
    inv = sale(b, c, "1", date(2026, 9, 1), place_of_supply="98")
    LineItem.objects.filter(invoice=inv).update(igst=Decimal("299.97"))
    checks = month_checks(b, 2026, 9)
    assert any(r["kind"] == "state" for r in checks["blockers"])
    assert any(r["kind"] == "tax" for r in checks["notes"])
    assert gstr1_blockers([b.pk], ["2026-09"])[b.pk, "2026-09"]["count"] == 1


def test_valid_gstin_and_hsn_turnover_threshold():
    gstin = "08ABCDE1234F1Z" + check_digit("08ABCDE1234F1Z")
    b, c = firm(), buyer(gst_number=gstin)
    prior = sale(b, c, "old", date(2025, 8, 1))
    LineItem.objects.filter(invoice=prior).update(rate=Decimal("50000001"))
    sale(b, c, "1", date(2026, 9, 1), line(hsn="7113"))
    checks = month_checks(b, 2026, 9)
    assert checks["blockers"][0]["text"] == "1: an HSN code needs 6 digits for a business buyer"
    assert gstr1_blockers([b.pk], ["2026-09"])[b.pk, "2026-09"]["count"] == 1
    Customer.objects.filter(pk=c.pk).update(gst_number="")
    assert not month_checks(b, 2026, 9)["blockers"]


@pytest.mark.django_db(transaction=True)
def test_checks_and_builder_bypass_cacheops():
    from billing.services.gstr1_file import build_gstr1
    from billing.tests.test_v3_cacheops import cacheops_on

    b, c = firm(), buyer()
    sale(b, c, "1", date(2026, 9, 1))
    with cacheops_on() as touched:
        build_gstr1(b, 2026, 9, amendments=False)
        month_checks(b, 2026, 9)
        gstr1_blockers([b.pk], ["2026-09"])
    assert touched == []


def test_bulk_first_two_includes_two_bills_failing_the_same_check():
    b, c = firm(), buyer()
    sale(b, c, "1", date(2026, 9, 1), line(hsn=""))
    sale(b, c, "2", date(2026, 9, 2), line(hsn=""))
    summary = gstr1_blockers([b.pk], ["2026-09"])[b.pk, "2026-09"]
    assert summary["first_two"] == ["1: a line has no HSN code", "2: a line has no HSN code"]
