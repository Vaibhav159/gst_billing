"""v3 roles and what each may do.

Four roles: owner, accountant, staff (counter staff) and viewer. Each user also keeps a v2 group
(admin, editor or viewer), so today's permission classes keep working and a rollback to v2 is safe:
the owner sits in admin, the accountant and counter staff in editor, viewers in viewer. The matrix
matches the prototype's (PROTO/core/select.js PERMS); web/src/core/auth/perms.json is the client's
copy, and billing/tests/test_roles.py keeps the two equal.
"""

from types import MappingProxyType

GROUP_ACCOUNTANT = "accountant"
# Not "staff": that word already means Django's is_staff (admin-site access).
GROUP_STAFF = "counter_staff"
V3_GROUPS = frozenset({GROUP_ACCOUNTANT, GROUP_STAFF})

ROLES = {
    "owner": {"label": "Owner", "blurb": "Everything, including deleting bills, locking months and managing users.", "groups": ["admin"]},
    "accountant": {"label": "Accountant", "blurb": "Sees everything, books purchase bills, files GST and locks months. Can't change or delete sales bills.", "groups": [GROUP_ACCOUNTANT, "editor"]},
    "staff": {"label": "Counter staff", "blurb": "Makes and sends bills, books purchase bills, adds customers and sets today's rates. Can't delete or file.", "groups": [GROUP_STAFF, "editor"]},
    "viewer": {"label": "View only", "blurb": "Can look at everything and download reports. Changes nothing.", "groups": ["viewer"]},
}


class FrozenList(list):
    """A list nobody can change. PERMS is read on every request, so one stray append would widen
    a role for the whole process (part 0, Ruling 58). It still equals the plain list it was made from."""

    def _refuse(self, *args, **kwargs):
        raise TypeError("PERMS is read-only")

    append = extend = insert = remove = pop = clear = sort = reverse = _refuse
    __setitem__ = __delitem__ = __iadd__ = __imul__ = _refuse


PERMS = MappingProxyType({
    "owner": "*",
    "accountant": FrozenList(["view", "reports.export", "gst.file", "gst.lock", "gst.download", "backup.download", "audit.view", "purchase.create", "purchase.edit", "purchase.import", "capture", "supplier.edit", "customer.edit"]),
    "staff": FrozenList(["view", "bill.create", "bill.send", "capture", "purchase.create", "purchase.import", "supplier.edit", "customer.edit", "rates.edit", "reports.export"]),
    "viewer": FrozenList(["view", "reports.export"]),
})

# whyNot's words (web/src/core/auth/permissions.ts), so a 403 reads like the screen's hint.
ROLE_WHO = {"owner": "the owner", "accountant": "the accountant", "staff": "counter staff", "viewer": "view-only users"}
ACTION_WHAT = {
    "bill.create": "make bills", "bill.edit": "change bills", "bill.delete": "delete bills", "bill.cancel": "cancel bills", "bill.send": "send bills",
    "capture": "take photos of supplier bills", "purchase.create": "add purchases", "purchase.edit": "change purchases", "purchase.delete": "delete purchases",
    "customer.edit": "add or change customers", "product.edit": "add or change products", "firm.edit": "change firm details",
    "gst.file": "mark returns filed", "gst.lock": "lock or unlock a month", "gst.download": "download returns for the portal",
    "users.manage": "manage users", "settings.edit": "change settings", "backup.download": "download backups", "backup.restore": "restore a backup",
    "audit.view": "see the Audit log", "audit.restore": "restore from the Audit log", "audit.undo": "undo changes from the Audit log", "reports.export": "export reports",
    "customer.merge": "merge customers", "capture.discard": "remove captured photos", "purchase.import": "import bills from a file", "supplier.edit": "add or change suppliers", "rates.edit": "set today's rates", "view": "see this",
}


def group_names(user):
    """The user's group names, read once per user object.

    DRF loads the user afresh for every request, so this is one auth_group query per request;
    /api/me/ used to make four. billing.signals forgets the names when the user's groups change.
    """
    names = getattr(user, "_group_names", None)
    if names is None:
        names = frozenset(user.groups.values_list("name", flat=True))
        user._group_names = names
    return names


def role_of(user):
    """The user's v3 role, or None when nobody is signed in."""
    if not user or not user.is_authenticated:
        return None
    if user.is_superuser:
        return "owner"
    groups = group_names(user)
    if "admin" in groups:
        return "owner"
    if GROUP_ACCOUNTANT in groups:
        return "accountant"
    if GROUP_STAFF in groups:
        return "staff"
    if "editor" in groups:
        # a v2 editor the owner hasn't placed yet: the least that still lets them bill
        return "staff"
    return "viewer"


def needs_role_choice(user):
    """A v2 editor with no v3 role yet: the owner should choose Counter staff or Accountant."""
    if not user or not user.is_authenticated or user.is_superuser:
        return False
    groups = group_names(user)
    return "editor" in groups and not groups & {"admin", GROUP_ACCOUNTANT, GROUP_STAFF}


def permissions_of(user):
    role = role_of(user)
    return PERMS[role] if role else []


def can(user, action):
    perms = permissions_of(user)
    return perms == "*" or action in perms


def is_placed(user):
    """True when the owner has put this person in a v3 group (accountant or counter staff)."""
    return bool(user and user.is_authenticated and group_names(user) & V3_GROUPS)


def why_not(user, action):
    """Why `user` can't do `action`, in whyNot's words; "" when they can.

    "Only the owner and counter staff can make bills. Ask the owner if you need it."
    """
    if can(user, action):
        return ""
    who = [ROLE_WHO[r] for r, p in PERMS.items() if p == "*" or action in p]
    names = f"{', '.join(who[:-1])} and {who[-1]}" if len(who) > 1 else (who[0] if who else "the owner")
    tail = "" if role_of(user) == "owner" else " Ask the owner if you need it."
    return f"Only {names} can {ACTION_WHAT.get(action, 'do this')}.{tail}"
