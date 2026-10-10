"""Cancelling a sale (plan 1A, Task 2): POST /api/sales/{id}/cancel/, and what v2's paths do with it."""

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from billing.api.mixins import snapshot_of
from billing.constants import BILL_ACTIVE, BILL_CANCELLED
from billing.models import AuditLog, FiledPeriod, Invoice, UserPreference
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person, sale


class CancelTest(TestCase):
    def setUp(self):
        self.owner = person("kailash", *ROLE_GROUPS["owner"], first_name="Kailash", last_name="Mehta")
        self.biz = firm()
        self.cust = buyer()
        self.bill = sale(self.biz, self.cust, "KGH/2026-27/31", "2026-10-08")

    def cancel(self, user=None, reason="Customer returned it", bill=None):
        body = {} if reason is None else {"reason": reason}
        return client_for(user or self.owner).post(reverse("sale-cancel", args=[(bill or self.bill).pk]), body, format="json")

    def test_the_owner_cancels_with_a_reason(self):
        r = self.cancel()
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["status"], BILL_CANCELLED)
        self.assertEqual(r.data["cancel_reason"], "Customer returned it")
        self.assertEqual(r.data["cancelled_by"], {"id": self.owner.pk, "name": "Kailash Mehta"})
        self.assertTrue(r.data["cancelled_at"].endswith("+05:30"))
        self.bill.refresh_from_db()
        self.assertEqual((self.bill.status, self.bill.cancelled_by_id), (BILL_CANCELLED, self.owner.pk))
        entry = AuditLog.objects.get(action="cancelled", entity_id=self.bill.pk)
        self.assertEqual(entry.details, "Customer returned it")
        self.assertEqual(entry.changes, {"status": {"old": BILL_ACTIVE, "new": BILL_CANCELLED}})

    def test_the_reason_is_required(self):
        for reason in (None, "  "):
            r = self.cancel(reason=reason)
            self.assertEqual(r.status_code, 400)
            self.assertEqual(r.data, {"reason": ["Say why in a few words. It goes into the audit log."]})
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.status, BILL_ACTIVE)

    def test_a_reason_that_cant_be_used_gets_the_contracts_words(self):
        # Ruling 1A-5: never DRF's own words. Null, over 255 characters, not text, a null character,
        # or a body that isn't an object all say what the contract says.
        url = reverse("sale-cancel", args=[self.bill.pk])
        for body in ({"reason": None}, {"reason": "x" * 256}, {"reason": ["Returned"]}, {"reason": {"why": "Returned"}},
                     {"reason": True}, {"reason": "Returned\x00"}, ["Customer returned it"], "Customer returned it"):
            with self.subTest(body=body):
                r = client_for(self.owner).post(url, body, format="json")
                self.assertEqual((r.status_code, r.data),
                                 (400, {"reason": ["Say why in a few words. It goes into the audit log."]}))
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.status, BILL_ACTIVE)
        self.assertEqual(self.cancel(reason="x" * 255).status_code, 200)

    def test_twice_is_a_409(self):
        self.cancel()
        r = self.cancel()
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.data, {"detail": "KGH/2026-27/31 is already cancelled.", "code": "cancelled"})

    def test_a_closed_month_refuses(self):
        FiledPeriod.objects.create(business=self.biz, year=2026, month=10)
        r = self.cancel()
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.data["code"], "month_closed")
        self.assertIn("so its bills can't be cancelled", r.data["detail"])
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.status, BILL_ACTIVE)

    def test_only_the_owner_cancels(self):
        for role in ("accountant", "staff", "viewer"):
            r = self.cancel(person(role, *ROLE_GROUPS[role]))
            self.assertEqual(r.status_code, 403, role)
            self.assertEqual(r.data["needs"], "bill.cancel")

    def test_a_purchase_is_not_a_sale(self):
        purchase = sale(self.biz, self.cust, "SJ-1", "2026-10-08", kind="inward")
        r = self.cancel(bill=purchase)
        self.assertEqual((r.status_code, r.data), (404, {"detail": "No Invoice matches the given query."}))
        purchase.refresh_from_db()
        self.assertEqual(purchase.status, BILL_ACTIVE)


class V2PathsAndCancelTest(TestCase):
    def setUp(self):
        self.owner = person("kailash", *ROLE_GROUPS["owner"])
        self.client = client_for(self.owner)
        self.biz = firm()
        self.bill = sale(self.biz, buyer(), "1", "2026-10-08")

    def test_v2_can_read_the_status_but_not_write_it(self):
        Invoice.objects.filter(pk=self.bill.pk).update(status=BILL_CANCELLED)
        r = self.client.patch(reverse("invoice-detail", args=[self.bill.pk]), {"status": BILL_ACTIVE}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["status"], BILL_CANCELLED)
        rows = self.client.get(reverse("invoice-list")).data["results"]
        self.assertEqual(rows[0]["status"], BILL_CANCELLED)

    def test_undoing_an_old_edit_never_revives_a_cancelled_bill(self):
        self.client.patch(reverse("invoice-detail", args=[self.bill.pk]), {"payment_mode": "cash"}, format="json")
        edit = AuditLog.objects.get(action="updated", entity_id=self.bill.pk)
        Invoice.objects.filter(pk=self.bill.pk).update(status=BILL_CANCELLED)
        r = self.client.post(reverse("auditlog-undo", args=[edit.pk]))
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.data, {"error": "cancelled",
                                  "detail": "Cancelled bills can't be changed. Make it again from the bill instead."})
        self.bill.refresh_from_db()
        self.assertEqual((self.bill.status, self.bill.payment_mode), (BILL_CANCELLED, "cash"))

    def test_undoing_an_old_edit_leaves_the_v3_fields_be(self):
        self.client.patch(reverse("invoice-detail", args=[self.bill.pk]), {"payment_mode": "cash"}, format="json")
        edit = AuditLog.objects.get(action="updated", entity_id=self.bill.pk)
        Invoice.objects.filter(pk=self.bill.pk).update(replaces=41)  # set later, as only v3 sets it
        r = self.client.post(reverse("auditlog-undo", args=[edit.pk]))
        self.assertEqual(r.status_code, 200, r.data)
        self.bill.refresh_from_db()
        self.assertEqual((self.bill.payment_mode, self.bill.replaces), ("", 41))

    def test_undoing_an_old_edit_keeps_a_later_renumber(self):
        self.client.patch(reverse("invoice-detail", args=[self.bill.pk]), {"payment_mode": "cash"}, format="json")
        edit = AuditLog.objects.get(action="updated", entity_id=self.bill.pk)
        self.client.patch(reverse("invoice-detail", args=[self.bill.pk]), {"invoice_number": "7"}, format="json")
        r = self.client.post(reverse("auditlog-undo", args=[edit.pk]))
        self.assertEqual(r.status_code, 200, r.data)
        self.bill.refresh_from_db()
        self.assertEqual((self.bill.payment_mode, self.bill.invoice_number), ("", "7"))

    def test_a_json_field_is_snapshotted_as_json(self):
        pref = UserPreference(user=User.objects.get(pk=self.owner.pk), data={"defaultBusinessId": "3"})
        self.assertEqual(snapshot_of(pref)["data"], {"defaultBusinessId": "3"})
