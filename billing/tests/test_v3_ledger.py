from datetime import date
from decimal import Decimal

import pytest

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


def test_amendment_applies_once_after_last_frozen_return_and_unused_reduction_waits_for_tax():
    books = {"2025-04": book(amount(cgst=100)), "2025-05": book(amount(cgst=20))}
    original = calculate_ledger(books, {}, amount(), "2025-06")
    frozen = {key: freeze(original[key]) for key in ("2025-04", "2025-05")}
    books["2025-04"] = book(amount(cgst=40))
    june = calculate_ledger(books, frozen, amount(), "2025-06")["2025-06"]
    assert june["amendments_in"] == ["2025-04"]
    assert june["output"] == amount()
    assert june["carry_on"] == amount()
    assert june["reduction_on"] == amount(cgst=60)
    frozen["2025-06"] = freeze(june)
    books["2025-08"] = book(amount(cgst=75))
    rows = calculate_ledger(books, frozen, amount(), "2025-08")
    assert rows["2025-07"]["amendments_in"] == []
    assert rows["2025-07"]["carry_on"] == amount()
    assert rows["2025-07"]["reduction_on"] == amount(cgst=60)
    assert rows["2025-08"]["output"] == rows["2025-08"]["cash"] == amount(cgst=15)


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
    monkeypatch.setattr("billing.services.ledger._book_groups", lambda *args, **kwargs: books)
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


@pytest.mark.django_db
def test_purchase_query_excludes_bills_before_opening_credit():
    # Real purchase SQL on 2A's fields: a 31 Mar 2025 bill sits in the opening credit.
    from billing.services.ledger import START, _purchase_lines

    business, supplier = firm(), buyer(gst_number="08ABCDE1234A1Z5")
    sale(business, supplier, "OLD", date(2025, 3, 31), kind="inward")
    new = sale(business, supplier, "NEW", START, kind="inward")
    sale(firm("OTHER FIRM", gstin="08AAECD1234K1Z2"), supplier, "OTHER", START, kind="inward")
    assert list(_purchase_lines(business).values_list("invoice_id", flat=True)) == [new.pk]


def test_credit_risk_before_first_supported_fy_has_no_query(monkeypatch):
    from billing.services.ledger import credit_at_risk_summary

    def unexpected_query(*args):
        pytest.fail("Purchases before April 2025 have no credit month or risk")

    monkeypatch.setattr("billing.services.ledger.uncached", unexpected_query)
    assert credit_at_risk_summary([17], today=date(2025, 11, 1)) == {
        "count": 0, "tax": Decimal("0.00"), "earliest_deadline": None, "first_business_id": None,
        "lapsed": {"count": 0, "tax": Decimal("0.00")}}


@pytest.mark.django_db
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


def test_correction_below_this_months_tax_is_taken_off_next_months_tax_never_credit():
    # R3A-2: April filed with CGST 100; corrected to 40 (-60). May's own CGST 20
    # leaves -40: 3.1(a) shows 0 and 40 is taken off June's 3.1(a), not credit.
    books = {"2025-04": book(amount(cgst=100)), "2025-05": book(amount(cgst=20), amount(sgst=5)),
             "2025-06": book(amount(cgst=100))}
    frozen = {"2025-04": freeze(calculate_ledger(books, {}, amount(), "2025-04")["2025-04"])}
    books["2025-04"] = book(amount(cgst=40))
    rows = calculate_ledger(books, frozen, amount(), "2025-06")
    may, june = rows["2025-05"], rows["2025-06"]
    assert may["amendments_in"] == ["2025-04"]
    assert may["output"] == amount()
    assert may["available"] == amount(sgst=5)
    assert may["carry_on"] == amount(sgst=5)
    assert may["reduction_on"] == amount(cgst=40)
    assert may["reduction_note"] == "₹40.00 of an earlier correction is taken off next month's tax."
    assert june["output"] == amount(cgst=60)
    assert june["cash"] == amount(cgst=60)
    assert june["reduction_on"] == amount()
    assert june["reduction_note"] is None
    frozen["2025-05"] = freeze(may)
    june = calculate_ledger(books, frozen, amount(), "2025-06")["2025-06"]
    assert june["amendments_in"] == []
    assert june["output"] == amount(cgst=60)


def test_nil_gstr3b_ignores_carried_credit_but_not_nil_rated_sales():
    # R3A-1, Notification 19/2021: 60 days late, turnover under 1.5 Cr.
    from billing.services.gst_amounts import late_cost
    from billing.services.ledger import nil_returns

    position = calculate_ledger({}, {}, amount(igst=10000), "2025-05")["2025-05"]
    empty = {"bills": 0, "taxable": Decimal(0), **amount()}
    purchases = {"heads": amount()}
    nil = nil_returns(empty, {"taxable": Decimal(0)}, position, purchases, purchases)
    assert nil == {"gstr1": True, "gstr3b": True}
    late = late_cost(2025, 5, cash=amount(), turnover=0, nil=nil, filed={"gstr1": True}, today=date(2025, 8, 19))
    assert (late["gstr3b"]["days"], late["gstr3b"]["fee"]) == (60, Decimal(500))
    nil = nil_returns(empty, {"taxable": Decimal(100000)}, position, purchases, purchases)
    assert nil == {"gstr1": False, "gstr3b": False}
    late = late_cost(2025, 5, cash=amount(), turnover=0, nil=nil, filed={"gstr1": True}, today=date(2025, 8, 19))
    assert late["gstr3b"]["fee"] == Decimal(2000)
    credit = calculate_ledger({"2025-05": book(credit=amount(cgst=9, sgst=9))}, {}, amount(), "2025-05")["2025-05"]
    assert nil_returns(empty, {"taxable": Decimal(0)}, credit, purchases, purchases)["gstr3b"] is False


@pytest.mark.django_db
def test_october_credit_lapses_once_30_november_passes_unfiled():
    # R3A-5: a 2025-26 bill claimed in October 2026, no GSTR-3B on record.
    from django.db.models import DateField, Value

    from billing.models import FiledPeriod, FilingRecord, LineItem
    from billing.services.ledger import _credit_lapse

    business, customer = firm(), buyer(gst_number="08ABCDE1234A1Z5")
    sale(business, customer, "P1", "2025-06-01", line(rate="1000"), kind="inward")

    def lapsed(today):
        lines = LineItem.objects.filter(invoice__business=business).annotate(
            credit_month=Value(date(2026, 10, 1), output_field=DateField()), credit_eligible=Value(True))
        return _credit_lapse(lines, today=today).get().lapsed

    assert lapsed(date(2026, 11, 30)) is False
    assert lapsed(date(2026, 12, 1)) is True
    FiledPeriod.objects.create(business=business, year=2026, month=10)
    assert lapsed(date(2026, 12, 1)) is False
    FiledPeriod.objects.all().delete()
    FilingRecord.objects.create(business=business, year=2026, month=10, kind="gstr3b", filed_on=date(2026, 11, 20))
    assert lapsed(date(2026, 12, 1)) is False


@pytest.mark.django_db
def test_every_unfiled_month_of_the_year_lapses_after_30_november():
    # R3A-9, worked by hand for 2025-26 bills at 3%, deadline 30 Nov 2026:
    #   A Jun 2025 bill, Jun 2025 credit month, unfiled        tax  30  -> lapses
    #   B Mar 2026 bill, Apr 2026 credit month, unfiled        tax  60  -> lapses
    #   C Sep 2025 bill, its GSTR-3B recorded on 20 Oct 2025   tax  90  -> claimed
    #   D Oct 2025 bill, Oct 2026 credit month, unfiled        tax 120  -> lapses (R3A-5)
    #   E Jul 2025 bill, July locked by v2 (legacy, filed)     tax 150  -> claimed
    # On 30 Nov: 3 bills, 30 + 60 + 120 = 210 at risk. On 1 Dec: those 3 lapse, 210.
    from billing.models import FiledPeriod, FilingRecord
    from billing.services.ledger import _purchase_lines, credit_at_risk_summary

    business, supplier = firm(), buyer(gst_number="08ABCDE1234A1Z5")
    bills = {
        "A": sale(business, supplier, "A", date(2025, 6, 10), line(rate="1000"), kind="inward"),
        "B": sale(business, supplier, "B", date(2026, 3, 5), line(rate="2000"), kind="inward", itc_month=date(2026, 4, 1)),
        "C": sale(business, supplier, "C", date(2025, 9, 1), line(rate="3000"), kind="inward"),
        "D": sale(business, supplier, "D", date(2025, 10, 1), line(rate="4000"), kind="inward", itc_month=date(2026, 10, 1)),
        "E": sale(business, supplier, "E", date(2025, 7, 1), line(rate="5000"), kind="inward"),
    }
    FilingRecord.objects.create(business=business, year=2025, month=9, kind="gstr3b", filed_on=date(2025, 10, 20))
    FiledPeriod.objects.create(business=business, year=2025, month=7)
    names = {bill.pk: name for name, bill in bills.items()}

    def lapsed(today):
        return sorted(names[pk] for pk in _purchase_lines(business, today=today).filter(lapsed=True)
                      .values_list("invoice_id", flat=True))

    assert lapsed(date(2026, 11, 30)) == []
    before = credit_at_risk_summary([business.pk], today=date(2026, 11, 30))
    assert (before["count"], before["tax"], before["lapsed"]) == (3, Decimal("210.00"), {"count": 0, "tax": Decimal("0.00")})
    assert lapsed(date(2026, 12, 1)) == ["A", "B", "D"]
    after = credit_at_risk_summary([business.pk], today=date(2026, 12, 1))
    assert (after["count"], after["earliest_deadline"]) == (0, None)
    assert after["lapsed"] == {"count": 3, "tax": Decimal("210.00")}


def test_credit_risk_after_30_november_reports_unfiled_credit_as_lapsed(monkeypatch):
    from billing.services import ledger

    monkeypatch.setattr(ledger, "_risk_rows", lambda business_ids, source_fy, **more: {
        "count": 2, "tax": Decimal("54.00"), "first_business_id": 17})
    at_risk = ledger.credit_at_risk_summary([17], today=date(2026, 11, 30))
    assert (at_risk["count"], at_risk["lapsed"]) == (2, {"count": 0, "tax": Decimal("0.00")})
    after = ledger.credit_at_risk_summary([17], today=date(2026, 12, 1))
    assert (after["count"], after["earliest_deadline"]) == (0, None)
    assert after["lapsed"] == {"count": 2, "tax": Decimal("54.00")}


@pytest.mark.django_db
def test_recorded_gstr3b_shows_the_recorded_late_fee_and_interest(monkeypatch):
    # R3A-4: the frozen worked-out figure gives way to what the owner recorded.
    from billing.models import FilingRecord

    business = firm()
    worked = {"gstr1": {"days": 0, "per_day": Decimal(50), "fee": Decimal(0), "cap": Decimal(2000), "capped": False},
              "gstr3b": {"days": 10, "per_day": Decimal(50), "fee": Decimal(500), "cap": Decimal(2000), "capped": False},
              "interest": Decimal("4.93"), "interest_on": Decimal(1000), "interest_from": "2026-10-21",
              "turnover_band": "upto_1.5cr", "nil": {"gstr1": False, "gstr3b": False}, "total": Decimal("504.93")}
    position = {"filed": True, "recorded": True, "tables": {"late": worked}, "as_filed_at": None, "cash_paid": None, "carry_on": amount()}
    FilingRecord.objects.create(business=business, year=2026, month=9, kind="gstr3b", filed_on=date(2026, 10, 31),
                                late_fee=Decimal(400), interest=Decimal("5.00"), cash_total=Decimal(1000))
    late = gstr3b_tables(business, 2026, 9, today=date(2026, 12, 1), position=position)["late"]
    assert late["recorded"] is True
    assert (late["gstr3b"]["fee"], late["gstr3b"]["days"], late["interest"], late["total"]) == (
        Decimal(400), 0, Decimal("5.00"), Decimal("405.00"))
    FilingRecord.objects.update(late_fee=Decimal(0), interest=Decimal(0))
    assert gstr3b_tables(business, 2026, 9, today=date(2026, 12, 1), position=position)["late"] is None


def _refresh(figures, lapsed_before, monkeypatch, old=date(2026, 12, 2), new=date(2026, 11, 20)):
    # Re-review minors: a GSTR-3B filed 2 Dec with "lapsed_before" in 4(D)(2) is moved to 20 Nov.
    from types import SimpleNamespace

    from billing.services import ledger

    lapsed = {date(2026, 11, 20): {"heads": heads(), "list": []},
              date(2026, 12, 2): {"heads": heads({"igst": lapsed_before}), "list": [{"id": 1}]}}
    monkeypatch.setattr(ledger, "_lapsed", lambda business, day, filed_on: lapsed[filed_on])
    monkeypatch.setattr(ledger, "_turnover", lambda business, day: Decimal(0))
    return ledger.refresh_filing_date(SimpleNamespace(pk=1), 2026, 10, figures, old, new)[0]


def test_refreshing_a_date_keeps_late_costs_on_odd_snapshot_shapes(monkeypatch):
    # tables saved as None, no t4a5 and no earlier late working: moved from 20 Nov (on time) to
    # 2 Dec, the nil return's new late cost still lands: 12 days x 20 = 240.
    figures = {"cash": {"igst": "0.00"}, "tables": None}
    refreshed = _refresh(figures, "0", monkeypatch, old=date(2026, 11, 20), new=date(2026, 12, 2))
    assert (refreshed["tables"]["late"]["gstr3b"]["days"], refreshed["tables"]["late"]["gstr3b"]["fee"]) == (12, "240.00")
    assert refreshed["tables"]["late"]["nil"] == {"gstr1": True, "gstr3b": True}


def test_moving_credit_back_out_of_4d2_releases_the_earlier_excess(monkeypatch):
    # Filed 2 Dec: IGST 80 lapsed into 4(D)(2); with 30 of other credit that left -50, paid in
    # cash on top of the 1000 tax (set-off output 1050). Moved to 20 Nov the 80 is claimable
    # again: 30 + 80 - 80 + 80 -> available 30, set-off output back to 1000, cash 970.
    igst = lambda value: {"igst": value, "cgst": "0.00", "sgst": "0.00", "total": value}  # noqa: E731
    figures = {"output": igst("1000.00"), "setoff_output": igst("1050.00"), "available": igst("0.00"),
               "credit": igst("-50.00"), "base_credit": igst("-50.00"), "cash": igst("1050.00"),
               "tables": {"late": None, "t4a5": {"heads": igst("30.00"), "bills": 1},
                          "t4d2": {"heads": igst("80.00"), "bills": 1, "list": [{"id": 1}]}}}
    refreshed = _refresh(figures, "80", monkeypatch)
    assert refreshed["setoff_output"]["igst"] == "1000.00"
    assert refreshed["available"]["igst"] == "30.00"
    assert refreshed["cash"]["igst"] == "970.00"
    assert refreshed["credit"]["igst"] == "30.00"
