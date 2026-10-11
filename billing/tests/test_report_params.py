from datetime import date

import pytest
from rest_framework.exceptions import NotFound, ValidationError

from billing.tests.v3_helpers import firm

TODAY = date(2026, 10, 8)


def parsed(params):
    from billing.api.report_params import report_range
    return report_range(params, today=TODAY)


@pytest.mark.parametrize("key,raw,words", [
    ("from", "", "Pick the first day of the range."),
    ("to", "", "Pick the last day of the range."),
    ("from", "2026-02-30", "Pick the first day of the range."),
    ("to", "20260901", "Pick the last day of the range."),
    ("from", "2022-03-31", "The app goes back to 01 Apr 2022. Pick that day or later."),
    ("to", "2022-03-31", "The app goes back to 01 Apr 2022. Pick that day or later."),
    ("from", "2026-10-09", "That's after today. Pick 08 Oct 2026 or earlier."),
    ("to", "2026-10-09", "That's after today. Pick 08 Oct 2026 or earlier."),
    ("from", "2026-W40-1", "Pick the first day of the range."),
    ("from", " 2026-09-01 ", "Pick the first day of the range."),
])
def test_range_words(key, raw, words):
    params = {"from": "2026-09-01", "to": "2026-09-30", key: raw}
    with pytest.raises(ValidationError) as error:
        parsed(params)
    assert error.value.detail == {key: [words]}


def test_range_reversal_and_both_missing():
    with pytest.raises(ValidationError) as error:
        parsed({"from": "2026-06-01", "to": "2026-05-31"})
    assert error.value.detail == {"to": ["The range ends before it starts (01 Jun 2026). Pick a later end date."]}
    with pytest.raises(ValidationError) as error:
        parsed({})
    assert error.value.detail == {"from": ["Pick the first day of the range."], "to": ["Pick the last day of the range."]}


def test_range_spans_fys_and_includes_end_dates():
    assert parsed({"from": "2022-04-01", "to": "2026-10-08"}) == (date(2022, 4, 1), TODAY)
    assert parsed({"from": "2026-03-31", "to": "2026-04-01"}) == (date(2026, 3, 31), date(2026, 4, 1))


@pytest.mark.django_db
@pytest.mark.parametrize("raw", ["", "abc", "-1", "²", "9" * 30, "1.0", " 1"])
def test_required_firm_refuses_odd_input(raw):
    from billing.api.report_params import report_firm
    with pytest.raises(ValidationError) as error:
        report_firm({"business_id": raw}, required=True)
    assert error.value.detail == {"business_id": ["Pick a firm from the list."]}


@pytest.mark.django_db
def test_firm_is_narrow_and_missing_has_404(django_assert_num_queries):
    from billing.api.report_params import report_firm
    business = firm()
    with django_assert_num_queries(1):
        found = report_firm({"business_id": str(business.pk)}, required=True)
        assert (found.id, found.name, found.gst_number, found.state_name, found.invoice_prefix) == (
            business.id, business.name, business.gst_number, business.state_name, business.invoice_prefix)
    assert "address" in found.get_deferred_fields()
    assert report_firm({}) is None
    with pytest.raises(NotFound, match=r"No such firm\."):
        report_firm({"business_id": "0"})


@pytest.mark.parametrize("raw,expected", [(None, False), ("0", False), ("1", True)])
def test_split_selector(raw, expected):
    from billing.api.report_params import report_split
    assert report_split({} if raw is None else {"split": raw}) is expected


@pytest.mark.parametrize("raw", ["true", "2", "", "yes"])
def test_bad_split_is_a_400(raw):
    from billing.api.report_params import report_split
    with pytest.raises(ValidationError) as error:
        report_split({"split": raw})
    assert error.value.detail == {"split": ["Choose 0 or 1 for split."]}


def test_fy_defaults_to_ist_and_reuses_existing_validation():
    from billing.api.report_params import report_fy
    assert report_fy({}, today=date(2026, 3, 31)) == 2025
    assert report_fy({}, today=date(2026, 4, 1)) == 2026
    assert report_fy({"fy": "2025-26"}, today=TODAY) == 2025
    with pytest.raises(ValidationError) as error:
        report_fy({"fy": "2026-99"}, today=TODAY)
    assert error.value.detail == {"fy": ["Give the financial year like 2026-27."]}
