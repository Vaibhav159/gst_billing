from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from billing.models import SignInSession
from billing.services.accounts import revoke_all, security_for
from billing.tests.v3_helpers import person

pytestmark = pytest.mark.django_db


def login(user, remember=True):
    user.set_password("Forest927!")
    user.save(update_fields=["password"])
    client = APIClient()
    response = client.post("/api/token/", {"username": user.username, "password": "Forest927!", "remember": remember}, format="json", HTTP_USER_AGENT="Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537")
    assert response.status_code == 200
    client.credentials(HTTP_AUTHORIZATION="Bearer " + response.data["access"])
    return client, response.data


def test_login_session_claim_refresh_and_device():
    user = person("maya", "admin")
    client, tokens = login(user, False)
    session = SignInSession.objects.get(user=user)
    assert session.device == "Chrome on Windows" and not session.remember
    assert RefreshToken(tokens["refresh"])["sid"] == str(session.pk)
    assert client.get("/api/me/").data["session_id"] == str(session.pk)
    assert client.get("/api/me/").data["must_change_password"] is False
    response = APIClient().post("/api/token/refresh/", {"refresh": tokens["refresh"]})
    assert response.status_code == 200
    assert RefreshToken(response.data["refresh"])["sid"] == str(session.pk)


def test_ended_or_revoked_tokens_stop_access_and_refresh():
    user = person("maya", "admin")
    client, tokens = login(user)
    revoke_all(user)
    for response in [client.get("/api/me/"), APIClient().post("/api/token/refresh/", {"refresh": tokens["refresh"]})]:
        assert response.status_code == 401
        assert response.data == {"detail": "You were signed out on this device. Sign in again.", "code": "signed_out"}


def test_token_verify_refuses_signed_out_or_revoked_tokens():
    user = person("maya", "admin")
    client, tokens = login(user)
    verify = APIClient()
    assert verify.post("/api/token/verify/", {"token": tokens["access"]}).status_code == 200
    assert verify.post("/api/token/verify/", {"token": "not-a-token"}).status_code == 401
    assert client.post("/api/auth/sign-out/", {"refresh": tokens["refresh"]}).status_code == 204
    response = verify.post("/api/token/verify/", {"token": tokens["access"]})
    assert response.status_code == 401 and response.data["code"] == "signed_out"
    _, fresh = login(user)
    revoke_all(user)
    assert verify.post("/api/token/verify/", {"token": fresh["access"]}).status_code == 401


def test_sidless_token_works_until_revoked():
    user = person("maya", "admin")
    token = RefreshToken.for_user(user)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION="Bearer " + str(token.access_token))
    assert client.get("/api/me/").status_code == 200
    revoke_all(user)
    assert client.get("/api/me/").status_code == 401


def test_stopped_account_only_explained_after_right_password():
    user = person("maya", "admin")
    login(user)
    user.is_active = False
    user.save(update_fields=["is_active"])
    good = APIClient().post("/api/token/", {"username": "maya", "password": "Forest927!"})
    bad = APIClient().post("/api/token/", {"username": "maya", "password": "wrong"})
    assert good.status_code == 401 and good.data["code"] == "stopped"
    assert good.data["detail"] == "The owner has stopped @maya signing in. Ask the owner."
    assert bad.status_code == 401 and bad.data.get("code") != "stopped"


def test_password_gate_skips_v2_and_me_preferences():
    user = person("maya", "counter_staff", "editor")
    client, _ = login(user)
    security = security_for(user)
    security.must_change_password = True
    security.save()
    response = client.get("/api/sales/")
    assert response.status_code == 403 and response.data["code"] == "password_change_needed"
    assert client.get("/api/products/").status_code == 200
    assert client.get("/api/me/").status_code == 200
    assert client.get("/api/preferences/").status_code == 200


def test_last_used_is_written_only_after_fifteen_minutes():
    user = person("maya", "admin")
    client, _ = login(user)
    session = SignInSession.objects.get(user=user)
    initial = session.last_used_at
    client.get("/api/me/")
    session.refresh_from_db()
    assert session.last_used_at == initial
    SignInSession.objects.filter(pk=session.pk).update(last_used_at=timezone.now() - timedelta(minutes=16))
    client.get("/api/me/")
    session.refresh_from_db()
    assert session.last_used_at > initial


def test_authentication_reads_only_user_security_and_current_device(django_assert_num_queries):
    from rest_framework_simplejwt.tokens import AccessToken

    from billing.api.auth import SessionJWTAuthentication
    user = person("maya", "admin")
    user.email = "maya@example.com"
    user.is_staff = True
    user.save(update_fields=["email", "is_staff"])
    _, tokens = login(user)
    with django_assert_num_queries(1):
        authenticated = SessionJWTAuthentication().get_user(AccessToken(tokens["access"]))
        assert authenticated.email == "maya@example.com"
        assert authenticated.is_staff
    assert authenticated.pk == user.pk


def test_old_sessions_and_codes_cleaned_only_on_sign_in():
    from billing.models import PasswordResetCode
    user = person("maya", "admin")
    before = timezone.now() - timedelta(days=91)
    old = SignInSession.objects.create(user=user, device="Browser on Unknown system", signed_out_at=before)
    PasswordResetCode.objects.create(user=user, code_hash="digest", expires_at=before, ip_hash="digest")
    login(user)
    assert not SignInSession.objects.filter(pk=old.pk).exists()
    assert not PasswordResetCode.objects.exists()


def test_refresh_never_reads_full_user_rows():
    from django.db import connection
    from django.test.utils import CaptureQueriesContext
    user = person("maya", "admin")
    _, tokens = login(user)
    with CaptureQueriesContext(connection) as queries:
        response = APIClient().post("/api/token/refresh/", {"refresh": tokens["refresh"]})
    assert response.status_code == 200
    selects = [row["sql"] for row in queries if row["sql"].lstrip().startswith("SELECT") and '"auth_user".' in row["sql"]]
    assert selects
    assert all('"auth_user"."password"' not in sql and '"auth_user"."last_login"' not in sql for sql in selects)


def test_legacy_refresh_creates_one_visible_revocable_device_and_preserves_claims():
    from rest_framework_simplejwt.tokens import AccessToken

    from billing.api.serializers import CustomTokenObtainPairSerializer
    from billing.api.session_auth import micros

    user = person("maya", "admin", first_name="Maya", last_name="Li")
    legacy = CustomTokenObtainPairSerializer.get_token(user)
    before = micros(timezone.now())
    response = APIClient().post("/api/token/refresh/", {"refresh": str(legacy)},
                                HTTP_USER_AGENT="Mozilla/5.0 (Macintosh) Version/17 Safari/605")
    assert response.status_code == 200
    session = SignInSession.objects.get(user=user)
    assert session.device == "Safari on Mac"
    assert session.remember and session.signed_out_at is None
    rotated = RefreshToken(response.data["refresh"])
    access = AccessToken(response.data["access"])
    for token in (rotated, access):
        assert token["sid"] == str(session.pk)
        assert before <= token["issued"] <= micros(timezone.now())
        for claim in ("user_id", "username", "full_name", "role"):
            assert token[claim] == legacy[claim]
    assert access["issued"] == rotated["issued"]
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION="Bearer " + str(access))
    assert client.get("/api/me/").data["session_id"] == str(session.pk)
    devices = client.get("/api/account/sessions/")
    assert devices.status_code == 200
    assert len(devices.data["results"]) == 1
    assert devices.data["results"][0]["current"] is True
    second = APIClient().post("/api/token/refresh/", {"refresh": str(rotated)})
    assert second.status_code == 200
    assert RefreshToken(second.data["refresh"])["sid"] == str(session.pk)
    assert SignInSession.objects.count() == 1
    assert APIClient().post("/api/token/refresh/", {"refresh": str(legacy)}).status_code == 401
    assert SignInSession.objects.count() == 1
    assert client.post("/api/auth/sign-out/", {"refresh": second.data["refresh"]}).status_code == 204
    for response in (client.get("/api/me/"), APIClient().post("/api/token/refresh/", {"refresh": second.data["refresh"]})):
        assert response.status_code == 401
        assert response.data["code"] == "signed_out"


@pytest.mark.parametrize("invalid", ["stopped", "revoked", "blacklisted", "expired"])
def test_invalid_legacy_refresh_never_creates_a_session(invalid):
    user = person("maya", "admin")
    legacy = RefreshToken.for_user(user)
    if invalid == "stopped":
        user.is_active = False
        user.save(update_fields=["is_active"])
    elif invalid == "revoked":
        revoke_all(user)
    elif invalid == "blacklisted":
        legacy.blacklist()
    else:
        legacy.set_exp(lifetime=timedelta(seconds=-1))
    response = APIClient().post("/api/token/refresh/", {"refresh": str(legacy)})
    assert response.status_code == 401
    assert not SignInSession.objects.exists()
