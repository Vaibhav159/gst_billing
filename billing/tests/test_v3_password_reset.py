from datetime import timedelta
from unittest.mock import patch

import pytest
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from billing.models import PasswordResetCode
from billing.services.accounts import security_for
from billing.tests.test_v3_sessions import login
from billing.tests.v3_helpers import person

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def clean_reset_cache():
    cache.clear()
    yield
    cache.clear()


def test_reset_ships_off_and_rules_are_public():
    client = APIClient()
    assert client.get("/api/auth/options/").data == {"sms_reset": False}
    assert client.get("/api/auth/password-rules/").data == {"min_length": 8, "common": False}
    for path in ["start", "finish"]:
        response = client.post(f"/api/auth/reset/{path}/", {"username": "maya"})
        assert response.status_code == 409 and response.data["code"] == "sms_off"


@override_settings(SMS_RESET_ENABLED=True, SMS_PROVIDER="fake")
def test_owner_reset_hashed_single_use_and_revokes_all():
    from billing.services.sms import fake_outbox
    owner = person("maya", "admin")
    logged, tokens = login(owner)
    security = security_for(owner)
    security.phone = "9000000000"
    security.save()
    anonymous = APIClient()
    assert anonymous.post("/api/auth/reset/start/", {"username": "maya"}).status_code == 200
    code = fake_outbox["9000000000"]
    stored = PasswordResetCode.objects.get(user=owner)
    assert stored.code_hash != code and stored.ip_hash != "127.0.0.1"
    body = {"username": "maya", "code": code, "password": "Harbour873!"}
    assert anonymous.post("/api/auth/reset/finish/", body).status_code == 200
    assert logged.get("/api/me/").status_code == 401
    assert anonymous.post("/api/token/refresh/", {"refresh": tokens["refresh"]}).status_code == 401
    assert anonymous.post("/api/auth/reset/finish/", body).data["code"] == ["That code has run out or been used. Ask for a new one."]


@override_settings(SMS_RESET_ENABLED=True, SMS_PROVIDER="fake")
def test_unknown_staff_stopped_and_three_per_hour_keep_generic_answer():
    from billing.services.sms import fake_outbox
    fake_outbox.clear()
    owner = person("maya", "admin")
    security = security_for(owner)
    security.phone = "9000000000"
    security.save()
    client = APIClient()
    for _ in range(4):
        response = client.post("/api/auth/reset/start/", {"username": "maya"})
        assert response.status_code == 200
    assert PasswordResetCode.objects.filter(user=owner).count() == 3
    assert response.data["detail"] == "If @maya is an owner with a mobile number saved, a 6-digit code is on its way by SMS. It works for 10 minutes."
    person("staff", "editor")
    for username in ["absent", "staff"]:
        assert client.post("/api/auth/reset/start/", {"username": username}).status_code == 200
    assert PasswordResetCode.objects.count() == 3


@override_settings(SMS_RESET_ENABLED=True, SMS_PROVIDER="fake")
def test_five_tries_persist_and_expiry_is_enforced():
    from billing.services.sms import fake_outbox
    owner = person("maya", "admin")
    security = security_for(owner)
    security.phone = "9000000000"
    security.save()
    client = APIClient()
    client.post("/api/auth/reset/start/", {"username": "maya"})
    correct = fake_outbox["9000000000"]
    wrong = "000000" if correct != "000000" else "111111"
    for remaining in range(4, -1, -1):
        response = client.post("/api/auth/reset/finish/", {"username": "maya", "code": wrong, "password": "Harbour873!"})
        expected = f"That code isn't right. {remaining} tries left." if remaining else "That code has run out or been used. Ask for a new one."
        assert response.status_code == 400 and response.data["code"] == [expected]
    assert PasswordResetCode.objects.get().tries == 5
    PasswordResetCode.objects.update(tries=0, expires_at=timezone.now() - timedelta(seconds=1))
    response = client.post("/api/auth/reset/finish/", {"username": "maya", "code": correct, "password": "Harbour873!"})
    assert "run out" in response.data["code"][0]


@override_settings(SMS_RESET_ENABLED=True, SMS_PROVIDER="fake")
def test_provider_failure_leaves_no_usable_code_and_logs_no_secrets(caplog):
    owner = person("maya", "admin")
    security = security_for(owner)
    security.phone = "9000000000"
    security.save()
    with patch("billing.services.password_reset.send_code", return_value=False):
        response = APIClient().post("/api/auth/reset/start/", {"username": "maya"})
    assert response.status_code == 503 and response.data["code"] == "sms_failed"
    assert not PasswordResetCode.objects.filter(used_at__isnull=True).exists()
    assert "9000000000" not in caplog.text


@override_settings(SMS_RESET_ENABLED=True, SMS_PROVIDER="fake")
def test_reset_scope_ten_per_address():
    client = APIClient()
    statuses = [client.post("/api/auth/reset/start/", {"username": "absent"}).status_code for _ in range(11)]
    assert statuses == [200] * 10 + [429]


@pytest.mark.parametrize("body", [[], {"username": {}}, {"username": "a" * 151}])
@override_settings(SMS_RESET_ENABLED=True)
def test_odd_reset_input_is_400(body):
    assert APIClient().post("/api/auth/reset/start/", body, format="json").status_code == 400


@override_settings(SMS_PROVIDER="msg91", MSG91_AUTH_KEY="synthetic-key", MSG91_TEMPLATE_ID="synthetic-template", MSG91_SENDER="TESTID")
def test_msg91_request_and_failures_are_bounded_and_private(caplog):
    import requests

    from billing.services.sms import send_code
    with patch("billing.services.sms.requests.post") as post:
        post.return_value.json.return_value = {"type": "success"}
        assert send_code("9000000000", "123456")
        kwargs = post.call_args.kwargs
        assert kwargs["timeout"] == (3.05, 10)
        assert kwargs["json"]["recipients"] == [{"mobiles": "919000000000", "VAR1": "123456"}]
        assert kwargs["headers"]["authkey"] == "synthetic-key"
        post.side_effect = requests.Timeout("provider failed")
        assert not send_code("9000000000", "123456")
    assert not caplog.text
