from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.conf import settings
from django.utils import timezone

from billing.models import AuditLog
from billing.tests.v3_helpers import ROLE_GROUPS, client_for, person

QUOTED = {"gold-24K": "71040.00", "gold-22K": "65125.00", "gold-18K": "53280.00",
          "silver-999": "78500.00", "silver-925": "72610.00"}


@pytest.mark.django_db
def test_board_history_audit_and_day_lookup():
    import json

    from billing.models import RateBoard
    from billing.rates import RATE_ROWS, per_gram
    assert json.loads((settings.BASE_DIR / "web/src/core/rates/rows.json").read_text()) == RATE_ROWS
    owner = person("rates-owner", *ROLE_GROUPS["owner"], first_name="Kailash")
    client = client_for(owner)
    with patch("billing.api.dashboard.timezone.localdate", return_value=date(2026, 10, 12)):
        assert client.get("/api/rates/").json()["latest"] is None
        prior = RateBoard.objects.create(on=date(2026, 10, 10), quoted=QUOTED, set_by=owner)
        a = client.post("/api/rates/", {"quoted": QUOTED, "on": "2000-01-01"}, format="json")
        b = client.post("/api/rates/", {"quoted": QUOTED}, format="json")
        assert a.status_code == b.status_code == 201
        assert a.json()["id"] != b.json()["id"]
        assert b.json()["on"] == "2026-10-12"
        assert b.json()["per_gram"]["silver-925"] == "72.610"
        row = client.get("/api/rates/?date=2026-10-11").json()
        assert row["latest"]["id"] == b.json()["id"]
        assert row["previous"]["id"] == row["in_force"]["id"] == prior.pk
        assert row["set_today"] is True
        assert client.get("/api/rates/?date=2026-10-09").json()["in_force"] is None
        assert "in_force" not in client.get("/api/rates/").json()
        event = AuditLog.objects.get(entity="rates", entity_id=b.json()["id"])
        assert (event.action, event.entity_name, event.details) == (
            "set", "Today's rates", "Gold 22K ₹65,125.00 per 10 g · Silver 999 ₹78,500.00 per kg")
        assert event.snapshot is None
        assert per_gram({"silver-999": "78.50"}, RATE_ROWS[3]) == Decimal("0.079")
        owner.delete()
        assert client_for(person("other", "viewer")).get("/api/rates/").json()["latest"]["set_by"] is None


@pytest.mark.django_db
@pytest.mark.parametrize("value,words", [(None, "Type the Gold 22K rate per 10 g."),
    ("", "Type the Gold 22K rate per 10 g."), (True, "That's not an amount."),
    ([], "That's not an amount."), ("NaN", "That's not an amount."),
    ("Infinity", "That's not an amount."), ("1.001", "That's not an amount."),
    (0, "That's not an amount."), (-1, "That's not an amount."),
    ("1e999999", "That's more than ₹99,99,999.99 per 10 g."),
    ("10000000", "That's more than ₹99,99,999.99 per 10 g.")])
def test_rate_amount_errors(value, words):
    c = client_for(person("rates-validation", "admin"))
    r = c.post("/api/rates/", {"quoted": {**QUOTED, "gold-22K": value}}, format="json")
    assert r.status_code == 400
    assert r.json() == {"quoted": {"gold-22K": [words]}}


@pytest.mark.django_db
def test_rate_permissions_validation_and_atomicity():
    from billing.models import RateBoard
    for role in ROLE_GROUPS:
        c = client_for(person("rates-" + role, *ROLE_GROUPS[role]))
        assert c.get("/api/rates/").status_code == 200
        r = c.post("/api/rates/", {"quoted": QUOTED}, format="json")
        assert r.status_code == (201 if role in {"owner", "staff"} else 403)
        if r.status_code == 403:
            assert r.json() == {"detail": "Only the owner and counter staff can set today's rates. Ask the owner if you need it.", "needs": "rates.edit"}
    for body in ({}, {"quoted": []}, []):
        assert c.post("/api/rates/", body, format="json").status_code == 403
    c = client_for(person("rate-body", "admin"))
    for body in ({}, {"quoted": []}, []):
        assert c.post("/api/rates/", body, format="json").json() == {"quoted": ["Send the rates."]}
    assert c.post("/api/rates/", {"quoted": {**QUOTED, "gold-14K": "1"}}, format="json").json() == {
        "quoted": {"gold-14K": ["The board has no row gold-14K."]}}
    for day in ("", "20261012", "2026-02-30", "9999-12-31", "x"):
        assert c.get("/api/rates/", {"date": day}).json() == {"date": ["Give the date like 2026-09-30."]}
    before = RateBoard.objects.count()
    with patch("billing.api.dashboard.AuditLog.objects.create", side_effect=RuntimeError("audit failed")), pytest.raises(RuntimeError):
        c.post("/api/rates/", {"quoted": QUOTED}, format="json")
    assert RateBoard.objects.count() == before
    assert timezone.is_aware(RateBoard.objects.first().set_at)
