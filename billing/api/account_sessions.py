"""Own password and devices; all changes lock the user before their sessions."""
from uuid import UUID

from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from billing.cache import invalidate, uncached
from billing.models import AuditLog, SignInSession
from billing.services.accounts import audit_user, revoke_all, security_for, validate_password
from billing.text import stamp

from .account_access import DeviceAccess
from .auth import DynamicScopedRateThrottle
from .session_auth import track_refresh
from .session_tokens import device_name, pair_for


def body(request):
    if not isinstance(request.data, dict):
        raise ValidationError({"detail": "Send the fields as an object."})
    return request.data


def locked_user(request):
    user = uncached(User).select_for_update().only("id", "password", "username", "first_name", "last_name", "is_active", "is_superuser").get(pk=request.user.pk)
    if request.auth is not None:
        from .session_auth import SessionJWTAuthentication
        SessionJWTAuthentication().get_user(request.auth)
    return user


def session_audit(user, words, session_ids, current=None):
    # X-28: the integer identifies the person; ended session UUIDs remain in details.
    identifiers = sorted(str(session_id) for session_id in session_ids)
    if identifiers:
        label = "session" if len(identifiers) == 1 else "sessions"
        reference = f"{label} {', '.join(identifiers)}"
    else:
        reference = f"from session {current}" if current else "legacy sign-in (no session)"
    AuditLog.objects.create(user=user, action="signedout", entity="session", entity_id=user.pk,
                            entity_name=user.get_full_name() or user.username, details=f"{words} · {reference}")


class PasswordView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [DynamicScopedRateThrottle]
    throttle_scope = "password"

    @transaction.atomic
    def post(self, request):
        data = body(request)
        user = locked_user(request)
        current = data.get("current")
        if not isinstance(current, str) or not current:
            raise ValidationError({"current": ["Enter your current password."]})
        if not user.check_password(current):
            raise ValidationError({"current": ["That isn't your current password. Check Caps Lock and try again."]})
        password = data.get("password")
        validate_password(password, user, own=True, change=True)
        sid = getattr(request.user, "_session_id", None)
        session = uncached(SignInSession).filter(pk=sid, user_id=user.pk, signed_out_at__isnull=True).first() if sid else None
        if session is None:
            session = SignInSession.objects.create(user=user, device=device_name(request.META.get("HTTP_USER_AGENT", "")))
        user.set_password(password)
        user.save(update_fields=["password"])
        changed_at, _ = revoke_all(user, actor=user, keep=session.pk)
        security = security_for(user)
        security.must_change_password = False
        security.save(update_fields=["must_change_password"])
        audit_user(user, user, "password", "Changed by themself · other devices signed out")
        return Response({"detail": "Password changed. Your other devices are signed out.", "changed_at": stamp(changed_at), **pair_for(user, session)})


class SessionsView(APIView):
    permission_classes = [DeviceAccess]

    def get(self, request):
        current = getattr(request.user, "_session_id", None)
        rows = list(uncached(SignInSession).filter(user_id=request.user.pk, signed_out_at__isnull=True)
                    .order_by("-last_used_at", "id").values("id", "device", "created_at", "last_used_at"))
        rows.sort(key=lambda row: str(row["id"]) != current)
        return Response({"results": [{"id": str(row["id"]), "device": row["device"],
                  "created_at": stamp(row["created_at"]), "last_used_at": stamp(row["last_used_at"]),
                  "current": str(row["id"]) == current} for row in rows]})


class SessionEndView(APIView):
    permission_classes = [DeviceAccess]

    @transaction.atomic
    def post(self, request, pk=None):
        user = locked_user(request)
        current = getattr(request.user, "_session_id", None)
        sessions = uncached(SignInSession).filter(user_id=user.pk, signed_out_at__isnull=True)
        if pk is not None:
            try:
                session_id = UUID(pk)
            except (ValueError, TypeError, AttributeError):
                raise NotFound("That device is signed out already.") from None
            if str(session_id) == current:
                raise ValidationError({"detail": "That's this device. Use Sign out at the top instead."})
            session = sessions.only("id", "device").filter(pk=session_id).first()
            if session is None:
                raise NotFound("That device is signed out already.")
            sessions = sessions.filter(pk=session_id)
            words = f"Signed out on {session.device}"
            ended_ids = [session.pk]
        else:
            if current:
                sessions = sessions.exclude(pk=current)
            words = None
            ended_ids = list(sessions.values_list("pk", flat=True))
        count = sessions.update(signed_out_at=timezone.now(), signed_out_by=user, ended_how="signed_out")
        invalidate(SignInSession)
        session_audit(user, words or f"Signed out on {count} other devices", ended_ids, current)
        return Response(status=204) if pk is not None else Response({"signed_out": count})


class SignOutView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request):
        data = body(request)
        user = locked_user(request)
        sid = getattr(request.user, "_session_id", None)
        raw = data.get("refresh")
        if "refresh" in data and not isinstance(raw, str):
            raise ValidationError({"refresh": ["Use the refresh token from this sign-in."]})
        if raw:
            try:
                token = RefreshToken(raw)
                if str(token.get("user_id")) != str(user.pk) or token.get("sid") != sid:
                    raise ValidationError({"refresh": ["Use the refresh token from this sign-in."]})
                track_refresh(token, blacklist=True)
            except TokenError:
                pass  # An expired/already-used refresh cannot be used again; end its device anyway.
        session = uncached(SignInSession).filter(pk=sid, user_id=user.pk).only("device").first() if sid else None
        if session:
            ended_ids = [session.pk]
            uncached(SignInSession).filter(pk=sid).update(signed_out_at=timezone.now(), signed_out_by=user, ended_how="signed_out")
            invalidate(SignInSession)
        else:
            ended_ids = list(uncached(SignInSession).filter(user_id=user.pk, signed_out_at__isnull=True)
                             .values_list("pk", flat=True))
            revoke_all(user, actor=user, how="signed_out")
        session_audit(user, f"Signed out on {session.device if session else 'this device'}", ended_ids, sid)
        return Response(status=204)
