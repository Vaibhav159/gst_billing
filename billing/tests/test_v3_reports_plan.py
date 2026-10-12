"""Hand-worked report and reconciliation examples for plan 3B."""

from copy import deepcopy
from datetime import date
from decimal import Decimal as D

import pytest

from billing.services.v3_reports import build_report, ca_workbook, payment_split

FIRM = {"id": 3, "name": "KIRAN GOLD HOUSE", "gst_number": "08VRHFA2322D1ZI"}

SEPT = {"firms": [FIRM], "start": date(2026, 9, 1), "end": date(2026, 9, 30), "today": date(2026, 10, 8)}

def row(pk=1, *, kind="sales", day=date(2026, 9, 12), payment="cash", status="active", section="b2b", price="6512.500", qty="12.345", taxable="80396.81", cgst="1205.95", sgst="1205.95", igst="0.00", total="82808.71", unit="gms", name="Gold Ring 22K", hsn="711319", gst="0.03", **more):
    result = {"id": pk, "number": f"KGH/2026-27/{pk}", "date": day, "business": FIRM,
              "customer": {"id": 7, "name": "Anil Gupta", "gst_number": "08ABCDE1234F1Z5", "pan": "", "type": "business"},
              "total": D(total), "status": status, "payment": payment, "duplicate": False,
              "section": section, "pos": "08", "credit_month": day.strftime("%Y-%m"),
              "itc_eligible": True, "needs_review": False, "credit_lapsed": False,
              "lines": [{"name": name, "hsn": hsn, "unit": unit, "quantity": D(qty), "rate": D(price),
                         "gst_rate": D(gst), "taxable": D(taxable), "cgst": D(cgst), "sgst": D(sgst), "igst": D(igst)}]}
    if kind == "purchases":
        result["number"] = "JGE/1183"
    result.update(more)
    return result

def diamond(pk=9, **more):
    return row(pk, **({"kind": "purchases", "day": date(2026, 9, 5), "price": "56400", "qty": "6.4", "taxable": "360960", "cgst": "451.2", "sgst": "451.2", "total": "361862.4", "unit": "ct", "name": "Diamond", "hsn": "710239", "gst": "0.0025", "payment": "bank"} | more))

def test_sales_count_active_but_keep_cancelled_and_duplicate_rows():
    result = build_report("sales", [row(duplicate=True), row(2, status="cancelled")], [], **SEPT, split=True)
    assert result["totals"] == {"bills": 1, "taxable": "80396.81", "igst": "0.00", "cgst": "1205.95", "sgst": "1205.95", "tax": "2411.90", "value": "82808.71", "round_off": "0.00", "cancelled": 1}
    assert len(result["bills"]) == 2
    assert result["bills"][0]["duplicate"] is True
    assert result["bills"][1]["status"] == "cancelled"
    assert result["by_firm"][0]["bills"] == 1
    assert result["split"][0]["share"] == "100.00"

def test_payment_shares_take_two_decimal_remainder_and_keep_blank_mode():
    bills = [row(i, total="1.00", payment=mode) for i, mode in enumerate(("cash", "bank", ""))]
    assert [r["share"] for r in payment_split(bills)] == ["33.33", "33.33", "33.34"]
    assert payment_split(bills)[-1]["mode"] == ""
    assert payment_split([]) == []

def test_purchase_credit_follows_return_month_and_explains_gap():
    early = diamond(day=date(2026, 2, 18), credit_month="2026-10")
    context = {**SEPT, "start": date(2026, 10, 1), "end": date(2026, 10, 31)}
    result = build_report("purchases", [], [early], **context)
    assert result["bills"] == []
    assert result["totals"]["tax"] == "0.00"
    assert result["credit_by_return"]["tax"] == "902.40"
    assert result["gap"]["parts"] == ["+₹902.40 from a Feb 2026 bill to be claimed in October 2026"]
    assert result["gap"]["difference"] == "902.40"
    filed = build_report("purchases", [], [early], **{**context, "closed_credit": {(3, "2026-10")}})
    assert filed["gap"]["parts"] == ["+₹902.40 from a Feb 2026 bill claimed in October 2026"]

@pytest.mark.parametrize("changes,closed,want", [
    ({}, {(3, "2026-09")}, "claimed"), ({}, set(), "to_claim"),
    ({"itc_eligible": False}, set(), "not_allowed"),
    ({"needs_review": True}, set(), "to_confirm"),
    ({"credit_lapsed": True}, {(3, "2026-09")}, "lapsed"),
    ({"date": date(2025, 5, 1), "credit_month": "2026-11", "credit_lapsed": True}, set(), "lapsed"),
])
def test_purchase_credit_states(changes, closed, want):
    bill = diamond(**changes)
    context = {**SEPT, "start": date(2025, 2, 1)}
    result = build_report("purchases", [], [bill], **context, closed_credit=closed)
    assert result["bills"][0]["credit_state"] == want
    assert result["credit_by_return"]["tax"] == ("0.00" if want in {"not_allowed", "lapsed"} else "902.40")

def test_tax_report_consumes_as_filed_positions_and_totals_each_firm():
    position = {"output": {"igst": D("0"), "cgst": D("1205.95"), "sgst": D("1205.95")},
                "credit": {"igst": D("0"), "cgst": D("451.20"), "sgst": D("451.20")},
                "cash": {"igst": D("0"), "cgst": D("754.75"), "sgst": D("754.75")},
                "carry_on": {"igst": D("0"), "cgst": D("0"), "sgst": D("0")},
                "filed": True, "gstr1_filed_on": "2026-10-10", "gstr3b_filed_on": "2026-10-19"}
    result = build_report("tax", [row()], [diamond()], **SEPT, positions={(3, "2026-09"): position})
    assert result["firms"][0]["rows"][0]["state"] == "paid"
    assert result["firms"][0]["rows"][0]["cash"]["total"] == "1509.50"
    assert result["firms"][0]["totals"]["cash"]["total"] == "1509.50"
    assert result["firms"][0]["rows"][0]["gstr3b_filed_on"] == "2026-10-19"

def test_hsn_groups_rate_and_uqc_and_does_not_double_count_bills():
    bill = diamond()
    bill["lines"].append(deepcopy(bill["lines"][0]))
    result = build_report("hsn", [], [bill], **SEPT, side="purchases")
    assert result["rows"] == [{"hsn": "710239", "description": "Diamonds, cut and polished", "uqc": "CTM", "quantity": "12.80", "rate": "0.25", "taxable": "721920.00", "igst": "0.00", "cgst": "902.40", "sgst": "902.40", "bills": 1}]

def test_months_clip_days_and_cross_fy_without_carrying_cancelled_bills():
    context = {**SEPT, "start": date(2026, 3, 31), "end": date(2026, 4, 1)}
    result = build_report("months", [row(day=date(2026, 3, 30)), row(2, day=date(2026, 3, 31)), row(3, day=date(2026, 4, 1), status="cancelled")], [], **context)
    assert [r["month"] for r in result["rows"]] == ["2026-03", "2026-04"]
    assert [r["sales"]["bills"] for r in result["rows"]] == [1, 0]
    assert result["crosses_fy"] is True
    assert result["totals"]["sales"]["value"] == "82808.71"

def test_customers_rank_udhaar_and_keep_walkin_out_of_named_ranking():
    sale = row(payment="credit")
    walkin = row(2, customer={"id": 8, "name": "Walk-in", "gst_number": "", "pan": "", "type": "walkin"})
    result = build_report("customers", [sale, walkin, row(3, status="cancelled")], [], **SEPT)
    assert len(result["rows"]) == 1
    assert result["rows"][0]["udhaar"] == {"bills": 1, "total": "82808.71"}
    assert result["rows"][0]["last_bill"] == "2026-09-12"
    assert result["walkin"]["bills"] == 1

def test_products_never_add_grams_and_pieces_and_count_a_bill_once():
    bill = row()
    bill["lines"].append({**bill["lines"][0], "unit": "pcs", "quantity": D("2")})
    result = build_report("products", [bill, row(2, status="cancelled")], [], **SEPT)
    assert result["rows"][0]["quantity"] == {"gms": "12.345", "pcs": "2.000"}
    assert result["rows"][0]["bills"] == 1
    assert result["rows"][0]["taxable"] == "160793.62"

def test_workbook_exact_columns_preserve_quantity_price_and_purchase_ct():
    result = ca_workbook([row(21)], [diamond()], **SEPT, closed_credit={(3, "2026-09")})
    month = result["firms"][0]["months"][0]
    assert month["sales"]["rows"] == [[1, "KGH/2026-27/21", "2026-09-12", "Anil Gupta", "08ABCDE1234F1Z5", "Gold Ring 22K", "711319", "3", "12.345", "gms", "6512.500", "80396.81", "1205.95", "1205.95", "0.00", "0.00", "82808.71", "cash", "B2B", "08"]]
    assert month["purchases"]["rows"][0][7:11] == ["0.25", "6.400", "ct", "56400.000"]
    assert month["purchases"]["rows"][0][18:] == ["2026-09", "claimed"]
    assert result["summary"][0]["sales"]["value"] == "82808.71"
    assert result["summary"][0]["purchases"]["value"] == "361862.40"
    assert result["file"] == "GST_Report_KIRAN_GOLD_HOUSE_Sep_2026.xlsx"

def test_workbook_first_row_fields_pan_fallback_empty_lines_and_round_off():
    bill = row(customer={"id": 7, "name": "Anil Gupta", "gst_number": "", "pan": "ABCDE1234F", "type": "person"})
    bill["lines"].append(deepcopy(bill["lines"][0]))
    bill["total"] = D("165617.44")
    empty = row(2, lines=[], total="0")
    result = ca_workbook([bill, empty, row(3, status="cancelled")], [], **SEPT, split=True)
    lines = result["firms"][0]["months"][0]["sales"]["rows"]
    assert lines[0][4] == "ABCDE1234F (PAN)"
    assert lines[0][15:17] == ["0.02", "165617.44"]
    assert [lines[1][i] for i in (0, 1, 2, 3, 4, 15, 16)] == [""] * 7
    assert lines[2][5] == "(no items)"
    assert result["summary"][0]["sales"]["bills"] == 2
    assert result["file"].endswith("_with_split.xlsx")

def test_workbook_carries_return_tables_and_amendments_without_customer_payload():
    returns = {(3, "2026-09"): {"gstr1": {"business": 3, "b2b": [{"bill": {"id": 1}, "customer": {"name": "Anil"}}]},
                               "gstr3b": {"t31a": {"taxable": "80396.81", "cgst": "1205.95", "sgst": "1205.95", "igst": "0.00", "bills": 1, "total": "2411.90"}},
                               "stage": "filed", "filing": {"id": 5}, "amendments": [{"month": "2026-08", "kind": "changed"}]}}
    result = ca_workbook([row()], [], **SEPT, return_data=returns)
    firm = result["firms"][0]
    assert firm["gstr1"][0]["sections"]["b2b"] == [{"bill": {"id": 1}}]
    assert firm["gstr3b"][0]["tables"]["t31a"]["cgst"] == "1205.95"
    assert firm["gstr3b"][0]["tables"]["t5_note"] == "Includes purchases from unregistered suppliers with no GST charged."
    assert firm["amendments"] == [{"month": "2026-08", "kind": "changed"}]
    assert returns[(3, "2026-09")]["gstr1"]["b2b"][0]["customer"]["name"] == "Anil"

def test_report_billref_and_placeholder_gstin_are_canonical():
    customer = {"id": 7, "name": "Anil Gupta", "gst_number": "URP", "pan": "ABCDE1234F", "type": "person"}
    sale = row(customer=customer)
    result = build_report("sales", [sale], [], **SEPT)
    assert {key: result["bills"][0][key] for key in ("invoice_number", "invoice_date", "customer_name")} == {"invoice_number": "KGH/2026-27/1", "invoice_date": "2026-09-12", "customer_name": "Anil Gupta"}
    purchase = diamond(customer=customer)
    result = build_report("purchases", [], [purchase], **SEPT)
    assert result["credit_by_return"]["tax"] == "0.00"
    assert result["bills"][0]["credit_state"] == "not_allowed"
    workbook = ca_workbook([sale], [], **SEPT, scope="All firms")
    assert workbook["scope"] == "All firms"
    assert workbook["file"] == "GST_Report_All_firms_Sep_2026.xlsx"
    assert workbook["firms"][0]["months"][0]["sales"]["rows"][0][4] == "ABCDE1234F (PAN)"

def test_workbook_nil_lines_show_table_8_and_mixed_bill_rows_keep_actual_section():
    bill = row()
    bill["lines"].append({**bill["lines"][0], "gst_rate": D("0"), "cgst": D("0"), "sgst": D("0")})
    workbook = ca_workbook([bill], [], **SEPT)
    rows = workbook["firms"][0]["months"][0]["sales"]["rows"]
    assert [row[18] for row in rows] == ["B2B", "NIL"]

def test_payment_split_uses_half_up_on_legacy_three_decimal_heads():
    bill = row(cgst="0.025", sgst="0.015")
    split = payment_split([bill])
    assert split[0]["cgst"] == "0.03"
    assert split[0]["sgst"] == "0.02"

def test_hsn_service_quantity_and_multiple_units_are_distinct():
    bill = diamond()
    bill["lines"].extend([{**bill["lines"][0], "unit": "pcs"}, {**bill["lines"][0], "hsn": "998800"}])
    result = build_report("hsn", [], [bill], **SEPT, side="purchases")
    assert [(r["hsn"], r["uqc"], r["quantity"]) for r in result["rows"]] == [("710239", "CTM", "6.40"), ("710239", "PCS", "6.40"), ("998800", "NA", "0.00")]


def test_reconciliation_keeps_b2cl_separate_and_file_differences_signed():
    bills = [row(section="b2b"), row(2, section="b2cl"), row(3, section="b2cs"), row(4, status="cancelled")]
    filed = {"2026-09": {"gstr1": {"taxable": "241180.42", "igst": "0.00", "cgst": "3617.85", "sgst": "3617.85", "bills": 2}, "gstr3b": {"igst": "0.00", "cgst": "3617.85", "sgst": "3617.85"}}}
    from billing.services.v3_reconciliation import reconcile

    result = reconcile(3, "2026-27", bills, filed=filed, amendments={"2026-09": "2026-10"}, today=date(2026, 10, 8))
    section = next(s for s in result["sections"] if s["key"] == "q2")
    assert section["b2b"]["bills"] == section["b2cl"]["bills"] == section["b2c"]["bills"] == 1
    assert section["all"]["taxable"] == "241190.43"
    filed_row = next(r for r in result["filed"] if r["month"] == "2026-09")
    assert filed_row["diff"]["taxable"] == "10.01"
    assert filed_row["diff"]["bills"] == 1
    assert filed_row["amended_in"] == "2026-10"
    assert result["differs"] == ["2026-09"]
    assert result["periods"][-1]["so_far"] == {"from": "2026-04-01", "to": "2026-10-08"}
    assert not any(c["id"].startswith("mode-") for c in result["checks"])

def test_reconciliation_widens_only_rate_tolerance_and_links_the_rate():
    bill = row(price="1", qty="1", taxable="1", cgst="0.025", sgst="0.005", total="1.04")
    bill["lines"] *= 200  # tax 8 instead of 6: exactly the ₹2 line-count tolerance.
    bill["total"] = D("208")
    from billing.services.v3_reconciliation import reconcile

    result = reconcile(3, "2026-27", [bill], split=True, today=date(2026, 10, 8))
    rates = [c for c in result["checks"] if c["id"].startswith("rate-")]
    assert {c["status"] for c in rates} == {"rounding"}
    assert rates[0]["diff"] == "2.00"
    assert rates[0]["link"] == {"to": "/sales?gst_rate=3", "label": "Open these bills"}
    bill["total"] = D("210")
    from billing.services.v3_reconciliation import reconcile

    result = reconcile(3, "2026-27", [bill], split=True, today=date(2026, 10, 8))
    assert next(c for c in result["checks"] if c["id"] == "mode-value")["status"] == "fail"

def test_reconciliation_empty_and_future_rows_have_complete_zeroes():
    from billing.services.v3_reconciliation import reconcile

    result = reconcile(3, "2026-27", [row(lines=[], total="0"), row(2, day=date(2026, 11, 1))], today=date(2026, 10, 8))
    assert len(result["filed"]) == 7
    assert result["sections"][-1]["all"]["bills"] == 1
    assert result["sections"][-1]["all"]["taxable"] == "0.00"
    coverage = next(c for c in result["checks"] if c["id"] == "coverage" and c["period"] == "Jul to Sep 2026")
    assert coverage["status"] == "pass"
    assert coverage["link"] == {"to": "/sales?empty=1", "label": "Open bills with no items"}

def test_reconciliation_compares_paise_rounded_books_to_snapshot():
    bill = row(taxable="1.00", cgst="0.025", sgst="0.015", total="1.04")
    filed = {"2026-09": {"gstr1": {"taxable": "1.00", "igst": "0.00", "cgst": "0.03", "sgst": "0.02", "bills": 1}}}
    from billing.services.v3_reconciliation import reconcile

    result = reconcile(3, "2026-27", [bill], filed=filed, today=date(2026, 10, 8))
    month = next(row for row in result["filed"] if row["month"] == "2026-09")
    assert month["books"]["cgst"] == "0.03"
    assert month["books"]["sgst"] == "0.02"
    assert month["diff"] == {"taxable": "0.00", "igst": "0.00", "cgst": "0.00", "sgst": "0.00", "bills": 0}
    assert month["differs"] is False


def test_reconciliation_line_paise_agrees_across_reports_split_workbook():
    from billing.services.v3_reconciliation import reconcile

    bill = row(price="1", qty="1", taxable="1", cgst="0.025", sgst="0.025", total="2.10")
    bill["lines"].append(deepcopy(bill["lines"][0]))
    report = build_report("sales", [bill], [], **SEPT, split=True)
    assert report["totals"]["cgst"] == "0.06"
    assert report["totals"]["sgst"] == "0.06"
    assert report["totals"]["round_off"] == "-0.02"
    assert report["split"][0]["cgst"] == "0.06"
    workbook = ca_workbook([bill], [], **SEPT)
    section = workbook["firms"][0]["months"][0]["sales"]
    assert [line[12] for line in section["rows"]] == ["0.03", "0.03"]
    assert section["totals"]["cgst"] == "0.06"
    assert section["rows"][0][15] == "-0.02"
    recon = reconcile(3, "2026-27", [bill], today=SEPT["today"])
    assert recon["sections"][-1]["all"]["cgst"] == "0.06"


def test_tax_report_before_ledger_widens_range_and_never_invents_cash():
    sales = [row(day=date(2025, 3, 1)), row(2, day=date(2025, 3, 31))]
    buys = [diamond(day=date(2025, 3, 2), credit_month=None)]
    scope = {**SEPT, "start": date(2025, 3, 12), "end": date(2025, 3, 15)}
    result = build_report("tax", sales, buys, **scope)
    assert (result["from"], result["to"]) == ("2025-03-01", "2025-03-31")
    assert result["note"] == "Shown for whole months: 01 Mar 2025 to 31 Mar 2025."
    assert result["cuts_month"] is True
    old = result["firms"][0]["rows"][0]
    assert old["state"] == "before_ledger"
    assert old["note"] == "Before the app's credit ledger (it starts April 2025)."
    assert old["output"]["total"] == "4823.80"
    assert old["credit"]["total"] == "902.40"
    assert old["cash"] is old["carry_on"] is None
    assert result["firms"][0]["totals"]["cash"] is None
    assert result["firms"][0]["totals"]["carry_on"] is None
    # The sales report still respects the exact days requested.
    assert build_report("sales", sales, buys, **scope)["totals"]["bills"] == 0


def test_tax_report_spans_ledger_start_without_adding_the_carry_balance():
    zero = {"igst": D("0"), "cgst": D("0"), "sgst": D("0")}
    positions = {(3, "2025-04"): {"output": zero, "credit": zero, "cash": zero,
                                    "carry_on": {**zero, "cgst": D("100")}, "filed": False}}
    scope = {**SEPT, "start": date(2025, 3, 31), "end": date(2025, 4, 1)}
    result = build_report("tax", [row(day=date(2025, 3, 2))], [], **scope, positions=positions)
    assert [r["state"] for r in result["firms"][0]["rows"]] == ["before_ledger", "to_pay"]
    assert result["firms"][0]["totals"]["cash"]["total"] == "0.00"
    assert result["firms"][0]["totals"]["carry_on"]["total"] == "100.00"


def test_hsn_reader_uses_period_frequency_across_units_and_canonical_names():
    bill = row(hsn="123456", name="Rare", unit="gms")
    bill["lines"].extend([{**bill["lines"][0], "name": "Common", "unit": unit} for unit in ("gms", "pcs")])
    result = build_report("hsn", [bill], [], **SEPT)
    assert {r["description"] for r in result["rows"]} == {"Common"}
    assert build_report("hsn", [row()], [], **SEPT)["rows"][0]["description"] == "Jewellery, gold or silver"


def test_product_average_uses_own_unit_and_combines_g_with_gms():
    bill = row(price="100", qty="2", taxable="200", unit="gms")
    bill["lines"].extend([
        {**bill["lines"][0], "unit": "g", "quantity": D("1"), "taxable": D("400")},
        {**bill["lines"][0], "unit": "pcs", "quantity": D("10"), "taxable": D("10000")},
    ])
    result = build_report("products", [bill], [], **SEPT, product_units={("Gold Ring 22K", "711319"): "gms"})
    product = result["rows"][0]
    assert product["quantity"] == {"gms": "3.000", "pcs": "10.000"}
    assert product["average_rate"] == "200.000"
    assert product["other_units"] == [{"unit": "pcs", "quantity": "10.000"}]
    assert product["taxable"] == "10600.00"
    missing = build_report("products", [bill], [], **SEPT)["rows"][0]
    assert missing["average_rate"] is None


def test_preledger_purchase_keeps_no_credit_month_in_report_and_workbook():
    bill = diamond(day=date(2025, 3, 31), credit_month=None)
    scope = {**SEPT, "start": date(2025, 3, 1), "end": date(2025, 3, 31)}
    result = build_report("purchases", [], [bill], **scope)
    assert result["bills"][0]["credit_month"] is None
    assert result["bills"][0]["credit_state"] == "outside"
    assert result["credit_by_return"]["tax"] == "0.00"
    assert result["gap"]["parts"] == ["−₹902.40 on 1 bill with no credit"]
    workbook = ca_workbook([], [bill], **scope)
    assert workbook["firms"][0]["months"][0]["purchases"]["rows"][0][18:] == ["", "outside"]


def test_tax_report_keeps_actual_filed_cash_total_with_unknown_heads():
    zero = {"igst": D("0"), "cgst": D("0"), "sgst": D("0")}
    positions = {(3, "2026-09"): {"output": zero, "credit": zero, "cash": {**zero, "cgst": D("10")},
                                    "cash_paid": {"igst": None, "cgst": None, "sgst": None, "total": D("123.45")},
                                    "carry_on": zero, "filed": True}}
    result = build_report("tax", [], [], **SEPT, positions=positions)
    expected = {"igst": None, "cgst": None, "sgst": None, "total": "123.45"}
    assert result["firms"][0]["rows"][0]["cash"] == expected
    assert result["firms"][0]["totals"]["cash"] == expected
    assert result["firms"][0]["rows"][0]["state"] == "paid"
