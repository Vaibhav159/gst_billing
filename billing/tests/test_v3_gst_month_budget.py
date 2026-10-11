"""P3-7 HTTP budgets; only the unavailable part-2 ledger boundary is replaced.

The real builder, checks, snapshots, amendments, auth and response serialization
run over 300 sales per firm. Fetched bytes count UTF-8 JSON of database values,
not SQL text or protocol overhead. Ledger's grouped scan has a separate 2A gate.
"""

import json
from collections import Counter
from contextlib import ExitStack, contextmanager
from datetime import date
from unittest.mock import patch

import pytest
from django.db import connection
from django.db.backends.utils import CursorWrapper
from django.test.utils import CaptureQueriesContext

from billing.models import FilingRecord, Invoice, LineItem
from billing.roles import group_names
from billing.services.gstr1_file import build_gstr1
from billing.tests.v3_helpers import buyer, client_for, firm, person, sale

pytestmark = pytest.mark.django_db
TODAY = date(2026, 10, 11)
ZERO = {"igst": "0.00", "cgst": "0.00", "sgst": "0.00", "total": "0.00"}
POSITION = {**dict.fromkeys(("output", "credit", "carry_in", "cash", "carry_on", "used"), ZERO),
            "amendments_in": [], "filed": None}
TABLES = {"late": None, "t4a5": {"late": []}, "to_confirm": [], "opening_missing": False}


@contextmanager
def fetched_bytes():
    total = {"bytes": 0}
    original = CursorWrapper.__getattr__

    def measured(cursor, name):
        method = original(cursor, name)
        if name not in ("fetchone", "fetchmany", "fetchall"):
            return method

        def fetch(*args, **kwargs):
            rows = method(*args, **kwargs)
            total["bytes"] += len(json.dumps(rows, default=str, ensure_ascii=False, separators=(",", ":")).encode())
            return rows
        return fetch

    with patch.object(CursorWrapper, "__getattr__", measured):
        yield total


def fixtures(firms):
    businesses = []
    customer = buyer(customer_type="walkin")
    for n in range(firms):
        business = firm(f"BUDGET FIRM {n}", invoice_prefix=f"F{n}")
        bills = Invoice.objects.bulk_create([
            Invoice(business=business, customer=customer, invoice_number=f"F{n}/2026-27/{i + 1}",
                    invoice_date=date(2026, 9, 2), type_of_invoice="outward", status="active", total_amount="1030.00")
            for i in range(300)])
        LineItem.objects.bulk_create([
            LineItem(invoice=bill, customer=customer, product_name="Gold", hsn_code="711311", quantity="1", rate="1000",
                     gst_tax_rate="0.03", cgst="15", sgst="15", igst="0", amount="1030", unit="gms") for bill in bills])
        original = build_gstr1(business, 2026, 9, amendments=False)
        FilingRecord.objects.create(business=business, year=2026, month=9, kind="gstr1", filed_on=date(2026, 10, 8),
                                    figures={**original["figures"], "unused_blob": "x" * 250000},
                                    bills=original["bills"], file={"unused_blob": "y" * 250000})
        # Exactly one correction; checks and amendment planning must share its build.
        Invoice.objects.filter(pk=bills[0].pk).update(total_amount="2060")
        LineItem.objects.filter(invoice=bills[0]).update(quantity="2", cgst="30", sgst="30")
        businesses.append(business)
    user = person("budget-owner", "admin")
    group_names(user)
    return businesses, client_for(user)


@pytest.mark.parametrize("firms,route,query_budget,transfer_budget,response_budget", [
    (1, "month", 24, 500000, 20000),
    (3, "month-end", 70, 1500000, 60000),
])
@pytest.mark.parametrize("integrated", [False, True])
def test_month_requests_build_each_firm_once_with_bounded_reads(firms, route, query_budget, transfer_budget, response_budget, integrated):
    if integrated and not {"itc_month", "itc_eligible", "needs_review"} <= {field.name for field in Invoice._meta.fields}:
        pytest.skip("X-40 integration gate: real ledger runs after part 2A's purchase fields land.")
    businesses, client = fixtures(firms)
    params = {"month": "2026-09", "business_id": businesses[0].pk}
    with ExitStack() as stack, patch("django.utils.timezone.localdate", return_value=TODAY), \
            patch("billing.services.gstr1_file.build_gstr1", wraps=build_gstr1) as build, \
            patch("billing.services.gst_checks.build_gstr1", wraps=build_gstr1) as check_build, \
            CaptureQueriesContext(connection) as queries, fetched_bytes() as transferred:
        if not integrated:
            stack.enter_context(patch("billing.services.ledger.month_position", return_value=POSITION))
            stack.enter_context(patch("billing.services.ledger.gstr3b_tables", return_value=TABLES))
        response = client.get(f"/api/gst/{route}/", params)
    assert response.status_code == 200, response.content
    calls = Counter((call.args[0].pk, call.args[1], call.args[2]) for call in [*build.call_args_list, *check_build.call_args_list])
    assert calls == Counter({(business.pk, 2026, 9): 1 for business in businesses}), calls
    # Real ledger: at most 16 additional queries and 50 KB per firm, independent
    # of bill count; grouped scans transfer months/heads, not historical lines.
    assert len(queries) <= query_budget + (16 * firms if integrated else 0), (len(queries), [query["sql"] for query in queries])
    assert transferred["bytes"] <= transfer_budget + (50000 * firms if integrated else 0), transferred
    assert len(response.content) <= response_budget, len(response.content)
    assert b"unused_blob" not in response.content
    sql = "\n".join(query["sql"] for query in queries)
    assert '"billing_filingrecord"."file"' not in sql
    payload = response.json()
    if route == "month":
        assert payload["since_filing"]["bills_diff"] == 1
        assert payload["amendments"]["rows"] == 1
        assert payload["gstr1"]["taxable"] == "301000.00"
    else:
        assert len(payload["firms"]) == 3
        assert all(item["stage"] == "gstr1" for item in payload["firms"])
    print(f"{route} integrated={integrated}: {len(queries)} queries, {transferred['bytes']} fetched-value bytes, {len(response.content)} response bytes")


@pytest.mark.parametrize("route", ["month", "month-end"])
def test_pending_correction_builds_its_source_once_and_reuses_it_for_b2cs(route):
    businesses, client = fixtures(1)
    business = businesses[0]
    FilingRecord.objects.all().delete()
    prior = sale(business, buyer("Earlier buyer", customer_type="walkin"), "EARLIER-1", date(2026, 8, 2))
    original = build_gstr1(business, 2026, 8, amendments=False)
    FilingRecord.objects.create(business=business, year=2026, month=8, kind="gstr1", filed_on=date(2026, 9, 8),
                               bills=original["bills"], figures=original["figures"], file=original["file"])
    FilingRecord.objects.create(business=business, year=2026, month=8, kind="gstr3b", filed_on=date(2026, 9, 19))
    LineItem.objects.filter(invoice=prior).update(quantity="2", cgst="300", sgst="300")
    Invoice.objects.filter(pk=prior.pk).update(total_amount="20600")
    with patch("django.utils.timezone.localdate", return_value=TODAY), \
            patch("billing.services.ledger.month_position", return_value=POSITION), \
            patch("billing.services.ledger.gstr3b_tables", return_value=TABLES), \
            patch("billing.services.gstr1_file.build_gstr1", wraps=build_gstr1) as build, \
            patch("billing.services.gst_checks.build_gstr1", wraps=build_gstr1) as check_build, \
            CaptureQueriesContext(connection) as queries, fetched_bytes() as transferred:
        response = client.get(f"/api/gst/{route}/", {"month": "2026-09", "business_id": business.pk})
    assert response.status_code == 200, response.content
    calls = Counter((call.args[1], call.args[2]) for call in [*build.call_args_list, *check_build.call_args_list])
    assert calls == Counter({(2026, 9): 1, (2026, 8): 1}), calls
    assert len(queries) <= 30, len(queries)
    assert transferred["bytes"] <= 300000, transferred
    assert len(response.content) <= 20000
    if route == "month":
        assert response.json()["gstr1"]["file"]["amendments"] == 1
    print(f"{route} history: {len(queries)} queries, {transferred['bytes']} fetched-value bytes, {len(response.content)} response bytes")
