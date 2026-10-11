"""P3-4: credit and reports agree with a December return's lapsed credit."""

from datetime import date
from decimal import Decimal

import pytest

from billing.api.gst import opening_data
from billing.services.filing import mark_filed
from billing.services.ledger import gstr3b_tables
from billing.services.report_context import report_payload
from billing.services.v3_credit import credit_data
from billing.tests.v3_helpers import buyer, firm, line, person, sale

pytestmark = pytest.mark.django_db


def purchase(business, supplier):
    return sale(business, supplier, "DEC/1", "2026-02-18", line(rate="30080"),
                kind="inward", itc_month=date(2026, 12, 1))


def test_december_record_is_lapsed_in_credit_reports_ca_and_gstr3b(monkeypatch):
    today = date(2027, 1, 8)
    monkeypatch.setattr("django.utils.timezone.localdate", lambda *args, **kwargs: today)
    business = firm()
    supplier = buyer("Supplier", gst_number="08ABCDE1234A1Z5")
    purchase(business, supplier)
    owner = person("december-owner", "admin")
    mark_filed(business, date(2026, 12, 1), owner, {
        "kind": "both", "gstr1_filed_on": "2027-01-04", "filed_on": "2027-01-05", "cash_total": "0.00",
    })
    tables = gstr3b_tables(business, 2026, 12, today=today)
    assert Decimal(str(tables["t4d2"]["heads"]["total"])) == Decimal("902.40")
    assert Decimal(str(tables["t4c"]["total"])) == Decimal("0.00")
    buckets = credit_data(business, 2025, opening=opening_data(business), today=today)["buckets"]
    assert buckets["lapsed"] == {"bills": 1, "tax": "902.40"}
    assert buckets["claimed"] == buckets["open"] == {"bills": 0, "tax": "0.00"}
    options = {"split": False, "side": "sales"}
    by_date = report_payload("purchases", business, date(2026, 2, 1), date(2026, 2, 28), **options)
    assert by_date["bills"][0]["credit_state"] == "lapsed"
    by_return = report_payload("purchases", business, date(2026, 12, 1), date(2026, 12, 31), **options)
    assert by_return["credit_by_return"]["tax"] == "0.00"
    workbook = report_payload("ca-workbook", business, date(2026, 2, 1), date(2026, 2, 28), **options)
    assert workbook["firms"][0]["months"][0]["purchases"]["rows"][0][19] == "lapsed"


def test_scheduled_lapsed_credit_is_not_at_risk_in_either_firm(monkeypatch):
    today = date(2026, 10, 8)
    monkeypatch.setattr("django.utils.timezone.localdate", lambda *args, **kwargs: today)
    business, other = firm(), firm("MEERA ORNAMENTS")
    supplier = buyer("Supplier", gst_number="08ABCDE1234A1Z5")
    for shop in (business, other):
        purchase(shop, supplier)
    result = credit_data(business, 2026, opening=opening_data(business), today=today)
    assert result["at_risk"]["count"] == 0
    assert result["others_at_risk"] == []
