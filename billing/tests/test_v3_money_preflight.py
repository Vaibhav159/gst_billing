"""P3-1/2/3/15 regressions; database seams disclose the absent 2A columns."""

from datetime import date
from decimal import Decimal

import pytest
from django.db.models import BooleanField, DateField, Value

from billing.models import FiledPeriod, FilingRecord, Invoice, LineItem, OpeningCredit
from billing.services.gst_amounts import heads
from billing.services.ledger import ledger, opening_effect
from billing.tests.v3_helpers import buyer, client_for, firm, line, person, sale


@pytest.mark.django_db
def test_shared_bill_totals_match_portal_per_line_half_paisa():
    from billing.services.bill_reads import figures, line_tax, sums
    from billing.services.gstr1_file import build_gstr1

    business = firm()
    invoice = sale(business, buyer(), "HALF", "2026-09-01", line(rate="0.025"), line(rate="0.025"))
    LineItem.objects.filter(invoice=invoice).update(cgst="0.025", sgst="0.025", igst=0)
    rows = list(LineItem.objects.filter(invoice=invoice))
    assert line_tax(rows[0]) == Decimal("0.06")
    totals = figures(sums(rows))
    assert totals == {"taxable": "0.06", "cgst": "0.06", "sgst": "0.06", "igst": "0.00", "tax": "0.12"}
    portal = build_gstr1(business, 2026, 9, amendments=False)["figures"]
    assert {key: totals[key] for key in ("taxable", "cgst", "sgst", "igst")} == {
        key: portal[key] for key in ("taxable", "cgst", "sgst", "igst")}
    assert list(LineItem.objects.filter(invoice=invoice).values_list("cgst", flat=True)) == [Decimal("0.025")] * 2


@pytest.mark.django_db
@pytest.mark.parametrize("recorded", [False, True])
def test_opening_read_names_first_real_3b_not_legacy_or_other_return(recorded, monkeypatch, django_assert_num_queries):
    from billing.api.gst import opening_data

    business = firm()
    FiledPeriod.objects.create(business=business, year=2025, month=4)
    FilingRecord.objects.create(business=business, year=2025, month=5, kind="gstr1", filed_on=date(2025, 6, 11))
    FilingRecord.objects.create(business=firm("OTHER"), year=2025, month=4, kind="gstr3b", filed_on=date(2025, 5, 20))
    if recorded:
        for year, month in ((2026, 1), (2025, 6)):
            FilingRecord.objects.create(business=business, year=year, month=month, kind="gstr3b",
                                        filed_on=date(year, month, 28), figures={"big": "x" * 10000})
    monkeypatch.setattr("billing.services.ledger.month_position", lambda *args, **kwargs: {"carry_on": heads()})
    with django_assert_num_queries(2) as captured:
        result = opening_data(business)
    assert result["first_filed_3b"] == ("2025-06" if recorded else None)
    assert all('"figures"' not in query["sql"] and '"file"' not in query["sql"] for query in captured)


@pytest.mark.django_db
def test_all_legacy_opening_preview_matches_saving_and_reaches_current_month(monkeypatch):
    business = firm()
    for month in (4, 5, 6):
        FiledPeriod.objects.create(business=business, year=2025, month=month)
    books = {f"2025-{month:02}": {"output": heads({"cgst": 10, "sgst": 10}), "credit": heads()}
             for month in (4, 5, 6)}
    # Actual legacy/opening rows; only purchase/sales aggregates await part 2A.
    monkeypatch.setattr("billing.services.ledger._book_groups", lambda *args, **kwargs: books)
    opening = heads({"cgst": 35, "sgst": 35})
    today = date(2025, 6, 25)
    effect = opening_effect(business, opening, today=today)
    assert effect == {"reaches": "2025-06", "carried_out": {"from": Decimal(0), "to": Decimal(10)},
                      "cash": {"month": "2025-06", "from": Decimal(20), "to": Decimal(0)},
                      "filed_differ": {"count": 0, "from": None, "to": None}}
    preview = ledger(business, today, today=today, opening=opening)
    OpeningCredit.objects.create(business=business, cgst=35, sgst=35)
    saved = ledger(business, today, today=today)
    assert [(row["cash"], row["carry_on"]) for row in saved.values()] == [
        (row["cash"], row["carry_on"]) for row in preview.values()]


@pytest.mark.django_db
@pytest.mark.parametrize("credit_month,filed_on,expected", [
    (date(2026, 10, 1), None, False),
    (date(2026, 11, 1), None, True),
    (date(2026, 10, 1), date(2026, 11, 30), False),
    (date(2026, 10, 1), date(2026, 12, 1), True),
    (date(2026, 9, 1), date(2026, 12, 1), True),
])
def test_credit_lapse_sql_uses_recorded_filing_day(credit_month, filed_on, expected, django_assert_num_queries):
    from billing.services.ledger import _credit_lapse

    business = firm()
    invoice = sale(business, buyer(), "P", "2025-04-01", kind="inward")
    if filed_on:
        FilingRecord.objects.create(business=business, year=credit_month.year, month=credit_month.month,
                                    kind="gstr3b", filed_on=filed_on)
    # This is real SQL against real filing/line rows. Only absent part-2 columns
    # are replaced by explicit query annotations; full purchase integration is below.
    lines = LineItem.objects.filter(invoice=invoice).annotate(
        credit_month=Value(credit_month, output_field=DateField()),
        credit_eligible=Value(True, output_field=BooleanField()))
    with django_assert_num_queries(1):
        assert _credit_lapse(lines).values_list("lapsed", flat=True).get() is expected


@pytest.mark.django_db
def test_credit_lapse_preview_uses_date_before_record_is_created():
    from billing.services.ledger import _credit_lapse

    business = firm()
    invoice = sale(business, buyer(), "P", "2025-04-01", kind="inward")
    month = date(2026, 10, 1)
    lines = LineItem.objects.filter(invoice=invoice).annotate(
        credit_month=Value(month, output_field=DateField()),
        credit_eligible=Value(True, output_field=BooleanField()))
    assert _credit_lapse(lines, filing_month=month, filing_date=date(2026, 12, 1)).values_list("lapsed", flat=True).get()
    assert not FilingRecord.objects.exists()


@pytest.mark.django_db
def test_gstr1_download_enforces_unsupported_amendment_refusal(monkeypatch):
    from rest_framework.exceptions import ValidationError

    from billing.models import ReturnDownload

    business = firm(gstin="08VRHFA2322D1ZI")
    client = client_for(person("owner", "admin"))
    monkeypatch.setattr("billing.api.gst.timezone.localdate", lambda: date(2026, 10, 8))
    monkeypatch.setattr("billing.services.gst_checks.month_checks", lambda *args, **kwargs: {"blockers": []})

    def attach(*args, **kwargs):
        if kwargs.get("strict"):
            raise ValidationError({"amendments": ["BILL/1 needs the CA to correct its HSN on the portal."]})
        return {"file": {"fp": "092026"}}

    monkeypatch.setattr("billing.services.gstr1_file.attach_amendments", attach)
    response = client.get("/api/gst/files/gstr1/", {"business_id": business.pk, "month": "2026-09"})
    assert response.status_code == 400
    assert response.json() == {"amendments": ["BILL/1 needs the CA to correct its HSN on the portal."]}
    assert not ReturnDownload.objects.exists()


@pytest.mark.django_db
def test_gstr1_download_refuses_real_ambiguous_frozen_hsn_without_audit(monkeypatch):
    from billing.models import AuditLog, ReturnDownload
    from billing.services.gstr1_file import build_gstr1

    business = firm(gstin="08VRHFA2322D1ZI")
    invoice = sale(business, buyer(), "OLD-AMBIGUOUS", "2026-08-01",
                   line(rate="100", hsn="711311"), line(rate="200", hsn="710239"))
    frozen = build_gstr1(business, 2026, 8, amendments=False)
    for item in frozen["bills"][str(invoice.pk)]["hsn"]:
        for field in ("taxable", "igst", "cgst", "sgst"):
            item.pop(field)
    FilingRecord.objects.create(business=business, year=2026, month=8, kind="gstr1",
                                filed_on=date(2026, 9, 11), bills=frozen["bills"], file=frozen["file"])
    FilingRecord.objects.create(business=business, year=2026, month=8, kind="gstr3b",
                                filed_on=date(2026, 9, 20))
    LineItem.objects.filter(invoice=invoice, hsn_code="711311").update(unit="ct")
    client = client_for(person("owner", "admin"))
    monkeypatch.setattr("billing.api.gst.timezone.localdate", lambda: date(2026, 10, 8))
    audit_count = AuditLog.objects.count()

    response = client.get("/api/gst/files/gstr1/", {"business_id": business.pk, "month": "2026-09"})

    assert response.status_code == 400
    words = " ".join(response.json()["amendments"])
    assert all(word in words for word in ("OLD-AMBIGUOUS", "HSN", "CA", "portal"))
    assert not ReturnDownload.objects.exists()
    assert AuditLog.objects.count() == audit_count


@pytest.mark.django_db
@pytest.mark.parametrize("kind,after_3b", [("gstr1a", False), ("amendments", False), ("amendments", True),
                                         ("gstr1", True)])
def test_correction_download_materializes_source_month_once(kind, after_3b, monkeypatch):
    import json

    from billing.services import gstr1_file

    business = firm(gstin="08VRHFA2322D1ZI")
    invoice = sale(business, buyer(), "CORRECT-1", "2026-08-01", line(rate="100"))
    frozen = gstr1_file.build_gstr1(business, 2026, 8, amendments=False)
    FilingRecord.objects.create(business=business, year=2026, month=8, kind="gstr1",
                                filed_on=date(2026, 9, 11), bills=frozen["bills"], file=frozen["file"])
    if after_3b:
        FilingRecord.objects.create(business=business, year=2026, month=8, kind="gstr3b",
                                    filed_on=date(2026, 9, 20))
    LineItem.objects.filter(invoice=invoice).update(rate=200, cgst=3, sgst=3)
    Invoice.objects.filter(pk=invoice.pk).update(total_amount=206)
    client = client_for(person("owner", "admin"))
    monkeypatch.setattr("billing.api.gst.timezone.localdate", lambda: date(2026, 10, 8))
    original, materialized, calls = gstr1_file.build_gstr1, [], []

    def build(business, year, month, **kwargs):
        calls.append((year, month))
        if (year, month) not in (kwargs.get("month_builds") or {}):
            materialized.append((year, month))
        return original(business, year, month, **kwargs)

    monkeypatch.setattr(gstr1_file, "build_gstr1", build)
    response = client.get(f"/api/gst/files/{kind}/", {
        "business_id": business.pk, "month": "2026-09" if kind == "gstr1" else "2026-08"})
    assert response.status_code == 200, response.content
    body = json.loads(response.content)
    assert body["fp"] == ("092026" if after_3b else "082026")
    assert body["hsn"]["hsn_b2c"][0]["txval"] == 100
    if after_3b:
        assert body["b2csa"][0]["itms"][0]["txval"] == 200
    else:
        assert body["b2cs"][0]["txval"] == 200
    expected = [(2026, 9), (2026, 8)] if kind == "gstr1" else [(2026, 8)]
    assert materialized == expected
    assert calls == expected


@pytest.mark.django_db
def test_gstr3b_download_labels_estimated_interest_outside_portal_json(monkeypatch):
    business = firm(gstin="08VRHFA2322D1ZI")
    client = client_for(person("owner", "admin"))
    monkeypatch.setattr("billing.api.gst.timezone.localdate", lambda: date(2026, 10, 8))
    portal = {"gstin": business.gst_number, "ret_period": "092026", "intr_ltfee": {"intr_details": {"iamt": 12}}}
    monkeypatch.setattr("billing.services.ledger.build_gstr3b_json", lambda *args, **kwargs: portal)
    response = client.get("/api/gst/files/gstr3b/", {"business_id": business.pk, "month": "2026-09"})
    assert response.status_code == 200
    assert response["X-GST-Interest-Note"] == "worked out to today; check on the portal"
    import json
    assert json.loads(response.content) == portal


def test_frozen_3b_working_exposes_interest_note_without_rewriting_snapshot():
    from types import SimpleNamespace

    from billing.services.ledger import gstr3b_tables

    stored = {"t4c": heads()}
    position = {"filed": True, "tables": stored, "as_filed_at": None, "cash_paid": heads(), "carry_on": heads()}
    working = gstr3b_tables(SimpleNamespace(pk=1), 2026, 9, position=position)
    assert working["interest_note"] == "worked out to today; check on the portal"
    assert "interest_note" not in stored


@pytest.mark.django_db
def test_recorded_late_claim_and_grouped_ledger_budget(django_assert_num_queries):
    from billing.services.ledger import _book_groups, _purchase_lines

    business, customer = firm(), buyer()
    for index in range(300):
        sale(business, customer, f"S{index}", "2026-10-01", line(rate="1000"))
        sale(business, customer, f"P{index}", "2025-04-01", line(rate="1000"), kind="inward",
             itc_month=date(2026, 10, 1))
    with django_assert_num_queries(2):
        groups = _book_groups(business, date(2026, 10, 1))
    assert len(groups) <= 19  # April 2025 through October 2026, independent of bill count.
    assert groups["2026-10"]["credit"] == heads({"cgst": 4500, "sgst": 4500})
    with django_assert_num_queries(6):
        rows = ledger(business, date(2026, 10, 1), today=date(2026, 12, 2))
    assert len(rows) == 19
    FilingRecord.objects.create(business=business, year=2026, month=10, kind="gstr3b", filed_on=date(2026, 12, 1),
                                figures={})
    assert _purchase_lines(business).filter(lapsed=True).values("invoice_id").distinct().count() == 300
