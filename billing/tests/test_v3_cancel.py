"""Cancelling a sale (plan 1A, Task 2): POST /api/sales/{id}/cancel/, and what v2's paths do with it."""

from decimal import Decimal
from unittest.mock import patch

from django.contrib import admin
from django.contrib.auth.models import User
from django.test import RequestFactory, TestCase
from django.urls import reverse

from billing.admin import InvoiceAdmin
from billing.api.mixins import snapshot_of
from billing.api.sales import SalesViewSet
from billing.constants import BILL_ACTIVE, BILL_CANCELLED
from billing.models import AuditLog, FiledPeriod, Invoice, UserPreference
from billing.period_lock import assert_period_unlocked
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

    def test_a_bill_deleted_after_it_was_found_is_a_404(self):
        # Ruling 1A-17: another request deletes the bill between get_object() and the row lock.
        found = SalesViewSet.get_object

        def found_then_deleted(view):
            bill = found(view)
            Invoice.objects.filter(pk=bill.pk).delete()
            return bill

        with patch.object(SalesViewSet, "get_object", found_then_deleted):
            r = self.cancel()
        self.assertEqual((r.status_code, r.data), (404, {"detail": "No Invoice matches the given query."}))
        self.assertFalse(AuditLog.objects.filter(action="cancelled").exists())


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


class V2SavesKeepACancelTest(TestCase):
    """A cancel that lands while a v2 path holds the bill stays (Ruling 1A-16): v2's saves never
    write the v3 columns. Each probe cancels the bill as another request would, after the path
    has read the bill and before it saves it."""

    def setUp(self):
        self.owner = person("kailash", *ROLE_GROUPS["owner"])
        self.client = client_for(self.owner)
        self.cust = buyer()
        self.bill = sale(firm(), self.cust, "1", "2026-10-08")

    def cancel_meanwhile(self):
        Invoice.objects.filter(pk=self.bill.pk).update(status=BILL_CANCELLED, cancel_reason="Customer returned it")

    def at_the_month_check(self, where="billing.api.views"):
        """The review's probe: these paths check the month between reading the bill and saving it."""

        def check(*args, **kwargs):
            self.cancel_meanwhile()
            return assert_period_unlocked(*args, **kwargs)

        return patch(f"{where}.assert_period_unlocked", check)

    def just_before_the_save(self):
        """For a path that checks the month before it reads the bill: the cancel lands just before the write."""
        save = Invoice.save

        def cancelled_then_saved(invoice, *args, **kwargs):
            if invoice.pk == self.bill.pk:
                self.cancel_meanwhile()
            return save(invoice, *args, **kwargs)

        return patch.object(Invoice, "save", cancelled_then_saved)

    def assert_still_cancelled(self):
        self.bill.refresh_from_db()
        self.assertEqual((self.bill.status, self.bill.cancel_reason), (BILL_CANCELLED, "Customer returned it"))

    def test_a_patch(self):
        with self.at_the_month_check():
            r = self.client.patch(reverse("invoice-detail", args=[self.bill.pk]), {"payment_mode": "cash"},
                                  format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assert_still_cancelled()
        self.assertEqual(self.bill.payment_mode, "cash")

    def test_the_eway_post(self):
        with self.at_the_month_check():
            r = self.client.post(reverse("invoice-eway-bill", args=[self.bill.pk]), {"vehicle_number": "RJ14AB1234"},
                                 format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assert_still_cancelled()
        self.assertEqual(self.bill.vehicle_number, "RJ14AB1234")

    def test_the_undo_of_an_edit(self):
        self.client.patch(reverse("invoice-detail", args=[self.bill.pk]), {"payment_mode": "cash"}, format="json")
        edit = AuditLog.objects.get(action="updated", entity_id=self.bill.pk)
        with self.at_the_month_check():
            r = self.client.post(reverse("auditlog-undo", args=[edit.pk]))
        self.assertEqual(r.status_code, 200, r.data)
        self.assert_still_cancelled()
        self.assertEqual(self.bill.payment_mode, "")

    def test_the_admin(self):
        # Also the path of the admin's history revert (SimpleHistoryAdmin.history_form_view).
        stale = Invoice.objects.get(pk=self.bill.pk)
        stale.payment_mode = "bank"
        request = RequestFactory().post("/admin/")
        request.user = self.owner
        with self.at_the_month_check("billing.admin"):
            InvoiceAdmin(Invoice, admin.site).save_model(request, stale, form=None, change=True)
        self.assert_still_cancelled()
        self.assertEqual(self.bill.payment_mode, "bank")

    def test_a_customer_merge(self):
        target = buyer("ANIL GUPTA")
        with self.just_before_the_save():
            r = self.client.post(reverse("customer-merge"), {"source_id": self.cust.pk, "target_id": target.pk},
                                 format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assert_still_cancelled()
        self.assertEqual(self.bill.customer_id, target.pk)

    def test_adding_a_line(self):
        with self.just_before_the_save():
            r = self.client.post(reverse("invoice-line-items", args=[self.bill.pk]),
                                 {"product_name": "Silver", "quantity": "1", "rate": "5000"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assert_still_cancelled()
        self.assertEqual(self.bill.total_amount, Decimal("10300") + Decimal(r.data["amount"]))
