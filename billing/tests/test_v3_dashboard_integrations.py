"""X-40: run these without skips once parts 2A, 3A and 4A land."""
import json
from datetime import date, datetime
from datetime import timezone as dt_timezone
from importlib.util import find_spec
from pathlib import Path
from unittest.mock import patch

import pytest

from billing.models import AuditLog, Invoice, InwardCapture
from billing.tests.v3_helpers import buyer, client_for, firm, line, person, sale

PART2 = hasattr(Invoice, "needs_review") and hasattr(InwardCapture, "discarded_at")
PART3 = find_spec("billing.services.filing") is not None
PART4 = find_spec("billing.services.audit") is not None


@pytest.mark.django_db
@pytest.mark.skipif(not PART2, reason="X-40: 2A additive fields")
def test_purchase_counts_capture_scope_and_no_double_count():
    f, g, c = firm(), firm("OTHER"), buyer()
    sale(f, c, "P1", date(2026, 9, 1), kind="inward", needs_review=True, itc_month=date(2026, 10, 1))
    sale(g, c, "P2", date(2026, 9, 1), kind="inward", needs_review=True)
    InwardCapture.objects.create(business=None, image="synthetic.png", status="new")
    InwardCapture.objects.create(business=f, image="synthetic.png", status="new")
    InwardCapture.objects.create(business=g, image="synthetic.png", status="converted")
    owner = client_for(person("p5-integration-owner", "admin"))
    with patch("billing.api.dashboard.timezone.localdate", return_value=date(2026, 10, 8)):
        for params, captured, reviews in [({}, 2, 2), ({"business_id": f.pk}, 2, 1), ({"business_id": g.pk}, 1, 1)]:
            rows = {r["kind"]: r for r in owner.get("/api/due-next/", params).json()["items"]}
            assert rows["captures"]["count"] == captured
            assert rows["review"]["count"] == reviews


@pytest.mark.django_db
@pytest.mark.skipif(not (PART2 and PART3), reason="X-40: 2A and 3A filing services")
def test_recorded_returns_past_cash_and_legacy():
    from billing.models import FiledPeriod
    f, c = firm(), buyer(address="Street")
    sale(f, c, "2", date(2026, 9, 1), line(rate="100", gst="0"))
    sale(f, c, "2", date(2026, 3, 1), line(rate="100", gst="0"))
    user = person("p5-filing-owner", "admin")
    client = client_for(user)
    staff = client_for(person("p5-filing-staff", "counter_staff", "editor"))
    with patch("django.utils.timezone.now", return_value=datetime(2026, 10, 8, 8, tzinfo=dt_timezone.utc)):
        before = staff.get("/api/due-next/", {"business_id": f.pk}).json()["items"]
        assert next(row for row in before if row["kind"] == "gaps")["count"] == 1
        for month, filed_on, cash in [("2026-09", "2026-10-07", "17.00"), ("2026-03", "2026-04-18", "23.00")]:
            response = client.post("/api/gst/filings/", {"business": f.pk, "month": month, "kind": "both",
                "filed_on": filed_on, "gstr1_filed_on": filed_on, "arn": "", "gstr1_arn": "", "cash_total": cash,
                "confirm_checks": True}, format="json")
            assert response.status_code == 201, response.content
        data = client.get("/api/due-next/", {"business_id": f.pk, "returns": "1"}).json()
        row = data["returns"]["firms"][0]
        assert row["stage"] == "filed"
        assert row["gstr3b"]["cash_paid"] == "17.00"
        assert not {"pay_3b", "file_gstr1", "gaps"} & {r["kind"] for r in data["items"]}
        viewer = client_for(person("p5-filing-viewer", "viewer"))
        past = viewer.get("/api/dashboard/", {"business_id": f.pk, "fy": "2025-26"}).json()["returns_year"][0]
        assert past["cash_paid"] == "23.00"
        assert past["months_filed"] == 1
        old = firm("LEGACY")
        FiledPeriod.objects.create(business=old, year=2026, month=9)
        legacy = viewer.get("/api/due-next/", {"business_id": old.pk, "returns": "1"}).json()["returns"]["firms"][0]
        assert legacy["stage"] == "filed"
        assert legacy["gstr1"] is None and legacy["gstr3b"] is None
        # Unlocking reopens edits; it does not erase the filing record or invent paper gaps for staff.
        response = client.post("/api/gst/months/unlock/", {"business": f.pk, "month": "2026-09", "reason": "Correct a bill"}, format="json")
        assert response.status_code == 200, response.content
        for actor in (client, staff):
            items = actor.get("/api/due-next/", {"business_id": f.pk}).json()["items"]
            assert "gaps" not in {row["kind"] for row in items}


@pytest.mark.django_db
@pytest.mark.skipif(not PART4, reason="X-40: corrected 4A/4E shared audit mapping")
def test_audit_fixture_words_shop_scope_and_narrow_details():
    from billing.services.audit import entry_row, read_entries
    from billing.services.dashboard import latest_changes
    raw = json.loads((Path(__file__).parent / "fixtures/rates_set.json").read_text())
    expected = raw.pop("expected")
    event = AuditLog.objects.create(**raw)
    mapped = entry_row(read_entries().get(pk=event.pk), actions=False)
    assert {k: mapped[k] for k in expected} == expected
    for i in range(4):
        AuditLog.objects.create(action="created", entity="customer", entity_id=i, entity_name="Buyer", details="x" * 10000)
    for action, entity in [("printed", "invoice"), ("exported", "report"), ("downloaded", "gst_file"), ("created", "backup")]:
        AuditLog.objects.create(action=action, entity=entity, entity_id=1, entity_name="Read")
    rows = latest_changes()
    assert len(rows) == 4
    assert all(row["details"] == "x" * 160 for row in rows)


@pytest.mark.django_db
@pytest.mark.skipif(find_spec("billing.services.catalog") is None, reason="X-40: 4A product kind inference")
def test_rate_key_uses_catalog_inference_without_reading_a_later_board():
    from billing.models import Product, RateBoard
    from billing.rates import rate_for, rate_key
    from billing.tests.test_v3_rates import QUOTED
    product = Product.objects.create(name="Gold 22K", hsn_code="711319", kind="gold", purity="22K")
    assert rate_key(product) == "gold-22K"
    RateBoard.objects.create(on=date(2026, 10, 8), quoted=QUOTED)
    assert rate_for(product, date(2026, 10, 7)) is None
    assert str(rate_for(product, date(2026, 10, 8))) == "6512.500"
