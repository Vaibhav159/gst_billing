"""People, their own profile and the v2 user-management bridge."""

import json
from concurrent.futures import ThreadPoolExecutor
from unittest import skipUnless
from unittest.mock import patch

import pytest
from django.contrib.auth.models import Group, User
from django.db import connection, connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.test.utils import CaptureQueriesContext

from billing.models import AuditLog, UserPreference
from billing.roles import role_of
from billing.tests.test_v3_cacheops import cacheops_on
from billing.tests.v3_helpers import ROLE_GROUPS, client_for, firm, person


@pytest.mark.django_db
@pytest.mark.parametrize("surface", ["people", "users"])
@pytest.mark.parametrize("password", ["Indigo83724", "short"])
def test_self_password_reset_is_refused_before_any_account_mutation(surface, password):
    from billing.models import SignInSession
    from billing.services.accounts import security_for

    owner = person("kailash", "admin")
    original_password = owner.password
    security = security_for(owner)
    session = SignInSession.objects.create(user=owner, device="Chrome on Windows")
    client = client_for(owner)
    data = {"password": password, "role": "viewer", "is_active": False}
    if surface == "people":
        response = client.post(f"/api/people/{owner.pk}/password/", data, format="json")
    else:
        response = client.patch("/api/users/", {"user_id": str(owner.pk), **data}, format="json")
    assert response.status_code == 409
    assert response.data == {"detail": "Change your own password on your profile.", "code": "own_account"}
    owner.refresh_from_db()
    security.refresh_from_db()
    session.refresh_from_db()
    assert owner.password == original_password and owner.is_active
    assert role_of(owner) == "owner"
    assert not security.must_change_password and security.tokens_after is None
    assert session.signed_out_at is None
    assert not AuditLog.objects.exists()


class PeopleTest(TestCase):
    def setUp(self):
        self.owner = person("kailash", *ROLE_GROUPS["owner"], first_name="Kailash", last_name="Mehta")
        self.client = client_for(self.owner)
        self.staff = person("rakesh", *ROLE_GROUPS["staff"], first_name="Rakesh", last_name="Soni")
        self.firm = firm()

    def post(self, action, body=None, user=None):
        return self.client.post(f"/api/people/{(user or self.staff).pk}/{action}/", body or {}, format="json")

    def new_person(self, **changes):
        body = {"first_name": "Pooja", "last_name": "Soni", "username": "pooja_s", "email": "",
                "role": "staff", "usual_firm": self.firm.pk, "password": "Indigo83724"}
        return self.client.post("/api/people/", {**body, **changes}, format="json")

    def test_owner_set_password_must_differ_from_the_existing_password(self):
        self.staff.set_password("Indigo83724")
        self.staff.save(update_fields=["password"])
        response = self.post("password", {"password": "Indigo83724"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["password"], ["It needs: different from your current password."])

    @override_settings(SMS_RESET_ENABLED=True, SMS_PROVIDER="msg91", MSG91_AUTH_KEY="", MSG91_TEMPLATE_ID="", MSG91_SENDER="")
    def test_profile_hides_sms_reset_when_the_provider_is_not_ready(self):
        response = self.client.get("/api/account/")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["sms_reset"])

    def test_list_shape_order_and_unplaced_editor(self):
        old = person("old_editor", "editor", first_name="Asha")
        UserPreference.objects.create(user=self.staff, data={"defaultBusinessId": str(self.firm.pk)})
        response = self.client.get("/api/people/")
        self.assertEqual(response.status_code, 200)
        rows = response.data["results"]
        self.assertEqual(rows[0]["id"], self.owner.pk)
        unplaced = next(row for row in rows if row["id"] == old.pk)
        self.assertFalse(unplaced["placed"])
        self.assertTrue(unplaced["needs_role_choice"])
        staff = next(row for row in rows if row["id"] == self.staff.pk)
        self.assertTrue(staff["placed"])
        self.assertEqual(staff["usual_firm"], {"id": self.firm.pk, "name": "KIRAN GOLD HOUSE", "short": "Kiran"})
        self.assertIsNone(staff["last_active"])
        self.assertEqual(set(staff), {"id", "username", "first_name", "last_name", "name", "email", "role",
                                     "role_label", "placed", "needs_role_choice", "active", "stopped_at", "stopped_by",
                                     "usual_firm", "last_active", "joined", "must_change_password", "you"})

    def test_every_people_door_requires_users_manage(self):
        for role in ("accountant", "staff", "viewer"):
            client = client_for(person(role, *ROLE_GROUPS[role]))
            for method, url in [("get", "/api/people/"), ("post", "/api/people/")] + [
                ("post", f"/api/people/{self.staff.pk}/{action}/")
                for action in ("role", "usual-firm", "password", "stop", "allow")
            ]:
                response = getattr(client, method)(url)
                self.assertEqual(response.status_code, 403, (role, url))
                self.assertEqual(response.data["needs"], "users.manage")

    def test_create_hashes_password_sets_both_groups_preferences_and_safe_audit(self):
        response = self.new_person()
        self.assertEqual(response.status_code, 201, response.data)
        made = User.objects.get(pk=response.data["id"])
        self.assertTrue(made.check_password("Indigo83724"))
        self.assertEqual(set(made.groups.values_list("name", flat=True)), {"counter_staff", "editor"})
        self.assertTrue(response.data["must_change_password"])
        self.assertEqual(UserPreference.objects.get(user=made).data["defaultBusinessId"], str(self.firm.pk))
        entry = AuditLog.objects.get(entity="user", entity_id=made.pk, action="created")
        self.assertEqual(entry.details, "As Counter staff · @pooja_s · usually works for Kiran")
        self.assertNotIn("password", json.dumps(entry.snapshot or {}))
        self.assertNotIn("Indigo83724", json.dumps(entry.changes or {}))

    def test_create_validation_exact_words_and_odd_shapes(self):
        cases = [
            ({"first_name": ""}, "first_name", "Enter their first name, as it should show in the Audit log."),
            ({"username": ""}, "username", "Pick a username they'll sign in with."),
            ({"username": "Ab"}, "username", "Use 3 to 20 lowercase letters, digits, dots or underscores."),
            ({"email": "half@"}, "email", "That email looks incomplete. It should look like name@example.com."),
            ({"role": []}, "role", "Pick a role: owner, accountant, counter staff or view only."),
            ({"usual_firm": {}}, "usual_firm", "Pick a firm from the list."),
        ]
        for changes, field, words in cases:
            with self.subTest(changes=changes):
                response = self.new_person(**changes)
                self.assertEqual(response.status_code, 400, response.data)
                self.assertEqual(response.data[field], [words])
        for field in ("first_name", "last_name", "email", "username", "password"):
            with self.subTest(field=field):
                self.assertEqual(self.new_person(**{field: {"bad": True}}).status_code, 400)
        self.assertEqual(self.client.post("/api/people/", [], format="json").status_code, 400)
        self.assertFalse(User.objects.filter(username="pooja_s").exists())

    def test_username_collision_ignores_case(self):
        person("POOJA_S", "viewer", first_name="Pooja", last_name="Soni")
        response = self.new_person()
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["username"], ["@pooja_s is taken by Pooja Soni. Try another."])

    def test_change_role_preserves_unrelated_groups_and_audits_labels(self):
        self.staff.groups.add(Group.objects.get_or_create(name="custom_team")[0])
        response = self.post("role", {"role": "accountant"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["role"], "accountant")
        self.assertEqual(set(self.staff.groups.values_list("name", flat=True)), {"accountant", "editor", "custom_team"})
        entry = AuditLog.objects.get(entity="user", entity_id=self.staff.pk)
        self.assertEqual(entry.changes, {"role": {"old": "Counter staff", "new": "Accountant"}})
        self.assertEqual(entry.details, "Counter staff → Accountant")

    def test_superuser_demotion_changes_the_effective_role(self):
        target = person("old_owner", "admin", superuser=True)
        response = self.post("role", {"role": "viewer"}, target)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["role"], "viewer")
        target.refresh_from_db()
        self.assertFalse(target.is_superuser)

    def test_self_role_and_stop_are_refused(self):
        for action, words in (("role", "You can't change your own role. Another owner can."),
                              ("stop", "You can't stop yourself signing in. Another owner can.")):
            response = self.post(action, {"role": "viewer"}, self.owner)
            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.data, {"detail": words, "code": "own_account"})
        response = self.client.post("/api/people/999999/role/", {"role": "viewer"}, format="json")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data["detail"], "That person isn't on file.")

    def test_usual_firm_preserves_preferences_and_can_clear(self):
        UserPreference.objects.create(user=self.staff, data={"phoneMode": "easy", "defaultBusinessId": "missing"})
        response = self.post("usual-firm", {"business": self.firm.pk})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["usual_firm"]["id"], self.firm.pk)
        self.assertEqual(UserPreference.objects.get(user=self.staff).data["phoneMode"], "easy")
        response = self.post("usual-firm", {"business": None})
        self.assertIsNone(response.data["usual_firm"])
        self.assertNotIn("defaultBusinessId", UserPreference.objects.get(user=self.staff).data)
        for body in ({"business": True}, {"business": 1.5}, {"business": []}, {}, {"business": 999999}):
            self.assertEqual(self.post("usual-firm", body).data["business"], ["Pick a firm from the list."])

    def test_stop_allow_and_owner_password_end_sessions_without_deleting_history(self):
        from billing.models import SignInSession, UserSecurity

        session = SignInSession.objects.create(user=self.staff, device="Chrome on Windows")
        response = self.post("stop")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["active"])
        self.assertEqual(response.data["stopped_by"], {"id": self.owner.pk, "name": "Kailash Mehta"})
        self.assertIsNotNone(response.data["stopped_at"])
        session.refresh_from_db()
        self.assertIsNotNone(session.signed_out_at)
        self.assertIsNotNone(UserSecurity.objects.get(user=self.staff).tokens_after)
        response = self.post("allow")
        self.assertTrue(response.data["active"])
        self.assertEqual(response.data["role"], "staff")
        self.staff.refresh_from_db()
        self.assertTrue(self.staff.check_password("x"))
        another = SignInSession.objects.create(user=self.staff, device="Safari on Mac")
        response = self.post("password", {"password": "Indigo83724"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["detail"], "New password set for Rakesh Soni. They're signed out everywhere and choose their own when they next sign in.")
        another.refresh_from_db()
        self.assertIsNotNone(another.signed_out_at)
        self.assertTrue(UserSecurity.objects.get(user=self.staff).must_change_password)
        self.assertEqual(AuditLog.objects.filter(entity="user", entity_id=self.staff.pk).count(), 3)

    def test_audit_failure_rolls_back_account_and_person_creation(self):
        with patch("billing.services.people.audit_user", side_effect=RuntimeError("audit unavailable")):
            with self.assertRaisesRegex(RuntimeError, "audit unavailable"):
                self.new_person()
            self.assertFalse(User.objects.filter(username="pooja_s").exists())
            with self.assertRaisesRegex(RuntimeError, "audit unavailable"):
                self.client.patch("/api/account/", {"first_name": "Changed", "phone": "9829017210"}, format="json")
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.first_name, "Kailash")
        self.assertEqual(self.client.get("/api/account/").data["phone"], "")

    def test_list_last_active_uses_the_session_timestamp(self):
        from datetime import datetime
        from zoneinfo import ZoneInfo

        from billing.models import SignInSession

        session = SignInSession.objects.create(user=self.staff, device="Chrome on Windows")
        SignInSession.objects.filter(pk=session.pk).update(last_used_at=datetime(2026, 10, 8, 16, 48, 59, tzinfo=ZoneInfo("Asia/Kolkata")))
        row = next(row for row in self.client.get("/api/people/").data["results"] if row["id"] == self.staff.pk)
        self.assertEqual(row["last_active"], "2026-10-08T16:48:59+05:30")

    def test_account_owner_phone_is_masked_in_audit_and_non_owner_cannot_write_it(self):
        response = self.client.patch("/api/account/", {"first_name": "Kailashji", "phone": "9829017210"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["phone"], "9829017210")
        self.assertTrue(response.data["phone_allowed"])
        self.assertFalse(response.data["sms_reset"])
        entry = AuditLog.objects.get(entity="user", entity_id=self.owner.pk)
        self.assertEqual(entry.changes["phone"], {"old": "None", "new": "98••••••10"})
        self.assertNotIn("9829017210", json.dumps(entry.changes))
        staff_client = client_for(self.staff)
        response = staff_client.patch("/api/account/", {"first_name": "Rakeshji", "phone": "9829017210"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.staff.refresh_from_db()
        self.assertEqual(self.staff.first_name, "Rakesh")
        row = staff_client.get("/api/account/").data
        self.assertIsNone(row["phone"])
        self.assertFalse(row["phone_allowed"])

    def test_account_validation_and_read_only_fields(self):
        cases = [({"first_name": ""}, "first_name", "Enter your first name. It shows in the Audit log next to your changes."),
                 ({"email": "broken"}, "email", "That email looks incomplete. It should look like name@example.com."),
                 ({"phone": "123"}, "phone", "A mobile number has 10 digits; this has 3.")]
        for body, key, words in cases:
            response = self.client.patch("/api/account/", body, format="json")
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.data[key], [words])
        response = self.client.patch("/api/account/", {"role": "viewer", "username": "hijack"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["role"], "owner")
        self.assertEqual(response.data["username"], "kailash")
        for body in ([], {"email": []}, {"phone": {}}, {"last_name": None}):
            self.assertEqual(self.client.patch("/api/account/", body, format="json").status_code, 400)

    def test_v2_editor_keeps_v3_group_and_password_revokes(self):
        from billing.models import SignInSession, UserSecurity

        for group in ("counter_staff", "accountant"):
            self.staff.groups.set([Group.objects.get_or_create(name=name)[0] for name in (group, "editor")])
            response = self.client.patch("/api/users/", {"user_id": self.staff.pk, "role": "editor"}, format="json")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(set(self.staff.groups.values_list("name", flat=True)), {group, "editor"})
        session = SignInSession.objects.create(user=self.staff, device="Chrome on Windows")
        response = self.client.patch("/api/users/", {"user_id": self.staff.pk, "password": "Indigo83724"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        session.refresh_from_db()
        self.assertIsNotNone(session.signed_out_at)
        self.assertTrue(UserSecurity.objects.get(user=self.staff).must_change_password)
        self.assertEqual(role_of(User.objects.get(pk=self.staff.pk)), "accountant")


class PeopleReadTest(TransactionTestCase):
    def test_people_and_account_firm_reads_bypass_cache_and_leave_wide_columns_unread(self):
        owner = person("owner", "admin")
        business = firm()
        UserPreference.objects.create(user=owner, data={"defaultBusinessId": str(business.pk)})
        client = client_for(owner)
        with cacheops_on() as touched, CaptureQueriesContext(connection) as queries:
            self.assertEqual(client.get("/api/people/").status_code, 200)
            self.assertEqual(client.get("/api/account/").status_code, 200)
        self.assertEqual(touched, [])
        for query in queries:
            sql = query["sql"]
            if sql.startswith("SELECT") and '"billing_business"' in sql:
                self.assertNotIn('"signature_image_base64"', sql)
                self.assertNotIn('"bank_account_number"', sql)
            if sql.startswith("SELECT") and '"auth_user"' in sql:
                self.assertNotIn('"password"', sql)


@skipUnless(connection.vendor == "postgresql", "row locks require the dispatch's Postgres replay")
class PeopleConcurrencyTest(TransactionTestCase):
    def test_two_new_people_with_the_same_username_create_one_person(self):
        owner = person("owner", "admin")

        def create():
            try:
                return client_for(owner).post("/api/people/", {
                    "first_name": "Nisha", "username": "nisha", "role": "staff", "password": "Indigo83724",
                }, format="json").status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as workers:
            statuses = list(workers.map(lambda _: create(), range(2)))
        self.assertEqual(sorted(statuses), [201, 400])
        self.assertEqual(User.objects.filter(username__iexact="nisha").count(), 1)
