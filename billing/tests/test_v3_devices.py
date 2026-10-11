import pytest
from rest_framework.test import APIClient

from billing.models import AuditLog, SignInSession
from billing.services.accounts import security_for
from billing.tests.test_v3_sessions import login
from billing.tests.v3_helpers import person

pytestmark = pytest.mark.django_db


def test_devices_are_private_current_first_and_revoked_immediately():
    user = person("maya", "admin")
    first, _ = login(user)
    second, tokens = login(user)
    outsider = person("outsider")
    foreign = SignInSession.objects.create(user=outsider, device="Safari on Mac")
    rows = first.get("/api/account/sessions/").data["results"]
    assert len(rows) == 2 and rows[0]["current"]
    assert first.post(f"/api/account/sessions/{rows[0]['id']}/sign-out/").status_code == 400
    assert first.post(f"/api/account/sessions/{foreign.pk}/sign-out/").status_code == 404
    response = first.post(f"/api/account/sessions/{rows[1]['id']}/sign-out/")
    assert response.status_code == 204
    assert second.get("/api/me/").status_code == 401
    assert APIClient().post("/api/token/refresh/", {"refresh": tokens["refresh"]}).status_code == 401


def test_sign_out_others_then_current_blacklists_refresh():
    user = person("maya", "admin")
    first, tokens = login(user)
    second, _ = login(user)
    assert first.post("/api/account/sessions/sign-out-others/").data == {"signed_out": 1}
    assert second.get("/api/me/").status_code == 401
    assert first.post("/api/auth/sign-out/", {"refresh": tokens["refresh"]}).status_code == 204
    assert first.get("/api/me/").status_code == 401
    refused = APIClient().post("/api/token/refresh/", {"refresh": tokens["refresh"]})
    assert refused.status_code == 401 and refused.data["code"] == "signed_out"
    assert AuditLog.objects.filter(action="signedout", entity="session").count() == 2


def test_own_password_reissues_same_session_and_revokes_every_old_token():
    user = person("maya", "admin")
    first, tokens = login(user)
    second, _ = login(user)
    sid = first.get("/api/me/").data["session_id"]
    security = security_for(user)
    security.must_change_password = True
    security.save()
    assert first.get("/api/account/sessions/").status_code == 403
    assert first.post("/api/account/password/", {"current": "wrong", "password": "Harbour873!"}).status_code == 400
    response = first.post("/api/account/password/", {"current": "Forest927!", "password": "Harbour873!"})
    assert response.status_code == 200
    assert response.data["detail"] == "Password changed. Your other devices are signed out."
    assert first.get("/api/me/").status_code == 401
    first.credentials(HTTP_AUTHORIZATION="Bearer " + response.data["access"])
    assert first.get("/api/me/").data["session_id"] == sid
    assert first.get("/api/me/").data["must_change_password"] is False
    assert second.get("/api/me/").status_code == 401
    refused = APIClient().post("/api/token/refresh/", {"refresh": tokens["refresh"]})
    assert refused.status_code == 401 and refused.data["code"] == "signed_out"
    assert AuditLog.objects.filter(action="password").get().details == "Changed by themself · other devices signed out"


@pytest.mark.parametrize("body", [[], None, {"current": []}, {"current": "Forest927!", "password": {}}])
def test_password_odd_body_is_400(body):
    user = person("maya", "admin")
    client, _ = login(user)
    assert client.post("/api/account/password/", body, format="json").status_code == 400


@pytest.mark.parametrize("refresh", [0, False, [], {}])
def test_odd_refresh_does_not_sign_out(refresh):
    user = person("maya", "admin")
    client, _ = login(user)
    assert client.post("/api/auth/sign-out/", {"refresh": refresh}, format="json").status_code == 400
    assert client.get("/api/me/").status_code == 200


@pytest.mark.parametrize("mode", ["one", "others", "current", "zero", "legacy", "legacy_with_sessions"])
def test_session_audit_keeps_user_id_and_only_the_affected_session_uuids(mode):
    from django.utils import timezone
    from rest_framework_simplejwt.tokens import RefreshToken

    user = person("maya", "admin")
    secrets = []
    if mode.startswith("legacy"):
        refresh = RefreshToken.for_user(user)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION="Bearer " + str(refresh.access_token))
        tokens = {"access": str(refresh.access_token), "refresh": str(refresh)}
        current = None
    else:
        client, tokens = login(user)
        current = client.get("/api/me/").data["session_id"]
    secrets.extend(tokens.values())
    others = []
    if mode in {"one", "others", "legacy_with_sessions"}:
        for _ in range(2):
            other, pair = login(user)
            others.append(other.get("/api/me/").data["session_id"])
            secrets.extend(pair.values())
    ended_before = SignInSession.objects.create(user=user, device="Ended device", signed_out_at=timezone.now())
    foreign = SignInSession.objects.create(user=person("someone_else"), device="Foreign device")
    if mode == "one":
        SignInSession.objects.filter(pk=others[0]).update(device="Safari on Mac")
        response = client.post(f"/api/account/sessions/{others[0]}/sign-out/")
        expected = f"Signed out on Safari on Mac · session {others[0]}"
        affected = [others[0]]
    elif mode in {"others", "zero"}:
        response = client.post("/api/account/sessions/sign-out-others/")
        assert response.data == {"signed_out": len(others)}
        suffix = "sessions " + ", ".join(sorted(others)) if others else f"from session {current}"
        expected = f"Signed out on {len(others)} other devices · {suffix}"
        affected = others
    else:
        response = client.post("/api/auth/sign-out/", {"refresh": tokens["refresh"]})
        if current:
            expected = f"Signed out on Chrome on Windows · session {current}"
            affected = [current]
        elif others:
            expected = "Signed out on this device · sessions " + ", ".join(sorted(others))
            affected = others
        else:
            expected = "Signed out on this device · legacy sign-in (no session)"
            affected = []
    assert response.status_code in {200, 204}
    entry = AuditLog.objects.get(entity="session", action="signedout")
    assert entry.entity_id == user.pk and isinstance(entry.entity_id, int)
    assert entry.entity_name == "maya"
    assert entry.details == expected
    # X-27 producer fixture: 4E feeds this row shape through its one shared audit mapper.
    fixture = {"action": "signedout", "entity": "session", "entity_id": user.pk,
               "entity_name": "maya", "details": expected, "changes": None, "snapshot": None}
    serialized = AuditLog.objects.filter(pk=entry.pk).values(*fixture).get()
    assert serialized == fixture
    assert str(ended_before.pk) not in entry.details and str(foreign.pk) not in entry.details
    assert all(secret not in entry.details for secret in [*secrets, "Forest927!"])
    assert SignInSession.objects.filter(pk__in=affected, signed_out_at__isnull=True).count() == 0
    if mode in {"one", "others", "zero"}:
        assert SignInSession.objects.get(pk=current).signed_out_at is None
