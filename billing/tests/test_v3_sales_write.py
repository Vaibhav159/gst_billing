"""Making and changing a bill (plan 1A, Task 8): POST and PUT /api/sales/, the e-way details and
re-filing the tax heads. Paper first: the number is always the one typed."""

import json
import re
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from decimal import Decimal
from unittest.mock import patch

from cacheops.conf import prepare_profiles
from cacheops.conf import settings as cacheops_settings
from django.db import connection
from django.test import TestCase, TransactionTestCase, override_settings, skipUnlessDBFeature
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone

from billing.constants import BILL_CANCELLED, V2_LINE_SNAPSHOT_FIELDS
from billing.models import AuditLog, FiledPeriod, Invoice, LineItem
from billing.services.bin import bin_bill
from billing.tests.test_v3_cacheops import CACHED
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person, sale

RING = {"product_name": "Gold Ring 22K", "hsn_code": "711319", "gst_percent": "3", "quantity": "12.345",
        "unit": "gms", "rate": "6512.50"}
CHAIN = {"product_name": "Gold Chain 22K", "hsn_code": "711319", "gst_percent": "3", "quantity": "1",
         "unit": "pcs", "rate": "4150"}


class CreateTest(TestCase):
    def setUp(self):
        self.staff = client_for(person("rakesh", *ROLE_GROUPS["staff"]))
        self.kgh = firm(invoice_prefix="KGH", paper_full_number_from=date(2026, 4, 1))
        self.anil = buyer(mobile_number="9829041122")

    def body(self, **more):
        return {"business": self.kgh.pk, "customer": self.anil.pk, "invoice_number": "31",
                "invoice_date": "2026-10-08", "payment_mode": "cash", "lines": [RING, CHAIN], **more}

    def make(self, client=None, **more):
        return (client or self.staff).post(reverse("sale-list"), self.body(**more), format="json")

    def test_a_bill_from_the_paper_book(self):
        r = self.make(paper=True, notes="Order 77")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual((r.data["invoice_number"], r.data["paper"], r.data["notes"]), ("KGH/2026-27/31", True, "Order 77"))
        self.assertEqual((r.data["taxable"], r.data["tax"], r.data["total_amount"]), ("84546.81", "2536.40", "87083.21"))
        self.assertEqual(r.data["firm"]["frozen"], True)
        bill = Invoice.objects.get(pk=r.data["id"])
        self.assertEqual(bill.firm_snapshot["name"], "KIRAN GOLD HOUSE")
        entry = AuditLog.objects.get(action="created", entity_id=bill.pk)
        self.assertEqual(entry.details, "Anil Gupta · ₹87,083.21 · From the paper bill book, dated 08 Oct 2026")
        self.assertEqual(set(entry.snapshot["line_items"][0]), set(V2_LINE_SNAPSHOT_FIELDS))

    def test_numbers_may_come_as_json_numbers(self):
        r = self.make(lines=[{**RING, "gst_percent": 3.0, "quantity": 12.345, "rate": 6512.5}])
        self.assertEqual((r.status_code, r.data["lines"][0]["gst_percent"], r.data["taxable"]), (201, "3", "80396.81"))

    def test_the_servers_one_rounding_rule(self):
        line = {**RING, "quantity": "1", "rate": "549.67"}  # tax 16.49: CGST takes the half rounded up
        r = self.make(lines=[line])
        self.assertEqual((r.data["lines"][0]["cgst"], r.data["lines"][0]["sgst"]), ("8.25", "8.24"))

    def test_the_place_of_supply_is_stored_only_when_it_differs_from_the_rule(self):
        gujarati = buyer("Desai Walk-in", state="GUJARAT")
        counter = self.make(customer=gujarati.pk, place_of_supply="08").data
        self.assertEqual((counter["place_of_supply_chosen"], counter["interstate"], counter["lines"][0]["igst"]),
                         ("08", False, "0.00"))
        usual = self.make(customer=gujarati.pk, invoice_number="32", place_of_supply="24").data
        self.assertEqual((usual["place_of_supply_chosen"], usual["interstate"]), (None, True))

    def test_the_number_is_required_and_free(self):
        r = self.make(invoice_number="")
        self.assertEqual(r.data, {"invoice_number": ["Type the bill number, or use the next free one, KGH/2026-27/1."]})
        self.make()
        r = self.make()
        self.assertEqual((r.status_code, r.data["code"], r.data["next"]["invoice_number"]),
                         (409, "number_taken", "KGH/2026-27/32"))
        bin_bill(Invoice.objects.get(), None)
        self.assertEqual(self.make().data["code"], "number_deleted")

    def test_a_closed_month_and_the_future(self):
        FiledPeriod.objects.create(business=self.kgh, year=2026, month=10)
        r = self.make()
        self.assertEqual((r.status_code, r.data["code"]), (409, "month_closed"))
        self.assertIn("so no bill can go into it", r.data["detail"])
        tomorrow = timezone.localdate() + timedelta(days=1)
        r = self.make(invoice_date=tomorrow.isoformat())
        self.assertEqual(r.data, {"invoice_date": [
            f"{tomorrow.day:02d} {tomorrow.strftime('%b')} {tomorrow.year} is after today. A bill can't be dated in the future."]})

    def test_words_for_what_was_sent(self):
        r = self.make(customer=None, lines=[])
        self.assertEqual(r.data["customer"], ["Choose who this bill is for. Pick Walk-in customer for a counter sale."])
        self.assertEqual(r.data["lines"], ["Add at least one item: pick a product, then type its weight."])
        # On the wire, line problems are keyed by the line's position; good lines are left out (DRF 3.18).
        bad = {"product_name": "", "hsn_code": "71", "gst_percent": "2", "quantity": "0", "unit": "gms", "rate": "x"}
        r = self.make(lines=[RING, bad])
        self.assertEqual(r.json()["lines"], {"1": {"product_name": ["Type the item's name."]}})
        r = self.make(lines=[{**bad, "product_name": "Ring"}])
        self.assertEqual(r.json()["lines"]["0"], {
            "hsn_code": ["Type the HSN code, 4 to 8 digits (7113 for jewellery)."],
            "gst_percent": ["Choose the GST rate. Gold and silver jewellery is 3%; cut diamonds are 0.25%."],
            "quantity": ["Type the weight in grams, like 12.345."], "rate": ["Type the rate per gram."]})
        r = self.make(lines=[{**CHAIN, "quantity": "", "rate": "0", "note": "n" * 61}])
        self.assertEqual(r.json()["lines"]["0"], {"note": ["Keep the note to 60 characters; it prints under the item."]})
        r = self.make(lines=[{**CHAIN, "quantity": "", "rate": "0"}])
        self.assertEqual(r.json()["lines"]["0"], {"quantity": ["Type how many pieces."], "rate": ["Type the rate per piece."]})
        self.assertEqual(self.make(lines=[{**RING, "unit": "bag"}]).json()["lines"]["0"], {"unit": ["Pick a unit from the list."]})
        self.assertEqual(self.make(payment_mode="upi").data,
                         {"payment_mode": ["Choose how it was paid: cash, UPI / bank, udhaar, or part cash, part UPI."]})
        self.assertEqual(self.make(place_of_supply="99x").data,
                         {"place_of_supply": ["Choose the state the goods are delivered to."]})
        self.assertEqual(self.make(lines=[RING] * 201).data, {"lines": ["A bill can have at most 200 items."]})

    def test_make_it_again(self):
        old = sale(self.kgh, self.anil, "KGH/2026-27/19", "2026-10-01")
        self.assertEqual(self.make(replaces=old.pk).data, {"replaces": ["Only a cancelled bill can be made again."]})
        Invoice.objects.filter(pk=old.pk).update(status=BILL_CANCELLED)
        r = self.make(replaces=old.pk)
        self.assertEqual(r.data["replaces"]["id"], old.pk)
        self.assertEqual(self.make(invoice_number="40", replaces=old.pk).data,
                         {"replaces": ["KGH/2026-27/19 was made again already, as KGH/2026-27/31."]})

    def test_who_may_make_bills(self):
        for role in ("accountant", "viewer"):
            r = self.make(client_for(person(role, *ROLE_GROUPS[role])))
            self.assertEqual((r.status_code, r.data["needs"]), (403, "bill.create"))

    # Beyond the plan's tests: the rulings.

    def test_the_answer_holds_its_own_created_row(self):
        # Ruling (1B Task 10's review): the BillDetail a save answers already shows the row the save wrote.
        r = self.make()
        self.assertEqual([(a["action"], a["details"]) for a in r.data["history"]["activity"]],
                         [("created", "Anil Gupta · ₹87,083.21")])
        self.assertEqual(r.data["sent"], None)

    def test_a_date_from_2000_to_2099(self):
        # Ruling 1A-32: a mistyped year (0026, 1926) would make a bill no return or report ever shows.
        for day in ("1999-12-31", "0026-10-08", "1926-10-08"):
            with self.subTest(day=day):
                self.assertEqual(self.make(invoice_date=day).data, {"invoice_date": ["Pick a date from 2000 to 2099."]})
        self.assertEqual(self.make(invoice_date="2000-01-01").status_code, 201)
        for day, words in (("", "Type the date like 2026-09-30."), ("08/10/2026", "Type the date like 2026-09-30."),
                           ("2026-02-30", "Type the date like 2026-09-30."), (None, "Type the date of the bill.")):
            with self.subTest(day=day):
                self.assertEqual(self.make(invoice_date=day).data, {"invoice_date": [words]})
        body = self.body()
        del body["invoice_date"]
        r = self.staff.post(reverse("sale-list"), body, format="json")
        self.assertEqual(r.data, {"invoice_date": ["Type the date of the bill."]})

    def test_a_typed_number_as_a_json_number_and_a_draft_id(self):
        # draft_id is Task 10's: accepted and left alone here, so the form's saves work before it lands.
        r = self.make(invoice_number=31, draft_id="5d1c2a8e-0b7f-4a8e-9c3a-1f2e3d4c5b6a")
        self.assertEqual((r.status_code, r.data["invoice_number"]), (201, "KGH/2026-27/31"))

    def test_what_no_column_can_store_is_dropped_from_the_texts(self):
        # A null character (psycopg refuses one) and a lone surrogate (a broken emoji: no UTF-8 for it). The body goes
        # as JSON text, escaped, so the surrogate can be sent at all.
        body = self.body(notes="Order\x00 77\ud83d", lines=[{**RING, "product_name": "Gold\x00 Ring\udc8d",
                                                              "note": "\x00Hallmarked"}])
        r = self.staff.post(reverse("sale-list"), json.dumps(body), content_type="application/json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual((r.data["notes"], r.data["lines"][0]["product_name"], r.data["lines"][0]["note"]),
                         ("Order 77", "Gold Ring", "Hallmarked"))

    def test_the_paper_flag_in_words(self):
        for value in ("maybe", None, [], 2):
            with self.subTest(paper=value):
                self.assertEqual(self.make(paper=value).data, {"paper": ["Say whether the bill is from the paper bill book."]})

    @skipUnlessDBFeature("has_select_for_update")
    def test_a_bill_made_again_reads_the_cancelled_one_under_its_row_lock(self):
        # Two saves at once can't both make it again: the second waits for the first, then finds it made.
        old = sale(self.kgh, self.anil, "KGH/2026-27/19", "2026-10-01", status=BILL_CANCELLED)
        with CaptureQueriesContext(connection) as seen:
            self.assertEqual(self.make(replaces=old.pk).status_code, 201)
        locked = [q["sql"] for q in seen.captured_queries if "FOR UPDATE" in q["sql"] and f"= {old.pk}" in q["sql"]]
        self.assertEqual(len(locked), 1, [q["sql"][:160] for q in seen.captured_queries])

    def test_ids_that_arent_plain_digits_name_nothing(self):
        # Ruling 1A-5: 1.5 isn't firm 1, true isn't 1, and 0 or -1 is no bill to make again.
        customer = "Choose who this bill is for. Pick Walk-in customer for a counter sale."
        for field, words in (("business", "Pick the firm."), ("customer", customer)):
            for value in (1.5, True, "١", "", None, "abc", [1], 10 ** 30):
                with self.subTest(field=field, value=value):
                    self.assertEqual(self.make(**{field: value}).data, {field: [words]})
        for value in (0, -1, "abc", 1.5, True, 10 ** 30):
            with self.subTest(replaces=value):
                self.assertEqual(self.make(replaces=value).data, {"replaces": ["Only a cancelled bill can be made again."]})
        self.assertEqual(self.make(business=str(self.kgh.pk)).status_code, 201)

    def test_more_than_the_books_hold(self):
        # A line or a bill whose figures the columns can't hold is refused in words, never a 500 (Ruling 1A-5).
        self.assertEqual(self.make(lines=[{**RING, "quantity": "10000000", "rate": "0.001"}]).json()["lines"]["0"],
                         {"quantity": ["Type the weight in grams, like 12.345."]})  # a quantity holds 9,999,999.999
        huge = {**RING, "quantity": "9999999.999", "rate": "999999999.999"}
        self.assertEqual(self.make(lines=[huge]).json()["lines"]["0"],
                         {"rate": ["This item comes to more than one bill can hold. Check the weight and the rate."]})
        # The words follow the unit, as the quantity's do (review fix 1): pieces have no weight.
        self.assertEqual(self.make(lines=[RING, {**CHAIN, "quantity": "9999999", "rate": "999999999"}]).json()["lines"],
                         {"1": {"rate": [("This item comes to more than one bill can hold. Check the number of pieces "
                                          "and the rate.")]}})
        # A tax that fits CGST and SGST but not one head is too big as well: a move, a new state for the customer or
        # fix-heads would put all of it on IGST (review fix 2). 1 piece at ₹40 crore and 3% is ₹1.2 crore of tax; one
        # head holds ₹99,99,999.999.
        self.assertEqual(self.make(lines=[{**CHAIN, "quantity": "1", "rate": "400000000"}]).json()["lines"]["0"],
                         {"rate": [("This item comes to more than one bill can hold. Check the number of pieces "
                                    "and the rate.")]})
        big = {**RING, "quantity": "1", "rate": "300000000"}  # ₹30.9 crore a line: its amount and its tax fit
        self.assertEqual(self.make(lines=[big] * 4).data,
                         {"lines": ["These items come to more than one bill can hold. Split them into two bills."]})
        self.assertFalse(Invoice.objects.exists())


class LinesShapeTest(TestCase):
    """Ruling 3 of Task 8's dispatch: words about one line are keyed by its position; words about the lines as a whole
    are a plain list. DRF's own list checks (which nest their words under non_field_errors) never fire first."""

    def setUp(self):
        self.staff = client_for(person("rakesh", *ROLE_GROUPS["staff"]))
        self.kgh, self.anil = firm(invoice_prefix="KGH", paper_full_number_from=date(2026, 4, 1)), buyer()

    def lines(self, lines, **more):
        """The 400's `lines`; `...` sends no lines at all."""
        body = {"business": self.kgh.pk, "customer": self.anil.pk, "invoice_number": "31", "invoice_date": "2026-10-08",
                **({} if lines is ... else {"lines": lines}), **more}
        r = self.staff.post(reverse("sale-list"), body, format="json")
        self.assertEqual(r.status_code, 400, r.data)
        return r.json()["lines"]

    def test_the_two_shapes(self):
        add = ["Add at least one item: pick a product, then type its weight."]
        for lines in (..., None, [], "Ring", 1, {}, {"0": RING}):
            with self.subTest(lines=lines):
                self.assertEqual(self.lines(lines), add)
        self.assertEqual(self.lines([RING] * 201), ["A bill can have at most 200 items."])
        self.assertEqual(self.lines([RING, {**RING, "rate": "0"}, RING, {**RING, "unit": "bag"}]),
                         {"1": {"rate": ["Type the rate per gram."]}, "3": {"unit": ["Pick a unit from the list."]}})
        # A line that isn't an object carries no item: its name is missing.
        name = {"product_name": ["Type the item's name."]}
        self.assertEqual(self.lines([RING, None, "Ring", 1, [RING]]), {"1": name, "2": name, "3": name, "4": name})


class UpdateTest(TestCase):
    def setUp(self):
        self.owner = client_for(person("kailash", *ROLE_GROUPS["owner"]))
        self.kgh = firm(invoice_prefix="KGH", paper_full_number_from=date(2026, 4, 1))
        self.anil = buyer(mobile_number="9829041122")
        self.bill = sale(self.kgh, self.anil, "INV 7/old", "2026-10-02")  # an older shape, from before the rules

    def put(self, client=None, **more):
        body = {"business": self.kgh.pk, "customer": self.anil.pk, "invoice_number": "INV 7/old",
                "invoice_date": "2026-10-02", "payment_mode": "bank", "lines": [RING], **more}
        return (client or self.owner).put(reverse("sale-detail", args=[self.bill.pk]), body, format="json")

    def test_an_edit_keeps_an_unchanged_number_and_logs_the_changes(self):
        r = self.put()
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual((r.data["invoice_number"], r.data["total_amount"], r.data["line_count"]),
                         ("INV 7/old", "82808.71", 1))
        entry = AuditLog.objects.get(action="updated", entity_id=self.bill.pk)
        self.assertEqual(set(entry.changes), {"payment_mode", "total_amount"})
        self.assertEqual(LineItem.objects.filter(invoice=self.bill).count(), 1)

    def test_a_new_number_is_checked(self):
        self.assertEqual(self.put(invoice_number="7 B").data["invoice_number"][0][:38],
                         'Use only letters, digits, "-" and "/" ')
        self.assertEqual(self.put(invoice_number="7").data["invoice_number"], "KGH/2026-27/7")

    def test_moving_firm_freezes_the_new_one(self):
        mo = firm("MEERA ORNAMENTS", gstin="08AAAAA0000A1Z5", invoice_prefix="MO", paper_full_number_from=date(2026, 4, 1))
        r = self.put(business=mo.pk, invoice_number="5")
        self.assertEqual((r.data["invoice_number"], r.data["firm"]["name"]), ("MO/2026-27/5", "MEERA ORNAMENTS"))

    def test_a_move_freezes_the_new_firm_over_the_old_one(self):
        made = self.owner.post(reverse("sale-list"), {
            "business": self.kgh.pk, "customer": self.anil.pk, "invoice_number": "8", "invoice_date": "2026-10-02",
            "lines": [RING]}, format="json").data
        self.assertEqual((made["firm"]["name"], made["firm"]["frozen"]), ("KIRAN GOLD HOUSE", True))
        mo = firm("MEERA ORNAMENTS", gstin="08AAAAA0000A1Z5", invoice_prefix="MO", paper_full_number_from=date(2026, 4, 1))
        r = self.owner.put(reverse("sale-detail", args=[made["id"]]), {
            "business": mo.pk, "customer": self.anil.pk, "invoice_number": "5", "invoice_date": "2026-10-02",
            "lines": [RING]}, format="json")
        self.assertEqual((r.data["firm"]["name"], r.data["firm"]["frozen"]), ("MEERA ORNAMENTS", True))
        self.assertEqual(Invoice.objects.get(pk=made["id"]).firm_snapshot["invoice_prefix"], "MO")
        entry = AuditLog.objects.get(action="updated", entity_id=made["id"])
        self.assertEqual(entry.changes["business"], {"old": str(self.kgh.pk), "new": str(mo.pk)})

    def test_refusals(self):
        staff = client_for(person("rakesh", *ROLE_GROUPS["staff"]))
        self.assertEqual(self.put(staff).data["needs"], "bill.edit")
        FiledPeriod.objects.create(business=self.kgh, year=2026, month=9)
        self.assertEqual(self.put(invoice_date="2026-09-30").data["code"], "month_closed")
        Invoice.objects.filter(pk=self.bill.pk).update(status=BILL_CANCELLED)
        r = self.put()
        self.assertEqual((r.status_code, r.data), (409, {
            "detail": "Cancelled bills can't be changed. Make it again from the bill instead.", "code": "cancelled"}))

    # Beyond the plan's tests: the rulings.

    def test_the_answer_holds_its_own_updated_row(self):
        # The saved panel (1B) compares the latest "updated" row with sent.last_at to tell whether the corrected bill
        # still needs sending: edited, sent and edited again must read "not sent" at once.
        r = self.put()
        self.assertEqual(r.status_code, 200, r.data)
        self.owner.post(reverse("sale-sent", args=[self.bill.pk]), {"via": "whatsapp"}, format="json")
        r = self.put(payment_mode="cash")
        newest = r.data["history"]["activity"][0]
        self.assertEqual((newest["action"], newest["details"]), ("updated", "Changed the payment"))
        self.assertGreater(datetime.fromisoformat(newest["at"]), datetime.fromisoformat(r.data["sent"]["last_at"]))
        self.assertEqual([a["action"] for a in r.data["history"]["activity"]], ["updated", "sent", "updated"])

    def test_a_new_customer_drops_the_number_the_bill_was_sent_to(self):
        # The send record belongs to the bill (Task 4's review): a one-off number typed for the old customer must not
        # be reused for the new one; when and how it was sent stay as history.
        Invoice.objects.filter(pk=self.bill.pk).update(sent_at=timezone.now(), last_sent_at=timezone.now(), sent_count=2,
                                                       sent_via="whatsapp", sent_to="9876543210")
        self.assertEqual(self.put(payment_mode="cash").data["sent"]["to"], "9876543210")
        sent = self.put(customer=buyer("Hemant Dave").pk).data["sent"]
        self.assertEqual((sent["to"], sent["count"], sent["via"]), ("", 2, "whatsapp"))
        self.assertIsNotNone(sent["at"])

    def test_paper_and_replaces_are_for_a_new_bill_only(self):
        r = self.put(paper=True, replaces=self.bill.pk)
        self.assertEqual((r.status_code, r.data["paper"], r.data["replaces"]), (200, False, None))

    def test_an_unchanged_number_or_date_isnt_checked_again(self):
        # An older bill keeps a number from before the rules, stored with spaces around it, and a date before 2000
        # (Ruling 1A-32): neither is checked while it doesn't change.
        Invoice.objects.filter(pk=self.bill.pk).update(invoice_number=" INV 7/old ", invoice_date="1999-03-31")
        r = self.put(invoice_date="1999-03-31")
        self.assertEqual((r.status_code, r.data["invoice_number"]), (200, " INV 7/old "))
        self.assertEqual(self.put(invoice_date="1999-03-30").data, {"invoice_date": ["Pick a date from 2000 to 2099."]})

    def test_an_edit_moves_the_lines_onto_the_new_heads(self):
        mumbai = buyer("Mumbai Buyer", state="MAHARASHTRA")
        r = self.put(customer=mumbai.pk)
        self.assertEqual((r.data["interstate"], r.data["igst"], r.data["cgst"], r.data["total_amount"]),
                         (True, "2411.90", "0.00", "82808.71"))
        self.assertEqual(set(LineItem.objects.filter(invoice=self.bill).values_list("customer_id", flat=True)), {mumbai.pk})

    def test_an_unchanged_number_in_digits_is_kept(self):
        # Review fix 1: the form sends the stored number back as it is. A v2 bill numbered "31", dated on or after the
        # firm's paper_full_number_from, keeps "31" (contract 2.3) and isn't checked: never renumbered KGH/2026-27/31,
        # and never refused because another bill holds that.
        v2 = sale(self.kgh, self.anil, "31", "2026-10-03")
        r = self.owner.put(reverse("sale-detail", args=[v2.pk]), {
            "business": self.kgh.pk, "customer": self.anil.pk, "invoice_number": "31", "invoice_date": "2026-10-03",
            "payment_mode": "bank", "lines": [RING]}, format="json")
        self.assertEqual((r.status_code, r.data["invoice_number"]), (200, "31"))
        self.assertNotIn("invoice_number", AuditLog.objects.get(action="updated", entity_id=v2.pk).changes)
        held = sale(self.kgh, self.anil, "32", "2026-10-03")
        sale(self.kgh, self.anil, "KGH/2026-27/32", "2026-10-04")
        r = self.owner.put(reverse("sale-detail", args=[held.pk]), {
            "business": self.kgh.pk, "customer": self.anil.pk, "invoice_number": " 32 ", "invoice_date": "2026-10-03",
            "payment_mode": "bank", "lines": [RING]}, format="json")
        self.assertEqual((r.status_code, r.data["invoice_number"]), (200, "32"))
        # Typed as digits, a number stored in the firm's format is the same number: a v2 twin in another case, which
        # the check would name, doesn't stop the edit.
        full = sale(self.kgh, self.anil, "KGH/2026-27/33", "2026-10-03")
        sale(self.kgh, self.anil, "kgh/2026-27/33", "2026-10-04")
        r = self.owner.put(reverse("sale-detail", args=[full.pk]), {
            "business": self.kgh.pk, "customer": self.anil.pk, "invoice_number": "33", "invoice_date": "2026-10-03",
            "payment_mode": "bank", "lines": [RING]}, format="json")
        self.assertEqual((r.status_code, r.data["invoice_number"]), (200, "KGH/2026-27/33"))

    def test_an_edit_that_changes_nothing_writes_nothing(self):
        # Review fix 2: a PUT with the header and the lines as they are stored writes nothing, logs nothing and clears
        # no cache, and answers the bill as it is (contract 2.3). An edit logged for nothing made 1B's saved panel ask
        # for a corrected bill to be sent.
        self.assertEqual(self.put().status_code, 200)  # a real edit first
        lines = list(LineItem.objects.filter(invoice=self.bill).values_list("pk", flat=True))
        with patch("billing.services.sales.invalidate") as invalidate, CaptureQueriesContext(connection) as seen:
            r = self.put()
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.json(), self.owner.get(reverse("sale-detail", args=[self.bill.pk])).json())
        self.assertEqual(list(LineItem.objects.filter(invoice=self.bill).values_list("pk", flat=True)), lines)
        self.assertEqual(AuditLog.objects.filter(action="updated", entity_id=self.bill.pk).count(), 1)
        invalidate.assert_not_called()
        self.assertEqual([q["sql"] for q in seen.captured_queries
                          if q["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE"))], [])
        # A line as stored but typed again, the number and spaces as stored: still nothing.
        r = self.put(invoice_number=" INV 7/old ", lines=[{**RING, "quantity": 12.345, "gst_percent": "3.0"}])
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(AuditLog.objects.filter(action="updated", entity_id=self.bill.pk).count(), 1)

    def test_an_edits_words_say_what_changed(self):
        # Ruling 1A-41: in words, in this order: the number, the date, the customer, the firm, the payment, the place
        # of supply, the note, the items, the total. `changes` keeps v2's old -> new for its log and Undo.
        def said(**more):
            self.assertEqual(self.put(**more).status_code, 200)
            entry = AuditLog.objects.filter(action="updated", entity_id=self.bill.pk).latest("pk")
            return entry.details, sorted(entry.changes or {})

        self.assertEqual(said(), ("Changed the payment, the items and the total", ["payment_mode", "total_amount"]))
        self.assertEqual(said(notes="Hallmarked"), ("Changed the note", ["notes"]))
        self.assertEqual(said(notes="Hallmarked", lines=[{**RING, "product_name": "Gold Ring 22K (plain)"}]),
                         ("Changed the items", []))
        # Any one thing a line stores is a change of the items, its figures the same or not.
        line = {**RING, "product_name": "Gold Ring 22K (plain)"}
        for change in ({"note": "Hallmarked 916"}, {"unit": "g"}, {"hsn_code": "7113"}):
            with self.subTest(**change):
                line = {**line, **change}
                self.assertEqual(said(notes="Hallmarked", lines=[line]), ("Changed the items", []))
                stored = LineItem.objects.get(invoice=self.bill)
                self.assertEqual(getattr(stored, next(iter(change))), next(iter(change.values())))
        # The weight and the rate changed together, the taxable the same (12.345 g × ₹6,512.50 is 24.690 g × ₹3,256.25):
        # still a change of the items, saved (review fix 2).
        line = {**line, "quantity": "24.690", "rate": "3256.25"}
        self.assertEqual(said(notes="Hallmarked", lines=[line]), ("Changed the items", []))
        stored = LineItem.objects.get(invoice=self.bill)
        self.assertEqual((stored.quantity, stored.rate), (Decimal("24.690"), Decimal("3256.25")))
        mo = firm("MEERA ORNAMENTS", gstin="08AAAAA0000A1Z5", invoice_prefix="MO", paper_full_number_from=date(2026, 4, 1))
        hemant = buyer("Hemant Dave")
        self.assertEqual(said(business=mo.pk, customer=hemant.pk, invoice_number="9", invoice_date="2026-10-01",
                              place_of_supply="24", payment_mode="cash", notes="", lines=[CHAIN]),
                         (("Changed the number, the date, the customer, the firm, the payment, the place of supply, the "
                           "note, the items and the total"),
                          ["business", "customer", "invoice_date", "invoice_number", "notes", "payment_mode",
                           "place_of_supply", "total_amount"]))

    def test_a_blank_place_is_the_rule_as_null_is(self):
        # Review fix 1 (minor 6): a v2 bill whose place_of_supply holds "" has no place chosen, so an edit that doesn't
        # touch it logs no place change.
        Invoice.objects.filter(pk=self.bill.pk).update(place_of_supply="")
        self.assertEqual(self.put().status_code, 200)
        self.assertEqual(set(AuditLog.objects.get(action="updated", entity_id=self.bill.pk).changes),
                         {"payment_mode", "total_amount"})

    def test_moving_out_of_a_filed_month_by_date_or_by_firm(self):
        # The old month is checked as well as the new (contract 2.3, 409 month_closed: "the old and the new month").
        FiledPeriod.objects.create(business=self.kgh, year=2026, month=9)
        filed = sale(self.kgh, self.anil, "KGH/2026-27/3", "2026-09-10")
        mo = firm("MEERA ORNAMENTS", gstin="08AAAAA0000A1Z5", invoice_prefix="MO", paper_full_number_from=date(2026, 4, 1))
        body = {"business": self.kgh.pk, "customer": self.anil.pk, "invoice_number": "KGH/2026-27/3",
                "invoice_date": "2026-10-01", "lines": [RING]}
        for more in ({}, {"business": mo.pk, "invoice_number": "3", "invoice_date": "2026-09-10"}):
            with self.subTest(**more):
                r = self.owner.put(reverse("sale-detail", args=[filed.pk]), {**body, **more}, format="json")
                self.assertEqual((r.status_code, r.data["code"]), (409, "month_closed"))
                self.assertIn("September 2026 is filed and locked for KIRAN GOLD HOUSE", r.data["detail"])

    def test_a_number_dated_into_another_fy_is_checked_there(self):
        # The same number in another FY is a new number of that FY's series: its bin and Rule 46 apply.
        bill = sale(self.kgh, self.anil, "5", "2026-04-02")
        bin_bill(sale(self.kgh, self.anil, "5", "2026-03-20"), None, "Entered twice")  # FY 2025-26's 5, in the bin
        r = self.owner.put(reverse("sale-detail", args=[bill.pk]), {
            "business": self.kgh.pk, "customer": self.anil.pk, "invoice_number": "5", "invoice_date": "2026-03-31",
            "lines": [RING]}, format="json")
        self.assertEqual((r.status_code, r.data["code"]), (409, "number_deleted"))
        r = self.put(invoice_date="2026-03-31")  # "INV 7/old" from before the rules: FY 2025-26 can't take it
        self.assertEqual(r.data, {"invoice_number": [
            'Use only letters, digits, "-" and "/" (GST rule 46). Spaces and other marks aren\'t allowed.']})

    def test_a_missing_bill_or_a_purchase_is_a_404(self):
        purchase = sale(self.kgh, self.anil, "P-1", "2026-10-02", kind="inward")
        for pk in (424242, purchase.pk, 10 ** 30):
            with self.subTest(pk=pk):
                r = self.owner.put(reverse("sale-detail", args=[pk]), {}, format="json")
                self.assertEqual((r.status_code, r.data), (404, {"detail": "No Invoice matches the given query."}))


class EwayAndHeadsTest(TestCase):
    def setUp(self):
        self.owner = client_for(person("kailash", *ROLE_GROUPS["owner"]))
        self.biz = firm()
        self.bill = sale(self.biz, buyer(), "1", "2026-10-02")

    def eway(self, **body):
        return self.owner.put(reverse("sale-eway", args=[self.bill.pk]), body, format="json")

    def test_e_way_details(self):
        r = self.eway(eway_bill_number="1234 5678 9012", vehicle_number="rj14-ab1234", distance_km=120)
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual((r.data["eway"]["eway_bill_number"], r.data["eway"]["vehicle_number"]),
                         ("123456789012", "RJ14AB1234"))
        self.assertEqual(AuditLog.objects.get(action="updated").details, "E-way bill 123456789012")

    def test_e_way_words(self):
        self.assertEqual(self.eway(eway_bill_number="123").data,
                         {"eway_bill_number": ["An e-way bill number has 12 digits; this has 3."]})
        self.assertEqual(self.eway(eway_bill_number="123456789012").data, {"vehicle_number": [
            "By road, the e-way bill needs the vehicle number. Add it here, or later on the portal (Part B)."]})
        self.assertEqual(self.eway(transporter_gstin="08ABC").data,
                         {"transporter_gstin": ["A transporter's GSTIN or transporter ID has 15 characters."]})
        self.assertEqual(self.eway(vehicle_number="RJ-1").data,
                         {"vehicle_number": ["Type it like RJ14AB1234 (state, district, letters, 4 digits)."]})
        self.assertEqual(self.eway(distance_km=5000).data,
                         {"distance_km": ["Type the distance in whole kilometres, 1 to 4,000."]})
        self.assertEqual(self.eway(transport_mode="Cart").data, {"transport_mode": ["Choose Road, Rail, Air or Ship."]})

    def test_fix_the_tax_heads(self):
        LineItem.objects.filter(invoice=self.bill).update(cgst=0, sgst=0, igst=300)
        r = self.owner.post(reverse("sale-fix-heads", args=[self.bill.pk]))
        self.assertEqual((r.data["cgst"], r.data["sgst"], r.data["igst"], r.data["total_amount"]),
                         ("150.00", "150.00", "0.00", "10300.00"))
        self.assertEqual(r.data["checks"], [])
        self.assertEqual(AuditLog.objects.get(action="updated").details, "Tax heads re-filed for the place of supply")

    def test_cancelled_bills_refuse_both(self):
        Invoice.objects.filter(pk=self.bill.pk).update(status=BILL_CANCELLED)
        self.assertEqual(self.eway(eway_bill_number="").data["code"], "cancelled")
        self.assertEqual(self.owner.post(reverse("sale-fix-heads", args=[self.bill.pk])).data["code"], "cancelled")

    # Beyond the plan's tests.

    def test_e_way_details_change_only_what_is_sent_and_log_only_a_change(self):
        self.eway(transport_mode="Rail", transporter_name="Shree Transport")
        r = self.eway(eway_bill_number="123456789012")  # by rail: no vehicle needed
        self.assertEqual((r.data["eway"]["transport_mode"], r.data["eway"]["transporter_name"]), ("Rail", "Shree Transport"))
        self.assertEqual([e.details for e in AuditLog.objects.filter(action="updated").order_by("pk")],
                         ["Transport details", "E-way bill 123456789012"])
        self.eway(eway_bill_number="1234 5678 9012", transport_mode="Rail")  # the same again
        self.assertEqual(AuditLog.objects.filter(action="updated").count(), 2)
        r = self.eway(eway_bill_number=None, transporter_name=None, distance_km=None)  # null clears
        self.assertEqual((r.data["eway"]["eway_bill_number"], r.data["eway"]["transporter_name"]), ("", ""))
        self.assertEqual(AuditLog.objects.filter(action="updated").latest("pk").changes["eway_bill_number"],
                         {"old": "123456789012", "new": ""})

    def test_e_way_and_heads_in_a_closed_month(self):
        FiledPeriod.objects.create(business=self.biz, year=2026, month=10)
        for r in (self.eway(distance_km=5), self.owner.post(reverse("sale-fix-heads", args=[self.bill.pk]))):
            self.assertEqual((r.status_code, r.data["code"]), (409, "month_closed"))
            self.assertIn("so its bills can't be changed", r.data["detail"])

    def test_the_heads_of_1_or_20_lines_in_as_many_queries(self):
        asked = []
        self.owner.get(reverse("sale-list"))  # anything a first request sets up
        for lines in (1, 20):
            bill = sale(self.biz, buyer(f"Buyer {lines}"), str(lines + 1), "2026-10-03",
                        *[{"product_name": "Silver", "hsn_code": "711311", "gst_tax_rate": "0.03", "quantity": "1",
                           "rate": str(1000 + n), "unit": "gms"} for n in range(lines)])
            LineItem.objects.filter(invoice=bill).update(cgst=0, sgst=0, igst=30)
            with CaptureQueriesContext(connection) as seen:
                self.assertEqual(self.owner.post(reverse("sale-fix-heads", args=[bill.pk])).data["cgst"],
                                 "15.00" if lines == 1 else "300.00")
            asked.append(len(seen.captured_queries))
        self.assertEqual(asked[0], asked[1])

    def test_fixing_the_heads_clears_v2s_cached_lines(self):
        # bulk_update sends no signal: without the clear, v2 would show the old heads for 30 minutes (Ruling 1A-34).
        LineItem.objects.filter(invoice=self.bill).update(cgst=0, sgst=0, igst=300)
        with patch("billing.services.sales.invalidate") as invalidate:
            self.assertEqual(self.owner.post(reverse("sale-fix-heads", args=[self.bill.pk])).status_code, 200)
        invalidate.assert_called_once_with(LineItem)
        with patch("billing.services.sales.invalidate") as invalidate:  # nothing to move: nothing written, no clear
            self.owner.post(reverse("sale-fix-heads", args=[self.bill.pk]))
        invalidate.assert_not_called()

    def test_heads_already_right_change_nothing(self):
        r = self.owner.post(reverse("sale-fix-heads", args=[self.bill.pk]))
        self.assertEqual((r.status_code, r.data["cgst"]), (200, "150.00"))
        self.assertFalse(AuditLog.objects.filter(action="updated").exists())

    def test_who_may_change_them(self):
        staff = client_for(person("rakesh", *ROLE_GROUPS["staff"]))
        for r in (staff.put(reverse("sale-eway", args=[self.bill.pk]), {}, format="json"),
                  staff.post(reverse("sale-fix-heads", args=[self.bill.pk]))):
            self.assertEqual((r.status_code, r.data["needs"]), (403, "bill.edit"))


# DRF's own words, which v3 never sends (Ruling 1A-5): what each odd body below must not answer with.
DRF_WORDS = ("This field is required.", "This field may not be null.", "This field may not be blank.",
             "Not a valid string.", "A valid integer is required.", "Must be a valid boolean.", "Expected a list",
             "Invalid data.", "Ensure this", "Date has wrong format", "is not a valid choice", "Invalid pk",
             "Incorrect type", "Null characters", "Surrogate characters", "String value too large", "non_field_errors")


def said(value):
    """Every key and string in an answer, flat."""
    if isinstance(value, dict):
        return [w for k, v in value.items() for w in (str(k), *said(v))]
    if isinstance(value, list):
        return [w for v in value for w in said(v)]
    return [str(value)]


class OddInputTest(TestCase):
    """Ruling 1A-5: odd input is a 400 in the contract's words, never a 500 or DRF's own words. Bodies go as JSON text
    (escaped, so a lone surrogate can be sent at all)."""

    # Values as JSON can carry them: 1e400 is JSON's own number literal, read as infinity.
    ODD = [None, "", "abc", "\x00", "\ud800", True, -1, 0, 1.5, 10 ** 40, [], [1], {}, {"id": 1}, "1e400", "NaN",
           "Infinity", "-0", "1" * 40, "٣", "x" * 5000, "1e400!"]

    def setUp(self):
        self.owner = client_for(person("kailash", *ROLE_GROUPS["owner"]))
        self.kgh, self.anil = firm(invoice_prefix="KGH", paper_full_number_from=date(2026, 4, 1)), buyer()
        self.bill = sale(self.kgh, self.anil, "KGH/2026-27/1", "2026-10-02")
        self.n = 100

    def body(self, **more):
        self.n += 1
        return {"business": self.kgh.pk, "customer": self.anil.pk, "invoice_number": str(self.n),
                "invoice_date": "2026-10-08", "payment_mode": "cash", "lines": [RING], **more}

    def send(self, method, url, body):
        """`body` as JSON text; the string "1e400!" in it goes as the bare number 1e400."""
        text = json.dumps(body).replace('"1e400!"', "1e400")
        r = getattr(self.owner, method)(url, text, content_type="application/json")
        self.assertIn(r.status_code, (200, 201, 400, 409), (url, text[:200]))
        words = [w for w in said(r.json()) if any(drf in w for drf in DRF_WORDS)]
        self.assertEqual(words, [], (url, text[:200]))
        return r

    def test_odd_values_anywhere(self):
        create, change = reverse("sale-list"), reverse("sale-detail", args=[self.bill.pk])
        eway, heads = reverse("sale-eway", args=[self.bill.pk]), reverse("sale-fix-heads", args=[self.bill.pk])
        for field in ("business", "customer", "invoice_number", "invoice_date", "payment_mode", "place_of_supply",
                      "notes", "paper", "replaces", "lines"):
            for value in self.ODD:
                with self.subTest(field=field, value=repr(value)[:20]):
                    self.send("post", create, self.body(**{field: value}))
                    self.send("put", change, self.body(**{field: value}))
        for field in RING:
            for value in self.ODD:
                with self.subTest(line_field=field, value=repr(value)[:20]):
                    self.send("post", create, self.body(lines=[{**RING, field: value}]))
        for field in ("eway_bill_number", "transporter_name", "transporter_gstin", "vehicle_number", "vehicle_type",
                      "transport_mode", "distance_km"):
            for value in self.ODD:
                with self.subTest(eway=field, value=repr(value)[:20]):
                    self.send("put", eway, {field: value})
        for method, url in (("post", create), ("put", change), ("put", eway), ("post", heads)):
            for body in ([], [RING], "Ring", 1, None):
                with self.subTest(url=url, body=body):
                    self.send(method, url, body)

    def test_odd_line_figures_get_the_lines_words(self):
        for value in (None, "", "abc", "\x00", True, [], {}, "1e400", "1e400!", "NaN", "Infinity", "1" * 40, "٣",
                      "12.3456", "-1", "0", "-0", 10 ** 40):
            with self.subTest(value=repr(value)[:20]):
                r = self.send("post", reverse("sale-list"),
                              self.body(lines=[{**RING, "quantity": value, "rate": value, "gst_percent": "7",
                                                "hsn_code": value}]))
                self.assertEqual((r.status_code, r.json()["lines"]["0"]), (400, {
                    "hsn_code": ["Type the HSN code, 4 to 8 digits (7113 for jewellery)."],
                    "gst_percent": ["Choose the GST rate. Gold and silver jewellery is 3%; cut diamonds are 0.25%."],
                    "quantity": ["Type the weight in grams, like 12.345."], "rate": ["Type the rate per gram."]}))
        r = self.send("post", reverse("sale-list"), self.body(lines=[{**RING, "gst_percent": "-0"}]))
        self.assertEqual((r.status_code, r.json()["lines"][0]["gst_percent"]), (201, "0"))
        r = self.send("post", reverse("sale-list"), self.body(lines=[{**RING, "hsn_code": "٧١١٣"}]))
        self.assertEqual(r.json()["lines"]["0"], {"hsn_code": ["Type the HSN code, 4 to 8 digits (7113 for jewellery)."]})


class SaveQueriesTest(TestCase):
    """Neon's free plan: a save asks the database a fixed number of times, however many lines. The lines go in one
    bulk write, which SQLite splits into batches of what its statement can hold (Postgres takes them in one)."""

    def test_a_bill_of_1_or_200_lines(self):
        owner = client_for(person("kailash", *ROLE_GROUPS["owner"]))
        kgh, anil = firm(invoice_prefix="KGH", paper_full_number_from=date(2026, 4, 1)), buyer()
        owner.get(reverse("sale-list"))  # anything a first request sets up

        def asked(send, url, lines, number):
            body = {"business": kgh.pk, "customer": anil.pk, "invoice_number": number, "invoice_date": "2026-10-08",
                    "payment_mode": "cash" if send == owner.post else "bank",  # the edit changes something
                    "lines": [{**RING, "rate": str(6000 + n)} for n in range(lines)]}
            with CaptureQueriesContext(connection) as seen:
                r = send(url, body, format="json")
            self.assertIn(r.status_code, (200, 201), r.data)
            sqls = [q["sql"] for q in seen.captured_queries]
            batches = [sql for sql in sqls if sql.startswith('INSERT INTO "billing_lineitem"')]
            self.assertLessEqual(len(batches), 4)
            return r.data["id"], [re.sub(r'"s[0-9]+_x[0-9]+"', '"sp"', sql.split(" WHERE ")[0][:60])
                                  for sql in sqls if sql not in batches]

        one, made1 = asked(owner.post, reverse("sale-list"), 1, "1")
        many, made200 = asked(owner.post, reverse("sale-list"), 200, "2")
        _id, changed1 = asked(owner.put, reverse("sale-detail", args=[one]), 1, "1")
        _id, changed200 = asked(owner.put, reverse("sale-detail", args=[many]), 200, "2")
        self.assertEqual((made200, changed200), (made1, changed1))
        self.assertLessEqual(max(len(made1), len(changed1)), 25)

    def test_a_typed_number_isnt_checked_against_the_whole_year(self):
        # The FY's numbers are read for the next free number, which only the words about an empty number need
        # (Ruling 1A-39: every read crosses the wire to Neon).
        owner = client_for(person("kailash", *ROLE_GROUPS["owner"]))
        kgh, anil = firm(invoice_prefix="KGH", paper_full_number_from=date(2026, 4, 1)), buyer()
        body = {"business": kgh.pk, "customer": anil.pk, "invoice_number": "31", "invoice_date": "2026-10-08",
                "payment_mode": "cash", "lines": [RING]}
        with CaptureQueriesContext(connection) as seen:
            self.assertEqual(owner.post(reverse("sale-list"), body, format="json").status_code, 201)
        self.assertEqual([q["sql"] for q in seen.captured_queries
                          if q["sql"].startswith('SELECT "billing_invoice"."invoice_number" AS "invoice_number"')], [])
        r = owner.post(reverse("sale-list"), {**body, "invoice_number": ""}, format="json")
        self.assertEqual(r.data, {"invoice_number": ["Type the bill number, or use the next free one, KGH/2026-27/32."]})


class V2SeesV3SavesTest(TransactionTestCase):
    """Ruling 1A-34: v2 still reads through cacheops, so a v3 save drops what v2 has cached of the bill and its lines.
    cacheops runs as production runs it, over a cache kept in a dict: it keeps each query v2 reads with the tables it
    watches, and a model's clear (billing.cache.invalidate) drops that table's queries. Row-level clears are left out
    (cacheops' own save and delete handlers aren't connected under the test settings), so only v3's clears drop
    anything here."""

    @contextmanager
    def cache(self):
        store = {}

        @contextmanager
        def getting(key, cond_dnfs, prefix, lock=False):
            yield store.get(key, (None,))[0]

        def cache_thing(prefix, key, data, cond_dnfs, *args, **kwargs):
            store[key] = (cacheops_settings.CACHEOPS_SERIALIZER.dumps(data), set(cond_dnfs))

        def clear(model, using=None):
            for key in [key for key, (_data, tables) in store.items() if model._meta.db_table in tables]:
                del store[key]

        with override_settings(CACHEOPS_ENABLED=True, CACHEOPS=CACHED, CACHEOPS_FAKE=False), \
                patch("cacheops.query.getting", getting), patch("cacheops.query.cache_thing", cache_thing), \
                patch("cacheops.query.invalidate_obj"), patch("cacheops.invalidate_model", clear):
            prepare_profiles.invalidate_all()
            try:
                yield store
            finally:
                prepare_profiles.invalidate_all()

    def test_v2s_cached_bill_and_lines_follow_a_v3_save(self):
        owner = client_for(person("kailash", *ROLE_GROUPS["owner"]))
        kgh, anil = firm(invoice_prefix="KGH", paper_full_number_from=date(2026, 4, 1)), buyer()
        bill = sale(kgh, anil, "KGH/2026-27/7", "2026-10-02")
        detail, listing = reverse("invoice-detail", args=[bill.pk]), reverse("invoice-list")
        lines = reverse("invoice-line-items", args=[bill.pk])

        def v2():
            seen = owner.get(detail).data
            return (seen["payment_mode"], str(seen["total_amount"]), [li["product_name"] for li in seen["line_items"]],
                    [li["product_name"] for li in owner.get(lines).data["results"]],
                    sorted(row["id"] for row in owner.get(listing).data["results"]))

        with self.cache() as store:
            before = v2()
            self.assertEqual(before, ("", "10300.000", ["Silver"], ["Silver"], [bill.pk]))
            self.assertTrue(store)
            # The control: a write cacheops can't see, and no clear after it, leaves v2 reading the old bill.
            Invoice.objects.filter(pk=bill.pk).update(payment_mode="credit")
            self.assertEqual(v2(), before)
            r = owner.put(reverse("sale-detail", args=[bill.pk]), {
                "business": kgh.pk, "customer": anil.pk, "invoice_number": "7", "invoice_date": "2026-10-02",
                "payment_mode": "bank", "lines": [RING]}, format="json")
            self.assertEqual(r.status_code, 200, r.data)
            self.assertEqual(v2(), ("bank", "82808.710", ["Gold Ring 22K"], ["Gold Ring 22K"], [bill.pk]))
            r = owner.post(reverse("sale-list"), {
                "business": kgh.pk, "customer": anil.pk, "invoice_number": "8", "invoice_date": "2026-10-03",
                "payment_mode": "cash", "lines": [CHAIN]}, format="json")
            self.assertEqual(r.status_code, 201, r.data)
            self.assertEqual(v2()[-1], sorted([bill.pk, r.data["id"]]))
