"""ledger.lapsed_purchase_ids: 3A's Sec 16(4) rule, read by 3B's reports and credit tab."""

from datetime import date
from unittest.mock import patch

import pytest

from billing.services.filing import mark_filed
from billing.services.ledger import lapsed_purchase_ids
from billing.tests.v3_helpers import buyer, firm, line, person, sale

pytestmark = pytest.mark.django_db


def _purchase(business, number, credit_month, **fields):
    supplier = buyer(f"Supplier {number}", gst_number="08ABCDE1234F1Z5", customer_type="business")
    return sale(business, supplier, number, date(2026, 2, 18), line(rate="1000"),
                kind="inward", itc_month=credit_month, itc_eligible=True, **fields)


def test_recorded_filing_day_decides_and_unfiled_months_lapse_after_30_november():
    with patch("django.utils.timezone.localdate", return_value=date(2026, 12, 10)):
        business = firm()
        on_time = _purchase(business, "L/1", date(2026, 9, 1))
        late = _purchase(business, "L/2", date(2026, 10, 1))
        unfiled = _purchase(business, "L/3", date(2026, 8, 1))
        owner = person("lapse-owner", "admin")
        for month, filed_on in ((date(2026, 8, 1), None), (date(2026, 9, 1), "2026-11-30"), (date(2026, 10, 1), "2026-12-01")):
            if filed_on:
                mark_filed(business, month, owner, {"kind": "both", "gstr1_filed_on": filed_on, "filed_on": filed_on,
                                                    "cash_total": "0.00", "confirm_checks": True})
        ids = [on_time.pk, late.pk, unfiled.pk]

        assert lapsed_purchase_ids(ids, today=date(2026, 11, 30)) == {late.pk}
        assert lapsed_purchase_ids(ids, today=date(2026, 12, 10)) == {late.pk, unfiled.pk}
        assert lapsed_purchase_ids([], today=date(2026, 12, 10)) == set()
