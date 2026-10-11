"""Part 3B credit projection, with explicit inputs from the part 2/3A readers."""

from datetime import date
from decimal import Decimal

import pytest

from billing.services.v3_credit import assemble_credit

TODAY = date(2026, 10, 8)
OPENING = {"business": 3, "typed": False, "total": "0.00"}


def row(pk=77, day=date(2026, 2, 18), tax="902.40", **changes):
    out = {
        "id": pk, "bill_no": f"JGE/{pk}", "bill_date": day,
        "entered_on": date(2026, 10, 5), "supplier": {
            "id": 21, "name": "Jaipur Gem Exports", "gst_number": "08ABCDE1234A1Z5"},
        "tax": Decimal(tax), "credit_month": date(2026, 10, 1),
        "credit_month_due": date(2026, 11, 20), "eligible": True,
        "deadline": date(2026 if day.month < 4 else 2027, 11, 30),
        "claim_months": [
            {"month": "2026-09", "state": "not_filed", "gstr3b_due": "2026-10-20", "too_late": False},
            {"month": "2026-10", "state": "running", "gstr3b_due": "2026-11-20", "too_late": False}],
    }
    out.update(changes)
    return out


def data(rows=(), filed=frozenset(), fy=2026, today=TODAY, others=()):
    return assemble_credit(3, fy, rows, filed, OPENING, today=today,
                           deadline=date(fy + 1, 11, 30), others_at_risk=others)


def test_risk_row_matches_contract_with_hand_worked_tax_and_days():
    out = data([row()])
    assert out["at_risk"] == {
        "deadline": "2026-11-30", "days_left": 53, "tax": "902.40", "count": 1,
        "bills": [{"id": 77, "bill_no": "JGE/77", "bill_date": "2026-02-18", "entered_on": "2026-10-05",
                   "supplier": row()["supplier"], "tax": "902.40", "credit_month": "2026-10",
                   "credit_month_due": "2026-11-20", "claim_months": row()["claim_months"],
                   "deadline": "2026-11-30", "days_left": 53}]}
    assert out["business"] == 3 and out["fy"] == "2026-27"
    assert out["opening"] == OPENING


def test_selected_fy_buckets_are_distinct_from_previous_fy_risk():
    out = data([row(), row(78, date(2026, 4, 1), "0.01"), row(79, date(2027, 3, 31), "0.02")])
    assert out["at_risk"]["tax"] == "902.40"
    assert out["buckets"]["fy"] == "2026-27"
    assert out["buckets"]["open"] == {"bills": 2, "tax": "0.03"}
    assert out["buckets"]["deadline"] == "2027-11-30"


def test_current_and_older_years_do_not_leak_into_risk():
    out = data([row(1, date(2026, 4, 1)), row(2, date(2025, 3, 31), deadline=date(2025, 11, 30))])
    assert out["at_risk"] == {"deadline": None, "days_left": None, "tax": "0.00", "count": 0, "bills": []}


@pytest.mark.parametrize("today,is_risk", [(date(2026, 11, 30), True), (date(2026, 12, 1), False)])
def test_deadline_is_inclusive(today, is_risk):
    out = data([row()], today=today)
    assert bool(out["at_risk"]["bills"]) is is_risk
    old = data([row()], fy=2025, today=today)
    assert old["buckets"]["open" if is_risk else "lapsed"] == {"bills": 1, "tax": "902.40"}


def test_recorded_credit_remains_claimed_after_deadline_regardless_of_lock():
    # The adapter unions legacy locks and all GSTR-3B records. The projection intentionally
    # receives no lock flag: unlocking a recorded return must not make its credit unclaimed.
    out = data([row()], {(3, 2026, 10)}, fy=2025, today=date(2026, 12, 1))
    assert out["buckets"]["claimed"] == {"bills": 1, "tax": "902.40"}
    assert out["buckets"]["lapsed"] == {"bills": 0, "tax": "0.00"}


def test_other_firms_filing_does_not_claim_this_firms_credit():
    out = data([row()], {(4, 2026, 10)})
    assert out["at_risk"]["count"] == 1


@pytest.mark.parametrize("changes,reason", [
    ({"eligible": False}, "not_allowed"),
    ({"tax": Decimal("0")}, "no_gst"),
    ({"supplier": {"id": 1, "name": "Unregistered", "gst_number": "URP"}}, "no_gstin"),
    ({"eligible": False, "tax": Decimal("0")}, "not_allowed"),
])
def test_bills_giving_no_credit_are_explained_and_never_at_risk(changes, reason):
    purchase = row(**changes)
    assert data([purchase])["at_risk"]["count"] == 0
    out = data([purchase], fy=2025)
    assert out["buckets"]["none"] == [{"id": 77, "bill_no": "JGE/77",
                                         "supplier_name": purchase["supplier"]["name"], "why": reason}]
    assert out["buckets"]["open"] == {"bills": 0, "tax": "0.00"}


def test_sum_is_decimal_exact_and_uses_only_unfiled_rows():
    out = data([row(1, tax="0.10"), row(2, tax="0.20"), row(3, tax="99.99", credit_month=date(2026, 9, 1))],
               {(3, 2026, 9)})
    assert out["at_risk"]["tax"] == "0.30"
    assert out["at_risk"]["count"] == 2


def test_unclaimable_scheduled_month_is_still_at_risk_before_actual_deadline():
    purchase = row(credit_month=date(2026, 11, 1), credit_month_due=date(2026, 12, 20), claim_months=[
        {"month": "2026-11", "state": "running", "gstr3b_due": "2026-12-20", "too_late": True}])
    out = data([purchase], today=date(2026, 11, 1))
    assert out["at_risk"]["bills"][0]["claim_months"][0]["too_late"] is True
    assert out["at_risk"]["count"] == 1


def test_risk_order_is_stable_and_other_firms_are_aggregate_rows():
    others = [{"business": 2, "short": "Meera", "count": 4}]
    out = data([row(9), row(2)], others=others)
    assert [bill["id"] for bill in out["at_risk"]["bills"]] == [2, 9]
    assert out["others_at_risk"] == others


def test_inputs_are_not_mutated():
    purchase = row()
    data([purchase])
    assert purchase["tax"] == Decimal("902.40")
    assert purchase["bill_date"] == date(2026, 2, 18)


def test_photo_needing_review_still_counts_as_credit():
    out = data([row(needs_review=True)])
    assert out["at_risk"]["tax"] == "902.40"


def test_bill_before_ledger_has_no_credit_month_and_is_never_at_risk():
    bill = row(day=date(2025, 3, 31), credit_month=None, credit_month_due=None, deadline=date(2025, 11, 30))
    assert data([bill], fy=2025, today=date(2025, 10, 8))["at_risk"]["bills"] == []
    old = data([bill], fy=2024, today=date(2025, 10, 8))
    assert old["buckets"]["lapsed"] == {"bills": 1, "tax": "902.40"}
    assert old["buckets"]["open"] == {"bills": 0, "tax": "0.00"}


def test_opening_cutoff_is_preserved_from_its_owner_without_recalculation():
    opening = {**OPENING, "first_filed_3b": "2025-06"}
    out = assemble_credit(3, 2026, [], set(), opening, today=TODAY, deadline=date(2027, 11, 30))
    assert out["opening"] == opening
    assert out["opening"]["first_filed_3b"] == "2025-06"
