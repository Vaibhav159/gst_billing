"""Deleting a sale to the bin, and restoring it (plan 1A, Task 3; design decision 6)."""

import threading
from unittest.mock import patch

from django.contrib.admin.models import LogEntry
from django.contrib.auth.models import User
from django.contrib.messages import get_messages
from django.db import connection, transaction
from django.http import Http404
from django.test import TestCase, TransactionTestCase, skipUnlessDBFeature
from django.urls import reverse

from billing.api.sales import SalesViewSet
from billing.constants import BILL_CANCELLED, V2_LINE_SNAPSHOT_FIELDS
from billing.models import AuditLog, BinnedInvoice, Customer, FiledPeriod, Invoice, LineItem
from billing.numbering import holder
from billing.period_lock import assert_period_unlocked
from billing.refusals import Refusal
from billing.services.bin import bin_bill
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, line, person, sale

NUMBER = "KGH/2026-27/27"
KEEP_IT_SHORT = {"reason": ["Keep the reason to 80 characters."]}


class BinTest(TestCase):
    def setUp(self):
        self.owner = person("kailash", *ROLE_GROUPS["owner"], first_name="Kailash", last_name="Mehta")
        self.client = client_for(self.owner)
        self.biz = firm()
        self.cust = buyer()
        self.bill = sale(self.biz, self.cust, NUMBER, "2026-09-24", line(rate="45000"))
        self.made = self.bill.created_at

    def delete(self, reason="Entered twice", user=None):
        body = {} if reason is None else {"reason": reason}
        return client_for(user or self.owner).delete(reverse("sale-detail", args=[self.bill.pk]), body, format="json")

    def restore(self, binned):
        return self.client.post(reverse("bin-restore", args=[binned.pk]))

    def test_delete_moves_the_bill_and_its_lines_to_the_bin(self):
        r = self.delete()
        self.assertEqual(r.status_code, 200, r.data)
        binned = BinnedInvoice.objects.get()
        self.assertEqual(r.data, {
            "id": binned.pk, "original_id": self.bill.pk, "kind": "deleted",
            "business": self.biz.pk, "business_name": "KIRAN GOLD HOUSE",
            "invoice_number": NUMBER, "invoice_date": "2026-09-24", "fy": "2026-27",
            "customer": {"id": self.cust.pk, "name": "Anil Gupta"}, "total_amount": "46350.00",
            "reason": "Entered twice", "deleted_at": r.data["deleted_at"],
            "deleted_by": {"id": self.owner.pk, "name": "Kailash Mehta"}, "locked": False,
        })
        self.assertFalse(Invoice.objects.filter(pk=self.bill.pk).exists())
        self.assertFalse(LineItem.objects.filter(invoice_id=self.bill.pk).exists())
        self.assertEqual(len(binned.data["lines"]), 1)
        # v2's audit row, v2's keys: v2's undo can still bring it back after a rollback
        entry = AuditLog.objects.get(pk=binned.audit_log_id)
        self.assertEqual((entry.action, entry.entity_id), ("deleted", self.bill.pk))
        self.assertEqual(entry.details, f"Deleted invoice: #{NUMBER} - Anil Gupta · Entered twice")
        self.assertEqual(set(entry.snapshot["line_items"][0]), set(V2_LINE_SNAPSHOT_FIELDS))

    def test_the_reason_is_optional_and_short(self):
        self.assertEqual(self.delete(reason="x" * 81).status_code, 400)
        self.assertEqual(self.delete(reason="x" * 81).data, {"reason": ["Keep the reason to 80 characters."]})
        self.assertEqual(self.delete(reason=None).status_code, 200)

    def test_a_reason_that_cant_be_used_gets_the_contracts_words(self):
        # Ruling 1A-5: never DRF's own words. Too long, not text, a null character, or a body that isn't
        # an object (read as "no reason", it would bin the bill): the contract's one 400, and the bill stays.
        url = reverse("sale-detail", args=[self.bill.pk])
        for body in ({"reason": "x" * 81}, {"reason": "x" * 256}, {"reason": ["Entered twice"]},
                     {"reason": {"why": "Entered twice"}}, {"reason": True}, {"reason": "Entered\x00twice"},
                     ["Entered twice"], "Entered twice"):
            with self.subTest(body=body):
                r = self.client.delete(url, body, format="json")
                self.assertEqual((r.status_code, r.data), (400, KEEP_IT_SHORT))
        self.assertTrue(Invoice.objects.filter(pk=self.bill.pk).exists())
        self.assertFalse(BinnedInvoice.objects.exists())
        self.assertEqual(self.delete(reason="x" * 80).status_code, 200)

    def test_null_or_blank_is_no_reason(self):
        for n, reason in ((41, None), (42, "   "), (43, "")):
            with self.subTest(reason=reason):
                bill = sale(self.biz, self.cust, f"KGH/2026-27/{n}", "2026-09-24")
                r = self.client.delete(reverse("sale-detail", args=[bill.pk]), {"reason": reason}, format="json")
                self.assertEqual((r.status_code, r.data.get("reason")), (200, ""), r.data)
                self.assertEqual(AuditLog.objects.get(action="deleted", entity_id=bill.pk).details,
                                 f"Deleted invoice: #KGH/2026-27/{n} - Anil Gupta")

    def test_a_closed_month_refuses(self):
        FiledPeriod.objects.create(business=self.biz, year=2026, month=9)
        r = self.delete()
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.data["code"], "month_closed")
        self.assertIn("so its bills can't be deleted", r.data["detail"])

    def test_bin_bill_checks_the_month_itself(self):
        # Ruling 1A-11: inside its own transaction, after the row lock, whoever calls it.
        FiledPeriod.objects.create(business=self.biz, year=2026, month=9)
        with self.assertRaises(Refusal) as refused:
            bin_bill(self.bill, self.owner)
        self.assertEqual(refused.exception.detail["code"], "month_closed")
        self.assertTrue(Invoice.objects.filter(pk=self.bill.pk).exists())
        self.assertFalse(BinnedInvoice.objects.exists())

    def test_a_second_delete_of_the_same_bill_is_a_404(self):
        # Ruling 1A-11: both requests found the bill; the second reads it again under the row lock and
        # finds it gone, so there's one bin row. (The lock itself: BinLockTest, on Postgres.)
        stale = Invoice.objects.get(pk=self.bill.pk)
        self.assertEqual(self.delete().status_code, 200)
        with patch.object(SalesViewSet, "get_object", lambda view: stale):
            r = self.delete()
        self.assertEqual((r.status_code, r.data), (404, {"detail": "No Invoice matches the given query."}))
        self.assertEqual((BinnedInvoice.objects.count(), AuditLog.objects.filter(action="deleted").count()), (1, 1))

    def test_only_the_owner_deletes(self):
        r = self.delete(user=person("rakesh", *ROLE_GROUPS["staff"]))
        self.assertEqual((r.status_code, r.data["needs"]), (403, "bill.delete"))

    def test_a_cancelled_bill_can_be_deleted(self):
        Invoice.objects.filter(pk=self.bill.pk).update(status=BILL_CANCELLED)
        self.assertEqual(self.delete().status_code, 200)

    def test_its_number_stays_used(self):
        self.delete()
        self.assertIsInstance(holder(self.biz.pk, 2026, NUMBER.lower()), BinnedInvoice)

    def test_the_bin_lists_deleted_bills(self):
        self.delete()
        rows = self.client.get(reverse("bin-list"), {"fy": "2026-27", "q": "27"}).data["results"]
        self.assertEqual([row["invoice_number"] for row in rows], [NUMBER])
        self.assertEqual(self.client.get(reverse("bin-list"), {"q": "anil"}).data["count"], 1)  # the customer's name
        self.assertEqual(self.client.get(reverse("bin-list"), {"business_id": self.biz.pk}).data["count"], 1)
        self.assertEqual(self.client.get(reverse("bin-list"), {"fy": "2025-26"}).data["results"], [])
        self.assertEqual(self.client.get(reverse("bin-list"), {"fy": "2026"}).status_code, 400)
        staff = client_for(person("rakesh", *ROLE_GROUPS["staff"]))
        self.assertEqual(staff.get(reverse("bin-list")).status_code, 403)

    def test_the_bin_lists_edges_get_words(self):
        # Ruling 1A-5: a firm that isn't an id, or a page past the end: words, never a 500 or DRF's own.
        r = self.client.get(reverse("bin-list"), {"business_id": "abc"})
        self.assertEqual((r.status_code, r.data), (400, {"business_id": ["Pick the firm."]}))
        r = self.client.get(reverse("bin-list"), {"page": "9"})
        self.assertEqual((r.status_code, r.data), (404, {"detail": "This list has no page 9."}))

    def test_restore_puts_it_back_under_its_own_id(self):
        self.delete()
        binned = BinnedInvoice.objects.get()
        r = self.restore(binned)
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual((r.data["id"], r.data["invoice_number"]), (self.bill.pk, NUMBER))
        back = Invoice.objects.get(pk=self.bill.pk)
        self.assertEqual((back.total_amount, back.created_at, back.lineitem_set.count()), (self.bill.total_amount, self.made, 1))
        binned.refresh_from_db()
        self.assertIsNotNone(binned.restored_at)
        restored = AuditLog.objects.get(action="restored", entity_id=self.bill.pk)
        self.assertEqual(restored.details, "Back in Sales and in the month's GST figures")
        entry = AuditLog.objects.get(pk=binned.audit_log_id)
        # the Audit log no longer offers Undo: v2's marker, which says what used it
        self.assertEqual({**entry.snapshot["_undo"], "at": ""}, {"at": "", "by": self.owner.pk, "log": restored.pk, "via": "bin"})
        self.assertEqual(self.client.get(reverse("bin-list")).data["results"], [])
        again = self.restore(binned)
        self.assertEqual((again.status_code, again.data["code"]), (409, "already_restored"))
        self.assertEqual(again.data["detail"], f"{NUMBER} is back already: it was restored from the bin.")
        self.assertEqual(again.data["bill"]["id"], self.bill.pk)

    def test_restore_waits_for_an_open_month(self):
        self.delete()
        FiledPeriod.objects.create(business=self.biz, year=2026, month=9)
        r = self.restore(BinnedInvoice.objects.get())
        self.assertEqual((r.status_code, r.data["code"]), (409, "month_closed"))
        self.assertIn("so a deleted bill can't go back into it", r.data["detail"])

    def test_restore_refuses_a_number_another_bill_took(self):
        self.delete()
        other = sale(self.biz, self.cust, NUMBER, "2026-10-01")
        r = self.restore(BinnedInvoice.objects.get())
        self.assertEqual((r.status_code, r.data["code"]), (409, "number_taken"))
        self.assertEqual(r.data["bill"]["id"], other.pk)
        self.assertEqual(r.data["next"], {"counter": 28, "invoice_number": "28"})

    def test_restore_refuses_when_the_customer_is_gone(self):
        self.delete()
        with connection.cursor() as c:  # as v2 could, after a rollback: it doesn't know the bin
            c.execute("DELETE FROM billing_customer WHERE id = %s", [self.cust.pk])
        r = self.restore(BinnedInvoice.objects.get())
        self.assertEqual((r.status_code, r.data["code"]), (409, "customer_gone"))


class V2PathsAndTheBinTest(TestCase):
    def setUp(self):
        self.client = client_for(person("kailash", *ROLE_GROUPS["owner"]))
        self.biz = firm()
        self.cust = buyer()
        self.bill = sale(self.biz, self.cust, "1", "2026-09-24")

    def test_v2_delete_of_a_sale_goes_to_the_bin(self):
        r = self.client.delete(reverse("invoice-detail", args=[self.bill.pk]))
        self.assertEqual(r.status_code, 204)
        self.assertEqual(BinnedInvoice.objects.get().original_id, self.bill.pk)

    def test_v2_delete_of_a_purchase_stays_a_delete(self):
        supplier = Customer.objects.create(name="SUPPLIER", gst_number="08AAECD1234K1Z2", state_name="RAJASTHAN")
        purchase = sale(self.biz, supplier, "SJ-1", "2026-09-24", kind="inward")
        r = self.client.delete(reverse("invoice-detail", args=[purchase.pk]))
        # Ruling 1A-8: it was deleted, not refused: gone, with v2's own audit row, and nothing in the bin
        self.assertEqual(r.status_code, 204)
        self.assertFalse(Invoice.objects.filter(pk=purchase.pk).exists())
        self.assertTrue(AuditLog.objects.filter(action="deleted", entity_id=purchase.pk).exists())
        self.assertFalse(BinnedInvoice.objects.exists())

    def test_the_audit_logs_undo_restores_from_the_bin(self):
        self.client.delete(reverse("invoice-detail", args=[self.bill.pk]))
        entry = AuditLog.objects.get(action="deleted", entity_id=self.bill.pk)
        r = self.client.post(reverse("auditlog-undo", args=[entry.pk]))
        self.assertEqual((r.status_code, r.data["new_id"]), (200, self.bill.pk))
        again = self.client.post(reverse("bin-restore", args=[BinnedInvoice.objects.get().pk]))
        self.assertEqual(again.data["code"], "already_restored")
        # Ruling 1A-9: it names what brought the bill back
        self.assertEqual(again.data["detail"], "1 is back already: it was restored from the Audit log.")
        self.assertEqual(again.data["bill"]["id"], self.bill.pk)

    def test_undoing_a_sales_create_moves_it_to_the_bin(self):
        entry = AuditLog.objects.create(action="created", entity="invoice", entity_id=self.bill.pk, entity_name="#1")
        r = self.client.post(reverse("auditlog-undo", args=[entry.pk]))
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(BinnedInvoice.objects.get().original_id, self.bill.pk)

    def test_undoing_a_create_of_a_bill_deleted_meanwhile_is_v2s_404(self):
        # The bill goes between the undo's read and bin_bill's row lock: v2's 404, never a 500 (Ruling 1A-17).
        entry = AuditLog.objects.create(action="created", entity="invoice", entity_id=self.bill.pk, entity_name="#1")

        def deleted_meanwhile(*args, **kwargs):
            Invoice.objects.filter(pk=self.bill.pk).delete()
            return assert_period_unlocked(*args, **kwargs)

        with patch("billing.api.views.assert_period_unlocked", deleted_meanwhile):
            r = self.client.post(reverse("auditlog-undo", args=[entry.pk]))
        self.assertEqual((r.status_code, r.data), (404, {"error": "Record already deleted"}))
        self.assertFalse(BinnedInvoice.objects.exists())

    def test_merge_takes_the_deleted_bills_along(self):
        self.client.delete(reverse("invoice-detail", args=[self.bill.pk]))
        target = buyer("Anil Gupta (Udaipur)")
        r = self.client.post(reverse("customer-merge"), {"source_id": self.cust.pk, "target_id": target.pk}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(BinnedInvoice.objects.get().customer_id, target.pk)

    def test_a_customer_or_firm_with_deleted_bills_cant_be_deleted(self):
        self.client.delete(reverse("invoice-detail", args=[self.bill.pk]))
        r = self.client.delete(reverse("customer-detail", args=[self.cust.pk]))
        self.assertEqual(r.status_code, 409)
        # The bin protects the firm too: v2's 409, not a 500 (a restore needs both)
        self.assertEqual(self.client.delete(reverse("business-detail", args=[self.biz.pk])).status_code, 409)


class AdminAndTheBinTest(TestCase):
    """Ruling 1A-7: the Django admin's deletes of a sale go to the bin too, and its history can't
    revert a deleted bill into a 500."""

    def setUp(self):
        self.root = User.objects.create_superuser("root", "root@example.com", "pw")
        self.client.force_login(self.root)
        self.biz, self.cust = firm(), buyer()
        self.bill = sale(self.biz, self.cust, "1", "2026-09-24")
        supplier = Customer.objects.create(name="SUPPLIER", gst_number="08AAECD1234K1Z2", state_name="RAJASTHAN")
        self.purchase = sale(self.biz, supplier, "SJ-1", "2026-10-02", kind="inward")

    def select_and_delete(self, *bills):
        return self.client.post(reverse("admin:billing_invoice_changelist"), {
            "action": "delete_selected", "_selected_action": [b.pk for b in bills], "post": "yes"})

    def test_deleting_a_sale_moves_it_to_the_bin(self):
        r = self.client.post(reverse("admin:billing_invoice_delete", args=[self.bill.pk]), {"post": "yes"})
        self.assertEqual(r.status_code, 302)
        binned = BinnedInvoice.objects.get()
        self.assertEqual((binned.original_id, binned.deleted_by_id), (self.bill.pk, self.root.pk))
        self.assertEqual(AuditLog.objects.get(pk=binned.audit_log_id).action, "deleted")
        self.assertFalse(Invoice.objects.filter(pk=self.bill.pk).exists())

    def test_select_and_delete_bins_the_sales_and_deletes_the_purchases(self):
        self.assertEqual(self.select_and_delete(self.bill, self.purchase).status_code, 302)
        self.assertEqual(list(BinnedInvoice.objects.values_list("original_id", flat=True)), [self.bill.pk])
        self.assertFalse(Invoice.objects.exists())

    def test_select_and_delete_keeps_a_closed_month(self):
        # The purchase (October, open) goes first, then the sale's September is closed: all or nothing.
        FiledPeriod.objects.create(business=self.biz, year=2026, month=9)
        self.assertEqual(self.select_and_delete(self.purchase, self.bill).status_code, 403)
        self.assertEqual(Invoice.objects.count(), 2)
        self.assertFalse(BinnedInvoice.objects.exists())
        self.assertFalse(LogEntry.objects.exists())  # nor does the admin's log say they went

    def test_reverting_a_deleted_bill_says_where_it_comes_back_from(self):
        for bill, words in ((self.bill, "This bill was deleted. Restore it from the bin instead."),
                            (self.purchase, "This bill was deleted. Restore it with Undo in the Audit log instead.")):
            with self.subTest(bill=bill.invoice_number):
                version = bill.history.earliest().history_id
                self.client.post(reverse("admin:billing_invoice_delete", args=[bill.pk]), {"post": "yes"})
                r = self.client.post(reverse("admin:billing_invoice_simple_history", args=[bill.pk, version]), {
                    "customer": bill.customer_id, "business": bill.business_id, "invoice_number": bill.invoice_number,
                    "invoice_date": str(bill.invoice_date), "type_of_invoice": bill.type_of_invoice})
                self.assertEqual(r.status_code, 302)
                said = list(get_messages(r.wsgi_request))[-1]  # after the delete's own "deleted successfully"
                self.assertEqual((said.message, said.level_tag), (words, "error"))
                self.assertFalse(Invoice.objects.filter(pk=bill.pk).exists())
        self.assertIsNone(BinnedInvoice.objects.get().restored_at)


@skipUnlessDBFeature("has_select_for_update")
class BinLockTest(TransactionTestCase):
    """Ruling 1A-11 on a database with row locks: two deletes at once make one bin row. The first
    holds the bill's row until it commits; the second waits for it, then finds the bill gone."""

    def test_two_deletes_at_once_make_one_bin_row(self):
        owner = person("kailash", *ROLE_GROUPS["owner"])
        bill = sale(firm(), buyer(), "1", "2026-09-24")
        stale = Invoice.objects.get(pk=bill.pk)  # what the second request found
        locked, release, outcome = threading.Event(), threading.Event(), {}

        def first():
            try:
                with transaction.atomic():
                    bin_bill(bill, owner)
                    locked.set()
                    release.wait(10)
            finally:
                connection.close()

        def second():
            try:
                bin_bill(stale, owner)
                outcome["second"] = "binned"
            except Http404:
                outcome["second"] = "404"
            finally:
                connection.close()

        a = threading.Thread(target=first)
        a.start()
        self.assertTrue(locked.wait(10))
        b = threading.Thread(target=second)
        b.start()
        b.join(0.5)
        self.assertTrue(b.is_alive())  # waiting on the first one's lock
        release.set()
        a.join(10)
        b.join(10)
        self.assertEqual(outcome, {"second": "404"})
        self.assertEqual(BinnedInvoice.objects.count(), 1)
