"""Whole-branch M1: database aggregates use the same per-line paise as the books."""
from datetime import date
from decimal import Decimal

import pytest

from billing.models import LineItem
from billing.services.bill_reads import figures, sums
from billing.services.dashboard import dashboard
from billing.services.gst_checks import checked_bills, month_checks
from billing.tests.v3_helpers import buyer, firm, line, person, sale

pytestmark = pytest.mark.django_db


def old_lines(bill):
    LineItem.objects.filter(invoice=bill).update(quantity="1.5", rate="0.15", cgst="1.005", sgst="1.005", igst="0")


@pytest.mark.parametrize("kind", ["outward", "inward"])
def test_dashboard_agrees_with_bill_per_line_half_paise(kind):
    business, customer = firm(), buyer()
    bill = sale(business, customer, "OLD", date(2026, 10, 2), *[line() for _ in range(4)], kind=kind)
    old_lines(bill)
    expected = figures(sums(LineItem.objects.filter(invoice=bill)))
    assert (expected["taxable"], expected["tax"]) == ("0.92", "8.08")
    data = dashboard(person("viewer", "viewer"), [business], 2026, date(2026, 10, 8))
    side = "sales" if kind == "outward" else "purchases"
    for window in ("month", "last30"):
        assert data[window][side]["taxable"] == expected["taxable"]
        assert data[window][side]["tax"] == expected["tax"]
    assert data["year"]["months"][-1][side]["tax"] == expected["tax"]


def test_hsn_turnover_check_uses_the_books_per_line_paise():
    business, customer = firm(), buyer()
    prior = sale(business, customer, "OLD", date(2025, 10, 2), *[line() for _ in range(4)])
    old_lines(prior)
    current = sale(business, customer, "NEW", date(2026, 10, 2))
    assert checked_bills([business.pk], 2026, 10).get(pk=current.pk)._turnover == Decimal("0.92")


def test_photo_credit_to_confirm_note_uses_the_books_per_line_paise():
    business, customer = firm(), buyer(gst_number="08ABCDE1234A1Z5")
    purchase = sale(business, customer, "PHOTO", date(2026, 9, 2), *[line() for _ in range(4)],
                    kind="inward", needs_review=True)
    old_lines(purchase)
    notes = month_checks(business, 2026, 9)["notes"]
    assert len(notes) == 1
    assert notes[0]["bills"][0]["tax"] == "8.08"
    assert "8.08" in notes[0]["text"]
