from datetime import timedelta

import pytest
from django.contrib.auth.hashers import check_password
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from billing.tests.v3_helpers import person

pytestmark = pytest.mark.django_db


def test_security_tables_and_safe_audit():
    from billing.models import AuditLog, PasswordResetCode, SignInSession, UserSecurity
    from billing.services.accounts import audit_user, security_for
    user = person("maya", "admin")
    security = security_for(user)
    assert UserSecurity.objects.count() == 1
    assert security_for(user).pk == security.pk
    assert security.phone == "" and not security.must_change_password
    session = SignInSession.objects.create(user=user, device="Chrome on Windows")
    assert session.signed_out_at is None and session.remember
    code = PasswordResetCode.objects.create(user=user, code_hash="hashed", expires_at=timezone.now() + timedelta(minutes=10), ip_hash="digest")
    assert code.tries == 0 and code.used_at is None
    audit_user(user, user, "created")
    assert "password" not in AuditLog.objects.latest("id").snapshot
    for model in (UserSecurity, SignInSession, PasswordResetCode):
        for field in model._meta.fields:
            if field.is_relation:
                assert not field.db_constraint


def test_password_rules_order_and_names():
    from billing.services.accounts import validate_password
    user = person("maya", first_name="Maya", last_name="Li")
    with pytest.raises(ValidationError) as error:
        validate_password("maya", user)
    assert str(error.value.detail["password"][0]) == "It needs: at least 8 characters; letters and at least one number; not the person's name or username; not a common password."
    validate_password("Forest927!", user)
    with pytest.raises(ValidationError) as error:
        validate_password("password1", user)
    assert "not a common password" in str(error.value.detail)
    user.set_password("Forest927!")
    with pytest.raises(ValidationError) as error:
        validate_password("Forest927!", user, own=True, change=True)
    assert str(error.value.detail["password"][0]) == "The new password needs: different from your current password."


@pytest.mark.parametrize("value", [None, [], {}, 10, True])
def test_odd_password_is_a_field_error(value):
    from billing.services.accounts import validate_password
    with pytest.raises(ValidationError):
        validate_password(value, person("maya"))


def test_setting_password_revokes_sessions_and_hashes():
    from billing.models import SignInSession
    from billing.services.accounts import security_for, set_password
    user = person("maya")
    session = SignInSession.objects.create(user=user, device="Firefox on Linux")
    set_password(user, "Forest927!")
    user.refresh_from_db()
    session.refresh_from_db()
    assert check_password("Forest927!", user.password)
    assert session.signed_out_at is not None and session.ended_how == "password"
    assert security_for(user).must_change_password
    assert security_for(user).tokens_after is not None
