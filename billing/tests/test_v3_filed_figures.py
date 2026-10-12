"""filing.filed_figures: as-filed totals without bill bodies, in changes_for_month's order."""

from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from billing.models import Invoice, LineItem
from billing.services.filing import changes_for_month, filed_figures, mark_filed, relock_month, unlock_month
from billing.tests.v3_helpers import buyer, firm, line, person, sale

pytestmark = pytest.mark.django_db


def test_gstr1a_then_later_corrections_move_the_baseline_and_agree_with_changes_for_month():
    with patch("django.utils.timezone.localdate", return_value=date(2026, 12, 10)):
        business, owner = firm(), person("figures-owner", "admin")
        customer = buyer(gst_number="08ABCDE1234F1Z5", customer_type="business")
        bill = sale(business, customer, "FIG-1", date(2026, 9, 5), line(rate="1000"))
        mark_filed(business, date(2026, 9, 1), owner, {"kind": "gstr1", "filed_on": "2026-10-02", "confirm_checks": True})
        unlock_month(business, date(2026, 9, 1), owner, "Correct the line")
        LineItem.objects.filter(invoice=bill).update(rate=2000, cgst=30, sgst=30)
        Invoice.objects.filter(pk=bill.pk).update(total_amount=2060)
        mark_filed(business, date(2026, 9, 1), owner, {"kind": "gstr1a", "filed_on": "2026-10-03"})
        mark_filed(business, date(2026, 9, 1), owner, {"kind": "gstr3b", "filed_on": "2026-10-04"})
        totals, amended_in = filed_figures(business, 2026)
        assert totals["2026-09"]["gstr1"] == {"taxable": Decimal("2000.00"), "igst": Decimal("0"), "cgst": Decimal("30.00"),
                                              "sgst": Decimal("30.00"), "bills": 1}
        assert amended_in == {}

        unlock_month(business, date(2026, 9, 1), owner, "Replace the bill")
        Invoice.objects.filter(pk=bill.pk).delete()
        sale(business, customer, "FIG-2", date(2026, 9, 6), line(rate="1000"))
        sale(business, customer, "FIG-3", date(2026, 9, 7), line(rate="500"))
        relock_month(business, date(2026, 9, 1), owner)
        mark_filed(business, date(2026, 10, 1), owner, {"kind": "gstr1", "filed_on": "2026-11-02", "confirm_checks": True})
        with CaptureQueriesContext(connection) as queries:
            totals, amended_in = filed_figures(business, 2026)
        assert len(queries) == 3
        assert not any(column in query["sql"] for query in queries for column in ('_filingrecord"."bills"', '_filingrecord"."file"'))
        assert totals["2026-09"]["gstr1"]["taxable"] == Decimal("1500.00")
        assert totals["2026-09"]["gstr1"]["bills"] == 2
        assert amended_in == {"2026-09": "2026-10"}
        assert changes_for_month(business, 2026, 9) == []
