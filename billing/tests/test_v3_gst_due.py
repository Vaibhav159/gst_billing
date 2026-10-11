from datetime import date


def test_monthly_due_dates_cross_december_and_leap_february():
    from billing.fy import due_dates
    assert due_dates(2026, 12) == {"gstr1": date(2027, 1, 11), "gstr3b": date(2027, 1, 20)}
    assert due_dates(2028, 2) == {"gstr1": date(2028, 3, 11), "gstr3b": date(2028, 3, 20)}
