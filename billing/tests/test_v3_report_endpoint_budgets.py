"""Query budgets for the CA workbook, credit and reconciliation endpoints (3B review g2 Minor 5).

Each read is bounded by firms × months, never by bills: the counts are equal for 1 and 6 bills a
firm, and stay under a stated ceiling. The workbook costs about 13 queries a firm-month because
3A's builders (GSTR-1, its changes, GSTR-3B tables) run once per firm and month.
"""

from datetime import date
from unittest.mock import patch

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from billing.tests.v3_helpers import buyer, client_for, firm, line, person, sale

pytestmark = pytest.mark.django_db
TODAY = date(2026, 12, 10)


def _add_bills(shops, customer, first, last):
    for shop in shops:
        for index in range(first, last):
            sale(shop, customer, f"S{shop.pk}-{index}", date(2026, 9, 1 + index), line(rate="1000"))
            sale(shop, customer, f"P{shop.pk}-{index}", date(2026, 9, 1 + index), line(rate="100"), kind="inward")


def _counts(client, business):
    reads = {
        "credit": ("/api/gst/credit/", {"business_id": business.pk, "fy": "2026-27"}),
        "reconciliation": ("/api/gst/reconciliation/", {"business_id": business.pk, "fy": "2026-27", "split": "1"}),
        "workbook_month": ("/api/reports/ca-workbook/", {"business_id": business.pk, "from": "2026-09-01", "to": "2026-09-30", "split": "1"}),
        "workbook_quarter": ("/api/reports/ca-workbook/", {"business_id": business.pk, "from": "2026-07-01", "to": "2026-09-30", "split": "1"}),
        "workbook_all_firms": ("/api/reports/ca-workbook/", {"from": "2026-09-01", "to": "2026-09-30", "split": "1"}),
    }
    counts = {}
    for name, (path, params) in reads.items():
        client.get(path, params)  # warm per-process caches so both runs count the same work
        with CaptureQueriesContext(connection) as queries:
            response = client.get(path, params)
        assert response.status_code == 200, response.content
        counts[name] = len(queries)
    return counts


def test_endpoint_reads_are_bounded_by_firms_and_months_not_bills():
    with patch("django.utils.timezone.localdate", return_value=TODAY):
        business, other = firm(), firm("MEERA ORNAMENTS")
        customer = buyer(gst_number="08ABCDE1234F1Z5", customer_type="business")
        client = client_for(person("budget-owner", "admin"))
        _add_bills((business, other), customer, 0, 1)
        few = _counts(client, business)
        _add_bills((business, other), customer, 1, 6)
        many = _counts(client, business)
    assert few == many
    ceilings = {"credit": 12, "reconciliation": 18, "workbook_month": 32, "workbook_quarter": 58, "workbook_all_firms": 51}
    assert {name: count for name, count in many.items() if count > ceilings[name]} == {}
    # Each extra month of one firm's workbook costs at most 13 queries.
    assert many["workbook_quarter"] - many["workbook_month"] <= 2 * 13
