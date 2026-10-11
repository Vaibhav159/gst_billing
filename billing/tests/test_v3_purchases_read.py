"""Purchase lists use bill dates or credit months without changing any figure."""
from datetime import date

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from billing.models import AuditLog, FiledPeriod, LineItem
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, line, person, sale

pytestmark = pytest.mark.django_db


@pytest.fixture
def rows(monkeypatch):
    monkeypatch.setattr(timezone, "localdate", lambda *a, **k: date(2026, 10, 8))
    business, supplier = firm(), buyer("Udaipur Bullion Suppliers", gst_number="08AACFU5521R1ZN", city="Udaipur")
    current = sale(business, supplier, "UBS/0850", date(2026, 10, 4), line(rate="100", qty="2"), kind="inward", needs_review=True)
    late = sale(business, supplier, "OLD-7", date(2026, 3, 31), kind="inward", itc_month=date(2026, 10, 1))
    zero = sale(business, supplier, "NO-ITC", date(2026, 9, 1), kind="inward", itc_eligible=False, status="cancelled")
    sale(business, supplier, "KGH/1", date(2026, 10, 4))
    client = client_for(person("reader", *ROLE_GROUPS["viewer"]))
    return client, business, supplier, current, late, zero


def test_rows_summary_credit_overrides_bill_date_filters(rows):
    client, _, _, current, late, zero = rows
    response = client.get("/api/purchases/", {"credit_month": "2026-10", "fy": "bad", "month": "bad", "start_date": "bad"})
    assert response.status_code == 200
    assert {r["id"] for r in response.data["results"]} == {current.pk, late.pk}
    assert response.data["summary"] == {"bills": 2, "taxable": "10200.00", "cgst": "153.00", "sgst": "153.00",
        "igst": "0.00", "tax": "306.00", "total_amount": "10506.00", "credit": "306.00"}
    all_rows = client.get("/api/purchases/").data
    assert all_rows["count"] == 3
    assert any(r["id"] == zero.pk for r in all_rows["results"])
    assert all_rows["summary"]["credit"] == "306.00"


def test_facets_count_late_prior_year_credit_and_ignore_other_filters(rows):
    response = rows[0].get("/api/purchases/", {"fy": "2026-27", "facets": "1", "check": "1", "supplier_id": "999"})
    assert response.status_code == 200
    facets = response.data["facets"]
    october = next(m for m in facets["months"] if m["month"] == "2026-10")
    assert october == {"month": "2026-10", "bills": 1, "late_in": 1, "late_in_credit": "300.00", "closed": False}
    assert facets["credit_months"] == [{"month": "2026-10", "bills": 2, "credit": "306.00"}]
    assert facets["checks"]["needs_review"] == 1


def test_closed_credit_lock_is_shared_by_rows_detail_and_facets(rows):
    FiledPeriod.objects.create(business=rows[1], year=2026, month=10)
    response = rows[0].get("/api/purchases/", {"facets": "1", "fy": "2026-27", "credit_month": "2026-10"})
    late = next(r for r in response.data["results"] if r["id"] == rows[4].pk)
    assert late["locked"] and late["credit"]["state"] == "filed"
    detail = rows[0].get(f"/api/purchases/{rows[4].pk}/").data
    assert detail["credit"]["deadline"] == "2026-11-30"
    assert detail["credit"]["month"] == "2026-10"
    assert detail["supplier"]["pan"] == "AACFU5521R"
    assert next(m for m in response.data["facets"]["months"] if m["month"] == "2026-10")["closed"]


@pytest.mark.parametrize("q", ["UBS-0850", "uda bul", "AACF", "Sil"])
def test_search_number_supplier_gstin_and_line_words(rows, q):
    result = rows[0].get("/api/purchases/", {"q": q})
    assert result.status_code == 200
    assert rows[3].pk in {r["id"] for r in result.data["results"]}


def test_checks_and_exports_weights_and_detail_history(rows):
    current = rows[3]
    LineItem.objects.filter(invoice=current).update(hsn_code="", unit="g")
    duplicate = sale(rows[1], rows[2], "UBS-0850", date(2026, 10, 5), kind="inward")
    response = rows[0].get("/api/purchases/", {"dups": "1", "no_hsn": "1", "include": "lines"})
    assert response.data["count"] == 1
    result = response.data["results"][0]
    assert result["checks"] == ["duplicate", "no_hsn"]
    assert result["weights"] == [{"unit": "gms", "quantity": "2.000"}]
    assert result["lines"][0]["rate"] == "100.000"
    assert duplicate.pk != current.pk
    for n in range(51):
        AuditLog.objects.create(entity="invoice", entity_id=current.pk, action="credit_set", details=str(n))
    detail = rows[0].get(f"/api/purchases/{current.pk}/").data
    assert len(detail["history"]["activity"]) == 50
    assert detail["history"]["activity"][0]["action"] == "credit_set"


@pytest.mark.parametrize("params,key", [({"credit_month": "bad"}, "credit_month"), ({"fy": "bad"}, "fy"),
    ({"supplier_id": "²"}, "supplier_id"), ({"business_id": "x"}, "business_id"), ({"month": "2026-13"}, "month"),
    ({"start_date": "bad"}, "start_date"), ({"facets": "0"}, "facets"), ({"summary": "yes"}, "summary")])
def test_bad_filters_are_words(rows, params, key):
    response = rows[0].get("/api/purchases/", params)
    assert response.status_code == 400
    assert key in response.data


def test_page_words_and_optional_summary(rows):
    response = rows[0].get("/api/purchases/", {"page": 9})
    assert response.status_code == 404
    assert response.data["detail"] == "This list has no page 9."
    assert "summary" not in rows[0].get("/api/purchases/", {"summary": "0"}).data


def test_usual_rate_is_quantity_weighted_and_skips_amount_only(rows):
    sale(rows[1], rows[2], "RATE-1", date(2026, 10, 5), line(rate="200", qty="1"), kind="inward")
    other = buyer("Other", gst_number="08AACFU5521R1ZN")
    sale(rows[1], other, "RATE-2", date(2026, 10, 5), line(rate="999", qty="100"), kind="inward")
    data = rows[0].get("/api/purchases/usual-rate/", {"product_name": "silver", "unit": "gms", "supplier_id": rows[2].pk}).data
    # September's ineligible purchase still paid a rate, so it belongs in this average.
    assert data["rate"] == "2600.000"
    assert data["from"] == "them"
    assert data["last"] == {"rate": "200.000", "invoice_date": "2026-10-05", "invoice_number": "RATE-1"}
    result = rows[0].get("/api/purchases/usual-rate/", {"product_name": "Nothing", "unit": "gms"}).data
    assert result == {"rate": None, "from": None, "last": None}


def test_duplicate_check_marks_unreadable_inputs_unknown(rows):
    for params in ({}, {"business_id": "9"*50}, {"business_id": rows[1].pk, "supplier_id": []}):
        result = rows[0].get("/api/purchases/check-duplicate/", params)
        assert result.status_code == 200
        assert result.data == {"duplicate": None, "same_spelling": False, "unchecked": True}


def test_summary_query_columns_are_narrow_and_query_count_does_not_grow_per_row(rows):
    from billing.services.purchase_reads import purchase_queryset, purchase_summary

    with CaptureQueriesContext(connection) as sql:
        summary = purchase_summary(purchase_queryset())
    assert summary["bills"] == 3
    assert len(sql) <= 2
    queries = " ".join(q["sql"] for q in sql)
    assert "source_file" not in queries and "buyer_gstin" not in queries and "firm_snapshot" not in queries
    with CaptureQueriesContext(connection) as first:
        response = rows[0].get("/api/purchases/", {"summary": "0"})
    assert response.status_code == 200
    for n in range(12):
        sale(rows[1], rows[2], f"MORE-{n}", date(2026, 10, 6), kind="inward")
    with CaptureQueriesContext(connection) as more:
        rows[0].get("/api/purchases/", {"summary": "0"})
    assert len(more) <= len(first) + 1


def test_contract_row_and_detail_have_every_key(rows):
    expected = {"id", "business", "business_name", "invoice_number", "invoice_date", "fy", "created_at", "supplier",
                "payment_mode", "taxable", "cgst", "sgst", "igst", "tax", "total_amount", "interstate", "gst_percents",
                "line_count", "first_line", "weights", "credit", "needs_review", "source", "has_files", "checks", "locked"}
    result = rows[0].get("/api/purchases/").data["results"][0]
    assert set(result) == expected
    assert set(result["credit"]) == {"month", "chosen", "late", "eligible", "lapsed", "claimed", "state", "filed_on", "deadline"}
    detail = rows[0].get(f"/api/purchases/{rows[3].pk}/").data
    assert set(detail) == expected | {"firm", "buyer_gstin", "buyer_ack", "linked_sale", "lines", "slabs", "files", "capture", "history"}


@pytest.mark.parametrize("params,which", [({"fy": "2025-26"}, (4,)), ({"month": "2026-09"}, (5,)),
    ({"start_date": "2026-09-01", "end_date": "2026-09-30"}, (5,)), ({"check": "1"}, (3,)),
    ({"eligible": "0"}, (5,)), ({"photo": "1"}, ()), ({"empty": "1"}, ())])
def test_each_filter_uses_its_own_scope(rows, params, which):
    result = rows[0].get("/api/purchases/", params)
    assert result.status_code == 200
    assert {r["id"] for r in result.data["results"]} == {rows[n].pk for n in which}


@pytest.mark.django_db(transaction=True)
def test_all_purchase_read_paths_bypass_cacheops(rows):
    from billing.tests.test_v3_cacheops import cacheops_on

    paths = [("/api/purchases/", {"facets": "1", "fy": "2026-27", "q": "Silver"}),
             ("/api/purchases/", {"dups": "1", "no_hsn": "1"}),
             (f"/api/purchases/{rows[3].pk}/", {}),
             ("/api/purchases/credit-months/", {"business_id": rows[1].pk, "invoice_date": "2026-09-01"}),
             ("/api/purchases/check-duplicate/", {"business_id": rows[1].pk, "supplier_id": rows[2].pk,
                "invoice_number": "UBS-0850", "invoice_date": "2026-10-04"}),
             ("/api/purchases/usual-rate/", {"product_name": "Silver", "unit": "gms", "supplier_id": rows[2].pk})]
    with cacheops_on() as touched:
        for url, params in paths:
            response = rows[0].get(url, params)
            assert response.status_code == 200, response.data
    assert touched == []


@pytest.mark.parametrize("duplicates", [False, True])
def test_facets_reuse_each_line_and_fy_number_once(rows, monkeypatch, duplicates):
    from billing.models import Invoice

    sale(rows[1], rows[2], "UBS-0850", date(2026, 10, 6), kind="inward")
    sale(rows[1], rows[2], "OTHER-1", date(2026, 10, 6), kind="inward")
    read_lines, read_numbers = [], []
    original_line, original_bill = LineItem.from_db, Invoice.from_db

    def loaded_line(cls, db, fields, values):
        read_lines.append(dict(zip(fields, values, strict=True))["id"])
        return original_line(db, fields, values)

    def loaded_bill(cls, db, fields, values):
        if "invoice_number" in fields and "total_amount" not in fields:
            read_numbers.append(dict(zip(fields, values, strict=True))["id"])
        return original_bill(db, fields, values)

    monkeypatch.setattr(LineItem, "from_db", classmethod(loaded_line))
    monkeypatch.setattr(Invoice, "from_db", classmethod(loaded_bill))
    params = {"facets": "1", "fy": "2026-27", "page_size": "1"}
    if duplicates:
        params["dups"] = "1"
    response = rows[0].get("/api/purchases/", params)
    assert response.status_code == 200
    assert response.data["facets"]["checks"]["duplicate"] == 2
    assert response.data["summary"]["bills"] == (2 if duplicates else 4)
    assert response.data["summary"]["tax"] == ("306.00" if duplicates else "906.00")
    assert response.data["summary"]["credit"] == ("306.00" if duplicates else "606.00")
    assert read_lines and len(read_lines) == len(set(read_lines))
    assert read_numbers and len(read_numbers) == len(set(read_numbers))


@pytest.mark.parametrize("numbers,duplicate", [(("UBS/0850", "U.B.S-0850"), True),
    (("12-3", "1-23"), False), (("SS/09", "ß-09"), True)])
def test_detail_duplicate_candidates_are_narrow_without_changing_number_identity(rows, monkeypatch, numbers, duplicate):
    from billing.models import Invoice

    current = sale(rows[1], rows[2], numbers[0], date(2026, 10, 7), kind="inward")
    twin = sale(rows[1], rows[2], numbers[1], date(2026, 10, 7), kind="inward")
    for index in range(12):
        sale(rows[1], rows[2], f"UNRELATED-{index}", date(2026, 10, 7), kind="inward")
    candidates = []
    original = Invoice.from_db

    def loaded(cls, db, fields, values):
        if "invoice_number" in fields and "total_amount" not in fields:
            candidates.append(dict(zip(fields, values, strict=True))["id"])
        return original(db, fields, values)

    monkeypatch.setattr(Invoice, "from_db", classmethod(loaded))
    response = rows[0].get(f"/api/purchases/{current.pk}/")
    assert response.status_code == 200
    assert ("duplicate" in response.data["checks"]) is duplicate
    assert set(candidates) <= {current.pk, twin.pk, rows[3].pk}
    assert len(candidates) <= 3


def test_preledger_reads_have_no_credit_month_and_keep_book_figures(rows):
    bill = sale(rows[1], rows[2], "OLD-2024", date(2024, 3, 1), kind="inward")
    FiledPeriod.objects.create(business=rows[1], year=2024, month=3)
    detail = rows[0].get(f"/api/purchases/{bill.pk}/").data
    assert detail["credit"] == {"month": None, "chosen": None, "late": False, "eligible": True,
        "lapsed": False, "claimed": "0.00", "state": "outside", "filed_on": None, "deadline": "2024-11-30"}
    assert not detail["locked"]
    result = rows[0].get("/api/purchases/", {"fy": "2023-24", "facets": "1"}).data
    assert result["summary"]["bills"] == 1
    assert result["summary"]["tax"] == "300.00" and result["summary"]["credit"] == "0.00"
    assert result["facets"]["credit_months"] == []
    refused = rows[0].get("/api/purchases/", {"credit_month": "2024-03"})
    assert refused.status_code == 400
    assert refused.data == {"credit_month": ["The credit ledger starts in April 2025. Pick April 2025 or later."]}
