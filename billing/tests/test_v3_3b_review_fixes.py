"""3B review fixes: the reconciliation's period totals and checks, and the credit tab against 3A's risk summary."""

from datetime import date
from decimal import Decimal as D
from unittest.mock import patch

import pytest

from billing.services.ledger import credit_at_risk_summary
from billing.services.report_context import credit_payload
from billing.services.v3_reconciliation import _check, reconcile
from billing.tests.test_v3_reports_plan import row
from billing.tests.v3_helpers import buyer, firm, line, sale
from billing.text import money

TODAY = date(2026, 10, 8)
FILED = {"2026-09": {"gstr1": {"taxable": "80390.00", "igst": "0.00", "cgst": "1205.95", "sgst": "1205.95", "bills": 1},
                     "gstr3b": {"igst": "0.00", "cgst": "1205.95", "sgst": "1205.95"}}}


def test_period_books_beside_gstr1_cover_the_filed_months_so_the_difference_adds_up():
    # August has a bill and no return; September is filed with 6.81 less taxable value than the books.
    result = reconcile(3, "2026-27", [row(1, day=date(2026, 8, 5)), row(2)], filed=FILED, today=TODAY)
    q2 = next(period for period in result["periods"] if period["key"] == "q2")
    assert q2["filed_months"] == 1
    assert q2["books"] == {"taxable": "80396.81", "igst": "0.00", "cgst": "1205.95", "sgst": "1205.95", "bills": 1}
    assert q2["gstr1"] == FILED["2026-09"]["gstr1"]
    assert q2["diff"] == {"taxable": "6.81", "igst": "0.00", "cgst": "0.00", "sgst": "0.00", "bills": 0}
    for key in ("taxable", "igst", "cgst", "sgst"):
        assert D(q2["books"][key]) - D(q2["gstr1"][key]) == D(q2["diff"][key])
    # GSTR-3B carries tax heads only: no made-up taxable value or bill count.
    assert q2["gstr3b"] == {"igst": "0.00", "cgst": "1205.95", "sgst": "1205.95"}


def test_period_with_nothing_filed_shows_every_month_so_far_and_no_return_figures():
    result = reconcile(3, "2026-27", [row(1, day=date(2026, 8, 5)), row(2)], filed=FILED, today=TODAY)
    q1 = next(period for period in result["periods"] if period["key"] == "q1")
    assert (q1["filed_months"], q1["gstr1"], q1["gstr3b"], q1["diff"]) == (0, None, None, None)
    q2_unfiled = next(period for period in reconcile(3, "2026-27", [row(1, day=date(2026, 8, 5)), row(2)],
                                                     today=TODAY)["periods"] if period["key"] == "q2")
    assert q2_unfiled["books"]["bills"] == 2
    assert q2_unfiled["books"]["taxable"] == "160793.62"


def test_count_checks_have_no_rupee_tolerance():
    assert _check("coverage", "Bills counted: 4 of 5", "FY", D(5), D(4), tolerance=D(0))["status"] == "fail"
    assert _check("split-cgst", "money", "FY", D("5.00"), D("4.50"))["status"] == "rounding"
    coverage = [check for check in reconcile(3, "2026-27", [row()], today=TODAY)["checks"] if check["id"] == "coverage"]
    assert {check["status"] for check in coverage} == {"pass"}


@pytest.mark.django_db
@pytest.mark.parametrize("today,at_risk,lapsed", [(date(2026, 11, 1), 1, 0), (date(2026, 12, 1), 0, 1)])
def test_credit_tab_risk_agrees_with_3a_summary_before_and_after_30_november(today, at_risk, lapsed):
    with patch("django.utils.timezone.localdate", return_value=today):
        business = firm()
        supplier = buyer("Risk supplier", gst_number="08ABCDE1234F1Z5", customer_type="business")
        sale(business, supplier, "RISK/1", date(2026, 2, 18), line(rate="30080"),
             kind="inward", itc_month=date(2026, 9, 1), itc_eligible=True)
        summary = credit_at_risk_summary([business.pk])
        tab = credit_payload(business, 2026)["at_risk"]
        assert (tab["count"], D(tab["tax"])) == (summary["count"], summary["tax"]) == (at_risk, D("902.40") * at_risk)
        assert summary["lapsed"] == {"count": lapsed, "tax": D("902.40") * lapsed}
        assert credit_payload(business, 2025)["buckets"]["lapsed"] == {"bills": lapsed, "tax": money(D("902.40") * lapsed)}
