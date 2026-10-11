"""On-demand, bounded password resets; every attempt commits before its error leaves."""
import re
import secrets
from datetime import timedelta

from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import salted_hmac
from rest_framework.exceptions import ValidationError

from billing.cache import invalidate, uncached
from billing.models import PasswordResetCode
from billing.roles import role_of
from billing.services.accounts import audit_user, revoke_all, security_for, validate_password

from .sms import send_code

# R4B-1: one answer for every wrong, expired or used code, whoever the username is.
EXPIRED = "That code isn't right or has run out. Ask for a new code."
FAILED = {"detail": "The SMS couldn't be sent. Try again in a few minutes, or ask the person who looks after the app.", "code": "sms_failed"}


def username_from(data):
    value = data.get("username") if isinstance(data, dict) else None
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= 150:
        raise ValidationError({"username": ["Enter the username you sign in with."]})
    return value.strip()


@transaction.atomic
def start_reset(data, address):
    username = username_from(data)
    # Hash once even when the code is a dummy for an unknown, ineligible or
    # limited username. Provider latency remains observable when SMS is on.
    code = f"{secrets.randbelow(1_000_000):06d}"
    code_hash = make_password(code)
    answer = {"detail": f"If @{username} is an owner with a mobile number saved, a 6-digit code is on its way by SMS. It works for 10 minutes."}
    user = uncached(User).select_for_update().filter(username=username).first()
    if user is None or not user.is_active or role_of(user) != "owner":
        return answer, 200
    security = security_for(user)
    if not re.fullmatch(r"[0-9]{10}", security.phone):
        return answer, 200
    now = timezone.now()
    codes = uncached(PasswordResetCode).filter(user_id=user.pk)
    if codes.filter(created_at__gt=now - timedelta(hours=1)).count() >= 3:
        return answer, 200
    codes.filter(used_at__isnull=True).update(used_at=now)
    invalidate(PasswordResetCode)
    record = PasswordResetCode.objects.create(user=user, code_hash=code_hash,
                  expires_at=now + timedelta(minutes=10),
                  ip_hash=salted_hmac("password-reset-address", address, algorithm="sha256").hexdigest())
    if not send_code(security.phone, code):
        record.used_at = now
        record.save(update_fields=["used_at"])
        return FAILED, 503
    return answer, 200


@transaction.atomic
def finish_reset(data):
    username = username_from(data)
    code = data.get("code")
    if not isinstance(code, str) or not re.fullmatch(r"[0-9]{6}", code):
        return {"code": ["The code has 6 digits. Check the SMS."]}, 400
    user = uncached(User).select_for_update().filter(username=username).first()
    if user is None or not user.is_active or role_of(user) != "owner":
        return {"code": [EXPIRED]}, 400
    record = uncached(PasswordResetCode).filter(user_id=user.pk).order_by("-created_at", "-pk").first()
    now = timezone.now()
    if record is None or record.used_at or record.expires_at <= now or record.tries >= 5:
        return {"code": [EXPIRED]}, 400
    if not check_password(code, record.code_hash):
        record.tries += 1
        record.save(update_fields=["tries"])
        return {"code": [EXPIRED]}, 400
    password = data.get("password")
    validate_password(password, user, own=True, change=True)
    user.set_password(password)
    user.save(update_fields=["password"])
    record.used_at = now
    record.save(update_fields=["used_at"])
    revoke_all(user, actor=user, how="reset")
    security = security_for(user)
    security.must_change_password = False
    security.save(update_fields=["must_change_password"])
    audit_user(user, user, "password", "Reset with a code sent by SMS · signed out everywhere")
    return {"detail": "Password changed. Sign in with the new one. Every other device is signed out."}, 200
