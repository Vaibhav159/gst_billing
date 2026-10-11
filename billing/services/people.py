"""People and profiles: narrow reads, paired groups and transactional audit writes."""

import re

from django.contrib.auth.models import Group, User
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.db.models import Max
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from billing.cache import uncached
from billing.models import Business, SignInSession, UserPreference, UserSecurity
from billing.refusals import Refusal
from billing.roles import ROLES, needs_role_choice, role_of
from billing.services.accounts import audit_user, revoke_all, security_for, set_password, validate_password
from billing.text import person, stamp

USER_FIELDS = ("id", "username", "first_name", "last_name", "email", "is_active", "is_superuser", "date_joined")
ROLE_GROUPS = ("admin", "editor", "viewer", "accountant", "counter_staff")
ROLE_WORDS = "Pick a role: owner, accountant, counter staff or view only."
EMAIL_WORDS = "That email looks incomplete. It should look like name@example.com."
FIRM_WORDS = "Pick a firm from the list."


def body_object(data):
    if not isinstance(data, dict):
        raise ValidationError({"detail": "Send the fields as an object."})
    return data


def text_field(data, key, words, limit=150, required=False):
    value = data.get(key, "")
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        raise ValidationError({key: [words]})
    return value.strip()


def checked_email(data):
    value = text_field(data, "email", EMAIL_WORDS, limit=254)
    if value:
        try:
            validate_email(value)
        except DjangoValidationError:
            raise ValidationError({"email": [EMAIL_WORDS]}) from None
    return value


def checked_role(data):
    value = data.get("role")
    if not isinstance(value, str) or value not in ROLES:
        raise ValidationError({"role": [ROLE_WORDS]})
    return value


def firm_fields():
    return ["id", "name"] + (["short_name"] if any(f.name == "short_name" for f in Business._meta.fields) else [])


def firm_ref(row):
    if row is None:
        return None
    return {"id": row["id"], "name": row["name"],
            "short": row.get("short_name") or (row["name"].split()[0].title() if row["name"].split() else "")}


def checked_firm(data, key):
    value = data.get(key)
    if key not in data:
        raise ValidationError({key: [FIRM_WORDS]})
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (str, int)) or not re.fullmatch(r"[0-9]{1,10}", str(value)):
        raise ValidationError({key: [FIRM_WORDS]})
    row = uncached(Business).filter(pk=int(value)).values(*firm_fields()).first()
    if row is None:
        raise ValidationError({key: [FIRM_WORDS]})
    return firm_ref(row)


def default_firm_id(data):
    value = data.get("defaultBusinessId") if isinstance(data, dict) else None
    return int(value) if isinstance(value, (str, int)) and not isinstance(value, bool) and re.fullmatch(r"[0-9]{1,10}", str(value)) else None


def people_rows(actor, pk=None):
    query = uncached(User).only(*USER_FIELDS)
    if pk is not None:
        query = query.filter(pk=pk)
    users = list(query)
    ids = [user.pk for user in users]
    groups = {}
    for user_id, name in uncached(User.groups.through).filter(user_id__in=ids).values_list("user_id", "group__name"):
        groups.setdefault(user_id, set()).add(name)
    prefs = dict(uncached(UserPreference).filter(user_id__in=ids).values_list("user_id", "data"))
    security = {row["user_id"]: row for row in uncached(UserSecurity).filter(user_id__in=ids).values(
        "user_id", "must_change_password", "stopped_at", "stopped_by_id", "stopped_by__username",
        "stopped_by__first_name", "stopped_by__last_name")}
    active = dict(uncached(SignInSession).filter(user_id__in=ids).values("user_id").annotate(last=Max("last_used_at")).values_list("user_id", "last"))
    firm_ids = {default_firm_id(data) for data in prefs.values()} - {None}
    firms = {row["id"]: firm_ref(row) for row in uncached(Business).filter(pk__in=firm_ids).values(*firm_fields())}
    rows = []
    for user in users:
        user._group_names = frozenset(groups.get(user.pk, ()))
        role = role_of(user)
        sec = security.get(user.pk, {})
        stopped_by = None
        if sec.get("stopped_by_id"):
            name = f"{sec['stopped_by__first_name'] or ''} {sec['stopped_by__last_name'] or ''}".strip()
            stopped_by = {"id": sec["stopped_by_id"], "name": name or sec["stopped_by__username"]}
        choice = needs_role_choice(user)
        rows.append({
            "id": user.pk, "username": user.username, "first_name": user.first_name, "last_name": user.last_name,
            "name": person(user)["name"], "email": user.email, "role": role, "role_label": ROLES[role]["label"],
            "placed": not choice, "needs_role_choice": choice, "active": user.is_active,
            "stopped_at": stamp(sec.get("stopped_at")), "stopped_by": stopped_by,
            "usual_firm": firms.get(default_firm_id(prefs.get(user.pk))), "last_active": stamp(active.get(user.pk)),
            "joined": timezone.localdate(user.date_joined).isoformat(),
            "must_change_password": sec.get("must_change_password", False), "you": user.pk == actor.pk,
        })
    return sorted(rows, key=lambda row: (not row["you"], tuple(ROLES).index(row["role"]), row["name"].casefold(), row["id"]))


def account_row(user):
    from billing.services.sms import sms_enabled

    profile = uncached(User).only("id", "username", "first_name", "last_name", "email", "is_superuser").get(pk=user.pk)
    role = role_of(profile)
    owner = role == "owner"
    pref = uncached(UserPreference).filter(user_id=user.pk).values_list("data", flat=True).first()
    firm_id = default_firm_id(pref)
    firm = firm_ref(uncached(Business).filter(pk=firm_id).values(*firm_fields()).first()) if firm_id else None
    fields = ["must_change_password"] + (["phone"] if owner else [])
    security = uncached(UserSecurity).filter(user_id=user.pk).values(*fields).first() or {}
    return {"id": profile.pk, "username": profile.username, "first_name": profile.first_name,
            "last_name": profile.last_name, "email": profile.email, "role": role, "role_label": ROLES[role]["label"],
            "usual_firm": firm, "must_change_password": security.get("must_change_password", False),
            "phone": security.get("phone", "") if owner else None, "phone_allowed": owner,
            "sms_reset": sms_enabled()}


def assign_role(user, role):
    user.groups.remove(*uncached(Group).filter(name__in=ROLE_GROUPS).values_list("pk", flat=True))
    user.groups.add(*(uncached(Group).get_or_create(name=name)[0] for name in ROLES[role]["groups"]))
    if user.is_superuser and role != "owner":
        user.is_superuser = False
        user.save(update_fields=["is_superuser"])


def save_firm(user, firm):
    pref, _ = uncached(UserPreference).get_or_create(user=user)
    pref.data = dict(pref.data) if isinstance(pref.data, dict) else {}
    if firm is None:
        pref.data.pop("defaultBusinessId", None)
    else:
        pref.data["defaultBusinessId"] = str(firm["id"])
    pref.save(update_fields=["data", "updated_at"])


def target_user(pk):
    user = uncached(User).select_for_update().only(*USER_FIELDS).filter(pk=pk).first()
    if user is None:
        raise NotFound("That person isn't on file.")
    return user


@transaction.atomic
def create_person(actor, data):
    data = body_object(data)
    first_name = text_field(data, "first_name", "Enter their first name, as it should show in the Audit log.", required=True)
    last_name = text_field(data, "last_name", "Enter their last name in 150 characters or fewer.")
    username = text_field(data, "username", "Pick a username they'll sign in with.", limit=150, required=True)
    if not re.fullmatch(r"[a-z0-9._]{3,20}", username):
        raise ValidationError({"username": ["Use 3 to 20 lowercase letters, digits, dots or underscores."]})
    email = checked_email(data)
    role = checked_role(data)
    firm = checked_firm({"usual_firm": None, **data}, "usual_firm")
    candidate = User(username=username, first_name=first_name, last_name=last_name, email=email)
    validate_password(data.get("password", ""), candidate)
    # A shared existing group serializes v3's case-insensitive username check on Postgres.
    group, _ = uncached(Group).get_or_create(name="admin")
    uncached(Group).select_for_update().only("id").get(pk=group.pk)
    holder = uncached(User).filter(username__iexact=username).only("id", "username", "first_name", "last_name").first()
    if holder:
        raise ValidationError({"username": [f"@{username} is taken by {person(holder)['name']}. Try another."]})
    try:
        with transaction.atomic():
            candidate.set_password(data["password"])
            candidate.save()
    except IntegrityError:
        raise ValidationError({"username": [f"@{username} is taken. Try another."]}) from None
    assign_role(candidate, role)
    save_firm(candidate, firm)
    security = security_for(candidate)
    security.must_change_password = True
    security.save(update_fields=["must_change_password"])
    details = f"As {ROLES[role]['label']} · @{username}" + (f" · usually works for {firm['short']}" if firm else "")
    audit_user(actor, candidate, "created", details)
    return people_rows(actor, candidate.pk)[0]


@transaction.atomic
def change_person(actor, pk, action, data):
    data = body_object(data)
    user = target_user(pk)
    if user.pk == actor.pk and action in ("role", "stop", "password"):
        words = {"role": "You can't change your own role. Another owner can.",
                 "stop": "You can't stop yourself signing in. Another owner can.",
                 "password": "Change your own password on your profile."}[action]
        raise Refusal(words, "own_account")
    old = people_rows(actor, pk)[0]
    if action == "role":
        role = checked_role(data)
        assign_role(user, role)
        changes = {"role": {"old": old["role_label"], "new": ROLES[role]["label"]}}
        audit_user(actor, user, "updated", f"{old['role_label']} → {ROLES[role]['label']}", changes)
    elif action == "usual-firm":
        firm = checked_firm(data, "business")
        save_firm(user, firm)
        before = old["usual_firm"]["short"] if old["usual_firm"] else "Shop's default"
        after = firm["short"] if firm else "Shop's default"
        audit_user(actor, user, "updated", f"Usually works for: {before} → {after}",
                   {"usual_firm": {"old": before, "new": after}})
    elif action == "password":
        password = data.get("password", "")
        validate_password(password, user, change=True)
        set_password(user, password)
        audit_user(actor, user, "password", "Set by the owner · signed out everywhere")
        return {"detail": f"New password set for {person(user)['name']}. They're signed out everywhere and choose their own when they next sign in."}
    elif action == "stop":
        user.is_active = False
        user.save(update_fields=["is_active"])
        at, _ = revoke_all(user, actor=actor, how="stopped")
        security = security_for(user)
        security.stopped_at = at
        security.stopped_by = actor
        security.save(update_fields=["stopped_at", "stopped_by"])
        audit_user(actor, user, "stopped", "Signed out everywhere · bills and history kept")
    elif action == "allow":
        user.is_active = True
        user.save(update_fields=["is_active"])
        security = security_for(user)
        security.stopped_at = None
        security.stopped_by = None
        security.save(update_fields=["stopped_at", "stopped_by"])
        audit_user(actor, user, "allowed", f"As {old['role_label']}")
    else:
        raise NotFound("That action isn't on file.")
    return people_rows(actor, pk)[0]


def masked_phone(phone):
    return phone[:2] + "••••••" + phone[-2:] if phone else "None"


@transaction.atomic
def change_account(actor, data):
    data = body_object(data)
    user = target_user(actor.pk)
    values = {}
    if "first_name" in data:
        values["first_name"] = text_field(data, "first_name", "Enter your first name. It shows in the Audit log next to your changes.", required=True)
    if "last_name" in data:
        values["last_name"] = text_field(data, "last_name", "Enter your last name in 150 characters or fewer.")
    if "email" in data:
        values["email"] = checked_email(data)
    if "phone" in data:
        if role_of(user) != "owner":
            raise ValidationError({"phone": ["Only the owner can save a mobile number for password codes."]})
        phone = data["phone"]
        if not isinstance(phone, str) or (phone and not re.fullmatch(r"[0-9]{10}", phone)):
            n = sum(ch in "0123456789" for ch in phone) if isinstance(phone, str) else 0
            raise ValidationError({"phone": [f"A mobile number has 10 digits; this has {n}."]})
    changes = {key: {"old": getattr(user, key) or "None", "new": value or "None"}
               for key, value in values.items() if getattr(user, key) != value}
    for key, value in values.items():
        setattr(user, key, value)
    if values:
        user.save(update_fields=list(values))
    if "phone" in data:
        security = security_for(user)
        if security.phone != phone:
            changes["phone"] = {"old": masked_phone(security.phone), "new": masked_phone(phone)}
            security.phone = phone
            security.save(update_fields=["phone"])
    audit_user(actor, user, "updated", ", ".join(changes), changes)
    return account_row(user)
