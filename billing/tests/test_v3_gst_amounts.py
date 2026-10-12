from datetime import date
from decimal import Decimal

import pytest

from billing.fy import due_dates
from billing.services.gst_amounts import late_cost


def test_due_dates_roll_december_into_next_year():
    assert due_dates(2026, 12) == {"gstr1": date(2027, 1, 11), "gstr3b": date(2027, 1, 20)}


@pytest.mark.parametrize("turnover,band,cap", [
    ("15000000", "upto_1.5cr", "2000"),
    ("15000000.01", "1.5cr_5cr", "5000"),
    ("50000000", "1.5cr_5cr", "5000"),
    ("50000000.01", "over_5cr", "10000"),
])
def test_late_caps_per_return(turnover, band, cap):
    result = late_cost(2025, 4, cash={"igst": "36500"}, turnover=turnover, today=date(2026, 5, 20))
    assert result["turnover_band"] == band
    assert result["gstr1"]["fee"] == Decimal(cap)
    assert result["gstr3b"]["fee"] == Decimal(cap)
    assert result["gstr3b"]["capped"] is True
    assert result["interest"] == Decimal("6570.00")  # 36500 * .18 * 365 / 365.


def test_nil_return_caps_and_no_nil_interest():
    result = late_cost(2026, 8, cash={}, turnover="90000000", nil={"gstr1": True, "gstr3b": True},
                       today=date(2026, 10, 31))
    assert result["gstr1"]["per_day"] == Decimal("20")
    assert result["gstr1"]["fee"] == result["gstr3b"]["fee"] == Decimal("500")
    assert result["total"] == Decimal("1000")


def test_interest_is_cash_only_half_up_and_filed_return_stops_clock():
    result = late_cost(2026, 9, cash={"igst": "20.2777777778"}, turnover="1", today=date(2026, 10, 21),
                       filed={"gstr1": True, "gstr3b": False})
    assert result["gstr1"]["days"] == 0
    assert result["gstr3b"]["days"] == 1
    assert result["interest"] == Decimal("0.01")
    assert result["interest_from"] == "2026-10-21"
    assert late_cost(2026, 9, cash={"igst": "100"}, turnover="1", today=date(2026, 10, 20),
                     filed={"gstr1": True}) is None
    assert late_cost(2026, 9, cash={"igst": "100"}, turnover="1", today=date(2026, 12, 31),
                     filed={"gstr1": True, "gstr3b": True}) is None
