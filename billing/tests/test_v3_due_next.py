from datetime import date
from unittest.mock import patch
from uuid import uuid4

import pytest

from billing.models import SaleDraft, SavedDraft
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person, sale


@pytest.mark.django_db
def test_operational_items_scope_role_and_paper_send_rules():
    f, other, c = firm(), firm("PARAS JEWELS"), buyer(mobile_number="919829041122", address="street")
    sale(f, c, "2", date(2026, 9, 30))
    sale(f, c, "3", date(2026, 10, 8))
    sale(f, c, "4", date(2026, 10, 8), paper=True)
    sale(f, buyer("Bad mobile", mobile_number="123"), "5", date(2026, 10, 8))
    draft = SaleDraft.objects.create(id=uuid4(), business=f, data={})
    SaleDraft.objects.create(id=uuid4(), business=None, data={})
    consumed = SaleDraft.objects.create(id=uuid4(), business=f, data={})
    SavedDraft.objects.create(id=consumed.pk, invoice_number="done")
    staff = client_for(person("due-staff", *ROLE_GROUPS["staff"]))
    with patch("billing.api.dashboard.timezone.localdate", return_value=date(2026, 10, 8)):
        r = staff.get("/api/due-next/", {"business_id": f.pk})
        assert r.status_code == 200
        data = r.json()
        by_kind = {r["kind"]: r for r in data["items"]}
        assert list(by_kind) == ["gaps", "unsent", "drafts"]
        assert by_kind["gaps"]["count"] == 1
        assert by_kind["gaps"]["title"] == "Kiran's September skips number 1"
        assert by_kind["unsent"]["count"] == 1
        assert by_kind["unsent"]["title"] == "1 of today's bills hasn't been sent"
        assert by_kind["drafts"]["draft_id"] == str(draft.pk)
        assert by_kind["drafts"]["count"] == 1
        assert staff.get("/api/due-next/", {"business_id": other.pk}).json()["items"] == []
        assert staff.get("/api/due-next/?returns=x").json() == {"returns": ["Choose 0 or 1 for returns."]}
        viewer = client_for(person("due-viewer", "viewer"))
        with patch("billing.services.due.operational_items", side_effect=AssertionError("viewer did item work")):
            assert viewer.get("/api/due-next/").json()["items"] == []


@pytest.mark.django_db
@pytest.mark.parametrize("role,expected", [("owner", {"gaps", "itax", "unsent", "drafts"}),
    ("accountant", {"itax"}), ("staff", {"gaps", "unsent", "drafts"}), ("viewer", set())])
def test_operational_kind_roles_long_details_and_forbidden_itax_work(role, expected):
    from billing.services.due import operational_items
    from billing.tests.v3_helpers import line
    f, c = firm(), buyer(mobile_number="9000000001", address="", customer_type="walkin")
    sale(f, c, "6", date(2026, 9, 30))
    for number in range(7, 13):
        sale(f, c, str(number), date(2026, 10, 8), line(rate="250000", gst="0"), payment_mode="cash")
    SaleDraft.objects.create(id=uuid4(), business=f, data={})
    actor = person("kind-" + role, *ROLE_GROUPS[role])
    from billing.services.bill_reads import itax_summary
    with patch("billing.services.due.itax_summary", wraps=itax_summary) as flags:
        rows = {r["kind"]: r for r in operational_items(actor, [f], f.pk, date(2026, 10, 8), {(f.pk, "2026-09"): "ready"})}
    assert set(rows) == expected
    assert flags.call_count == (1 if role in {"owner", "accountant"} else 0)
    if "gaps" in rows:
        assert rows["gaps"]["title"] == "Kiran's September skips 5 numbers (1, 2, 3, 4…)"
        assert rows["unsent"]["count"] == 6
        assert rows["unsent"]["detail"].endswith("and 1 more")
        assert rows["drafts"]["title"] == "1 unfinished bill"
    if "itax" in rows:
        assert rows["itax"]["count"] == 6
        assert "6 cash bills" in rows["itax"]["detail"]
