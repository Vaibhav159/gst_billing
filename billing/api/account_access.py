"""v3's password gate; v2's compatibility endpoints explicitly bypass it."""
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated


def password_gate(user):
    # SessionJWTAuthentication already joins this row on every real request. A second
    # read adds no check; force_authenticate deliberately bypasses the authentication layer.
    security = getattr(user, "_v3_security", None)
    if security and security.must_change_password:
        raise PermissionDenied({"detail": "Choose your own password first. The owner set this one for you.", "code": "password_change_needed"})


class AccountAccess(IsAuthenticated):
    """Own profile remains available during forced password change (§0.4)."""


class DeviceAccess(IsAuthenticated):
    def has_permission(self, request, view):
        allowed = super().has_permission(request, view)
        if allowed:
            password_gate(request.user)
        return allowed
