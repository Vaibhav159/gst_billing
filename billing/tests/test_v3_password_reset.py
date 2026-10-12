import json
import os
import runpy
import stat
import sys
from datetime import timedelta
from types import ModuleType
from unittest.mock import patch

import pytest
from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from billing.models import PasswordResetCode
from billing.services.accounts import security_for
from billing.tests.test_base import load_production_settings
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
    assert anonymous.post("/api/auth/reset/finish/", body).data["code"] == ["That code isn't right or has run out. Ask for a new code."]


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
    for _ in range(5):
        response = client.post("/api/auth/reset/finish/", {"username": "maya", "code": wrong, "password": "Harbour873!"})
        assert response.status_code == 400 and response.data["code"] == ["That code isn't right or has run out. Ask for a new code."]
    assert PasswordResetCode.objects.get().tries == 5
    PasswordResetCode.objects.update(tries=0, expires_at=timezone.now() - timedelta(seconds=1))
    response = client.post("/api/auth/reset/finish/", {"username": "maya", "code": correct, "password": "Harbour873!"})
    assert response.data["code"] == ["That code isn't right or has run out. Ask for a new code."]


@override_settings(SMS_RESET_ENABLED=True, SMS_PROVIDER="fake")
def test_wrong_code_words_never_tell_owners_apart():
    from billing.services.sms import fake_outbox
    owner = person("maya", "admin")
    person("staff")
    security = security_for(owner)
    security.phone = "9000000000"
    security.save()
    client = APIClient()
    answers = []
    for username in ("maya", "staff", "absent"):
        client.post("/api/auth/reset/start/", {"username": username})
        wrong = "000000" if fake_outbox["9000000000"] != "000000" else "111111"
        response = client.post("/api/auth/reset/finish/", {"username": username, "code": wrong, "password": "Harbour873!"})
        answers.append((response.status_code, response.data))
    assert answers == [(400, {"code": ["That code isn't right or has run out. Ask for a new code."]})] * 3
    assert PasswordResetCode.objects.get().tries == 1


@override_settings(SMS_RESET_ENABLED=True, SMS_PROVIDER="fake")
@pytest.mark.parametrize("password", [None, 12345678, ["Harbour873!"], {}])
def test_finish_refuses_a_non_string_password_and_keeps_the_code(password):
    from billing.services.sms import fake_outbox
    owner = person("maya", "admin")
    security = security_for(owner)
    security.phone = "9000000000"
    security.save()
    client = APIClient()
    client.post("/api/auth/reset/start/", {"username": "maya"})
    body = {"username": "maya", "code": fake_outbox["9000000000"], "password": password}
    response = client.post("/api/auth/reset/finish/", body, format="json")
    assert response.status_code == 400 and response.data == {"password": ["Use a password of 8 to 128 characters."]}
    owner.refresh_from_db()
    assert owner.check_password("x")
    assert PasswordResetCode.objects.get().used_at is None


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


@pytest.mark.parametrize("state", ["live", "unknown", "staff", "stopped", "missing", "used", "expired", "exhausted"])
def test_reset_finish_does_one_password_check_for_every_username(state):
    from billing.services.password_reset import EXPIRED, finish_reset

    if state != "unknown":
        user = person("maya", "editor" if state == "staff" else "admin")
        if state == "stopped":
            user.is_active = False
            user.save(update_fields=["is_active"])
        if state in {"live", "used", "expired", "exhausted"}:
            PasswordResetCode.objects.create(user=user, code_hash=make_password("123456"), ip_hash="synthetic",
                expires_at=timezone.now() + timedelta(minutes=-1 if state == "expired" else 10),
                used_at=timezone.now() if state == "used" else None, tries=5 if state == "exhausted" else 0)
    with patch("billing.services.password_reset.check_password", wraps=check_password) as checked:
        assert finish_reset({"username": "maya", "code": "654321"}) == ({"code": [EXPIRED]}, 400)
    assert checked.call_count == 1
    assert checked.call_args.args[0] == "654321"


@override_settings(SMS_RESET_ENABLED=True, SMS_PROVIDER="fake")
def test_reset_throttle_falls_back_to_username_when_proxy_hops_are_missing():
    with override_settings(REST_FRAMEWORK={**settings.REST_FRAMEWORK, "NUM_PROXIES": 2}):
        client = APIClient()
        for _ in range(10):
            assert client.post("/api/auth/reset/start/", {"username": "first"}).status_code == 200
        assert client.post("/api/auth/reset/start/", {"username": "FIRST"}).status_code == 429
        assert client.post("/api/auth/reset/start/", {"username": "second"}).status_code == 200


@pytest.mark.parametrize("body", [[], {"username": {}}, {"username": "a" * 151}])
@override_settings(SMS_RESET_ENABLED=True, SMS_PROVIDER="fake")
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


@pytest.mark.parametrize(("switch", "provider", "missing", "enabled"), [
    (False, "fake", None, False),
    (True, "fake", None, True),
    (True, "msg91", "MSG91_AUTH_KEY", False),
    (True, "msg91", "MSG91_TEMPLATE_ID", False),
    (True, "msg91", "MSG91_SENDER", False),
    (True, "msg91", None, True),
    (True, "unknown", None, False),
])
def test_sms_options_and_reset_share_provider_readiness(switch, provider, missing, enabled):
    configured = {"SMS_RESET_ENABLED": switch, "SMS_PROVIDER": provider,
                  "SMS_FAKE_OUTBOX_FILE": "", "MSG91_AUTH_KEY": "synthetic-key",
                  "MSG91_TEMPLATE_ID": "synthetic-template", "MSG91_SENDER": "TESTID"}
    if missing:
        configured[missing] = ""
    owner = person("maya", "admin")
    security = security_for(owner)
    security.phone = "9000000000"
    security.save()
    client = APIClient()
    with override_settings(**configured), patch("billing.services.sms.requests.post") as post:
        assert client.get("/api/auth/options/").data == {"sms_reset": enabled}
        if not enabled:
            for username in ["maya", "absent"]:
                for step in ["start", "finish"]:
                    response = client.post(f"/api/auth/reset/{step}/", {"username": username})
                    assert response.status_code == 409
                    assert response.data["code"] == "sms_off"
            assert not PasswordResetCode.objects.exists()
        post.assert_not_called()


@pytest.mark.parametrize("debug", ["True", "False"])
def test_production_settings_refuse_fake_even_when_debug(debug):
    with pytest.raises(ImproperlyConfigured, match="SMS_PROVIDER=fake"):
        load_production_settings(SMS_PROVIDER="fake", DEBUG=debug,
                                 SMS_FAKE_OUTBOX_FILE=None)


def test_production_settings_refuse_a_fake_outbox_file_at_startup():
    with pytest.raises(ImproperlyConfigured, match="SMS_FAKE_OUTBOX_FILE"):
        load_production_settings(SMS_PROVIDER="msg91", SMS_FAKE_OUTBOX_FILE="/tmp/outbox.json")


def test_production_settings_still_accept_real_provider():
    production = load_production_settings(SMS_PROVIDER="msg91", SMS_FAKE_OUTBOX_FILE=None)
    assert production.SMS_PROVIDER == "msg91"


@pytest.mark.parametrize("kind", ["absent", "staff", "stopped", "no-phone",
                                  "invalid-phone", "limited", "owner", "provider-failed"])
@override_settings(SMS_RESET_ENABLED=True, SMS_PROVIDER="fake", SMS_FAKE_OUTBOX_FILE="")
def test_every_reset_start_does_one_code_hash_before_username_branch(kind):
    user = None
    if kind != "absent":
        user = person("maya", "editor" if kind == "staff" else "admin")
        if kind == "stopped":
            user.is_active = False
            user.save(update_fields=["is_active"])
        security = security_for(user)
        security.phone = {"no-phone": "", "invalid-phone": "bad-phone"}.get(kind, "9000000000")
        security.save()
        if kind == "limited":
            for _ in range(3):
                PasswordResetCode.objects.create(user=user, code_hash="used-placeholder",
                                                 expires_at=timezone.now() + timedelta(minutes=10))
    with patch("billing.services.password_reset.make_password", wraps=make_password) as hashed, \
            patch("billing.services.password_reset.secrets.randbelow", return_value=123456), \
            patch("billing.services.password_reset.send_code", return_value=kind != "provider-failed") as sent:
        response = APIClient().post("/api/auth/reset/start/", {"username": "maya"})
    assert response.status_code == (503 if kind == "provider-failed" else 200)
    hashed.assert_called_once_with("123456")
    if kind in {"owner", "provider-failed"}:
        sent.assert_called_once_with("9000000000", "123456")
        assert check_password("123456", PasswordResetCode.objects.get(user=user).code_hash)
    else:
        sent.assert_not_called()


@override_settings(DEBUG=True, SMS_RESET_ENABLED=True, SMS_PROVIDER="fake")
def test_fake_file_supports_the_complete_browser_reset_flow_without_http(tmp_path, caplog):
    from billing.services.sms import fake_outbox, send_code

    outbox = tmp_path / "sms-outbox.json"
    owner = person("maya", "admin")
    security = security_for(owner)
    security.phone = "9000000000"
    security.save()
    client = APIClient()
    with override_settings(SMS_FAKE_OUTBOX_FILE=str(outbox)), \
            patch("billing.services.sms.requests.post") as post:
        assert send_code("9000000001", "111111")
        assert client.post("/api/auth/reset/start/", {"username": "maya"}).status_code == 200
        payload = json.loads(outbox.read_text())
        assert payload == {"phone": "9000000000", "code": fake_outbox["9000000000"]}
        assert stat.S_IMODE(outbox.stat().st_mode) == 0o600
        response = client.post("/api/auth/reset/finish/", {
            "username": "maya", "code": payload["code"], "password": "Harbour873!"})
        assert response.status_code == 200
        post.assert_not_called()
    assert payload["code"] not in caplog.text
    assert "9000000000" not in caplog.text


@pytest.mark.parametrize(("debug", "provider"), [(False, "fake"), (True, "msg91"), (False, "msg91")])
def test_fake_file_refuses_non_debug_or_real_provider(tmp_path, debug, provider):
    from billing.services.sms import send_code

    outbox = tmp_path / "sms-outbox.json"
    with override_settings(DEBUG=debug, SMS_PROVIDER=provider, SMS_FAKE_OUTBOX_FILE=str(outbox)), \
            patch("billing.services.sms.requests.post") as post, \
            pytest.raises(ImproperlyConfigured, match="SMS_FAKE_OUTBOX_FILE"):
        send_code("9000000000", "123456")
    assert not outbox.exists()
    post.assert_not_called()


@override_settings(DEBUG=False, SMS_PROVIDER="fake", SMS_FAKE_OUTBOX_FILE="")
def test_fake_without_file_still_supports_unit_tests():
    from billing.services.sms import fake_outbox, send_code

    with patch("billing.services.sms.requests.post") as post:
        assert send_code("9000000000", "123456")
    assert fake_outbox["9000000000"] == "123456"
    post.assert_not_called()


@override_settings(DEBUG=True, SMS_PROVIDER="fake")
def test_fake_file_write_failure_does_not_report_delivery(tmp_path):
    from billing.services.sms import send_code

    with override_settings(SMS_FAKE_OUTBOX_FILE=str(tmp_path)):
        assert not send_code("9000000000", "123456")


@override_settings(DEBUG=True, SMS_PROVIDER="fake")
def test_fake_outbox_folder_is_private_and_must_be_ours(tmp_path):
    from billing.services.sms import send_code

    outbox = tmp_path / "made" / "outbox.json"
    with override_settings(SMS_FAKE_OUTBOX_FILE=str(outbox)):
        assert send_code("9000000000", "123456")
        assert stat.S_IMODE(outbox.parent.stat().st_mode) == 0o700
        outbox.unlink()
        with patch("billing.services.sms.os.getuid", return_value=os.getuid() + 1):
            assert not send_code("9000000000", "123456")
        assert not outbox.exists()
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    (tmp_path / "linked").symlink_to(elsewhere)
    with override_settings(SMS_FAKE_OUTBOX_FILE=str(tmp_path / "linked" / "outbox.json")):
        assert not send_code("9000000000", "123456")
    assert not (elsewhere / "outbox.json").exists()


@pytest.mark.parametrize("enabled", [False, True])
def test_sandbox_fake_sms_is_explicit_and_sets_a_private_file(enabled, tmp_path):
    environment = {"GST_SANDBOX": "1", "DB_HOST": "db", "DB_NAME": "gst_sandbox_test",
                   "SMS_PROVIDER": "", "DEBUG": "False", "SMS_RESET_ENABLED": "",
                   "SMS_FAKE_OUTBOX_FILE": None, "SANDBOX_SMS_OUTBOX_FILE": str(tmp_path / "outbox.json"),
                   "SANDBOX_FAKE_SMS": "1" if enabled else "0"}
    production = load_production_settings(**environment)
    with patch.dict(os.environ, {key: value for key, value in environment.items() if value is not None}), \
            patch.dict(sys.modules, {"gst_billing.production_settings": production}):
        sandbox = runpy.run_module("gst_billing.sandbox_settings")
    assert sandbox["DEBUG"] is enabled
    assert sandbox["SMS_RESET_ENABLED"] is enabled
    if enabled:
        assert sandbox["SMS_PROVIDER"] == "fake"
        assert sandbox["SMS_FAKE_OUTBOX_FILE"] == str(tmp_path / "outbox.json")
    else:
        assert sandbox["SMS_PROVIDER"] != "fake"


def test_sandbox_fake_sms_cannot_bypass_database_guard():
    production = ModuleType("gst_billing.production_settings")
    production.DATABASES = {"default": {"HOST": "production.invalid", "NAME": "books"}}
    with patch.dict(os.environ, {"GST_SANDBOX": "1", "SANDBOX_FAKE_SMS": "1"}), \
            patch.dict(sys.modules, {"gst_billing.production_settings": production}), \
            pytest.raises(RuntimeError, match="sandbox database"):
        runpy.run_module("gst_billing.sandbox_settings")
