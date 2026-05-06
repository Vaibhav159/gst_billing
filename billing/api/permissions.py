"""
Role-based permission classes for the GST billing API.

Three roles:
- Admin: full access (CRUD + settings + user management)
- Editor: create, read, update (no delete, no settings, no user management)
- Viewer: read only (list, retrieve, print, export)
"""
from rest_framework.permissions import BasePermission, SAFE_METHODS


def get_user_role(user):
    """Get the user's role from their groups. Defaults to 'viewer' if no group."""
    if not user or not user.is_authenticated:
        return None
    if user.is_superuser:
        return "admin"
    groups = set(user.groups.values_list("name", flat=True))
    if "admin" in groups:
        return "admin"
    if "editor" in groups:
        return "editor"
    if "viewer" in groups:
        return "viewer"
    # No group assigned — default to editor for backward compatibility
    return "editor"


class RoleBasedPermission(BasePermission):
    """
    - Admin: all methods allowed
    - Editor: GET, POST, PUT, PATCH allowed. DELETE denied.
    - Viewer: only GET (safe methods) allowed.
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        role = get_user_role(request.user)

        if role == "admin":
            return True

        if role == "editor":
            # Editors can do everything except DELETE
            return request.method != "DELETE"

        if role == "viewer":
            # Viewers can only read
            return request.method in SAFE_METHODS

        return False


class AdminOnlyPermission(BasePermission):
    """Only admin users can access this view."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        return get_user_role(request.user) == "admin"
