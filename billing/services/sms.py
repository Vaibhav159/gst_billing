"""MSG91 flow adapter. Never log a request, response, phone or reset code."""
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory

import requests
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

fake_outbox = {}


def provider_ready():
    if getattr(settings, "SMS_FAKE_OUTBOX_FILE", "") and not (
        settings.DEBUG and settings.SMS_PROVIDER == "fake"
    ):
        raise ImproperlyConfigured("SMS_FAKE_OUTBOX_FILE requires DEBUG and SMS_PROVIDER=fake.")
    return settings.SMS_PROVIDER == "fake" or (
        settings.SMS_PROVIDER == "msg91"
        and all(value.strip() for value in (
            settings.MSG91_AUTH_KEY, settings.MSG91_TEMPLATE_ID, settings.MSG91_SENDER
        ))
    )


def sms_enabled():
    return bool(settings.SMS_RESET_ENABLED and provider_ready())


def send_code(phone, code):
    if not provider_ready():
        return False
    if settings.SMS_PROVIDER == "fake":
        if filename := getattr(settings, "SMS_FAKE_OUTBOX_FILE", ""):
            path = Path(filename)
            try:
                path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with TemporaryDirectory(dir=path.parent) as directory:
                    temporary = Path(directory) / "outbox.json"
                    temporary.write_text(json.dumps({"phone": phone, "code": code}))
                    temporary.chmod(0o600)
                    os.replace(temporary, path)
            except OSError:
                return False
        fake_outbox[phone] = code
        return True
    try:
        response = requests.post("https://control.msg91.com/api/v5/flow",
            headers={"authkey": settings.MSG91_AUTH_KEY, "accept": "application/json"},
            json={"template_id": settings.MSG91_TEMPLATE_ID, "sender": settings.MSG91_SENDER,
                  "short_url": "0", "recipients": [{"mobiles": "91" + phone, "VAR1": code}]},
            timeout=(3.05, 10))
        response.raise_for_status()
        result = response.json()
        return isinstance(result, dict) and result.get("type") == "success"
    except (requests.RequestException, ValueError):
        return False
