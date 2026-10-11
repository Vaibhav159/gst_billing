from copy import deepcopy
from datetime import date
from decimal import Decimal as D
from unittest.mock import patch

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.exceptions import ValidationError

from billing.models import BinnedInvoice, FilingRecord, Invoice, LineItem
from billing.services.gstr1_file import build_amendments, build_gstr1
from billing.tests.v3_helpers import buyer, firm, line, sale

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("rate,expected", [("1.005", "2.02"), ("0.025", "0.06")])
def test_line_taxable_rounds_half_up_before_summing(rate, expected):
    b, c = firm(), buyer()
    inv = sale(b, c, "KGH/2026-27/1", date(2026, 9, 1),
               line(rate=rate), line(rate=rate))
    result = build_gstr1(b, 2026, 9)
    assert D(str(result["file"]["b2cs"][0]["txval"])) == D(expected)
    assert D(str(result["file"]["hsn"]["hsn_b2c"][0]["txval"])) == D(expected)
    assert result["figures"]["taxable"] == expected
    assert result["bills"][str(inv.pk)]["taxable"] == expected


@pytest.mark.parametrize("interstate,heads", [(False, ("cgst", "sgst")), (True, ("igst",))])
def test_historical_tax_heads_round_each_line_before_summing(interstate, heads):
    b = firm()
    c = buyer(state="GUJARAT" if interstate else "RAJASTHAN")
    inv = sale(b, c, "1", date(2026, 9, 1), line(rate="1.665"), line(rate="1.665"))
    LineItem.objects.filter(invoice=inv).update(
        **{head: D("0.025") if head in heads else D("0") for head in ("igst", "cgst", "sgst")})
    assert list(LineItem.objects.filter(invoice=inv).values_list(heads[0], flat=True)) == [D("0.025")] * 2
    result = build_gstr1(b, 2026, 9, amendments=False)
    for head in heads:
        portal_key = {"igst": "iamt", "cgst": "camt", "sgst": "samt"}[head]
        assert result["file"]["b2cs"][0][portal_key] == 0.06
        assert result["file"]["hsn"]["hsn_b2c"][0][portal_key] == 0.06
        assert result["sections"]["by_rate"][0][head] == "0.06"
        assert result["figures"][head] == "0.06"
        assert result["bills"][str(inv.pk)][head] == "0.06"


def test_hsn_description_known_map_and_preaggregated_mode_need_no_queries():
    from billing.services.gstr1_file import hsn_description

    with CaptureQueriesContext(connection) as captured:
        assert hsn_description(" 711311 ") == "Jewellery, gold or silver"
        assert hsn_description("8413", descriptions={"Pumps": 3, "First label": 1}) == "Pumps"
        assert hsn_description("8413", descriptions={"Zebra": 2, "Alpha": 2}) == "Alpha"
        assert hsn_description("8413") == "Other goods"
        assert hsn_description("") == "No HSN code"
    assert not captured


def test_hsn_description_period_mode_uses_one_grouped_projection():
    from billing.services.gstr1_file import hsn_description

    b, c = firm(), buyer()
    sale(b, c, "1", date(2026, 9, 1), line(hsn=" 8413 ", name=" First label "),
         line(hsn="8413", name="Pumps"), line(hsn="8413", name=" Pumps "))
    for number, day, owner, opts in [
        ("2", date(2026, 8, 1), b, {}),
        ("3", date(2026, 9, 1), b, {"status": "cancelled"}),
        ("4", date(2026, 9, 1), b, {"kind": "inward"}),
        ("5", date(2026, 9, 1), firm(name="Other business"), {}),
    ]:
        sale(owner, c, number, day, *(line(hsn="8413", name="Excluded") for _ in range(3)), **opts)
    with CaptureQueriesContext(connection) as captured:
        assert hsn_description("8413", b, 2026, 9) == "Pumps"
    assert len(captured) == 1
    sql = captured[0]["sql"]
    assert "GROUP BY" in sql
    projection = sql.split(" FROM ")[0]
    assert "product_name" in projection
    assert not any(f'"{name}"' in projection for name in ("rate", "quantity", "gst_tax_rate", "amount"))


def test_hsn_descriptions_match_between_portal_and_screen_across_buyer_classes():
    b, c = firm(), buyer()
    registered = buyer(name="Registered", gst_number="08AAGPL3375F1ZO")
    sale(b, c, "1", date(2026, 9, 1), line(hsn="8413", name="First label"),
         line(hsn="711311", name="Custom jewellery description"))
    sale(b, registered, "2", date(2026, 9, 2), line(hsn="8413", name="Pumps"),
         line(hsn="8413", name="Pumps", gst="0.05"))
    with CaptureQueriesContext(connection) as captured:
        result = build_gstr1(b, 2026, 9, amendments=False)
    for kind in ("b2b", "b2c"):
        for row in result["file"]["hsn"][f"hsn_{kind}"]:
            assert row["desc"] == ("Pumps" if row["hsn_sc"] == "8413" else "Jewellery, gold or silver")
        for row in result["sections"]["hsn"][kind]:
            assert row["description"] == ("Pumps" if row["hsn"] == "8413" else "Jewellery, gold or silver")
    assert len(captured) <= 5


@pytest.mark.parametrize("unit,hsn,uqc,qty", [
    ("ct", "710239", "CTM", 2), ("tola", "711311", "GMS", 23.33),
    ("oz", "711311", "GMS", 62.21), ("pair", "711311", "PRS", 2),
    ("set", "711311", "SET", 2), ("box", "711311", "BOX", 2),
    ("dozen", "711311", "DOZ", 2), ("mtr", "711311", "MTR", 2),
    ("ltr", "711311", "LTR", 2), ("ml", "711311", "MLT", 2),
    ("unit", "711311", "UNT", 2), ("nos", "998892", "NA", 0),
])
def test_portal_units(unit, hsn, uqc, qty):
    b, c = firm(), buyer()
    sale(b, c, "1", date(2026, 9, 1), line(qty="2", unit=unit, hsn=hsn))
    row = build_gstr1(b, 2026, 9)["file"]["hsn"]["hsn_b2c"][0]
    assert (row["uqc"], row["qty"]) == (uqc, qty)


@pytest.mark.parametrize("registered,inter,supply", [
    (True, True, "INTRB2B"), (True, False, "INTRAB2B"),
    (False, True, "INTRB2C"), (False, False, "INTRAB2C"),
])
def test_nil_lines_leave_taxable_sections_but_stay_in_hsn(registered, inter, supply):
    b = firm()
    c = buyer(state="GUJARAT" if inter else "RAJASTHAN",
              gst_number=("24ABCDE1234F1Z5" if inter else "08ABCDE1234F1Z5") if registered else "")
    sale(b, c, "1", date(2026, 9, 1), line(rate="100", gst="0"))
    result = build_gstr1(b, 2026, 9)
    assert result["file"]["nil"]["inv"] == [{"sply_ty": supply, "nil_amt": 100.0,
                                           "expt_amt": 0, "ngsup_amt": 0}]
    assert not any(k in result["file"] for k in ("b2b", "b2cl", "b2cs"))
    assert sum(r["txval"] for rows in result["file"]["hsn"].values() for r in rows) == 100
    assert result["sections"]["nil"] == [{"supply": supply, "bills": 1, "value": "100.00"}]


def test_documents_use_deleted_endpoints_and_other_month_bin_without_blob():
    b, c = firm(), buyer()
    sale(b, c, "A-2", date(2026, 9, 1))
    sale(b, c, "A-5", date(2026, 9, 2), status="cancelled")
    for n, day in [("A-1", date(2026, 9, 1)), ("A-3", date(2026, 8, 1))]:
        BinnedInvoice.objects.create(original_id=99, business=b, customer=c, invoice_number=n,
                                     invoice_date=day, data={"secret_unused_blob": "x" * 1000})
    with CaptureQueriesContext(connection) as captured:
        result = build_gstr1(b, 2026, 9, amendments=False)
    docs = result["file"]["doc_issue"]["doc_det"][0]["docs"]
    assert [(r["from"], r["to"], r["cancel"], r["net_issue"]) for r in docs] == [
        ("A-1", "A-2", 1, 1), ("A-5", "A-5", 1, 0)]
    deleted = next(row["bill"] for row in result["sections"]["cancelled"] if row["kind"] == "deleted")
    assert (deleted["id"], deleted["status"], deleted["invoice_number"]) == (99, "deleted", "A-1")
    assert deleted["bin_id"] is not None
    assert not result["meta"]["warnings"]
    assert len(captured) <= 5
    assert all('"data"' not in q["sql"].split(" FROM ")[0] for q in captured)


def test_gap_note_excludes_cancelled_and_deleted_numbers():
    b, c = firm(), buyer()
    sale(b, c, "1", date(2026, 9, 1))
    sale(b, c, "5", date(2026, 9, 1), status="cancelled")
    BinnedInvoice.objects.create(original_id=99, business=b, customer=c, invoice_number="3",
                                 invoice_date=date(2026, 9, 1), data={})
    result = build_gstr1(b, 2026, 9)
    assert result["meta"]["warnings"] == [
        ("1 to 5: 2 numbers aren't on any bill and go in as cancelled (2, 4). "
        "If they're paper bills not entered yet, enter them before filing.")]


def test_amendments_zero_deleted_b2b_and_restate_whole_b2cs_group():
    b = firm()
    c = buyer(gst_number="08ABCDE1234F1Z5")
    inv = sale(b, c, "1", date(2026, 9, 1))
    walkin = buyer(name="Walk-in")
    small = sale(b, walkin, "2", date(2026, 9, 2), line(rate="100"))
    sale(b, walkin, "3", date(2026, 9, 3), line(rate="200"))
    before = build_gstr1(b, 2026, 9)["bills"]
    Invoice.objects.filter(pk=inv.pk).update(status="cancelled")
    LineItem.objects.filter(invoice=small).update(rate=D("150"), cgst=D("2.25"), sgst=D("2.25"))
    after = build_gstr1(b, 2026, 9)["bills"]
    changes = [{"month": "2026-09", "before": before[str(inv.pk)], "after": None},
               {"month": "2026-09", "before": before[str(small.pk)], "after": after[str(small.pk)]}]
    amended = build_amendments(b, 2026, 10, changes, today=date(2026, 10, 10))
    row = amended["b2ba"][0]["inv"][0]
    assert (row["oinum"], row["oidt"], row["val"]) == ("1", "01-09-2026", 0)
    assert row["itms"][0]["itm_det"]["txval"] == 0
    assert amended["b2csa"][0]["omon"] == "092026"
    assert amended["b2csa"][0]["itms"][0]["txval"] == 350
    one_a = build_amendments(b, 2026, 9, changes, before_gstr3b=True, today=date(2026, 10, 10))
    assert one_a["b2cs"][0]["txval"] == 350
    assert "b2csa" not in one_a
    expired = build_amendments(b, 2027, 12, changes, today=date(2027, 12, 1))
    assert not any(k in expired for k in ("b2ba", "b2csa", "b2b"))


def test_gstn_schema_contract_and_capture_synthetic_payloads():
    import json
    import os
    from pathlib import Path

    b = firm(gstin="08AAGPL3375F1ZO")
    c = buyer(gst_number="08AAGPL3375F1ZO")
    regular = sale(b, c, "R-1", date(2026, 9, 1), line(rate="100"), line(rate="50", gst="0"))
    consumer = buyer(name="Gujarat", state="GUJARAT")
    large = sale(b, consumer, "L-1", date(2026, 9, 2), line(rate="100000"))
    small = sale(b, consumer, "S-1", date(2026, 9, 3), line(rate="100"), line(rate="100", gst="0.05"))
    first = build_gstr1(b, 2026, 9, amendments=False)
    before = first["bills"]
    Invoice.objects.filter(pk=large.pk).update(status="cancelled")
    LineItem.objects.filter(invoice=regular, gst_tax_rate=D("0.03")).update(rate=D("110"), cgst=D("1.65"), sgst=D("1.65"))
    LineItem.objects.filter(invoice=small, gst_tax_rate=D("0.03")).update(rate=D("120"), igst=D("3.60"))
    after = build_gstr1(b, 2026, 9, amendments=False)["bills"]
    changes = [{"month": "2026-09", "before": before[str(inv.pk)], "after": after.get(str(inv.pk))}
               for inv in [regular, large, small]]
    payloads = {"gstr1": first["file"],
                "amendments": build_amendments(b, 2026, 10, changes, today=date(2026, 10, 10)),
                "gstr1a": build_amendments(b, 2026, 9, changes, before_gstr3b=True, today=date(2026, 10, 10))}
    for kind, data in payloads.items():
        fixture = Path(__file__).parent / "fixtures" / ("gstr1a-v2.0-gstn-schema.json" if kind == "gstr1a" else "gstr1-v4.1-gstn-schema.json")
        schema = json.loads(fixture.read_text())["schema"]
        assert set(data) <= set(schema["properties"])
        assert set(schema["required"]) <= set(data)
        assert data["version"] == "GST3.2.4"
    capture = os.environ.get("GST_SCHEMA_CAPTURE")
    if capture:
        Path(capture).write_text(json.dumps(payloads))


@pytest.mark.parametrize("month,tabs", [(4, {"data"}), (5, {"hsn_b2b", "hsn_b2c"})])
def test_hsn_split_starts_may_2025_and_screen_quantity_is_two_decimals(month, tabs):
    b = firm()
    for number, customer in [("1", buyer()), ("2", buyer(name="Registered", gst_number="08AAGPL3375F1ZO"))]:
        sale(b, customer, number, date(2025, month, 1), line(qty="1.005"))
    built = build_gstr1(b, 2025, month, amendments=False)
    assert set(built["file"]["hsn"]) == tabs
    if month == 4:
        rows = built["file"]["hsn"]["data"]
        assert len(rows) == 1
        assert rows[0]["qty"] == 2.01
        assert rows[0]["txval"] == 20100
        assert built["sections"]["hsn"]["b2b"] == built["sections"]["hsn"]["b2c"] == []
        section = built["sections"]["hsn"]["data"][0]
        assert section["quantity"] == "2.01"
        assert section["taxable"] == "20100.00"
        assert section["bills"] == 2
        assert section["description"] == "Jewellery, gold or silver"
    else:
        for rows in built["sections"]["hsn"].values():
            assert rows[0]["quantity"] == "1.01"


@pytest.mark.parametrize("before_3b", [False, True])
def test_added_amendment_includes_taxable_and_nil_hsn_and_table8(before_3b):
    b, c = firm(), buyer(gst_number="08AAGPL3375F1ZO")
    inv = sale(b, c, "LATE-1", date(2026, 9, 1), line(rate="100"), line(rate="50", gst="0"))
    after = build_gstr1(b, 2026, 9, amendments=False)["bills"][str(inv.pk)]
    amended = build_amendments(b, 2026, 9 if before_3b else 10,
        [{"month": "2026-09", "before": None, "after": after}], before_gstr3b=before_3b,
        today=date(2026, 10, 10))
    rows = {row["rt"]: row for row in amended["hsn"]["hsn_b2b"]}
    assert (rows[3]["txval"], rows[3]["qty"], rows[3]["camt"], rows[0]["txval"]) == (100, 1, 1.5, 50)
    assert amended["nil"]["inv"] == [{"sply_ty": "INTRAB2B", "nil_amt": 50, "expt_amt": 0, "ngsup_amt": 0}]
    assert amended["b2b"][0]["inv"][0]["itms"][0]["itm_det"]["txval"] == 100


@pytest.mark.parametrize("registered,before_3b", [(False, False), (True, False), (True, True)])
def test_nil_only_correction_has_signed_supplements_without_empty_invoice(registered, before_3b):
    b = firm()
    c = buyer(gst_number="08AAGPL3375F1ZO" if registered else "")
    inv = sale(b, c, "NIL-1", date(2026, 9, 1), line(rate="100", gst="0"))
    before = build_gstr1(b, 2026, 9, amendments=False)["bills"][str(inv.pk)]
    LineItem.objects.filter(invoice=inv).update(rate=D("75"))
    after = build_gstr1(b, 2026, 9, amendments=False)["bills"][str(inv.pk)]
    amended = build_amendments(b, 2026, 9 if before_3b else 10,
        [{"month": "2026-09", "before": before, "after": after}], before_gstr3b=before_3b,
        today=date(2026, 10, 10))
    tab = "hsn_b2b" if registered else "hsn_b2c"
    assert amended["hsn"][tab][0]["txval"] == -25
    assert amended["hsn"][tab][0]["qty"] == 0
    assert amended["nil"]["inv"][0]["nil_amt"] == -25
    assert not any(key in amended for key in ("b2b", "b2cl", "b2cs", "b2ba", "b2cla", "b2csa"))


def test_hsn_unit_only_correction_moves_exact_money_and_filed_quantity():
    b, c = firm(), buyer()
    inv = sale(b, c, "UNIT-1", date(2026, 9, 1), line(rate="100", unit="ct", hsn="710239"))
    before = build_gstr1(b, 2026, 9, amendments=False)["bills"][str(inv.pk)]
    LineItem.objects.filter(invoice=inv).update(unit="tola", hsn_code="711311")
    after = build_gstr1(b, 2026, 9, amendments=False)["bills"][str(inv.pk)]
    amended = build_amendments(b, 2026, 10, [{"month": "2026-09", "before": before, "after": after}],
                               today=date(2026, 10, 10))
    rows = {row["hsn_sc"]: row for row in amended["hsn"]["hsn_b2c"]}
    assert (rows["710239"]["qty"], rows["710239"]["txval"], rows["710239"]["uqc"]) == (-1, -100, "CTM")
    assert (rows["711311"]["qty"], rows["711311"]["txval"], rows["711311"]["uqc"]) == (11.66, 100, "GMS")
    assert sum(row["camt"] for row in rows.values()) == 0


def test_cancelled_mixed_bill_reverses_hsn_and_nil_without_mutating_snapshot():
    b, c = firm(), buyer(gst_number="08AAGPL3375F1ZO")
    inv = sale(b, c, "VOID-1", date(2026, 9, 1), line(rate="100"), line(rate="50", gst="0"))
    before = build_gstr1(b, 2026, 9, amendments=False)["bills"][str(inv.pk)]
    preserved = deepcopy(before)
    amended = build_amendments(b, 2026, 10, [{"month": "2026-09", "before": before, "after": None}],
                               today=date(2026, 10, 10))
    assert sum(row["txval"] for row in amended["hsn"]["hsn_b2b"]) == -150
    assert amended["nil"]["inv"][0]["nil_amt"] == -50
    assert amended["b2ba"][0]["inv"][0]["val"] == 0
    assert before == preserved


def test_attach_amendments_combines_current_hsn_nil_and_reuses_source_build():
    from billing.services.gstr1_file import attach_amendments

    b, c = firm(), buyer()
    inv = sale(b, c, "OLD-1", date(2026, 9, 1), line(rate="100"), line(rate="50", gst="0"))
    before = build_gstr1(b, 2026, 9, amendments=False)["bills"][str(inv.pk)]
    LineItem.objects.filter(invoice=inv, gst_tax_rate=D("0.03")).update(rate=D("150"), cgst=D("2.25"), sgst=D("2.25"))
    LineItem.objects.filter(invoice=inv, gst_tax_rate=D("0")).update(rate=D("75"))
    sale(b, c, "NOW-1", date(2026, 10, 1), line(rate="1000"), line(rate="100", gst="0"))
    cache = {}
    source = build_gstr1(b, 2026, 9, amendments=False, month_builds=cache)
    base = build_gstr1(b, 2026, 10, amendments=False, month_builds=cache)
    changes = [{"month": "2026-09", "before": before, "after": source["bills"][str(inv.pk)]}]
    preserved = deepcopy(base)
    with CaptureQueriesContext(connection) as captured:
        assert build_gstr1(b, 2026, 9, amendments=False, month_builds=cache) is source
        amended = attach_amendments(base, b, 2026, 10, changes, month_builds=cache, strict=True)
    assert not captured
    rows = {row["rt"]: row for row in amended["file"]["hsn"]["hsn_b2c"]}
    assert (rows[3]["txval"], rows[0]["txval"]) == (1050, 125)
    assert amended["file"]["nil"]["inv"][0]["nil_amt"] == 125
    section_rows = {row["rate"]: row for row in amended["sections"]["hsn"]["b2c"]}
    assert (section_rows["3"]["taxable"], section_rows["0"]["taxable"]) == ("1050.00", "125.00")
    assert section_rows["3"]["bills"] == section_rows["0"]["bills"] == 2
    assert amended["sections"]["nil"] == [{"supply": "INTRAB2C", "bills": 2, "value": "125.00"}]
    assert base == preserved


def test_ambiguous_legacy_hsn_money_refuses_strict_but_keeps_month_readable():
    from billing.services.gstr1_file import attach_amendments

    b, c = firm(), buyer()
    inv = sale(b, c, "OLD-AMBIGUOUS", date(2026, 9, 1), line(rate="100", hsn="711311"),
               line(rate="200", hsn="710239"))
    built = build_gstr1(b, 2026, 9, amendments=False)
    before = deepcopy(built["bills"][str(inv.pk)])
    for item in before["hsn"]:
        for field in ("taxable", "igst", "cgst", "sgst"):
            item.pop(field, None)
    after = deepcopy(built["bills"][str(inv.pk)])
    after["hsn"][0]["unit"] = "ct"
    changes = [{"month": "2026-09", "before": before, "after": after}]
    with pytest.raises(ValidationError) as caught:
        build_amendments(b, 2026, 10, changes, today=date(2026, 10, 10))
    words = str(caught.value.detail)
    assert "OLD-AMBIGUOUS" in words and "CA" in words and "HSN" in words
    assert caught.value.get_codes()["amendments"] == ["unsupported_amendment"]
    result = attach_amendments(built, b, 2026, 10, changes)
    assert "OLD-AMBIGUOUS" in result["meta"]["amendment_errors"][0]
    with patch("billing.services.filing.pending_amendments", return_value=changes), pytest.raises(ValidationError):
        build_gstr1(b, 2026, 10, strict_amendments=True)


def test_legacy_hsn_money_is_inferred_only_when_rate_has_one_hsn_unit_group():
    b, c = firm(), buyer()
    inv = sale(b, c, "OLD-SIMPLE", date(2026, 9, 1), line(rate="100"), line(rate="200"))
    before = build_gstr1(b, 2026, 9, amendments=False)["bills"][str(inv.pk)]
    for item in before["hsn"]:
        for field in ("taxable", "igst", "cgst", "sgst"):
            item.pop(field, None)
    amended = build_amendments(b, 2026, 10, [{"month": "2026-09", "before": before, "after": None}],
                               today=date(2026, 10, 10))
    row = amended["hsn"]["hsn_b2c"][0]
    assert (row["qty"], row["txval"], row["camt"]) == (-2, -300, -4.5)


def test_snapshot_comparison_ignores_added_money_only_for_legacy_hsn_rows():
    from billing.services.gstr1_file import snapshots_equal

    b, c = firm(), buyer()
    inv = sale(b, c, "COMPARE-1", date(2026, 9, 1))
    after = build_gstr1(b, 2026, 9, amendments=False)["bills"][str(inv.pk)]
    before = deepcopy(after)
    for field in ("taxable", "igst", "cgst", "sgst"):
        before["hsn"][0].pop(field)
    assert snapshots_equal(before, after)
    for field in ("hsn", "unit", "quantity", "description", "rate"):
        changed = deepcopy(after)
        changed["hsn"][0][field] = "different"
        assert not snapshots_equal(before, changed)
    changed = deepcopy(after)
    changed["rates"][0]["taxable"] = "999.00"
    assert not snapshots_equal(before, changed)
    changed = deepcopy(after)
    changed["hsn"][0]["taxable"] = "999.00"
    assert not snapshots_equal(after, changed)


@pytest.mark.parametrize("unchanged_quantity,expected_delta", [(None, D("0.01")), ("0.001", D("0.00"))])
def test_amended_hsn_quantity_is_difference_of_rounded_month_groups(unchanged_quantity, expected_delta):
    b, c = firm(), buyer(gst_number="08AAGPL3375F1ZO")
    inv = sale(b, c, "ROUND-1", date(2026, 9, 1), line(rate="100", qty="1.004"))
    if unchanged_quantity:
        sale(b, c, "ROUND-2", date(2026, 9, 2), line(rate="100", qty=unchanged_quantity))
    before_build = build_gstr1(b, 2026, 9, amendments=False)
    LineItem.objects.filter(invoice=inv).update(quantity=D("1.005"))
    after_build = build_gstr1(b, 2026, 9, amendments=False)
    amended = build_amendments(b, 2026, 10, [{"month": "2026-09",
        "before": before_build["bills"][str(inv.pk)], "after": after_build["bills"][str(inv.pk)]}],
        today=date(2026, 10, 10), month_builds={(2026, 9): after_build})
    assert D(str(amended["hsn"]["hsn_b2b"][0]["qty"])) == expected_delta
    assert (D(str(after_build["file"]["hsn"]["hsn_b2b"][0]["qty"])) -
            D(str(before_build["file"]["hsn"]["hsn_b2b"][0]["qty"]))) == expected_delta


@pytest.mark.parametrize("removed", [False, True])
def test_supplement_sections_preserve_full_descriptions_and_positive_contributor_counts(removed):
    from billing.services.gstr1_file import attach_amendments

    b, c = firm(), buyer()
    description = "High pressure hydraulic pump assembly and fittings"
    inv = sale(b, c, "SUPPLEMENT-1", date(2026, 9, 1), line(rate="100", hsn="8413", name=description, unit="nos"),
               line(rate="50", gst="0", hsn="9988", qty="2"))
    source = build_gstr1(b, 2026, 9, amendments=False)
    snapshot = source["bills"][str(inv.pk)]
    base = build_gstr1(b, 2026, 10, amendments=False)
    preserved = deepcopy(base)
    changes = [{"month": "2026-09", "before": snapshot if removed else None,
                "after": None if removed else snapshot}]
    amended = attach_amendments(base, b, 2026, 10, changes, month_builds={(2026, 9): source}, strict=True)
    rows = {row["hsn"]: row for row in amended["sections"]["hsn"]["b2c"]}
    sign = "-" if removed else ""
    assert rows["8413"] == {"hsn": "8413", "description": description, "uqc": "NOS", "quantity": sign + "1.00",
                            "rate": "3", "taxable": sign + "100.00", "igst": "0.00", "cgst": sign + "1.50",
                            "sgst": sign + "1.50", "service": False, "bills": 1}
    assert (rows["9988"]["service"], rows["9988"]["quantity"], rows["9988"]["bills"]) == (True, "0.00", 1)
    assert amended["sections"]["nil"] == [{"supply": "INTRAB2C", "bills": 1, "value": sign + "100.00"}]
    assert base == preserved


def test_gstr1a_wrapper_builds_source_month_once():
    from billing.services.gstr1_file import build_gstr1a

    b, c = firm(), buyer()
    inv = sale(b, c, "ONCE-1", date(2026, 9, 1), line(rate="100"))
    filed = build_gstr1(b, 2026, 9, amendments=False)
    FilingRecord.objects.create(business=b, year=2026, month=9, kind="gstr1", filed_on=date(2026, 10, 1),
                                bills=filed["bills"], figures=filed["figures"], file=filed["file"])
    LineItem.objects.filter(invoice=inv).update(rate=D("150"), cgst=D("2.25"), sgst=D("2.25"))
    with patch("billing.services.gstr1_file.build_gstr1", wraps=build_gstr1) as wrapped:
        result = build_gstr1a(b, 2026, 9)
    assert wrapped.call_count == 1
    assert result["hsn"]["hsn_b2c"][0]["txval"] == 50


def test_april_correction_refuses_unallocatable_quantity_rounding_in_may_split():
    b = firm()
    registered = buyer(gst_number="08AAGPL3375F1ZO")
    inv = sale(b, registered, "APRIL-ROUND", date(2025, 4, 1), line(rate="100", qty="1.004"))
    sale(b, buyer(name="Unregistered"), "APRIL-SMALL", date(2025, 4, 2), line(rate="100", qty="0.001"))
    before = build_gstr1(b, 2025, 4, amendments=False)
    LineItem.objects.filter(invoice=inv).update(quantity=D("1.005"))
    after = build_gstr1(b, 2025, 4, amendments=False)
    assert before["file"]["hsn"]["data"][0]["qty"] == after["file"]["hsn"]["data"][0]["qty"] == 1.01
    with pytest.raises(ValidationError) as caught:
        build_amendments(b, 2025, 5, [{"month": "2025-04", "before": before["bills"][str(inv.pk)],
                                      "after": after["bills"][str(inv.pk)]}], today=date(2025, 6, 1),
                         month_builds={(2025, 4): after})
    assert "APRIL-ROUND" in str(caught.value.detail)
    assert "rounding" in str(caught.value.detail) and "CA" in str(caught.value.detail)


@pytest.mark.parametrize("redistributed", [False, True])
def test_legacy_ambiguous_amounts_cannot_be_declared_unchanged(redistributed):
    from billing.services.filing import changes_for_month

    b, c = firm(), buyer()
    inv = sale(b, c, "AMBIG-BASELINE", date(2026, 9, 1), line(rate="100", hsn="8413"),
               line(rate="200", hsn="8501"))
    filed = build_gstr1(b, 2026, 9, amendments=False)
    for row in filed["bills"][str(inv.pk)]["hsn"]:
        for field in ("taxable", "igst", "cgst", "sgst"):
            row.pop(field)
    FilingRecord.objects.create(business=b, year=2026, month=9, kind="gstr1", filed_on=date(2026, 10, 1),
                                bills=filed["bills"], figures=filed["figures"], file=filed["file"])
    if redistributed:
        LineItem.objects.filter(invoice=inv, hsn_code="8413").update(rate=D("200"), cgst=D("3"), sgst=D("3"))
        LineItem.objects.filter(invoice=inv, hsn_code="8501").update(rate=D("100"), cgst=D("1.5"), sgst=D("1.5"))
    changes = changes_for_month(b, 2026, 9)
    assert len(changes) == 1
    assert changes[0]["before"]["taxable"] == changes[0]["after"]["taxable"] == "300.00"
    with pytest.raises(ValidationError) as caught:
        build_amendments(b, 2026, 10, changes, today=date(2026, 10, 10))
    assert "AMBIG-BASELINE" in str(caught.value.detail) and "CA" in str(caught.value.detail)
