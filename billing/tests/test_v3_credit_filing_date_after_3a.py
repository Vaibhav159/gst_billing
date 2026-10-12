"""X-40 integration cases for 3A's P3-15 fixes, run now that 3A has landed.

They read 3A's public interfaces and assert the adopted ruling.
"""

from calendar import monthrange
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest

from billing.credit import credit_lapsed
from billing.services.filing import mark_filed
from billing.services.gstr1_file import build_gstr1
from billing.services.ledger import gstr3b_tables
from billing.services.report_context import credit_payload, report_payload
from billing.tests.v3_helpers import buyer, firm, line, person, sale

pytestmark = pytest.mark.django_db
TODAY = date(2026, 12, 10)


@pytest.mark.parametrize("filed_on,lapsed", [(date(2026, 11, 30), False), (date(2026, 12, 1), True)])
def test_recorded_filing_date_controls_credit_and_frozen_tables(filed_on, lapsed):
    with patch("django.utils.timezone.localdate", return_value=TODAY):
        business = firm()
        owner = person("filing-date-owner", "admin")
        supplier = buyer("Filing date supplier", gst_number="08ABCDE1234F1Z5", customer_type="business")
        purchase = sale(business, supplier, "DATE/1", date(2026, 2, 18), line(rate="30080"),
                        kind="inward", itc_month=date(2026, 10, 1), itc_eligible=True)
        mark_filed(business, date(2026, 10, 1), owner, {
            "kind": "both", "gstr1_filed_on": "2026-11-02", "filed_on": filed_on.isoformat(),
            "cash_total": "0.00", "confirm_checks": True,
        })

        assert credit_lapsed(purchase, today=TODAY) is lapsed
        buckets = credit_payload(business, 2025)["buckets"]
        expected_state = "lapsed" if lapsed else "claimed"
        other_state = "claimed" if lapsed else "lapsed"
        assert buckets[expected_state] == {"bills": 1, "tax": "902.40"}
        assert buckets[other_state] == {"bills": 0, "tax": "0.00"}
        assert buckets["open"] == {"bills": 0, "tax": "0.00"}

        register = report_payload("purchases", business, date(2026, 2, 1), date(2026, 2, 28),
                                  split=False, side="sales")
        assert register["bills"][0]["credit_state"] == expected_state
        october = report_payload("purchases", business, date(2026, 10, 1), date(2026, 10, 31),
                                 split=False, side="sales")
        assert october["bills"] == []
        assert october["credit_by_return"]["tax"] == ("0.00" if lapsed else "902.40")

        workbook = report_payload("ca-workbook", business, date(2026, 2, 1), date(2026, 2, 28),
                                  split=False, side="sales")
        assert workbook["firms"][0]["months"][0]["purchases"]["rows"][0][19] == expected_state

        # This reads the stored return, so changing a live helper alone cannot
        # make the test pass while mark_filed still freezes an incorrect claim.
        tables = gstr3b_tables(business, 2026, 10, today=TODAY)
        assert tables["filed"] is True
        assert Decimal(str(tables["t4d2"]["heads"]["total"])) == (Decimal("902.40") if lapsed else Decimal("0.00"))
        assert Decimal(str(tables["t4c"]["total"])) == (Decimal("0.00") if lapsed else Decimal("902.40"))


@pytest.mark.parametrize("month", [4, 5])
def test_ca_passes_through_correct_historical_hsn_and_portal_quantity(month):
    with patch("django.utils.timezone.localdate", return_value=TODAY):
        business = firm()
        registered = buyer("Registered buyer", gst_number="08ABCDE1234F1Z5", customer_type="business")
        retail = buyer("Retail buyer")
        for index, customer in enumerate((registered, retail), start=1):
            sale(business, customer, f"HSN/{month}/{index}", date(2025, month, index),
                 line(rate="100", qty="0.125", hsn="711319"))
        built = build_gstr1(business, 2025, month)
        workbook = report_payload("ca-workbook", business, date(2025, month, 1),
                                  date(2025, month, monthrange(2025, month)[1]), split=False, side="sales")
        sections = workbook["firms"][0]["gstr1"][0]["sections"]["hsn"]
        assert sections == built["sections"]["hsn"]
        portal = built["file"]["hsn"]
        if month == 4:
            assert sections["b2b"] == [] and sections["b2c"] == []
            assert [row["quantity"] for row in sections["data"]] == ["0.25"]
            assert [Decimal(str(row["qty"])) for row in portal["data"]] == [Decimal("0.25")]
        else:
            assert "data" not in sections and "data" not in portal
            for section, table in (("b2b", "hsn_b2b"), ("b2c", "hsn_b2c")):
                assert [row["quantity"] for row in sections[section]] == ["0.13"]
                assert [Decimal(str(row["qty"])) for row in portal[table]] == [Decimal("0.13")]


def test_ca_preserves_actual_gstr3b_interest_note():
    with patch("django.utils.timezone.localdate", return_value=TODAY):
        business = firm()
        customer = buyer("Interest note buyer", gst_number="08ABCDE1234F1Z5", customer_type="business")
        sale(business, customer, "INTEREST/1", date(2026, 9, 5), line(rate="1000"))
        workbook = report_payload("ca-workbook", business, date(2026, 9, 1), date(2026, 9, 30),
                                  split=False, side="sales")
        tables = workbook["firms"][0]["gstr3b"][0]["tables"]
        assert Decimal(tables["late"]["interest"]) > 0
        assert tables["interest_note"] == "worked out to today; check on the portal"
