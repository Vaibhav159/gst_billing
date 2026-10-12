from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest


def test_gst_items_words_permissions_windows_order_and_as_filed():
    from billing.services.due_gst import gst_items, returns_card
    f = SimpleNamespace(pk=1, name="KIRAN GOLD HOUSE", gst_number="08ABCDE1234A1Z5", short_name="")
    g = SimpleNamespace(pk=2, name="PARAS JEWELS", gst_number="", short_name="")
    def h(value):
        return {"igst": Decimal(value), "cgst": Decimal("0"), "sgst": Decimal("0")}
    facts = {"stages": {(1, "2026-09"): "blocked", (2, "2026-09"): "ready"},
             "blocks": {(1, "2026-09"): {"count": 2, "bills": 3, "first_two": ["Two bills use number 31", "Add an HSN"]}},
             "latest": {1: "2026-08", 2: "2026-08"},
             "positions": {1: {"output": h("100"), "cash": h("40"), "carry_on": h("0")},
                           2: {"output": h("10"), "cash": h("0"), "carry_on": h("20")}},
             "records": {}, "reviews": {1: 2},
             "risk": {"count": 2, "tax": Decimal("50"), "earliest_deadline": date(2026, 11, 30), "first_business_id": 1}}
    items = gst_items({"gst.file", "bill.edit"}, [f, g], date(2026, 10, 8), facts)
    assert [i["kind"] for i in items] == ["blocker", "file_gstr1", "pay_3b", "credit"]
    assert items[0]["title"] == "2 problems stop Kiran's September GSTR-1"
    assert items[0]["badge"] == "home_dot"
    assert items[1]["title"] == "File September GSTR-1 for PARAS JEWELS"
    assert items[2]["title"] == "Pay ₹40.00 GSTR-3B tax in cash"
    assert items[2]["detail"] == "September · Kiran ₹40.00 · Paras: credit covers it"
    assert items[3]["detail"] == "2 purchase bills from FY 2025-26; the credit lapses after 30 Nov 2026"
    assert gst_items(set(), [f, g], date(2026, 10, 8), facts) == []
    early = gst_items({"gst.file"}, [f, g], date(2026, 10, 1), facts)
    assert "pay_3b" not in [i["kind"] for i in early]
    card = returns_card([f, g], date(2026, 10, 8), facts)
    assert card["firms"][0]["credit_used"] == "60.00"
    assert card["firms"][0]["purchases_to_check"] == 2
    assert card["firms"][1]["carry_on"] == "20.00"


def test_single_blocker_open_month_and_all_credit_words():
    from billing.services.due import ORDER
    from billing.services.due_gst import gst_items, returns_card
    f = SimpleNamespace(pk=1, name="PARAS JEWELS", gst_number="", short_name="")
    zero = {"igst": Decimal("0"), "cgst": Decimal("0"), "sgst": Decimal("0")}
    facts = {"stages": {(1, "2026-09"): "blocked"}, "latest": {1: "2026-08"},
        "blocks": {(1, "2026-09"): {"count": 1, "bills": 2, "first_two": ["Two bills use number 31"]},
                   (1, "2026-10"): {"count": 2, "bills": 1, "first_two": ["Add an HSN", "Fix the heads"]}},
        "positions": {1: {"output": zero, "cash": zero, "carry_on": zero}}, "records": {}, "reviews": {}, "risk": {"count": 0}}
    items = gst_items({"gst.file", "bill.edit"}, [f], date(2026, 10, 8), facts)
    rows = {i["kind"]: i for i in items}
    assert rows["blocker"]["title"] == "Two bills use number 31"
    assert rows["blocker"]["detail"] == "PARAS JEWELS · September 2026 GSTR-1 can't be filed until it's fixed"
    assert rows["pay_3b"]["title"] == "File September GSTR-3B"
    assert rows["pay_3b"]["detail"] == "Credit covers the tax; nothing to pay in cash"
    assert rows["open_blocker"]["title"] == "1 October bill needs fixing before October's GSTR-1"
    assert rows["open_blocker"]["detail"] == "PARAS JEWELS · Add an HSN; Fix the heads"
    ordered = sorted(items, key=lambda i: (i["due"] or "9999", ORDER.index(i["kind"])))
    assert [i["kind"] for i in ordered] == ["blocker", "pay_3b", "open_blocker"]
    facts["stages"][1, "2026-09"] = "filed"
    facts["records"][1, "gstr3b"] = {"filed_on": "2026-10-07", "arn": "", "cash_paid": "17.00", "by": None}
    card = returns_card([f], date(2026, 10, 8), facts)
    assert card["firms"][0]["blockers"] == 0
    assert card["firms"][0]["cash"] == "0.00"
    assert card["firms"][0]["gstr3b"]["cash_paid"] == "17.00"


@pytest.mark.parametrize("cash", ["0", "100"])
def test_pay_3b_excludes_unlocked_and_filed_firms_from_amount_count_words_and_link(cash):
    from billing.services.due_gst import gst_items

    firms = [SimpleNamespace(pk=pk, name=name, short_name="") for pk, name in
             [(1, "KIRAN GOLD HOUSE"), (2, "PARAS JEWELS"), (3, "MEHTA ORNAMENTS")]]
    facts = {"stages": {(1, "2026-09"): "unlocked", (2, "2026-09"): "gstr1", (3, "2026-09"): "filed"},
             "blocks": {}, "latest": {}, "risk": {"count": 0},
             "positions": {pk: {"cash": {"igst": Decimal(value)}} for pk, value in [(1, cash), (2, "40"), (3, "200")]}}
    rows = gst_items({"gst.file"}, firms, date(2026, 10, 8), facts)
    assert len(rows) == 1
    assert rows[0]["kind"] == "pay_3b"
    assert rows[0]["count"] == 1
    assert rows[0]["firm"] == 2
    assert rows[0]["title"] == "Pay ₹40.00 GSTR-3B tax in cash"
    assert rows[0]["detail"] == "September · Paras ₹40.00"
    facts["stages"][2, "2026-09"] = "unlocked"
    assert gst_items({"gst.file"}, firms, date(2026, 10, 8), facts) == []


def test_collect_gst_reads_month_stages_dict_once_and_reuses_its_stages():
    """P5-1/P5-2/P5-3: 3A's dict envelope; one stage call for every scanned month; its blocker counts reused."""
    from unittest.mock import MagicMock

    from billing.services.dashboard import month_keys
    from billing.services.due_gst import collect_gst, gst_items
    f = SimpleNamespace(pk=1, name="KIRAN GOLD HOUSE", gst_number="", short_name="")
    zero = {"igst": Decimal("0"), "cgst": Decimal("0"), "sgst": Decimal("0")}
    # August is a v2 whole-month lock with a failing check; September is blocked.
    stages = {(1, "2026-08"): "filed", (1, "2026-09"): "blocked"}
    stage_call = MagicMock(return_value={"stages": stages, "latest_gstr1": {1: "2026-07"},
                                         "blockers": {(1, "2026-09"): {"count": 1, "bills": 2, "first_two": ["Two bills use number 31"]}}})
    blockers = MagicMock(return_value={(1, "2026-10"): {"count": 0, "bills": 0, "first_two": []}})
    with (patch("billing.services.due_gst.month_stages", stage_call), patch("billing.services.due_gst.gstr1_blockers", blockers),
          patch("billing.services.due_gst.credit_at_risk_summary", MagicMock(return_value={"count": 0})),
          patch("billing.services.due_gst.month_positions", MagicMock(return_value={1: {"output": zero, "cash": zero, "carry_on": zero}}))):
        facts = collect_gst([f], date(2026, 10, 8), {"gst.file", "bill.edit"}, False)
    stage_call.assert_called_once_with([1], list(month_keys(date(2025, 4, 1), date(2026, 9, 30))), today=date(2026, 10, 8))
    # Only this month's open bills are read again; September's count comes from month_stages.
    blockers.assert_called_once_with([1], ["2026-10"])
    assert facts["stages"] == stages and facts["latest"] == {1: "2026-07"}
    assert facts["blocks"][(1, "2026-09")]["count"] == 1
    # A v2-locked month that would fail a check is never a blocker item.
    facts["blocks"][(1, "2026-08")] = {"count": 3, "bills": 3, "first_two": ["x"]}
    items = gst_items({"gst.file"}, [f], date(2026, 10, 8), facts)
    assert [(i["kind"], i["month"]) for i in items if i["kind"] == "blocker"] == [("blocker", "2026-09")]


@pytest.mark.django_db
def test_v2_locked_month_with_a_failing_check_is_not_a_blocker():
    """P5-2 / 5-D6: a month v2 locked whole is filed even with no 3A record, so its old faults stay quiet."""
    from billing.models import FiledPeriod
    from billing.services.gst_checks import gstr1_blockers
    from billing.tests.v3_helpers import buyer, client_for, firm, line, person, sale
    f, c = firm(), buyer(address="Street")
    sale(f, c, "31", date(2026, 8, 5), line(hsn=""))
    assert gstr1_blockers([f.pk], ["2026-08"])[f.pk, "2026-08"]["count"] == 1
    FiledPeriod.objects.create(business=f, year=2026, month=8)
    owner = client_for(person("p5-v2-lock-owner", "admin"))
    with patch("billing.api.dashboard.timezone.localdate", return_value=date(2026, 10, 8)):
        items = owner.get("/api/due-next/", {"business_id": f.pk}).json()["items"]
    assert not [i for i in items if i["kind"] == "blocker" and i["month"] == "2026-08"]
