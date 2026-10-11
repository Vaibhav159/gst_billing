from datetime import date
from decimal import Decimal

import pytest

from billing.models import Invoice
from billing.services.gst_amounts import heads
from billing.services.ledger import build_gstr3b_json, calculate_ledger, gstr3b_tables, month_position, opening_effect
from billing.tests.v3_helpers import buyer, firm, line, sale


def amount(igst=0, cgst=0, sgst=0):
    return heads(dict(igst=igst, cgst=cgst, sgst=sgst))


def book(output=None, credit=None):
    return {"output": output or amount(), "credit": credit or amount()}


def freeze(position, *, credit_left=None):
    return {"figures": position, "credit_left": credit_left, "locked": True,
            "cash_paid": amount(), "marked_at": "2026-06-20T09:00:00Z"}


def test_credit_cannot_travel_backwards_and_opening_is_once():
    books = {"2025-04": book(amount(cgst=100)), "2025-05": book(credit=amount(cgst=150))}
    rows = calculate_ledger(books, {}, amount(cgst=25), "2025-05")
    assert rows["2025-04"]["cash"] == amount(cgst=75)
    assert rows["2025-05"]["carry_on"] == amount(cgst=150)
    assert rows["2025-04"]["carry_source"]["opening"] is True


def test_cross_head_names_first_month_of_current_fy_only():
    books = {"2025-04": book(amount(cgst=100), amount(sgst=200))}
    rows = calculate_ledger(books, {}, amount(), "2026-04")
    assert rows["2026-03"]["cross_head"] == {
        "month": "2025-04", "paid": "cgst", "paid_amount": Decimal(100), "left": "sgst", "left_amount": Decimal(200)}
    assert rows["2026-04"]["cross_head"] is None


def test_filed_carry_is_portal_balance_and_snapshot_stays_frozen():
    books = {"2025-04": book(amount(cgst=100), amount(cgst=150)), "2025-05": book(amount(cgst=25))}
    april = calculate_ledger(books, {}, amount(), "2025-04")["2025-04"]
    frozen = {"2025-04": freeze(april, credit_left=amount(cgst=10))}
    rows = calculate_ledger(books, frozen, amount(cgst=900), "2025-05")
    assert rows["2025-04"]["cash"] == april["cash"]
    assert rows["2025-04"]["carry_on"] == amount(cgst=10)
    assert rows["2025-05"]["cash"] == amount(cgst=15)
    assert rows["2025-05"]["carry_source"]["as_filed"] is True


def test_amendment_applies_once_after_last_frozen_return_and_can_reduce_output_below_zero():
    books = {"2025-04": book(amount(cgst=100)), "2025-05": book(amount(cgst=20))}
    original = calculate_ledger(books, {}, amount(), "2025-06")
    frozen = {key: freeze(original[key]) for key in ("2025-04", "2025-05")}
    books["2025-04"] = book(amount(cgst=40))
    june = calculate_ledger(books, frozen, amount(), "2025-06")["2025-06"]
    assert june["amendments_in"] == ["2025-04"]
    assert june["output"] == amount()
    assert june["carry_on"] == amount(cgst=60)
    frozen["2025-06"] = freeze(june)
    july = calculate_ledger(books, frozen, amount(), "2025-07")["2025-07"]
    assert july["amendments_in"] == []
    assert july["carry_on"] == amount(cgst=60)


def test_negative_credit_amendment_becomes_cash_shortfall():
    books = {"2025-04": book(amount(igst=100), amount(igst=100))}
    old = calculate_ledger(books, {}, amount(), "2025-04")["2025-04"]
    books["2025-04"] = book(amount(igst=100), amount(igst=20))
    result = calculate_ledger(books, {"2025-04": freeze(old)}, amount(), "2025-05")["2025-05"]
    assert result["cash"] == amount(igst=80)
    assert result["output"] == amount()


def test_taxable_amendment_is_carried_with_tax_and_consumed_once():
    books = {"2025-04": {**book(amount(cgst=15, sgst=15)), "taxable": "1000"}}
    old = calculate_ledger(books, {}, amount(), "2025-04")["2025-04"]
    books["2025-04"] = {**book(amount(cgst=30, sgst=30)), "taxable": "2000"}
    result = calculate_ledger(books, {"2025-04": freeze(old)}, amount(), "2025-05")["2025-05"]
    assert result["taxable"] == Decimal(1000)
    assert result["cash"] == amount(cgst=15, sgst=15)


def test_unlocked_record_uses_books_and_is_not_an_amendment_source():
    books = {"2025-04": book(amount(cgst=100))}
    old = calculate_ledger(books, {}, amount(), "2025-04")["2025-04"]
    record = {**freeze(old), "locked": False}
    books["2025-04"] = book(amount(cgst=10))
    rows = calculate_ledger(books, {"2025-04": record}, amount(), "2025-05")
    assert rows["2025-04"]["cash"] == amount(cgst=10)
    assert not rows["2025-04"]["filed"]
    assert rows["2025-05"]["amendments_in"] == []


def test_gstr3b_json_circular170_and_current_official_keys(monkeypatch):
    import json
    from pathlib import Path
    from types import SimpleNamespace

    table = {"t31a": {"taxable": Decimal("1000"), **amount(cgst=15, sgst=15)},
             "t31c": {"taxable": Decimal("200")}, "t32": [{"place_of_supply": "24", "taxable": Decimal(10), "igst": Decimal("0.30")}],
             "t4a5": {"heads": amount(cgst=45, sgst=45)}, "t4b1": {"heads": amount(cgst=30, sgst=30)},
             "t4c": amount(cgst=15, sgst=15), "t4d2": {"heads": amount(cgst=45, sgst=45)},
             "t5": {"inter": Decimal(0), "intra": Decimal(400)}, "late": None, "cash": amount(), "amendments": None}
    monkeypatch.setattr("billing.services.ledger.gstr3b_tables", lambda *args, **kwargs: table)
    business = SimpleNamespace(gst_number="08ABCDE1234A1Z5")
    result = build_gstr3b_json(business, 2026, 9)
    assert result["itc_elg"]["itc_avl"][-1]["camt"] == Decimal(45)
    assert result["itc_elg"]["itc_rev"][0]["camt"] == Decimal(30)
    assert result["itc_elg"]["itc_net"]["camt"] == Decimal(15)
    assert result["itc_elg"]["itc_inelg"][1]["camt"] == Decimal(45)
    assert result["sup_details"]["osup_nil_exmp"]["txval"] == Decimal(200)
    assert "inter_sup" not in result
    assert build_gstr3b_json(business, 2025, 10)["inter_sup"]["unreg_details"][0]["iamt"] == Decimal("0.30")
    fixture = json.loads((Path(__file__).parent / "fixtures/gstr3b-gstn-v58-keys.json").read_text())
    assert sorted(result) == fixture["top_level_since_2025_11"]
    assert sorted(result["eco_dtls"]) == fixture["eco_dtls"]
    assert [row["ty"] for row in result["itc_elg"]["itc_inelg"]] == fixture["itc_inelg_types"]


def test_file_interest_heads_sum_to_estimate_after_half_up(monkeypatch):
    from billing.services.ledger import interest_heads

    # .01 + .01 independently would overstate the .01 estimate; final head takes remainder.
    late = {"interest": Decimal("0.01"), "gstr3b": {"days": 1}}
    assert interest_heads(amount(cgst="10.14", sgst="10.14"), late) == amount(cgst="0.01")


@pytest.mark.django_db
def test_filed_database_rows_use_small_figures_and_typed_carry(monkeypatch, django_assert_num_queries):
    from billing.models import FilingRecord, OpeningCredit
    from billing.services.ledger import json_money, ledger

    business = firm()
    books = {"2025-04": book(amount(cgst=100), amount(cgst=150)), "2025-05": book(amount(cgst=25))}
    april = calculate_ledger(books, {}, amount(), "2025-04")["2025-04"]
    OpeningCredit.objects.create(business=business, cgst=900)
    FilingRecord.objects.create(business=business, year=2025, month=4, kind="gstr3b", filed_on="2025-05-20",
                                figures=json_money(april), bills={"big": "x" * 10000}, file={"big": "y" * 10000},
                                credit_left_igst=0, credit_left_cgst=10, credit_left_sgst=0, cash_total=13)
    monkeypatch.setattr("billing.services.ledger._book_groups", lambda *args: books)
    with django_assert_num_queries(4) as captured:
        rows = ledger(business, date(2025, 5, 1), today=date(2025, 6, 20))
    assert rows["2025-05"]["cash"] == amount(cgst=15)
    assert rows["2025-04"]["cash_paid"] == {"igst": None, "cgst": None, "sgst": None, "total": Decimal(13)}
    assert all('"bills"' not in query["sql"] and '"file"' not in query["sql"] for query in captured)


@pytest.mark.django_db
@pytest.mark.parametrize("year", [2025, 2026])
def test_turnover_uses_previous_fy_or_first_year_fallback_and_per_line_rounding(year):
    from billing.services.ledger import _turnover
    business, customer = firm(), buyer()
    sale(business, customer, "S1", "2025-04-01", line(rate="1.005"), line(rate="1.005"))
    sale(business, customer, "S2", "2026-04-01", line(rate="3000"))
    sale(business, customer, "S3", "2025-04-01", line(rate="9000"), status="cancelled")
    assert _turnover(business, date(year, 9, 1)) == Decimal("2.02")


@pytest.mark.django_db
def test_tax_heads_round_each_historical_line_before_aggregation():
    from billing.models import LineItem
    from billing.services.ledger import _sums

    business, customer = firm(), buyer()
    invoice = sale(business, customer, "HALF", "2025-04-01", line(), line())
    LineItem.objects.filter(invoice=invoice).update(igst="0.025", cgst="0.025", sgst="0.025")
    assert heads(LineItem.objects.filter(invoice=invoice).aggregate(**_sums())) == amount(
        igst="0.06", cgst="0.06", sgst="0.06")


def test_purchase_query_excludes_bills_before_opening_credit(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    from billing.services.ledger import START, _purchase_lines

    # Query-construction seam only: the real purchase SQL test waits for 2A.
    query = MagicMock()
    query.filter.return_value = query
    query.annotate.return_value = query
    monkeypatch.setattr("billing.services.ledger.uncached", lambda model: query)
    monkeypatch.setattr("billing.services.ledger.Invoice", SimpleNamespace(_meta=SimpleNamespace(
        fields=[SimpleNamespace(name=name) for name in ("itc_month", "itc_eligible", "needs_review")])))
    _purchase_lines(SimpleNamespace(pk=17))
    query.filter.assert_called_once_with(invoice__business_id=17, invoice__type_of_invoice="inward",
                                         invoice__invoice_date__gte=START)


def test_credit_risk_before_first_supported_fy_has_no_query(monkeypatch):
    from billing.services.ledger import credit_at_risk_summary

    def unexpected_query(*args):
        pytest.fail("Purchases before April 2025 have no credit month or risk")

    monkeypatch.setattr("billing.services.ledger.uncached", unexpected_query)
    assert credit_at_risk_summary([17], today=date(2025, 11, 1)) == {
        "count": 0, "tax": Decimal("0.00"), "earliest_deadline": None, "first_business_id": None}


PART2 = {"itc_month", "itc_eligible", "needs_review"} <= {f.name for f in Invoice._meta.fields}
requires_part2 = pytest.mark.skipif(not PART2, reason="3A Task 5 waits for part 2A purchase columns and helpers")


@pytest.mark.django_db
@requires_part2
def test_circular170_tables_and_credit_month(django_assert_num_queries):
    business, customer = firm(), buyer(gst_number="08ABCDE1234A1Z5")
    sale(business, customer, "S1", "2026-11-01", line(rate="1000"), line(rate="200", gst="0"))
    sale(business, customer, "C1", "2026-11-01", line(rate="9999"), status="cancelled")
    sale(business, customer, "P1", "2026-10-01", line(rate="1000"), kind="inward",
         itc_month=date(2026, 11, 1), needs_review=True)
    sale(business, customer, "P2", "2026-11-02", line(rate="2000"), kind="inward", itc_eligible=False)
    sale(business, customer, "P3", "2025-04-01", line(rate="3000"), kind="inward", itc_month=date(2026, 11, 1))
    sale(business, customer, "P4", "2026-11-02", line(rate="400", gst="0"), kind="inward")
    result = gstr3b_tables(business, 2026, 11, today=date(2026, 11, 21))
    assert result["t31a"]["taxable"] == Decimal("1000")
    assert result["t31c"]["taxable"] == Decimal("200")
    assert result["t4a5"]["heads"] == amount(cgst=45, sgst=45)
    assert result["t4b1"]["heads"] == amount(cgst=30, sgst=30)
    assert result["t4c"] == amount(cgst=15, sgst=15)
    assert result["t4d2"]["heads"] == amount(cgst=45, sgst=45)
    assert result["t5"] == {"inter": Decimal(0), "intra": Decimal(400)}
    assert result["to_confirm"][0]["bill_no"] == "P1"
    assert result["t4a5"]["late"][0]["bill_no"] == "P1"
    with django_assert_num_queries(6):
        assert month_position(business, 2026, 11, today=date(2026, 11, 21))["cash"] == amount()


@pytest.mark.django_db
@requires_part2
def test_pre_april_purchase_never_enters_credit_tables_or_risk():
    from billing.services.ledger import _purchase_lines, credit_at_risk_summary

    business, customer = firm(), buyer(gst_number="08ABCDE1234A1Z5")
    old = sale(business, customer, "PRE", "2025-03-31", line(rate="3000"), kind="inward",
               itc_month=date(2025, 4, 1), needs_review=True)
    current = sale(business, customer, "NOW", "2025-04-01", line(rate="1000"), kind="inward")
    assert set(_purchase_lines(business).values_list("invoice_id", flat=True)) == {current.pk}
    assert old.pk != current.pk
    result = gstr3b_tables(business, 2025, 4, today=date(2025, 5, 21))
    assert result["t4a5"]["heads"] == result["t4c"] == amount(cgst=15, sgst=15)
    assert result["t4d2"]["heads"] == amount()
    assert result["to_confirm"] == []
    assert month_position(business, 2025, 4, today=date(2025, 5, 21))["credit"] == amount(cgst=15, sgst=15)
    assert credit_at_risk_summary([business.pk], today=date(2025, 5, 21))["count"] == 0


@pytest.mark.django_db
@requires_part2
def test_opening_effect_stops_before_first_filed_carry():
    from billing.models import FilingRecord
    business, customer = firm(), buyer()
    sale(business, customer, "S1", "2025-04-01", line(rate="1000"))
    may = month_position(business, 2025, 5, today=date(2025, 6, 20))
    from billing.services.ledger import json_money
    FilingRecord.objects.create(business=business, year=2025, month=5, kind="gstr3b", filed_on="2025-06-20",
                                figures=json_money(may))
    effect = opening_effect(business, amount(cgst=30, sgst=30), today=date(2025, 6, 20))
    assert effect["reaches"] == "2025-04"
    assert effect["cash"] == {"month": "2025-04", "from": Decimal(30), "to": Decimal(0)}
    assert effect["filed_differ"]["count"] == 1
