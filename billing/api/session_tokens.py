"""JWT sessions: one joined user/security read, with an existence check for this device."""
from datetime import timedelta

from django.contrib.auth.models import User
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.settings import api_settings as jwt_settings
from rest_framework_simplejwt.tokens import UntypedToken

from billing.cache import invalidate, uncached
from billing.models import PasswordResetCode, SignInSession
from billing.services.accounts import security_for

from .serializers import CustomTokenObtainPairSerializer
from .session_auth import SessionJWTAuthentication, micros, track_refresh


def device_name(ua):
    ua = ua[:2048]
    browser = next((name for marker, name in [("Edg/", "Edge"), ("OPR/", "Opera"), ("Firefox/", "Firefox"), ("CriOS/", "Chrome"), ("Chrome/", "Chrome"), ("Safari/", "Safari")] if marker in ua), "Browser")
    system = next((name for marker, name in [("Android", "Android"), ("iPhone", "iPhone"), ("iPad", "iPad"), ("Windows", "Windows"), ("Macintosh", "Mac"), ("Linux", "Linux")] if marker in ua), "Unknown system")
    return f"{browser} on {system}"


def pair_for(user, session):
    token = CustomTokenObtainPairSerializer.get_token(user)
    token["sid"] = str(session.pk)
    token["issued"] = micros(timezone.now())
    return {"access": str(token.access_token), "refresh": str(token)}


class SessionTokenObtainSerializer(CustomTokenObtainPairSerializer):
    remember = serializers.BooleanField(default=True)

    @transaction.atomic
    def validate(self, attrs):
        # Check a stopped person's password without Django's inactive-user rejection.
        user = uncached(User).select_for_update().only("id", "password", "username", "first_name", "last_name", "is_active", "is_superuser").filter(username=attrs["username"]).first()
        if user is None:
            User().set_password(attrs["password"])
        if user is None or not user.check_password(attrs["password"]):
            raise AuthenticationFailed("No active account found with the given credentials", code="no_active_account")
        if not user.is_active:
            raise AuthenticationFailed({"detail": f"The owner has stopped @{user.username} signing in. Ask the owner.", "code": "stopped"})
        security_for(user)
        now = timezone.now()
        if uncached(SignInSession).filter(signed_out_at__isnull=True,
                last_used_at__lt=now - jwt_settings.REFRESH_TOKEN_LIFETIME).update(signed_out_at=now, ended_how="expired"):
            invalidate(SignInSession)
        cutoff = now - timedelta(days=90)
        uncached(SignInSession).filter(signed_out_at__lt=cutoff).delete()
        uncached(PasswordResetCode).filter(Q(used_at__lt=cutoff) | Q(expires_at__lt=cutoff)).delete()
        session = SignInSession.objects.create(user=user, device=device_name(self.context["request"].META.get("HTTP_USER_AGENT", "")),
                                               remember=attrs["remember"])
        self.user = user
        return pair_for(user, session)


class SessionTokenRefreshSerializer(TokenRefreshSerializer):
    @transaction.atomic
    def validate(self, attrs):
        # Check revocation before the blacklist so an ended device gets signed_out.
        untyped = UntypedToken(attrs["refresh"])
        user = SessionJWTAuthentication().get_user(untyped)
        # Serialise refresh with password/stop/sign-out, then check the newly locked state again.
        uncached(User).select_for_update().only("id").get(pk=user.pk)
        SessionJWTAuthentication().get_user(untyped)
        token = self.token_class(attrs["refresh"])
        if token.get("sid") is None:
            session = SignInSession.objects.create(user=user,
                device=device_name(self.context["request"].META.get("HTTP_USER_AGENT", "")))
            token["sid"] = str(session.pk)
            token["issued"] = micros(timezone.now())
        result = {"access": str(token.access_token)}
        if jwt_settings.ROTATE_REFRESH_TOKENS:
            if jwt_settings.BLACKLIST_AFTER_ROTATION:
                track_refresh(token, blacklist=True)
            token.set_jti()
            token.set_exp()
            token.set_iat()
            track_refresh(token)
            result["refresh"] = str(token)
        return result
