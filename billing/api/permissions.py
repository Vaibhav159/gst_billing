"""
Role-based permission classes for the GST billing API.

Three roles:
- Admin: full access (CRUD + settings + user management)
- Editor: create, read, update (no delete, no settings, no user management)
- Viewer: read only (list, retrieve, print, export)

v3 adds its matrix (billing.roles) beside them: V3Permission on v3's own endpoints, and
V3PermissionIfPlaced on v2's selling endpoints for people the owner has placed in a v3 group.
"""
from rest_framework.permissions import SAFE_METHODS, BasePermission

from billing.roles import can, group_names, is_placed, why_not


def get_user_role(user):
    """Get the user's role from their groups. Defaults to 'viewer' if no group."""
    if not user or not user.is_authenticated:
        return None
    if user.is_superuser:
        return "admin"
    groups = group_names(user)
    if "admin" in groups:
        return "admin"
    if "editor" in groups:
        return "editor"
    if "viewer" in groups:
        return "viewer"
    # No group assigned — least privilege. This used to default to editor,
    # which silently granted create/update to any account someone forgot to
    # put in a group. setup_roles assigns groups; ungrouped now means read-only.
    return "viewer"


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


# A key that rests on the stored object, asked before DRF has loaded it: has_permission lets the
# request on, and has_object_permission decides from the object get_object() found. A bad or
# missing id is then DRF's 404, as in v2, and the object costs no query of its own (Rulings
# 1A-13 and 1A-15).
LATER = object()


def needed(request, view, obj=None):
    """The v3 permission key a request needs, or None for a write nobody declared.

    A view names its keys in `v3_actions`, by action on a viewset ({"cancel": "bill.cancel"})
    or by HTTP method on an APIView ({"PUT": "settings.edit"}); a value may be a function of
    (request, view, obj), where obj is the object get_object() found (None until it has looked).
    Anything not named needs "view" to read.
    """
    actions = getattr(view, "v3_actions", {})
    key = getattr(view, "action", None) or request.method
    if key in actions:
        need = actions[key]
        return need(request, view, obj) if callable(need) else need
    return "view" if request.method in SAFE_METHODS else None


class V3Permission(BasePermission):
    """The v3 matrix (billing.roles.PERMS), for everyone, on v3's own endpoints.

    A write the view doesn't name is refused even to the owner, so a new action stays closed
    until someone gives it a key. A refusal says who may, in whyNot's words:
    403 {"detail": "Only the owner can cancel bills. Ask the owner if you need it.", "needs": "bill.cancel"}.
    """

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        return self._allows(user, needed(request, view))

    def has_object_permission(self, request, view, obj):
        return self._allows(request.user, needed(request, view, obj))

    def _allows(self, user, need):
        if need is LATER or (need and can(user, need)):
            return True
        self.message = {"detail": why_not(user, need) if need else "Nobody can do this here.", "needs": need or ""}
        return False


class V3PermissionIfPlaced(V3Permission):
    """The v3 matrix only for people the owner has placed in a v3 group; v2's rules for the rest.

    Paired with RoleBasedPermission on v2's selling endpoints and its import doors (design
    decision 4, Ruling 1A-14). A v2 admin, editor or viewer keeps exactly v2's rights until the
    owner gives them a v3 role, so v2's screens, v2's tests and a rollback see no change; an
    accountant the owner has placed can't make or change a sale through v2's endpoints.
    """

    def has_permission(self, request, view):
        # A method the view has no handler for gets DRF's 405, as everyone else does.
        if not is_placed(request.user) or not hasattr(view, request.method.lower()):
            return True
        return super().has_permission(request, view)

    def has_object_permission(self, request, view, obj):
        if not is_placed(request.user):
            return True
        return super().has_object_permission(request, view, obj)


def sale_or_purchase(sale_key, purchase_key, under=None):
    """A v3_actions value for a door that takes sales and purchases: the purchase key only when
    the bill is a purchase and stays one, the sale key otherwise.

    The type asked for is the request's type_of_invoice, inside request.data[under] when `under`
    is given (update_line_items sends it in "invoice"). A write to a stored bill needs both the
    stored type and the type asked for to be inward, and a request that names no type keeps the
    stored one. The stored type is read in has_object_permission, so such an action must load
    its bill with get_object().
    """

    def need(request, view, bill=None):
        if request.method in SAFE_METHODS:
            return "view"
        from billing.constants import INVOICE_TYPE_INWARD

        if getattr(view, "detail", False):
            if bill is None:
                return LATER
            kinds = (bill.type_of_invoice, _asked_type(request, under, bill.type_of_invoice))
        else:
            kinds = (_asked_type(request, under, None),)
        # Compared, never hashed: a list or a dict sent as the type gets the sale key, not a 500.
        return purchase_key if all(kind == INVOICE_TYPE_INWARD for kind in kinds) else sale_key

    return need


def _asked_type(request, under, unsaid):
    """The type_of_invoice a write asks for; `unsaid` when the request names none."""
    data = request.data
    if under:
        data = data.get(under) if isinstance(data, dict) else None
    return data.get("type_of_invoice", unsaid) if isinstance(data, dict) else unsaid
