from datetime import date
from decimal import Decimal as D

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from billing.models import BinnedInvoice, Invoice, LineItem
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
