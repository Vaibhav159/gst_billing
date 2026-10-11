"""MSG91 flow adapter. Never log a request, response, phone or reset code."""
import requests
from django.conf import settings

fake_outbox = {}


def send_code(phone, code):
    if settings.SMS_PROVIDER == "fake":
        fake_outbox[phone] = code
        return True
    if settings.SMS_PROVIDER != "msg91" or not all((settings.MSG91_AUTH_KEY, settings.MSG91_TEMPLATE_ID, settings.MSG91_SENDER)):
        return False
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
