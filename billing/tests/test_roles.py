"""v3 roles: four roles over Django groups, beside v2's admin/editor/viewer."""

import json
from pathlib import Path

from django.contrib.auth.models import Group, User
from django.test import TestCase

from billing.api.permissions import get_user_role
from billing.roles import GROUP_ACCOUNTANT, GROUP_STAFF, PERMS, ROLES, can, needs_role_choice, permissions_of, role_of

PERMS_JSON = Path(__file__).resolve().parents[2] / "web" / "src" / "core" / "auth" / "perms.json"


def user_in(*groups, superuser=False):
    u = User.objects.create_user(username="u" + "-".join(groups or ("none",)) + ("-su" if superuser else ""), password="x", is_superuser=superuser)
    for g in groups:
        u.groups.add(Group.objects.get_or_create(name=g)[0])
    return u


class RoleOfTest(TestCase):
    def test_superuser_and_admin_are_owner(self):
        self.assertEqual(role_of(user_in(superuser=True)), "owner")
        self.assertEqual(role_of(user_in("admin")), "owner")

    def test_v3_groups_win_over_editor(self):
        self.assertEqual(role_of(user_in(GROUP_ACCOUNTANT, "editor")), "accountant")
        self.assertEqual(role_of(user_in(GROUP_STAFF, "editor")), "staff")

    def test_unplaced_editor_is_staff_and_needs_a_choice(self):
        u = user_in("editor")
        self.assertEqual(role_of(u), "staff")
        self.assertTrue(needs_role_choice(u))
        self.assertFalse(needs_role_choice(user_in(GROUP_STAFF, "editor")))

    def test_viewer_and_no_group_are_viewer(self):
        self.assertEqual(role_of(user_in("viewer")), "viewer")
        self.assertEqual(role_of(user_in()), "viewer")

    def test_v2_role_is_unchanged_by_v3_groups(self):
        # rollback safety: v2 reads only admin/editor/viewer
        self.assertEqual(get_user_role(user_in(GROUP_STAFF, "editor")), "editor")
        self.assertEqual(get_user_role(user_in(GROUP_ACCOUNTANT, "editor")), "editor")

    def test_anonymous_has_no_role(self):
        from django.contrib.auth.models import AnonymousUser
        self.assertIsNone(role_of(AnonymousUser()))
        self.assertEqual(permissions_of(AnonymousUser()), [])


class CanTest(TestCase):
    def test_matrix(self):
        self.assertTrue(can(user_in("admin"), "bill.delete"))
        staff = user_in(GROUP_STAFF, "editor")
        self.assertTrue(can(staff, "bill.create"))
        self.assertFalse(can(staff, "bill.edit"))
        acct = user_in(GROUP_ACCOUNTANT, "editor")
        self.assertTrue(can(acct, "gst.file"))
        self.assertFalse(can(acct, "bill.create"))
        self.assertEqual(permissions_of(user_in("viewer")), ["view", "reports.export"])

    def test_every_role_names_its_v2_group(self):
        self.assertEqual(ROLES["owner"]["groups"], ["admin"])
        self.assertEqual(ROLES["accountant"]["groups"], [GROUP_ACCOUNTANT, "editor"])
        self.assertEqual(ROLES["staff"]["groups"], [GROUP_STAFF, "editor"])
        self.assertEqual(ROLES["viewer"]["groups"], ["viewer"])


class GroupsExistTest(TestCase):
    def test_migration_created_the_v3_groups(self):
        self.assertTrue(Group.objects.filter(name=GROUP_ACCOUNTANT).exists())
        self.assertTrue(Group.objects.filter(name=GROUP_STAFF).exists())


class ClientCopyTest(TestCase):
    def test_web_perms_json_matches(self):
        data = json.loads(PERMS_JSON.read_text())
        self.assertEqual(data["perms"], PERMS)
        self.assertEqual(data["roles"], {k: {"label": v["label"], "blurb": v["blurb"]} for k, v in ROLES.items()})
