from datetime import date
from decimal import Decimal
from types import SimpleNamespace


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
