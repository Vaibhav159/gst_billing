"""Passwords and revocation share one user lock; audit rows never hold credentials."""
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import CommonPasswordValidator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from billing.cache import invalidate, uncached
from billing.models import AuditLog, SignInSession, UserSecurity


def security_for(user):
    security, _ = uncached(UserSecurity).get_or_create(user_id=user.pk)
    return security


def validate_password(password, user, own=False, change=False):
    if not isinstance(password, str) or len(password) > 128:
        raise ValidationError({"password": ["Use a password of 8 to 128 characters."]})
    rules = []
    if len(password) < 8:
        rules.append("at least 8 characters")
    if not (any(c.isalpha() for c in password) and any(c.isdigit() for c in password)):
        rules.append("letters and at least one number")
    names = (user.username, user.first_name, user.last_name)
    if any(len(n) >= 3 and n.casefold() in password.casefold() for n in names if n):
        rules.append("not your name or username" if own else "not the person's name or username")
    try:
        CommonPasswordValidator().validate(password)
    except DjangoValidationError:
        rules.append("not a common password")
    if change and user.check_password(password):
        rules.append("different from your current password")
    if rules:
        lead = "The new password needs: " if own else "It needs: "
        raise ValidationError({"password": [lead + "; ".join(rules) + "."]})


def audit_user(actor, target, action, details="", changes=None):
    snapshot = None
    if action == "created":
        snapshot = {key: getattr(target, key) for key in ("id", "username", "first_name", "last_name", "email", "is_active")}
    return AuditLog.objects.create(user=actor, action=action, entity="user", entity_id=target.pk,
                                   entity_name=target.get_full_name() or target.username,
                                   details=details, changes=changes or {}, snapshot=snapshot)


@transaction.atomic
def revoke_all(user, actor=None, how="password", keep=None):
    uncached(User).select_for_update().only("id").get(pk=user.pk)
    now = timezone.now()
    security = security_for(user)
    security.tokens_after = now
    security.save(update_fields=["tokens_after"])
    sessions = uncached(SignInSession).filter(user_id=user.pk, signed_out_at__isnull=True)
    if keep:
        sessions = sessions.exclude(pk=keep)
    count = sessions.update(signed_out_at=now, signed_out_by=actor, ended_how=how)
    invalidate(SignInSession)
    return now, count


@transaction.atomic
def set_password(user, password, must_change=True):
    uncached(User).select_for_update().only("id").get(pk=user.pk)
    user.set_password(password)
    user.save(update_fields=["password"])
    security = security_for(user)
    security.must_change_password = must_change
    security.save(update_fields=["must_change_password"])
    return revoke_all(user)[0]
