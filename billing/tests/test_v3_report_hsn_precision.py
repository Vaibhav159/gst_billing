"""P3-15: HSN reports show the portal quantity; CA item rows keep bill precision."""

from datetime import date
from decimal import Decimal

import pytest

from billing.services.gstr1_file import build_gstr1
from billing.services.v3_reports import build_report, ca_workbook, load_sales
from billing.tests.v3_helpers import buyer, firm, line, sale


@pytest.mark.django_db
@pytest.mark.parametrize("registered", [True, False], ids=["b2b", "b2c"])
@pytest.mark.parametrize(
    "unit,hsn,gst,quantities,uqc,expected",
    [
        ("gms", "711319", "0.03", ("6.172", "6.173"), "GMS", "12.35"),
        ("ct", "710239", "0.0025", ("6.172", "6.173"), "CTM", "12.35"),
        ("tola", "711319", "0.03", ("1.005",), "GMS", "11.72"),
        ("gms", "998800", "0.18", ("12.345",), "NA", "0.00"),
    ],
    ids=["grams-half-up-after-sum", "carats-half-up-after-sum", "tola-conversion", "service-zero"],
)
def test_hsn_report_matches_portal_precision_while_ca_item_quantity_stays_three_places(
    registered, unit, hsn, gst, quantities, uqc, expected,
):
    business = firm(gstin="08VRHFA2322D1ZI")
    customer = buyer(gst_number="08WWUFP9975S1ZN" if registered else "")
    sale(business, customer, "HSN/1", "2026-09-12",
         *[line(rate="100", qty=quantity, gst=gst, hsn=hsn, unit=unit) for quantity in quantities])
    start, end = date(2026, 9, 1), date(2026, 9, 30)
    sales = load_sales(start, end, business.pk)
    scope = {
        "firms": [{"id": business.pk, "name": business.name, "gst_number": business.gst_number}],
        "start": start, "end": end, "today": date(2026, 10, 8),
    }

    portal = build_gstr1(business, 2026, 9, amendments=False)
    portal_hsn = portal["file"]["hsn"]["hsn_b2b" if registered else "hsn_b2c"]
    assert len(portal_hsn) == 1
    assert portal_hsn[0]["uqc"] == uqc
    assert Decimal(str(portal_hsn[0]["qty"])) == Decimal(expected)

    workbook = ca_workbook(sales, [], **scope)
    item_rows = workbook["firms"][0]["months"][0]["sales"]["rows"]
    assert [row[8] for row in item_rows] == list(quantities)
    assert [row[9] for row in item_rows] == [unit] * len(quantities)

    report_rows = build_report("hsn", sales, [], **scope)["rows"]
    assert len(report_rows) == 1
    assert report_rows[0]["uqc"] == uqc
    assert report_rows[0]["quantity"] == expected
