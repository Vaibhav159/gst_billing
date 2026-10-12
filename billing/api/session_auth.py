from datetime import timedelta
from uuid import UUID

from django.contrib.auth.models import User
from django.db.models import Exists, OuterRef, Subquery
from django.utils import timezone
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication

from billing.cache import invalidate, uncached
from billing.models import SignInSession

SIGNED_OUT = {"detail": "You were signed out on this device. Sign in again.", "code": "signed_out"}


def micros(moment):
    # Integer precision keeps a reset and a new sign-in in the same second distinct.
    return int(moment.timestamp()) * 1_000_000 + moment.microsecond


class SessionJWTAuthentication(JWTAuthentication):
    def get_user(self, token):
        sid = token.get("sid")
        try:
            if sid is not None:
                sid = UUID(str(sid))
            user_id = int(token["user_id"])
            issued = int(token.get("issued", int(token["iat"]) * 1_000_000))
        except (ValueError, TypeError, KeyError, OverflowError):
            raise AuthenticationFailed(SIGNED_OUT) from None
        sessions = uncached(SignInSession).filter(pk=sid, user_id=OuterRef("pk"), signed_out_at__isnull=True)
        user = (uncached(User).select_related("security").annotate(live_session=Exists(sessions), session_used=Subquery(sessions.values("last_used_at")[:1]))
                .only("id", "username", "first_name", "last_name", "email", "is_staff", "is_active", "is_superuser",
                      "security__id", "security__user_id", "security__must_change_password", "security__tokens_after")
                .filter(pk=user_id).first())
        if user is None or not user.is_active or (sid is not None and not user.live_session):
            raise AuthenticationFailed(SIGNED_OUT)
        security = getattr(user, "security", None)
        if security and security.tokens_after and issued < micros(security.tokens_after):
            raise AuthenticationFailed(SIGNED_OUT)
        user._v3_security = security
        user._session_id = str(sid) if sid else None
        if sid and user.session_used <= timezone.now() - timedelta(minutes=15):
            now = timezone.now()
            updated = uncached(SignInSession).filter(pk=sid, signed_out_at__isnull=True,
                          last_used_at__lte=now - timedelta(minutes=15)).update(last_used_at=now)
            if updated:
                invalidate(SignInSession)
        return user


def track_refresh(token, blacklist=False):
    """SimpleJWT's blacklist storage without its redundant full User fetch."""
    from rest_framework_simplejwt.settings import api_settings as jwt_settings
    from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
    from rest_framework_simplejwt.utils import datetime_from_epoch

    outstanding, _ = uncached(OutstandingToken).only("id").get_or_create(
        jti=token[jwt_settings.JTI_CLAIM], defaults={
            "user_id": token.get(jwt_settings.USER_ID_CLAIM), "token": str(token),
            "created_at": token.current_time, "expires_at": datetime_from_epoch(token["exp"]),
        })
    if blacklist:
        uncached(BlacklistedToken).only("id").get_or_create(token_id=outstanding.pk)
