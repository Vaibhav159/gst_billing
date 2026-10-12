from datetime import date
from types import SimpleNamespace

import pytest

from billing.tests.v3_helpers import buyer, firm, line, sale


@pytest.mark.django_db
def test_gap_count_reuses_paper_span_and_accepts_preread_numbers():
    from billing.numbering import Numbered, missing_numbers, paper_book
    f, c = firm(), buyer()
    for number, day in [("8", date(2026, 8, 31)), ("11", date(2026, 9, 2)),
                        ("KGH-10", date(2026, 9, 3)), ("P20000", date(2026, 9, 4)),
                        ("9", date(2026, 10, 1)), ("14", date(2026, 9, 9))]:
        sale(f, c, number, day)
    assert missing_numbers(f.pk, 2026, 9) == (2, [12, 13])
    book = paper_book(f, 2026, 9)
    assert (book["missing_count"], book["missing"][:4]) == missing_numbers(f.pk, 2026, 9)
    assert missing_numbers(f.pk, 2026, 9, [Numbered("1000000000", date(2026, 9, 1))]) == (999999999, [1, 2, 3, 4])


@pytest.mark.django_db
def test_itax_summary_matches_list_even_when_stored_total_is_wrong():
    from billing.models import Invoice
    from billing.services.bill_reads import filter_bills, itax_summary
    f, c = firm(), buyer(address="")
    flagged = sale(f, c, "1", date(2026, 10, 1), line(rate="50000", gst="0"))
    Invoice.objects.filter(pk=flagged.pk).update(total_amount="1.00")
    sale(f, buyer("addressed", address="street", pan_number="ABCDE1234F"), "2", date(2026, 10, 1),
         line(rate="200000", gst="0"), payment_mode="cash")
    sale(f, c, "3", date(2026, 10, 1), line(rate="50000", gst="0"), status="cancelled")
    total, kinds = itax_summary(Invoice.objects.sales())
    assert total == filter_bills(Invoice.objects.sales(), {"itax": "1"}).count() == 2
    assert kinds == {"b2c_address": 1, "cash_limit": 1}


def test_due_dates_and_short_name_vectors():
    from billing.fy import due_dates
    from billing.rates import firm_short
    assert due_dates(2026, 12) == {"gstr1": date(2027, 1, 11), "gstr3b": date(2027, 1, 20)}
    for name, short, expected in [("  KIRAN GOLD HOUSE  ", "", "Kiran"), ("PARAS", "", "Paras"),
                                  ("McDONALD GOLD", "", "Mcdonald"), ("KIRAN", "KG", "KG")]:
        assert firm_short(SimpleNamespace(name=name, short_name=short)) == expected
