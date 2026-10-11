"""P2-8: aggregate books in SQL and keep database transfer within a shop-sized budget."""
from contextlib import contextmanager
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.db.backends.utils import CursorWrapper
from django.utils import timezone

from billing.api.inward_bills_service import inward_number_key
from billing.models import Invoice, LineItem
from billing.services.purchase_reads import purchase_facets, purchase_queryset, purchase_summary, search
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person, sale

pytestmark = pytest.mark.django_db


@contextmanager
def transfer_budget():
    """Count fetched rows and UTF-8 scalar payload bytes (excludes protocol framing)."""
    measured = {"rows": 0, "bytes": 0}
    original = CursorWrapper.__getattr__

    def wrapped(cursor, name):
        method = original(cursor, name)
        if name not in {"fetchone", "fetchmany", "fetchall"}:
            return method

        def fetch(*args, **kwargs):
            result = method(*args, **kwargs)
            rows = ([result] if result is not None else []) if name == "fetchone" else result
            measured["rows"] += len(rows)
            measured["bytes"] += sum(len(str(value).encode("utf-8")) for row in rows for value in row)
            return result
        return fetch

    with patch.object(CursorWrapper, "__getattr__", wrapped):
        yield measured


@pytest.fixture
def shop(monkeypatch):
    monkeypatch.setattr(timezone, "localdate", lambda *a, **k: date(2026, 10, 8))
    business, supplier = firm(), buyer("Bullion supplier", gst_number="08AACFU5521R1ZN")
    return business, supplier


def test_sql_totals_round_each_stored_head_before_adding_and_count_bills_once(shop):
    business, supplier = shop
    bill = sale(business, supplier, "HALF-1", date(2026, 10, 1), kind="inward")
    LineItem.objects.filter(invoice=bill).delete()
    LineItem.objects.bulk_create([LineItem(invoice=bill, customer=supplier, product_name="Old silver", hsn_code="7106",
        quantity=Decimal("0.025"), rate=Decimal("1"), cgst=Decimal("0.025"), sgst=Decimal("0.025"),
        igst=Decimal("0.025"), amount=Decimal("0.100"), gst_tax_rate=Decimal("0.03"), unit="gms") for _ in range(2)])
    Invoice.objects.filter(pk=bill.pk).update(total_amount=Decimal("0.200"))
    summary = purchase_summary(purchase_queryset())
    assert summary == {"bills": 1, "taxable": "0.06", "cgst": "0.06", "sgst": "0.06", "igst": "0.06",
                       "tax": "0.18", "total_amount": "0.20", "credit": "0.18"}
    facets = purchase_facets(purchase_queryset(), {"fy": "2026-27"})
    assert facets["credit_months"] == [{"month": "2026-10", "bills": 1, "credit": "0.18"}]


@pytest.mark.parametrize("value,paise", [("0.015", "0.02"), ("1.005", "1.01")])
def test_sql_line_rounding_is_half_up_on_every_database(shop, value, paise):
    business, supplier = shop
    bill = sale(business, supplier, "HALF-2", date(2026, 10, 1), kind="inward")
    LineItem.objects.filter(invoice=bill).delete()
    LineItem.objects.create(invoice=bill, customer=supplier, product_name="Old silver", hsn_code="7106",
        quantity=Decimal(value), rate=Decimal("1"), cgst=Decimal(value), sgst=Decimal(value), igst=Decimal("0"),
        amount=Decimal(value), gst_tax_rate=Decimal("0.03"), unit="gms")
    summary = purchase_summary(purchase_queryset())
    tax = str(Decimal(paise) * 2)
    assert (summary["taxable"], summary["cgst"], summary["sgst"], summary["tax"], summary["credit"]) == (
        paise, paise, paise, tax, tax)


def test_summary_credit_follows_filtered_bills_even_when_their_claim_is_in_next_fy(shop):
    business, supplier = shop
    bill = sale(business, supplier, "MARCH-1", date(2026, 3, 31), kind="inward", itc_month=date(2026, 4, 1))
    summary = purchase_summary(purchase_queryset().filter(pk=bill.pk))
    assert summary["credit"] == "300.00"
    old_facets = purchase_facets(purchase_queryset(), {"fy": "2025-26"})
    assert old_facets["credit_months"] == []
    new_facets = purchase_facets(purchase_queryset(), {"fy": "2026-27"})
    assert new_facets["credit_months"] == [{"month": "2026-04", "bills": 1, "credit": "300.00"}]


@pytest.mark.parametrize("query,number,expected", [
    ("UBS-0850", "U.B.S/0850", True), ("12-3", "1-23", False), ("12-3", "A12 / 3", True),
    ("123", "1-23", False), ("123", "A123Z", True), ("SS-09", "ß/09", True),
    ("SI", "sı", True), ("J-21", "ǰ/21", True), ("FFI", "ﬃ", True), ("S", "ß", True),
])
def test_normalized_search_stays_exact_without_reading_candidate_ids(shop, query, number, expected):
    bill = sale(*shop, number, date(2026, 10, 1), kind="inward")
    assert search(purchase_queryset(), query).filter(pk=bill.pk).exists() is expected


def test_sql_number_key_matches_shared_identity_on_unicode_and_separator_edges(shop):
    from billing.services.purchase_reads import NumberKey

    numbers = [f"1{char}2" for char in "ßıŉſǰẖẗẘẙẚﬀﬁﬂﬃﬄﬅﬆ"] + [
        "12-3", "1-23", "1 / 2", "#1#2#", "U.B.S/0850", "é#1#é2", "ẞ/09", " i / 1", "1\x012", "a\u03011",
        "१-2", "1-१", "१-२", "١-٢", "१११", "1١٢3", "𝟙-2", "²-3", "1\x01२"]
    # Exercise every Python Nd boundary so a Unicode-table upgrade exposes any SQL drift.
    numbers += [value for point in range(0x110000) if (digit := chr(point)).isdecimal()
                for value in (f"{digit}-2", f"1-{digit}", digit * 3)]
    numbers = list(dict.fromkeys(numbers))
    bills = Invoice.objects.bulk_create([Invoice(business=shop[0], customer=shop[1], invoice_number=number,
        invoice_date=date(2026, 10, 1), type_of_invoice="inward", total_amount=0) for number in numbers])
    found = dict(Invoice.objects.purchases().filter(pk__in=[bill.pk for bill in bills]).annotate(key=NumberKey("invoice_number"))
                 .values_list("invoice_number", "key"))
    assert found == {number: inward_number_key(number) for number in numbers}


@pytest.fixture
def large_shop(shop):
    business, supplier = shop
    bills = Invoice.objects.bulk_create([Invoice(business=business, customer=supplier,
        invoice_number=f"SUP/{i:05d}" if i < 1999 else "SUP-00001", invoice_date=date(2026, 10, 1),
        type_of_invoice="inward", total_amount=Decimal("206.00")) for i in range(2000)])
    LineItem.objects.bulk_create([LineItem(invoice=bill, customer=supplier, product_name="Precious silver " + "x" * 230,
        hsn_code="7106", quantity=1, rate=100, cgst=Decimal("1.50"), sgst=Decimal("1.50"), igst=0,
        gst_tax_rate=Decimal("0.03"), amount=103, unit="gms") for bill in bills for _ in range(2)])
    return client_for(person("budget-reader", *ROLE_GROUPS["viewer"]))


@pytest.mark.parametrize("extra", [{}, {"q": "SUP-"}, {"q": "Precious"}, {"dups": "1"}])
def test_2000_bill_list_summary_facets_and_search_have_a_row_and_byte_budget(large_shop, extra, record_property):
    with transfer_budget() as measured:
        result = large_shop.get("/api/purchases/", {"fy": "2026-27", "facets": "1", **extra})
    assert result.status_code == 200, result.data
    assert result.data["facets"]["checks"]["duplicate"] == 2
    assert result.data["summary"]["bills"] == (2 if extra.get("dups") else 2000)
    assert result.data["summary"]["credit"] == ("12.00" if extra.get("dups") else "12000.00")
    # The one remaining identity scan transfers 2,000 narrow headers, never the 4,000 FY lines.
    # A page adds at most 40 headers and 80 lines; aggregates add only counts/month buckets.
    record_property("database_rows", measured["rows"])
    record_property("scalar_utf8_bytes", measured["bytes"])
    assert measured["rows"] <= 2200, measured
    assert measured["bytes"] <= 210_000, measured


def test_summary_transfers_only_two_aggregate_rows_for_2000_bills(large_shop, record_property):
    with transfer_budget() as measured:
        summary = purchase_summary(purchase_queryset())
    assert summary["bills"] == 2000
    assert summary["total_amount"] == "412000.00" and summary["credit"] == "12000.00"
    record_property("database_rows", measured["rows"])
    record_property("scalar_utf8_bytes", measured["bytes"])
    assert measured["rows"] == 2 and measured["bytes"] < 250, measured


def test_sql_credit_handles_ineligible_lapsed_preledger_empty_and_negative_bills(shop):
    business, supplier = shop
    good = sale(business, supplier, "GOOD", date(2026, 10, 1), kind="inward")
    sale(business, supplier, "INELIGIBLE", date(2026, 10, 1), kind="inward", itc_eligible=False)
    sale(business, supplier, "BEFORE", date(2024, 3, 1), kind="inward")
    sale(business, supplier, "LAPSED", date(2025, 4, 1), kind="inward", itc_month=date(2026, 11, 1))
    empty = sale(business, supplier, "EMPTY", date(2026, 10, 1), kind="inward")
    LineItem.objects.filter(invoice=empty).delete()
    Invoice.objects.filter(pk=empty.pk).update(total_amount=0)
    negative = sale(business, supplier, "NEGATIVE", date(2025, 4, 1), kind="inward", itc_month=date(2026, 11, 1))
    LineItem.objects.filter(invoice=negative).update(cgst=Decimal("-0.025"), sgst=0, igst=0)
    summary = purchase_summary(purchase_queryset())
    assert summary["bills"] == 6 and summary["credit"] == "299.97"
    assert purchase_summary(purchase_queryset().filter(pk=good.pk))["credit"] == "300.00"
    facets = purchase_facets(purchase_queryset(), {"fy": "2026-27"})
    assert facets["credit_months"] == [
        {"month": "2026-10", "bills": 3, "credit": "300.00"},
        {"month": "2026-11", "bills": 2, "credit": "-0.03"},
    ]
    assert facets["checks"]["no_lines"] == 1
