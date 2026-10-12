"""Ruling 1A-44: keeps clear abandoned drafts; reads use the user's daily allowance."""

import uuid
from contextlib import contextmanager
from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase, TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.throttling import SimpleRateThrottle

from billing.models import SaleDraft
from billing.tests.test_base import production_throttling
from billing.tests.v3_helpers import ROLE_GROUPS, client_for, firm, person


class DraftRetentionTest(TestCase):
    def setUp(self):
        self.starter = person("rakesh", *ROLE_GROUPS["staff"])
        self.owner = client_for(person("kailash", *ROLE_GROUPS["owner"]))
        self.firm = firm()
        self.now = timezone.now()

    def draft(self, days, business=None):
        draft = SaleDraft.objects.create(id=uuid.uuid4(), business=business, started_by=self.starter, data={"n": 1})
        SaleDraft.objects.filter(pk=draft.pk).update(updated_at=self.now - timedelta(days=days))
        return draft

    def keep(self, key=None):
        with patch("django.utils.timezone.now", return_value=self.now):
            return self.owner.put(reverse("draft-detail", args=[key or uuid.uuid4()]),
                                  {"business": self.firm.pk, "data": {"n": 2}}, format="json")

    def test_a_keep_clears_abandoned_drafts_across_the_shop(self):
        another = firm("MEERA ORNAMENTS", gstin="08AAAAA0000A1Z5")
        stale = [self.draft(91, business) for business in (self.firm, another, None)]
        response = self.keep()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertFalse(SaleDraft.objects.filter(pk__in=[draft.pk for draft in stale]).exists())

    def test_drafts_one_day_younger_and_exactly_at_the_limit_stay(self):
        recent, boundary = self.draft(89), self.draft(90)
        self.assertEqual(self.keep().status_code, 201)
        self.assertEqual(SaleDraft.objects.filter(pk__in=[recent.pk, boundary.pk]).count(), 2)

    def test_the_kept_draft_survives_even_when_older_than_the_limit(self):
        draft = self.draft(100, self.firm)
        response = self.keep(draft.pk)
        self.assertEqual(response.status_code, 200, response.data)
        draft.refresh_from_db()
        self.assertEqual((draft.started_by_id, draft.data, draft.updated_at),
                         (self.starter.pk, {"n": 2}, self.now))

    def test_listing_drafts_never_removes_an_abandoned_draft(self):
        abandoned = self.draft(100)
        response = self.owner.get(reverse("draft-list"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual([draft["id"] for draft in response.data["results"]], [str(abandoned.pk)])
        self.assertTrue(SaleDraft.objects.filter(pk=abandoned.pk).exists())


class DraftCleanupTransactionTest(TransactionTestCase):
    def test_cleanup_commits_independently_of_a_refused_keep(self):
        staff = client_for(person("rakesh", *ROLE_GROUPS["staff"]))
        abandoned = SaleDraft.objects.create(id=uuid.uuid4(), data={})
        SaleDraft.objects.filter(pk=abandoned.pk).update(updated_at=timezone.now() - timedelta(days=91))
        response = staff.put(reverse("draft-detail", args=[uuid.uuid4()]), {"data": None}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(SaleDraft.objects.filter(pk=abandoned.pk).exists())


@contextmanager
def draft_rates(**rates):
    with production_throttling() as prod:
        rates = {**prod.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"], **rates}
        with override_settings(REST_FRAMEWORK={**prod.REST_FRAMEWORK, "DEFAULT_THROTTLE_RATES": rates}), \
                patch.object(SimpleRateThrottle, "THROTTLE_RATES", rates):
            yield


class DraftReadThrottleTest(TestCase):
    def setUp(self):
        self.staff = client_for(person("rakesh", *ROLE_GROUPS["staff"]))
        self.path = reverse("draft-detail", args=[uuid.uuid4()])

    def keep(self):
        return self.staff.put(self.path, {"data": {}}, format="json")

    def test_list_spends_the_user_allowance_but_keeps_and_discards_do_not(self):
        with draft_rates(user="2/day"):
            self.assertEqual(self.keep().status_code, 201)
            self.assertEqual(self.staff.delete(self.path).status_code, 204)
            self.assertEqual(self.staff.get(reverse("draft-list")).status_code, 200)
            self.assertEqual(self.staff.get(reverse("sale-list")).status_code, 200)
            self.assertEqual(self.staff.get(reverse("draft-list")).status_code, 429)
            self.assertEqual(self.keep().status_code, 201)
            self.assertEqual(self.staff.delete(self.path).status_code, 204)

    def test_list_does_not_spend_the_drafts_allowance(self):
        with draft_rates(drafts="1/min"):
            self.assertEqual(self.staff.get(reverse("draft-list")).status_code, 200)
            self.assertEqual(self.keep().status_code, 201)
            self.assertEqual(self.keep().status_code, 429)
            self.assertEqual(self.staff.get(reverse("draft-list")).status_code, 200)

    def test_keeps_and_discards_share_the_drafts_allowance(self):
        with draft_rates(drafts="2/min"):
            self.assertEqual(self.keep().status_code, 201)
            self.assertEqual(self.staff.delete(self.path).status_code, 204)
            self.assertEqual(self.keep().status_code, 429)
            self.assertEqual(self.staff.get(reverse("draft-list")).status_code, 200)
