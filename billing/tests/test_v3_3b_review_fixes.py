"""3B review fixes (review g2 Minors) on the reconciliation, report parameters and query budgets."""

from datetime import date
from decimal import Decimal as D

from billing.services.v3_reconciliation import _check, reconcile
from billing.tests.test_v3_reports_plan import row

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
