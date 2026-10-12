"""Unfinished bills, shop-wide (plan 1A, Task 10): PUT, GET and DELETE /api/drafts/, and the draft
a bill becomes deleted with it."""

import json
import threading
import uuid
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.models import User
from django.db import connection, transaction
from django.test import TestCase, TransactionTestCase, override_settings, skipUnlessDBFeature
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from rest_framework.throttling import SimpleRateThrottle

from billing.api.body import valid
from billing.api.sales import SaleSerializer
from billing.constants import BILL_CANCELLED
from billing.models import AuditLog, Business, FiledPeriod, Invoice, SaleDraft, SavedDraft
from billing.numbering import checked_number
from billing.services.sales import save_bill
from billing.tests.test_base import load_production_settings, production_throttling
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person, sale

LINE = {"product_name": "Gold Ring 22K", "hsn_code": "711319", "gst_percent": "3", "quantity": "1",
        "unit": "gms", "rate": "1000"}


class DraftTest(TestCase):
    def setUp(self):
        self.rakesh = person("rakesh", *ROLE_GROUPS["staff"], first_name="Rakesh", last_name="Soni")
        self.owner = person("kailash", *ROLE_GROUPS["owner"])
        self.biz = firm()
        self.key = str(uuid.uuid4())

    def put(self, user=None, key=None, **body):
        body.setdefault("data", {"customerId": 7, "note": "Waiting for the bangles to be weighed"})
        return client_for(user or self.rakesh).put(reverse("draft-detail", args=[key or self.key]),
                                                   {"business": self.biz.pk, **body}, format="json")

    def test_staff_start_one_and_the_owner_finishes_it(self):
        r = self.put()
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual((r.data["id"], r.data["started_by"]), (self.key, {"id": self.rakesh.pk, "name": "Rakesh Soni"}))
        r = self.put(self.owner, data={"customerId": 7, "lines": [1]})
        self.assertEqual((r.status_code, r.data["started_by"]["name"], r.data["data"]["lines"]), (200, "Rakesh Soni", [1]))
        listed = client_for(self.owner).get(reverse("draft-list"), {"business_id": self.biz.pk}).data["results"]
        self.assertEqual([d["id"] for d in listed], [self.key])

    def test_delete_twice_is_fine(self):
        self.put()
        for _ in range(2):
            self.assertEqual(client_for(self.rakesh).delete(reverse("draft-detail", args=[self.key])).status_code, 204)
        self.assertFalse(SaleDraft.objects.exists())

    def test_words(self):
        self.assertEqual(self.put(data={"x": "y" * 70000}).data, {"data": [
            "This unfinished bill is too big to keep (over 64 KB). Save it as a bill, or start a new one."]})
        self.assertEqual(self.put(data=[1, 2]).data, {"data": ["An unfinished bill needs its data."]})
        self.assertEqual(self.put(business=999).data, {"business": ["Pick a firm from the list."]})
        self.assertEqual(self.put(key="-" * 36).status_code, 404)

    def test_who_keeps_drafts(self):
        for role in ("accountant", "viewer"):
            user = person(role, *ROLE_GROUPS[role])
            self.assertEqual(client_for(user).get(reverse("draft-list")).data["needs"], "bill.create")
            self.assertEqual(self.put(user).status_code, 403)

    def test_a_saved_bill_takes_its_draft_with_it(self):
        self.put()
        body = {"business": self.biz.pk, "customer": buyer().pk, "invoice_number": "1", "invoice_date": "2026-10-08",
                "lines": [LINE], "draft_id": self.key}
        staff = client_for(self.rakesh)
        made = staff.post(reverse("sale-list"), body, format="json")
        self.assertEqual(made.status_code, 201, made.data)
        self.assertFalse(SaleDraft.objects.exists())
        # Rulings 1D-6 to 1D-8, amending the plan (where a keep after the save made the draft again): a keep that comes
        # after the save never makes the draft again, and the draft never makes a second bill, whatever its number.
        saved = {"detail": "This unfinished bill was saved as 1 already.", "code": "draft_saved",
                 "bill": {"id": made.data["id"], "invoice_number": "1", "invoice_date": "2026-10-08",
                          "customer_name": "Anil Gupta", "status": "active"}}
        r = self.put()
        self.assertEqual((r.status_code, r.data), (409, saved))
        self.assertFalse(SaleDraft.objects.exists())
        r = staff.post(reverse("sale-list"), {**body, "invoice_number": "2"}, format="json")
        self.assertEqual((r.status_code, r.data), (409, saved))
        self.assertEqual(Invoice.objects.count(), 1)

    def test_a_firm_with_a_draft_isnt_deleted(self):
        self.put()
        r = client_for(self.owner).delete(reverse("business-detail", args=[self.biz.pk]))
        self.assertEqual(r.status_code, 409)
        # ... in words that name what holds it: an unfinished bill, not an invoice
        self.assertEqual(r.data, {"error": "Cannot delete: 1 unfinished bill(s) still name this firm. Finish or "
                                           "discard them first.", "protected": 1})
        self.assertTrue(Business.objects.filter(pk=self.biz.pk).exists())

    def test_a_draft_left_behind_its_save_doesnt_hold_its_firm(self):
        # Task 10's review, minor 1: a draft that outlived its save (a keep that raced it) is listed nowhere, so nobody
        # could discard it. It goes with its firm; a draft still on the list keeps holding it.
        self.put()
        SavedDraft.objects.create(id=self.key, bill_id=424242, invoice_number="31")
        r = client_for(self.owner).delete(reverse("business-detail", args=[self.biz.pk]))
        self.assertEqual(r.status_code, 204, getattr(r, "data", None))
        self.assertFalse(Business.objects.filter(pk=self.biz.pk).exists())
        self.assertFalse(SaleDraft.objects.exists())
        other = firm("MEERA ORNAMENTS", gstin="08AAAAA0000A1Z5")
        listed, behind = str(uuid.uuid4()), str(uuid.uuid4())
        for key in (listed, behind):
            self.put(key=key, business=other.pk)
        SavedDraft.objects.create(id=behind, bill_id=424242, invoice_number="32")
        r = client_for(self.owner).delete(reverse("business-detail", args=[other.pk]))
        self.assertEqual((r.status_code, r.data), (409, {"error": "Cannot delete: 1 unfinished bill(s) still name this "
                                                         "firm. Finish or discard them first.", "protected": 1}))
        self.assertEqual(SaleDraft.objects.count(), 2)  # a delete refused changes nothing


class SavedOnceTest(TestCase):
    """Rulings 1D-6, 1D-7 and 1D-8 (contract 2.3 and 4): a bill saved from a draft takes the draft with it, in its own
    transaction, and keeps a note of the draft's id and the bill it became. A later keep of that draft, or a later save
    of it, is refused (409 draft_saved) and makes nothing: two counters finishing one draft, or a save retried after
    its answer was lost, never make two bills, and a keep that arrives late never brings the draft back."""

    def setUp(self):
        self.rakesh = person("rakesh", *ROLE_GROUPS["staff"], first_name="Rakesh", last_name="Soni")
        self.owner = person("kailash", *ROLE_GROUPS["owner"], first_name="Kailash", last_name="Mehta")
        self.staff, self.boss = client_for(self.rakesh), client_for(self.owner)
        self.kgh, self.anil = firm(invoice_prefix="KGH"), buyer()
        self.key = str(uuid.uuid4())
        self.day = str(timezone.localdate() - timedelta(days=3))

    def keep(self, client=None, key=None, **body):
        body = {"business": self.kgh.pk, "data": {"note": "Bangles to be weighed"}, **body}
        return (client or self.staff).put(reverse("draft-detail", args=[key or self.key]), body, format="json")

    def body(self, number="31", **more):
        return {"business": self.kgh.pk, "customer": self.anil.pk, "invoice_number": number, "invoice_date": self.day,
                "payment_mode": "cash", "lines": [LINE], "draft_id": self.key, **more}

    def save(self, client=None, **more):
        return (client or self.staff).post(reverse("sale-list"), self.body(**more), format="json")

    def ref(self, bill_id, number="31", status="active"):
        return {"id": bill_id, "invoice_number": number, "invoice_date": self.day, "customer_name": "Anil Gupta",
                "status": status}

    def refused(self, r, number, bill):
        self.assertEqual((r.status_code, r.data), (409, {
            "detail": f"This unfinished bill was saved as {number} already.", "code": "draft_saved", "bill": bill}))

    def test_two_counters_finishing_one_draft_make_one_bill(self):
        self.keep()
        first = self.save()
        self.assertEqual(first.status_code, 201, first.data)
        second = self.save(self.boss, number="32")  # the other counter typed another number
        self.refused(second, "31", self.ref(first.data["id"]))
        self.assertEqual(list(Invoice.objects.values_list("invoice_number", flat=True)), ["31"])
        self.assertEqual(AuditLog.objects.filter(action="created").count(), 1)

    def test_a_save_retried_after_its_answer_was_lost_makes_no_second_bill(self):
        # The same body again: refused for its draft, not as a clash over its own number.
        self.keep()
        first = self.save()
        self.refused(self.save(), "31", self.ref(first.data["id"]))
        self.assertEqual(Invoice.objects.count(), 1)

    def test_a_keep_after_the_save_never_makes_the_draft_again(self):
        self.keep()
        made = self.save().data
        for client in (self.staff, self.boss):  # the counter that saved it, and another one still holding a copy
            with self.subTest(client=client):
                self.refused(self.keep(client), "31", self.ref(made["id"]))
        self.assertFalse(SaleDraft.objects.exists())
        self.assertEqual(client_for(self.owner).get(reverse("draft-list")).data, {"results": []})
        # and a keep of it that can't be used is still told the draft is saved: the client lets it go either way
        self.refused(self.keep(data=[1, 2], business="abc"), "31", self.ref(made["id"]))

    def test_the_bill_is_null_once_it_has_left_sales(self):
        self.keep()
        made = self.save().data
        r = self.boss.delete(reverse("sale-detail", args=[made["id"]]), {"reason": "Entered twice"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.refused(self.keep(), "31", None)  # the number it was saved as
        self.refused(self.save(number="33"), "31", None)  # and still no second bill
        self.assertFalse(Invoice.objects.exists())
        # Restored from the bin, under its own id: named again
        self.assertEqual(self.boss.post(reverse("bin-restore", args=[r.data["id"]])).status_code, 200)
        self.refused(self.keep(), "31", self.ref(made["id"]))

    def test_the_words_name_the_bill_as_it_is_now(self):
        self.keep()
        made = self.save().data
        r = self.boss.post(reverse("sale-renumber", args=[made["id"]]), {"invoice_number": "35"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.boss.post(reverse("sale-cancel", args=[made["id"]]), {"reason": "Returned"}, format="json")
        self.refused(self.keep(), "35", self.ref(made["id"], "35", BILL_CANCELLED))

    def test_a_save_refused_keeps_its_draft(self):
        # The plan's own case: a refused save makes nothing, so the draft stays to be finished, and its id stays free.
        sale(self.kgh, self.anil, "31", self.day)
        self.keep()
        self.assertEqual(self.save().data["code"], "number_taken")
        FiledPeriod.objects.create(business=self.kgh, year=int(self.day[:4]), month=int(self.day[5:7]))
        self.assertEqual(self.save(number="32").data["code"], "month_closed")
        FiledPeriod.objects.all().delete()
        self.assertEqual(self.save(number="32", lines=[]).status_code, 400)
        self.assertTrue(SaleDraft.objects.filter(pk=self.key).exists())
        self.assertFalse(SavedDraft.objects.exists())
        self.assertEqual(self.keep().status_code, 200)
        self.assertEqual(self.save(number="32").status_code, 201)
        self.assertFalse(SaleDraft.objects.exists())

    def test_a_draft_the_server_never_had_is_noted_too(self):
        # Kept offline and saved before it ever reached the server: its keep, arriving late, is refused.
        made = self.save()
        self.assertEqual(made.status_code, 201, made.data)
        self.refused(self.keep(), "31", self.ref(made.data["id"]))
        self.assertFalse(SaleDraft.objects.exists())

    def test_the_note_keeps_the_bill_and_nothing_else(self):
        self.keep()
        made = self.save().data
        saved = SavedDraft.objects.get()
        self.assertEqual((str(saved.pk), saved.bill_id, saved.invoice_number), (self.key, made["id"], "31"))

    def test_the_save_takes_the_draft_before_it_makes_the_bill(self):
        # Task 10's review, minor 2: the draft goes as soon as the save has claimed it, under its row lock, so a keep
        # while the bill is being made waits for the save and is then refused, never told "kept" and then dropped.
        # The bill goes on the note at the end. Here the save is looked at as it checks the number, before the bill.
        self.keep()
        seen = []

        def looking(*args, **kwargs):
            seen.append((SaleDraft.objects.filter(pk=self.key).exists(), SavedDraft.objects.get(pk=self.key).bill_id))
            return checked_number(*args, **kwargs)

        with patch("billing.services.sales.checked_number", looking):
            made = self.save()
        self.assertEqual(made.status_code, 201, made.data)
        self.assertEqual(seen, [(False, None)])  # the draft gone, the note claimed, no bill on it yet
        self.assertEqual(SavedDraft.objects.get().bill_id, made.data["id"])

    def test_a_discarded_draft_can_come_back(self):
        # Only a save leaves a note: a discard's Undo keeps the draft again.
        self.keep()
        self.assertEqual(self.staff.delete(reverse("draft-detail", args=[self.key])).status_code, 204)
        self.assertEqual(self.keep().status_code, 201)
        self.assertFalse(SavedDraft.objects.exists())

    def test_a_bill_without_a_draft_or_an_edit_leaves_no_note(self):
        self.keep()
        r = self.save(draft_id=None)
        self.assertEqual(r.status_code, 201, r.data)
        self.assertFalse(SavedDraft.objects.exists())
        r = self.boss.put(reverse("sale-detail", args=[r.data["id"]]), self.body(payment_mode="bank"), format="json")
        self.assertEqual(r.status_code, 200, r.data)  # draft_id is POST only: an edit takes no draft
        self.assertFalse(SavedDraft.objects.exists())
        self.assertTrue(SaleDraft.objects.filter(pk=self.key).exists())

    def test_a_bill_made_again_from_a_draft(self):
        gone = sale(self.kgh, self.anil, "19", self.day, status=BILL_CANCELLED, cancel_reason="Returned")
        self.keep(data={"replaces": gone.pk})
        r = self.save(replaces=gone.pk)
        self.assertEqual((r.status_code, r.data["replaces"]["id"]), (201, gone.pk))
        self.refused(self.save(replaces=gone.pk), "31", self.ref(r.data["id"]))

    def test_a_draft_id_that_isnt_one(self):
        # Ruling 1A-5: in words, never DRF's "Must be a valid UUID.", and nothing is made.
        for value in ("abc", "-" * 36, 7, True, [self.key], {"id": self.key}, "\x00", self.key + "0"):
            with self.subTest(value=value):
                r = self.save(draft_id=value)
                self.assertEqual((r.status_code, r.data), (400, {"draft_id": ["That isn't an unfinished bill's id."]}))
        self.assertFalse(Invoice.objects.exists())
        self.assertEqual(self.save(draft_id=self.key.upper()).status_code, 201)  # the same id, written in capitals
        self.assertEqual(str(SavedDraft.objects.get().pk), self.key)


class DraftListTest(TestCase):
    def setUp(self):
        self.rakesh = person("rakesh", *ROLE_GROUPS["staff"], first_name="Rakesh", last_name="Soni")
        self.staff = client_for(self.rakesh)
        self.kgh, self.mo = firm(), firm("MEERA ORNAMENTS", gstin="08AAAAA0000A1Z5")

    def keep(self, business=None, key=None, client=None, **data):
        key = key or str(uuid.uuid4())
        r = (client or self.staff).put(reverse("draft-detail", args=[key]),
                                       {"business": business, "data": data or {"note": "x"}}, format="json")
        self.assertIn(r.status_code, (200, 201), r.data)
        return key

    def listed(self, client=None, **params):
        r = (client or self.staff).get(reverse("draft-list"), params)
        self.assertEqual(r.status_code, 200, r.data)
        return r.data["results"]

    def test_the_shops_drafts_newest_change_first(self):
        old, new = self.keep(self.kgh.pk), self.keep(self.mo.pk)
        none = self.keep()
        other = client_for(person("vimla", *ROLE_GROUPS["owner"], first_name="Vimla", last_name="Jain"))
        self.keep(self.kgh.pk, key=old, client=other, note="changed last")
        rows = self.listed(other)
        self.assertEqual([d["id"] for d in rows], [old, none, new])
        self.assertEqual(rows[0], {"id": old, "business": self.kgh.pk, "started_by": {"id": self.rakesh.pk,
                                   "name": "Rakesh Soni"}, "data": {"note": "changed last"},
                                   "created_at": rows[0]["created_at"], "updated_at": rows[0]["updated_at"]})
        self.assertRegex(rows[0]["updated_at"], r"^2\d{3}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+\+05:30$")
        self.assertLess(rows[0]["created_at"], rows[0]["updated_at"])

    def test_one_firms_drafts(self):
        kgh, mo = self.keep(self.kgh.pk), self.keep(self.mo.pk)
        self.keep()
        self.assertEqual([d["id"] for d in self.listed(business_id=self.kgh.pk)], [kgh])
        self.assertEqual([d["id"] for d in self.listed(business_id=str(self.mo.pk))], [mo])
        self.assertEqual(self.listed(business_id="424242"), [])  # Ruling 1A-33: an id not on file matches nothing
        self.assertEqual(len(self.listed(business_id="")), 3)
        for junk in ("abc", "1.5", "٣", "-1", "9" * 30, "3\x00"):
            with self.subTest(business_id=junk):
                r = self.staff.get(reverse("draft-list"), {"business_id": junk})
                self.assertEqual((r.status_code, r.data), (400, {"business_id": ["Pick a firm from the list."]}))

    def test_at_most_500(self):
        now = timezone.now()
        drafts = SaleDraft.objects.bulk_create([SaleDraft(id=uuid.uuid4(), started_by=self.rakesh, data={"n": n})
                                                for n in range(501)])
        for n, draft in enumerate(drafts):
            draft.updated_at = now - timedelta(minutes=n)  # draft 0 changed last
        SaleDraft.objects.bulk_update(drafts, ["updated_at"])
        rows = self.listed()
        self.assertEqual(len(rows), 500)
        self.assertEqual([d["data"]["n"] for d in rows], list(range(500)))  # the oldest change is left out

    def test_a_draft_saved_meanwhile_isnt_listed(self):
        # A keep that raced a save of its draft can leave the draft behind its note: it lists nowhere, and the next keep
        # or discard of it takes it away.
        key = self.keep(self.kgh.pk)
        SavedDraft.objects.create(id=key, invoice_number="31")
        self.assertEqual(self.listed(), [])
        r = self.staff.put(reverse("draft-detail", args=[key]), {"data": {}}, format="json")
        self.assertEqual((r.status_code, r.data["code"], r.data["bill"]), (409, "draft_saved", None))
        self.assertFalse(SaleDraft.objects.exists())

    def test_who_started_it_whom_v2_deleted(self):
        # Ruling 1A-6: no database constraint ties a draft to its starter; a deleted one reads as nobody.
        key = self.keep(self.kgh.pk)
        SaleDraft.objects.filter(pk=key).update(started_by_id=424242)
        self.assertIsNone(self.listed()[0]["started_by"])
        r = self.staff.put(reverse("draft-detail", args=[key]), {"data": {"n": 1}}, format="json")
        self.assertEqual((r.status_code, r.data["started_by"]), (200, None))
        gone = person("gone", *ROLE_GROUPS["staff"])
        key = self.keep(client=client_for(gone))
        User.objects.filter(pk=gone.pk).delete()
        self.assertIsNone(SaleDraft.objects.get(pk=key).started_by_id)

    def test_one_narrow_read_however_many_drafts(self):
        # Rulings 1A-36 and 1A-39: one query, with each starter joined (no read per draft), in only the columns the
        # rows show: never a password hash.
        self.listed()  # anything a first request sets up
        counts = []
        for n in (3, 30):
            users = [person(f"counter{n}-{k}", *ROLE_GROUPS["staff"]) for k in range(3)]
            for k in range(n - len(SaleDraft.objects.all())):
                self.keep(self.kgh.pk, client=client_for(users[k % 3]))
            with CaptureQueriesContext(connection) as seen:
                self.assertEqual(len(self.listed()), n)
            counts.append(len(seen.captured_queries))
            self.assertEqual([q["sql"][:120] for q in seen.captured_queries if '"password"' in q["sql"]], [])
        self.assertEqual(counts, [1, 1])

    def test_a_keep_reads_no_draft_back(self):
        # A keep sends the draft and gets it back; it never reads the stored one, nor more of its firm than that it's
        # on file (Neon's transfer, Ruling 1A-39).
        key = self.keep(self.kgh.pk, lines=["x" * 1000] * 30)
        for new in (False, True):
            with self.subTest(new=new), CaptureQueriesContext(connection) as seen:
                self.keep(self.kgh.pk, key=str(uuid.uuid4()) if new else key, note="y")
            reads = [q["sql"] for q in seen.captured_queries if q["sql"].lstrip().upper().startswith("SELECT")]
            wide = ('"data"', '"password"', '"name"', '"address"', '"bank_account_number"', '"signature_image"')
            self.assertEqual([sql[:160] for sql in reads if any(column in sql for column in wide)], [])

    def test_reading_writes_nothing(self):
        # Ruling 1A-16.
        self.keep(self.kgh.pk)
        with CaptureQueriesContext(connection) as seen:
            self.listed()
            self.listed(business_id=self.kgh.pk)
        self.assertEqual([q["sql"] for q in seen.captured_queries
                          if q["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE"))], [])

    def test_everyone_who_makes_bills_and_no_one_else(self):
        key = self.keep(self.kgh.pk)
        for role in ("owner", "staff"):
            with self.subTest(role=role):
                user = client_for(person(f"{role}2", *ROLE_GROUPS[role]))
                self.assertEqual(len(self.listed(user)), 1)
                self.assertEqual(user.put(reverse("draft-detail", args=[key]), {"data": {}}, format="json").status_code, 200)
        for role in ("accountant", "viewer"):
            with self.subTest(role=role):
                user = client_for(person(f"{role}2", *ROLE_GROUPS[role]))
                for r in (user.get(reverse("draft-list")), user.delete(reverse("draft-detail", args=[key])),
                          user.put(reverse("draft-detail", args=[key]), {"data": {}}, format="json")):
                    self.assertEqual((r.status_code, r.data["needs"]), (403, "bill.create"))
        nobody = client_for(None)
        self.assertEqual(nobody.get(reverse("draft-list")).status_code, 401)
        self.assertEqual(nobody.delete(reverse("draft-detail", args=[key])).status_code, 401)
        self.assertTrue(SaleDraft.objects.filter(pk=key).exists())


class DraftWordsTest(TestCase):
    """Ruling 1A-5: what can't be kept is a 400 in the contract's words, never a 500 and never DRF's own words, and
    nothing is kept; a path that names no draft is a 404 in words."""

    NEEDS_DATA = ["An unfinished bill needs its data."]
    PICK = ["Pick a firm from the list."]
    TOO_BIG = ["This unfinished bill is too big to keep (over 64 KB). Save it as a bill, or start a new one."]

    def setUp(self):
        self.staff = client_for(person("rakesh", *ROLE_GROUPS["staff"]))
        self.kgh = firm()
        self.key = str(uuid.uuid4())

    def put(self, body, key=None, raw=False):
        url = reverse("draft-detail", args=[key or self.key])
        if raw:  # JSON text as sent, for what Python's own encoder wouldn't write
            return self.staff.put(url, body, content_type="application/json")
        return self.staff.put(url, body, format="json")

    def test_data_that_isnt_a_bills(self):
        for data in (None, [], [1, 2], "data", "", 7, 1.5, True):
            with self.subTest(data=data):
                r = self.put({"business": self.kgh.pk, "data": data})
                self.assertEqual((r.status_code, r.data), (400, {"data": self.NEEDS_DATA}))
        r = self.put({"business": self.kgh.pk})
        self.assertEqual((r.status_code, r.data), (400, {"data": self.NEEDS_DATA}))
        self.assertFalse(SaleDraft.objects.exists())

    def test_a_firm_that_isnt_one(self):
        for business in (999, "999", 0, -1, "-1", "abc", "٣", "1.5", 1.5, True, False, [self.kgh.pk],
                         {"id": self.kgh.pk}, 10 ** 30, "9" * 40):
            with self.subTest(business=business):
                r = self.put({"business": business, "data": {}})
                self.assertEqual((r.status_code, r.data), (400, {"business": self.PICK}))
        self.assertFalse(SaleDraft.objects.exists())
        for business, kept in ((None, None), ("", None), (str(self.kgh.pk), self.kgh.pk)):
            with self.subTest(business=business):
                r = self.put({"business": business, "data": {}}, key=str(uuid.uuid4()))
                self.assertEqual((r.status_code, r.data["business"]), (201, kept))

    def test_a_body_that_isnt_an_object(self):
        for body in ("[1, 2]", '"draft"', "7", "null", "true"):
            with self.subTest(body=body):
                r = self.put(body, raw=True)
                self.assertEqual((r.status_code, r.data), (400, {"business": self.PICK, "data": self.NEEDS_DATA}))
        self.assertFalse(SaleDraft.objects.exists())

    def test_what_no_column_can_store_is_dropped(self):
        # A null character (Postgres refuses one, in text and in JSON) and a lone surrogate (half an emoji: no UTF-8
        # for it), in a text or a key, anywhere in the data. Sent as JSON text, escaped, so they can be sent at all.
        data = {"note\x00": "Bangles\x00 22K\ud83d", "lines": [{"name": "Ring\udc8d", "qty": 1}], "\ud83d": "x"}
        r = self.put(json.dumps({"business": self.kgh.pk, "data": data}), raw=True)
        self.assertEqual(r.status_code, 201, r.data)
        clean = {"note": "Bangles 22K", "lines": [{"name": "Ring", "qty": 1}], "": "x"}
        self.assertEqual(r.data["data"], clean)
        self.assertEqual(SaleDraft.objects.get().data, clean)
        self.assertEqual(self.staff.get(reverse("draft-list")).data["results"][0]["data"], clean)

    def test_numbers_json_cant_carry_and_nesting_no_form_has(self):
        # 1e400 reads as infinity, which no JSON column keeps and no answer can carry.
        for text in ('{"data": {"rate": 1e400}}', '{"data": {"lines": [{"rate": -1e999}]}}'):
            with self.subTest(text=text):
                r = self.put(text, raw=True)
                self.assertEqual((r.status_code, r.data), (400, {"data": self.NEEDS_DATA}))
        deep = {}
        for _ in range(31):
            deep = {"x": deep}
        self.assertEqual(self.put({"data": deep}).status_code, 201)  # 32 levels, the data itself the first
        for levels in (33, 500):
            deep = {}
            for _ in range(levels - 1):
                deep = {"x": [deep]} if levels > 100 else {"x": deep}
            with self.subTest(levels=levels):
                r = self.put({"data": deep}, key=str(uuid.uuid4()))
                self.assertEqual((r.status_code, r.data), (400, {"data": self.NEEDS_DATA}))

    def test_64_kb_as_sent(self):
        # The data as the client sends it: compact JSON in UTF-8, so a name in Hindi counts its own bytes.
        for data, ok in (({"x": "y" * 65528}, True), ({"x": "y" * 65529}, False), ({"x": "₹" * 21842}, True),
                         ({"x": "₹" * 21843}, False)):
            with self.subTest(size=len(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode())):
                r = self.put({"data": data}, key=str(uuid.uuid4()))
                self.assertEqual(r.status_code, 201 if ok else 400)
                if not ok:
                    self.assertEqual(r.data, {"data": self.TOO_BIG})

    def test_a_path_that_names_no_draft(self):
        for key in ("-" * 36, "abc", "123", "5d1c2a8e-0b7f-4a8e-9c3a-1f2e3d4c5b6", "5d1c2a8e-0b7f-4a8e-9c3a-1f2e3d4c5b6aa",
                    "%00", "z" * 36):
            with self.subTest(key=key):
                url = f"{reverse('draft-list')}{key}/"
                for r in (self.staff.put(url, {"data": {}}, format="json"), self.staff.delete(url)):
                    self.assertEqual((r.status_code, r.json()), (404, {"detail": "No draft has that id."}))
        self.assertFalse(SaleDraft.objects.exists())
        # The same UUID in capitals is the same draft
        self.assertEqual(self.put({"data": {}}, key=self.key.upper()).data["id"], self.key)
        self.assertEqual(self.put({"data": {}}).status_code, 200)


class DraftThrottleTest(TestCase):
    """Ruling 1A-42: keeps have their own rate, drafts' 120 a minute, so a day of the paper book, a keep at every pause,
    never spends the user's daily requests, which the saves need. Production's throttles, with the rates below."""

    def setUp(self):
        self.staff = client_for(person("rakesh", *ROLE_GROUPS["staff"]))
        self.kgh, self.anil = firm(), buyer()
        self.key = str(uuid.uuid4())

    def keep(self, n):
        return self.staff.put(reverse("draft-detail", args=[self.key]), {"business": self.kgh.pk, "data": {"n": n}},
                              format="json")

    @staticmethod
    def rated(prod, **rates):
        """Production's REST settings with these rates changed, for the scoped throttles (read live) and for the user's
        (read from its class)."""
        changed = {**prod.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"], **rates}
        return (override_settings(REST_FRAMEWORK={**prod.REST_FRAMEWORK, "DEFAULT_THROTTLE_RATES": changed}),
                patch.object(SimpleRateThrottle, "THROTTLE_RATES", changed))

    def test_keeps_and_discards_bypass_the_daily_allowance_but_the_list_spends_it(self):
        with production_throttling() as prod:
            rest, user_rates = self.rated(prod, user="2/day")  # the day's budget, shrunk to two requests
            with rest, user_rates:
                for n in range(20):  # a bill typed with many pauses never spends the user's daily requests
                    self.assertEqual(self.keep(n).status_code, 201 if n == 0 else 200)
                self.assertEqual(self.staff.delete(reverse("draft-detail", args=[self.key])).status_code, 204)
                self.assertEqual(self.keep(20).status_code, 201)
                body = {"business": self.kgh.pk, "customer": self.anil.pk, "invoice_number": "1",
                        "invoice_date": str(timezone.localdate()), "lines": [LINE], "draft_id": self.key}
                r = self.staff.post(reverse("sale-list"), body, format="json")
                self.assertEqual(r.status_code, 201, r.data)  # the save still goes through: the day's first request
                self.assertEqual(self.staff.get(reverse("draft-list")).status_code, 200)  # Ruling 1A-44: the second
                self.assertEqual(self.staff.get(reverse("sale-list")).status_code, 429)  # the tiny budget is real
                self.assertEqual(self.staff.get(reverse("draft-list")).status_code, 429)
                self.key = str(uuid.uuid4())
                self.assertEqual(self.keep(21).status_code, 201)  # keeps and discards still work after the daily cap
                self.assertEqual(self.keep(22).status_code, 200)
                self.assertEqual(self.staff.delete(reverse("draft-detail", args=[self.key])).status_code, 204)

    def test_keeps_have_their_own_rate(self):
        self.assertEqual(load_production_settings().REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["drafts"], "120/min")
        with production_throttling() as prod:
            rest, user_rates = self.rated(prod, drafts="3/min")
            with rest, user_rates:
                self.assertEqual([self.keep(n).status_code for n in range(4)], [201, 200, 200, 429])
                self.assertEqual(self.staff.get(reverse("sale-list")).status_code, 200)  # the rest of the app goes on


class ResetTest(TestCase):
    def test_the_sandbox_reset_empties_the_drafts_and_their_notes(self):
        from billing.management.commands.seed_sandbox import Command

        kgh = firm()
        SaleDraft.objects.create(id=uuid.uuid4(), business=kgh, data={"note": "x"})  # it protects its firm
        SavedDraft.objects.create(id=uuid.uuid4(), bill_id=424242, invoice_number="31")
        Command()._reset()
        self.assertEqual((SaleDraft.objects.count(), SavedDraft.objects.count(), Business.objects.count()), (0, 0, 0))


@skipUnlessDBFeature("has_select_for_update")
class AtOnceTest(TransactionTestCase):
    """Rulings 1D-6 and 1D-8 on a database with row locks: what comes while another request holds a draft waits for it.
    A save of the draft held open (its bill made and its draft taken, not yet committed): a second save of it, or a
    keep, then finds the draft saved. A keep of a new draft held open: a second keep then replaces it."""

    def setUp(self):
        self.rakesh = person("rakesh", *ROLE_GROUPS["staff"])
        self.owner = client_for(person("kailash", *ROLE_GROUPS["owner"]))
        self.kgh, self.anil = firm(), buyer()
        self.key = str(uuid.uuid4())
        r = self.owner.put(reverse("draft-detail", args=[self.key]), {"business": self.kgh.pk, "data": {}}, format="json")
        self.assertEqual(r.status_code, 201)

    def body(self, number):
        return {"business": self.kgh.pk, "customer": self.anil.pk, "invoice_number": number,
                "invoice_date": str(timezone.localdate()), "lines": [LINE], "draft_id": self.key}

    def held_save(self):
        locked, release, made = threading.Event(), threading.Event(), {}

        def first():
            try:
                with transaction.atomic():
                    made["bill"] = save_bill(valid(SaleSerializer, self.body("1")), self.rakesh)
                    locked.set()
                    release.wait(10)
            finally:
                connection.close()

        thread = threading.Thread(target=first, daemon=True)  # a daemon, so a stuck lock can't keep pytest open
        thread.start()
        self.assertTrue(locked.wait(10))
        return thread, release, made

    def meanwhile(self, ask):
        answer = {}

        def second():
            try:
                answer["r"] = ask()
            finally:
                connection.close()

        thread = threading.Thread(target=second, daemon=True)
        thread.start()
        thread.join(0.5)
        self.assertTrue(thread.is_alive())  # waiting for the first save
        return thread, answer

    def settle(self, *threads, release):
        release.set()
        for thread in threads:
            thread.join(10)

    def test_two_saves_at_once_make_one_bill(self):
        first, release, made = self.held_save()
        second, answer = self.meanwhile(
            lambda: self.owner.post(reverse("sale-list"), self.body("2"), format="json"))
        self.settle(first, second, release=release)
        r = answer["r"]
        self.assertEqual((r.status_code, r.data["code"], r.data["bill"]["id"]), (409, "draft_saved", made["bill"].pk))
        self.assertEqual(list(Invoice.objects.values_list("invoice_number", flat=True)), ["1"])

    def test_two_keeps_of_one_new_draft_at_once(self):
        # The first makes it; the second waits for that, then replaces it, and who started it stays the first one.
        key, locked, release = str(uuid.uuid4()), threading.Event(), threading.Event()

        def first():
            try:
                with transaction.atomic():
                    SaleDraft.objects.create(id=key, business=self.kgh, started_by=self.rakesh, data={"n": 1})
                    locked.set()
                    release.wait(10)
            finally:
                connection.close()

        thread = threading.Thread(target=first, daemon=True)
        thread.start()
        self.assertTrue(locked.wait(10))
        second, answer = self.meanwhile(lambda: self.owner.put(reverse("draft-detail", args=[key]),
                                                               {"business": self.kgh.pk, "data": {"n": 2}}, format="json"))
        self.settle(thread, second, release=release)
        r = answer["r"]
        self.assertEqual((r.status_code, r.data["data"], r.data["started_by"]["id"]), (200, {"n": 2}, self.rakesh.pk))
        self.assertEqual(SaleDraft.objects.get(pk=key).data, {"n": 2})

    def test_a_keep_while_the_bill_is_being_made_waits_and_is_refused(self):
        # Task 10's review, minor 2: the save is held before its bill is made, its draft claimed and taken. A keep then
        # waits for it and is refused; it used to be told "kept", and then the save deleted the draft.
        locked, release, made = threading.Event(), threading.Event(), {}

        def holding(*args, **kwargs):
            locked.set()
            release.wait(10)
            return checked_number(*args, **kwargs)

        def first():
            try:
                made["bill"] = save_bill(valid(SaleSerializer, self.body("1")), self.rakesh)
            finally:
                connection.close()

        with patch("billing.services.sales.checked_number", holding):
            thread = threading.Thread(target=first, daemon=True)
            thread.start()
            self.assertTrue(locked.wait(10))
            second, answer = self.meanwhile(lambda: self.owner.put(reverse("draft-detail", args=[self.key]),
                                                                   {"business": self.kgh.pk, "data": {"n": 2}},
                                                                   format="json"))
            self.settle(thread, second, release=release)
        r = answer["r"]
        self.assertEqual((r.status_code, r.data["code"], r.data["bill"]["id"]), (409, "draft_saved", made["bill"].pk))
        self.assertFalse(SaleDraft.objects.exists())

    def test_a_keep_meanwhile_never_makes_the_draft_again(self):
        first, release, made = self.held_save()
        second, answer = self.meanwhile(lambda: self.owner.put(reverse("draft-detail", args=[self.key]),
                                                               {"business": self.kgh.pk, "data": {"n": 2}}, format="json"))
        self.settle(first, second, release=release)
        r = answer["r"]
        self.assertEqual((r.status_code, r.data["code"], r.data["bill"]["id"]), (409, "draft_saved", made["bill"].pk))
        self.assertFalse(SaleDraft.objects.exists())
