"""Result payload estimate: 7 bytes per row + 4 per column + UTF-8 text, not TLS traffic."""
import json
from contextlib import contextmanager
from datetime import date
from decimal import Decimal
from importlib.util import find_spec
from unittest.mock import patch

import pytest
from django.db import connection
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from billing.models import Invoice, LineItem, RateBoard
from billing.tests.test_v3_rates import QUOTED
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, firm, person


@contextmanager
def wire_bytes():
    seen = {"queries": 0, "bytes": 0, "sql": []}
    original = connection.create_cursor
    def size(value):
        if value is None:
            return 0
        if isinstance(value, (dict, list)):
            return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode())
        return len(str(value).encode())
    class Cursor:
        def __init__(self, raw):
            self.raw = raw
            self.read = False
        def __getattr__(self, name):
            return getattr(self.raw, name)
        def execute(self, sql, params=None):
            self.read = sql.lstrip().upper().startswith(("SELECT", "WITH"))
            if self.read:
                seen["queries"] += 1
                seen["sql"].append(sql)
            return self.raw.execute(sql, params)
        def count(self, row):
            if row is not None and self.read:
                seen["bytes"] += 7 + sum(4 + size(v) for v in row)
            return row
        def fetchone(self):
            return self.count(self.raw.fetchone())
        def fetchmany(self, size=None):
            rows = self.raw.fetchmany(size) if size is not None else self.raw.fetchmany()
            return [self.count(row) for row in rows]
        def fetchall(self):
            return [self.count(row) for row in self.raw.fetchall()]
        def __iter__(self):
            for row in self.raw:
                yield self.count(row)
    with patch.object(connection, "create_cursor", side_effect=lambda *a, **kw: Cursor(original(*a, **kw))):
        yield seen


@pytest.fixture
def shop(db):
    firms = [firm(name) for name in ("AARAV", "KIRAN", "MEERA")]
    customer = buyer(address="12 Street", gst_number="08AAKFS4821M1ZM", mobile_number="9000000001", pan_number="ABCDE1234F")
    flagged = buyer("Flagged", customer_type="walkin", address="", mobile_number="9000000002")
    bills = []
    for i in range(2600):
        day = date(2026, 10, 8) if i < 20 else date(2026, 4 + i % 6, 1 + i % 27)
        bills.append(Invoice(business=firms[i % 3], customer=flagged if 20 <= i < 140 else customer, payment_mode="cash" if 20 <= i < 140 else "", invoice_number=str(i + 1), invoice_date=day,
            type_of_invoice="outward" if i < 2000 else "inward", total_amount=Decimal("250000") if 20 <= i < 140 else Decimal("10300"),
            notes="unused" * 1000, firm_snapshot={"unused": "x" * 8000}))
    Invoice.objects.bulk_create(bills)
    LineItem.objects.bulk_create([LineItem(invoice=b, customer_id=b.customer_id, product_name="Silver", quantity=1, rate=5000, cgst=75,
        sgst=75, igst=0, gst_tax_rate=Decimal("0.03"), amount=5150, hsn_code="711311", unit="gms") for b in bills for _ in range(2)])
    users = {role: person("budget-" + role, *groups) for role, groups in ROLE_GROUPS.items()}
    for day in (date(2026, 10, 7), date(2026, 10, 8)):
        RateBoard.objects.create(on=day, quoted=QUOTED, set_by=users["owner"])
    return users


def request(user, path):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION="Bearer " + str(AccessToken.for_user(user)))
    with patch("billing.api.dashboard.timezone.localdate", return_value=date(2026, 10, 8)), wire_bytes() as seen:
        answer = client.get(path)
    assert answer.status_code == 200, answer.content
    return answer.json(), seen


@pytest.mark.django_db
def test_rates_budget_including_historical_date(shop):
    data, seen = request(shop["owner"], "/api/rates/?date=2026-10-06")
    assert data["in_force"] is None
    assert seen["queries"] <= 4, seen
    assert seen["bytes"] <= 4000, seen


@pytest.mark.django_db
def test_viewer_dashboard_and_operational_due_budgets(shop):
    data, seen = request(shop["viewer"], "/api/dashboard/")
    assert data["today"]["count"] == 20
    assert seen["queries"] <= 14, seen
    assert seen["bytes"] <= 40000, seen
    data, seen = request(shop["staff"], "/api/due-next/")
    assert seen["queries"] <= 10, seen
    assert seen["bytes"] <= 90000, seen
    data, seen = request(shop["owner"], "/api/due-next/")
    flags = next(row for row in data["items"] if row["kind"] == "itax")
    assert flags["count"] == 120
    assert seen["queries"] <= 24, seen
    assert seen["bytes"] <= 120000, seen
    data, seen = request(shop["viewer"], "/api/due-next/")
    assert data["items"] == []
    assert seen["queries"] <= 3, seen
    assert seen["bytes"] <= 2000, seen


@pytest.mark.django_db
@pytest.mark.skipif(find_spec("billing.services.filing") is None or find_spec("billing.services.audit") is None,
                    reason="X-40: requires 2A, 3A and 4A's shared audit mapper")
def test_full_predecessor_budgets(shop):
    for role, path, queries, size in [("owner", "/api/dashboard/", 14, 40000),
        ("owner", "/api/due-next/?returns=1", 24, 120000),
        ("staff", "/api/due-next/", 10, 90000),
        ("viewer", "/api/due-next/?returns=1", 12, 25000)]:
        data, seen = request(shop[role], path)
        if "returns=1" in path:
            assert data["returns"] is not None
        assert seen["queries"] <= queries, seen
        assert seen["bytes"] <= size, seen


@pytest.mark.django_db(transaction=True)
def test_new_reads_bypass_cacheops_and_use_ist_midnight():
    from datetime import datetime
    from datetime import timezone as utc

    from billing.tests.test_v3_cacheops import cacheops_on
    from billing.tests.v3_helpers import client_for, sale
    f, c = firm(), buyer(address="Street")
    sale(f, c, "1", date(2026, 10, 8))
    client = client_for(person("p5-cache-viewer", "viewer"))
    for minute, expected in [(29, "2026-10-07"), (30, "2026-10-08")]:
        with patch("django.utils.timezone.now", return_value=datetime(2026, 10, 7, 18, minute, tzinfo=utc.utc)), cacheops_on() as touched:
            assert client.get("/api/rates/").json()["today"] == expected
            assert client.get("/api/dashboard/").json()["today"]["date"] == expected
            assert client.get("/api/due-next/").json()["today"] == expected
        assert touched == []
