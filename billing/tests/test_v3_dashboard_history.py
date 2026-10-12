from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch


def test_past_fy_is_recorded_cash_and_ordered_firms():
    from billing.services.dashboard import past_returns
    firms = [SimpleNamespace(pk=2, name="AARAV", gst_number=""), SimpleNamespace(pk=1, name="KIRAN", gst_number="08ABCDE1234A1Z5")]
    with patch("billing.services.dashboard.year_filings", return_value={
        1: {"months_filed": 12, "last_gstr3b_filed_on": date(2026, 4, 18), "cash_paid": Decimal("412880")}}) as read:
        result = past_returns(firms, 2025)
    read.assert_called_once_with([2, 1], 2025)
    assert result == [
        {"firm": {"id": 2, "name": "AARAV", "gst_number": ""}, "months_filed": 0, "last_gstr3b_filed_on": None, "cash_paid": "0.00"},
        {"firm": {"id": 1, "name": "KIRAN", "gst_number": "08ABCDE1234A1Z5"}, "months_filed": 12,
         "last_gstr3b_filed_on": "2026-04-18", "cash_paid": "412880.00"}]
