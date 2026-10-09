"""v3 roles and what each may do.

Four roles: owner, accountant, staff (counter staff) and viewer. Each user also keeps a v2 group
(admin, editor or viewer), so today's permission classes keep working and a rollback to v2 is safe:
the owner sits in admin, the accountant and counter staff in editor, viewers in viewer. The matrix
matches the prototype's (PROTO/core/select.js PERMS); web/src/core/auth/perms.json is the client's
copy, and billing/tests/test_roles.py keeps the two equal.
"""

GROUP_ACCOUNTANT = "accountant"
# Not "staff": that word already means Django's is_staff (admin-site access).
GROUP_STAFF = "counter_staff"

ROLES = {
    "owner": {"label": "Owner", "blurb": "Everything, including deleting bills, locking months and managing users.", "groups": ["admin"]},
    "accountant": {"label": "Accountant", "blurb": "Sees everything, books purchase bills, files GST and locks months. Can't change or delete sales bills.", "groups": [GROUP_ACCOUNTANT, "editor"]},
    "staff": {"label": "Counter staff", "blurb": "Makes and sends bills, books purchase bills, adds customers and sets today's rates. Can't delete or file.", "groups": [GROUP_STAFF, "editor"]},
    "viewer": {"label": "View only", "blurb": "Can look at everything and download reports. Changes nothing.", "groups": ["viewer"]},
}

PERMS = {
    "owner": "*",
    "accountant": ["view", "reports.export", "gst.file", "gst.lock", "gst.download", "backup.download", "audit.view", "purchase.create", "purchase.edit", "purchase.import", "capture", "supplier.edit", "customer.edit"],
    "staff": ["view", "bill.create", "bill.send", "capture", "purchase.create", "purchase.import", "supplier.edit", "customer.edit", "rates.edit", "reports.export"],
    "viewer": ["view", "reports.export"],
}


def _groups(user):
    return set(user.groups.values_list("name", flat=True))


def role_of(user):
    """The user's v3 role, or None when nobody is signed in."""
    if not user or not user.is_authenticated:
        return None
    if user.is_superuser:
        return "owner"
    groups = _groups(user)
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
    groups = _groups(user)
    return "editor" in groups and not groups & {"admin", GROUP_ACCOUNTANT, GROUP_STAFF}


def permissions_of(user):
    role = role_of(user)
    return PERMS[role] if role else []


def can(user, action):
    perms = permissions_of(user)
    return perms == "*" or action in perms
