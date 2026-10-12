"""Part 7 hardening (Ruling 7-D15): deeply nested JSON is a 400, never a 500 (1A final review, Minor 7)."""
import os
import subprocess
import sys
from io import BytesIO
from pathlib import Path

import pytest
from django.utils.module_loading import import_string
from rest_framework.exceptions import ParseError
from rest_framework.test import APIClient

from billing.tests.test_base import load_production_settings
from billing.tests.v3_helpers import client_for, person

pytestmark = pytest.mark.django_db
DEEP = "[" * 100_000 + "]" * 100_000


def test_deep_json_to_the_sign_in_is_a_400():
    r = APIClient().post("/api/token/", data=DEEP, content_type="application/json")
    assert r.status_code == 400
    assert str(r.data["detail"]) == "JSON parse error - the data is nested too deeply."


def test_deep_json_to_a_view_with_its_own_parsers_is_a_400():
    r = client_for(person("deep-owner", "admin")).post("/api/businesses/", data=DEEP, content_type="application/json")
    assert r.status_code == 400
    assert str(r.data["detail"]) == "JSON parse error - the data is nested too deeply."


def test_ordinary_json_still_parses():
    r = APIClient().post("/api/token/", data={"username": "nobody", "password": "x"}, format="json")
    assert r.status_code == 401


def test_production_parses_deep_json_as_a_client_error_too():
    config = load_production_settings().REST_FRAMEWORK
    parser = import_string(config["DEFAULT_PARSER_CLASSES"][0])()
    with pytest.raises(ParseError, match="the data is nested too deeply"):
        parser.parse(BytesIO(DEEP.encode()))


def test_redis_password_is_not_printed_when_loading_settings(monkeypatch):
    monkeypatch.setenv("REDIS_PASSWORD", "synthetic-redis-password-for-test")
    marker = "GST_TEST_DOTENV_ISOLATION"
    monkeypatch.setenv(marker, "parent")
    # A checkout's .env can change settings-loader environment, but never this pytest process.
    def load_dotenv():
        os.environ[marker] = "settings-loader"

    monkeypatch.setattr("dotenv.load_dotenv", load_dotenv)
    result = subprocess.run([sys.executable, "-c", "import gst_billing.settings"],
                            cwd=Path(__file__).resolve().parents[2],
                            env={**os.environ, "DJANGO_SECRET_KEY": os.environ.get("DJANGO_SECRET_KEY", "test-only-not-secret")},
                            capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    assert "synthetic-redis-password-for-test" not in result.stdout + result.stderr
    assert os.environ[marker] == "parent"
