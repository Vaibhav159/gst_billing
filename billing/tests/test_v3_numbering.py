"""Bill numbers (plan 1A, Task 6; design §4.4): paper first, one series per firm and FY.

The server never makes a number up. It keeps what was typed, gives digits the firm's format
from the firm's paper_full_number_from date, counts deleted and cancelled numbers as used,
and never refills a gap.
"""

import threading
from datetime import date
from unittest.mock import patch

from django.contrib.auth.models import User
from django.db import DatabaseError, IntegrityError, connection
from django.db.models import Model
from django.test import Client, TestCase, TransactionTestCase, skipUnlessDBFeature
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from billing.api.sales import SalesViewSet
from billing.constants import BILL_CANCELLED
from billing.models import AuditLog, BinnedInvoice, FiledPeriod, Invoice
from billing.numbering import counter_of, format_number, full_number_on, next_number, shape_problem
from billing.period_lock import assert_period_unlocked
from billing.services.bin import bin_bill
from billing.services.sales import firm_snapshot
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person, sale


class FormatTest(TestCase):
    def setUp(self):
        self.kgh = firm(invoice_prefix="KGH", paper_full_number_from=date(2026, 9, 1))

    def test_digits_take_the_format_from_the_date(self):
        self.assertEqual(format_number(self.kgh, date(2026, 8, 31), " 107 "), "107")
        self.assertEqual(format_number(self.kgh, date(2026, 9, 1), "108"), "KGH/2026-27/108")
        self.assertEqual(format_number(self.kgh, date(2027, 3, 31), "007"), "KGH/2026-27/7")
        self.assertEqual(format_number(self.kgh, date(2026, 9, 1), "KGH/2026-27/108"), "KGH/2026-27/108")

    def test_without_a_date_or_a_prefix_numbers_stay_as_written(self):
        self.assertEqual(format_number(firm("MO", gstin="08AAAAA0000A1Z5"), date(2026, 9, 1), "108"), "108")
        plain = firm("AJ", gstin="08BBBBB0000B1Z5", paper_full_number_from=date(2026, 4, 1))
        self.assertEqual(format_number(plain, date(2026, 9, 1), "108"), "108")

    def test_the_counter_is_the_trailing_digits(self):
        self.assertEqual((counter_of("KGH/2026-27/108"), counter_of("45"), counter_of("A-B")), (108, 45, None))

    # Beyond the plan's tests: what's typed is never a 500 (Ruling 1A-5).

    def test_only_ascii_digits_take_the_format_and_any_length_is_read(self):
        # Other scripts' digits stay as typed (Rule 46 then refuses them in its words), and a number too long for
        # int() is still formatted and counted, never a ValueError.
        self.assertEqual(format_number(self.kgh, date(2026, 9, 1), "٣٤"), "٣٤")
        self.assertEqual(format_number(self.kgh, date(2026, 9, 1), "000"), "KGH/2026-27/0")
        self.assertEqual(format_number(self.kgh, date(2026, 9, 1), "1" * 5000), f"KGH/2026-27/{'1' * 5000}")
        self.assertEqual(counter_of("1" * 5000), int("1" * 255))

    def test_a_prefix_that_isnt_letters_keeps_numbers_as_typed(self):
        # Review fix 2: a full number is LETTERS/YYYY-YY/N, the shape next-number reads. A prefix with a digit, a mark or
        # a space would make numbers the series never counts, or that Rule 46 forbids, so such a firm's numbers stay as
        # typed, as without a date.
        for n, prefix in enumerate(("KGH2", "K.G", "K G", "K-G", "KGH/"), start=1):
            with self.subTest(prefix=prefix):
                odd = firm(f"FIRM {n}", gstin=f"08AAAAA000{n}A1Z5", invoice_prefix=prefix,
                           paper_full_number_from=date(2026, 4, 1))
                self.assertEqual((full_number_on(odd, date(2026, 9, 1)), format_number(odd, date(2026, 9, 1), "2")),
                                 (False, "2"))
        spaced = firm("SPACED", gstin="08AAAAA0009A1Z5", invoice_prefix=" KGH ", paper_full_number_from=date(2026, 4, 1))
        self.assertEqual(format_number(spaced, date(2026, 9, 1), "2"), "KGH/2026-27/2")

    def test_the_stored_number_meets_rule_46_too(self):
        # Review fix 2: Rule 46 is checked on the number that would be stored, not only on what was typed.
        self.assertEqual(shape_problem("2", "K.G/2026-27/2", "K.G/2026-27/1"),
                         'Use only letters, digits, "-" and "/" (GST rule 46). Spaces and other marks aren\'t allowed.')
        self.assertEqual(shape_problem("2", "KGH/2026-27/2", "KGH/2026-27/1"), "")


class NextNumberTest(TestCase):
    def setUp(self):
        self.client = client_for(person("rakesh", *ROLE_GROUPS["staff"]))
        self.kgh = firm(invoice_prefix="KGH", paper_full_number_from=date(2026, 9, 1))
        self.cust = buyer()

    def next(self, day="2026-09-30", **params):
        return self.client.get(reverse("sale-next-number"), {"business_id": self.kgh.pk, "invoice_date": day, **params})

    def test_active_cancelled_and_deleted_numbers_count_and_gaps_stay(self):
        sale(self.kgh, self.cust, "30", "2026-08-10")
        sale(self.kgh, self.cust, "KGH/2026-27/33", "2026-09-10", status=BILL_CANCELLED)
        bin_bill(sale(self.kgh, self.cust, "KGH/2026-27/34", "2026-09-11"), None)
        sale(self.kgh, self.cust, "P1778291284", "2026-09-12")  # not a series shape: ignored
        r = self.next()
        self.assertEqual(r.data, {"business": self.kgh.pk, "fy": "2026-27", "invoice_date": "2026-09-30",
                                  "counter": 35, "invoice_number": "KGH/2026-27/35", "full_number": True})
        self.assertEqual(self.next("2026-08-31").data["invoice_number"], "35")  # before the date: plain

    def test_each_fy_starts_again(self):
        sale(self.kgh, self.cust, "90", "2027-03-31")
        self.assertEqual(next_number(self.kgh, date(2027, 4, 1)), {"counter": 1, "invoice_number": "KGH/2027-28/1"})
        self.assertEqual(next_number(self.kgh, date(2027, 3, 31))["counter"], 91)

    def test_words_for_a_bad_firm_or_date(self):
        self.assertEqual(self.client.get(reverse("sale-next-number")).data, {"business_id": ["Pick the firm."]})
        self.assertEqual(self.next("30/09/2026").data, {"invoice_date": ["Type the date like 2026-09-30."]})

    # Beyond the plan's tests: the rulings' edges.

    def test_a_firm_or_date_that_cant_be_read_is_a_400_with_words(self):
        # Ruling 1A-5: never a 500. A firm id that isn't plain digits ("²" passes isdigit() but not int()), one past
        # the database's range, or a firm that's gone; a date that isn't one. A real date outside 2000 to 2099, the
        # years `fy` and `month` read (9999's financial year can't even be worked out), says so (Ruling 1A-28).
        for firm_id in ("abc", "²", "1.5", " 1", "99999999999999999999999", "424242"):
            with self.subTest(business_id=firm_id):
                r = self.client.get(reverse("sale-next-number"), {"business_id": firm_id})
                self.assertEqual((r.status_code, r.data), (400, {"business_id": ["Pick the firm."]}))
        for day, words in (("2026-02-30", "Type the date like 2026-09-30."), ("2026-09-30\x00", "Type the date like 2026-09-30."),
                           ("1999-12-31", "Pick a date from 2000 to 2099."), ("2100-01-01", "Pick a date from 2000 to 2099."),
                           ("9999-12-31", "Pick a date from 2000 to 2099."), ("0001-01-01", "Pick a date from 2000 to 2099.")):
            with self.subTest(invoice_date=day):
                r = self.next(day)
                self.assertEqual((r.status_code, r.data), (400, {"invoice_date": [words]}))
        self.assertEqual(self.next("2000-01-01").data["fy"], "1999-00")  # the years' edges are kept
        self.assertEqual(self.next("2099-12-31").data["fy"], "2099-00")

    def test_a_prefix_that_isnt_letters_numbers_as_typed(self):
        # Review fix 2 through the endpoints: with "KGH2" next-number suggested KGH2/2026-27/1, already used, and the
        # paper book counted nothing; with "K.G", check-number called K.G/2026-27/2 free though Rule 46 forbids the ".".
        for n, prefix in enumerate(("KGH2", "K.G"), start=1):
            with self.subTest(prefix=prefix):
                odd = firm(f"FIRM {n}", gstin=f"08AAAAA000{n}A1Z5", invoice_prefix=prefix,
                           paper_full_number_from=date(2026, 4, 1))
                sale(odd, buyer(f"Buyer {n}"), f"{prefix}/2026-27/1", "2026-09-10")  # as v2 lets it be typed
                r = self.client.get(reverse("sale-next-number"), {"business_id": odd.pk, "invoice_date": "2026-09-30"})
                self.assertEqual((r.data["invoice_number"], r.data["full_number"]), ("1", False))
                data = self.client.get(reverse("sale-check-number"), {"business_id": odd.pk, "invoice_date": "2026-09-30",
                                                                      "invoice_number": "2"}).data
                self.assertEqual((data["invoice_number"], data["code"]), ("2", ""))
                book = self.client.get(reverse("sale-paper-book"), {"business_id": odd.pk, "month": "2026-09"}).data
                self.assertEqual((book["entered"], book["bills"][0]["counter"]), (1, 1))

    def test_today_when_no_date_is_given(self):
        with patch("billing.params.timezone.localdate", return_value=date(2026, 9, 30)):
            r = self.client.get(reverse("sale-next-number"), {"business_id": self.kgh.pk})
        self.assertEqual((r.data["invoice_date"], r.data["invoice_number"]), ("2026-09-30", "KGH/2026-27/1"))

    def test_a_deleted_bill_v2_brought_back_holds_no_number(self):
        # Ruling 1A-6: after a rollback, v2's undo brings a deleted bill back under a new id and marks its "deleted"
        # entry used. The bin row is stale then: the number is the bill's in Sales, or free if v2 renumbered it.
        _binned, entry = bin_bill(sale(self.kgh, self.cust, "KGH/2026-27/40", "2026-09-11"), None)
        entry.snapshot = {**entry.snapshot, "_undo": {"at": "2026-10-01T10:00:00+05:30", "by": None, "log": entry.pk}}
        entry.save(update_fields=["snapshot"])
        self.assertEqual(self.next().data["counter"], 1)


class CheckNumberTest(TestCase):
    def setUp(self):
        self.client = client_for(person("rakesh", *ROLE_GROUPS["staff"]))
        self.kgh = firm(invoice_prefix="KGH", paper_full_number_from=date(2026, 9, 1))
        self.cust = buyer()
        self.taken = sale(self.kgh, self.cust, "KGH/2026-27/34", "2026-09-30")

    def check(self, typed, day="2026-09-30", **params):
        return self.client.get(reverse("sale-check-number"), {"business_id": self.kgh.pk, "invoice_date": day,
                                                              "invoice_number": typed, **params}).data

    def test_a_free_number(self):
        data = self.check("35")
        self.assertEqual((data["invoice_number"], data["counter"], data["code"], data["note"]), ("KGH/2026-27/35", 35, "", ""))

    def test_a_number_in_use_in_any_case(self):
        data = self.check("kgh/2026-27/34")
        self.assertEqual(data["code"], "number_taken")
        self.assertEqual(data["problem"], "KGH/2026-27/34 is already used in FY 2026-27 by Anil Gupta's bill of "
                                          "30 Sep 2026. The next free number is KGH/2026-27/35.")
        self.assertEqual(data["bill"]["id"], self.taken.pk)
        self.assertEqual(self.check("34", exclude_id=self.taken.pk)["code"], "")

    def test_a_deleted_bills_number(self):
        bin_bill(sale(self.kgh, self.cust, "KGH/2026-27/27", "2026-09-24"), None, "Entered twice")
        data = self.check("27")
        self.assertEqual(data["code"], "number_deleted")
        self.assertEqual(data["binned"]["reason"], "Entered twice")

    def test_shape_words(self):
        self.assertEqual(self.check("")["problem"], "Type the bill number, or use the next free one, KGH/2026-27/35.")
        self.assertEqual(self.check("KGH/2026-27/00001")["problem"],
                         "A GST bill number can have at most 16 characters; this has 17.")
        self.assertEqual(self.check("12 B")["code"], "shape")
        self.assertEqual(self.check("108A")["problem"],
                         "End the number with digits, like 108 or KGH/2026-27/108, so bills sort in order.")
        self.assertEqual(self.check("1234567890123")["problem"],
                         "KGH/2026-27/1234567890123 would have more than 16 characters. Type a shorter number.")

    def test_soft_notes(self):
        sale(self.kgh, self.cust, "107", "2026-08-30")
        data = self.check("KGH/2026-27/107")
        self.assertEqual(data["note"], "107 has the same number part (107). Customers and your CA may mix them up.")
        self.assertEqual(self.check("110")["note"],
                         "Numbers 108 to 109 would be skipped. GSTR-1 lists skipped numbers, so only do this on purpose.")
        self.assertEqual(self.check("109")["note"],
                         "Number 108 would be skipped. GSTR-1 lists skipped numbers, so only do this on purpose.")

    # Beyond the plan's tests: the rulings' edges.

    def test_the_whole_answer_for_a_number_in_use(self):
        self.assertEqual(self.check("34"), {
            "invoice_number": "KGH/2026-27/34", "counter": 34, "code": "number_taken",
            "problem": "KGH/2026-27/34 is already used in FY 2026-27 by Anil Gupta's bill of 30 Sep 2026. "
                       "The next free number is KGH/2026-27/35.",
            "bill": {"id": self.taken.pk, "invoice_number": "KGH/2026-27/34", "invoice_date": "2026-09-30",
                     "customer_name": "Anil Gupta", "status": "active"},
            "binned": None, "note": "", "same_counter": None, "next": {"counter": 35, "invoice_number": "KGH/2026-27/35"}})

    def test_a_number_ending_alike_is_no_twin(self):
        sale(self.kgh, self.cust, "1107", "2026-08-30")  # ends in "107" too, but its number part is 1107
        data = self.check("KGH/2026-27/107")
        self.assertEqual((data["code"], data["note"], data["same_counter"]), ("", "", None))

    def test_always_a_200_also_without_a_firm_or_date(self):
        # Ruling 1A-5: it only checks (contract 2.12). Without a firm, or with a date it can't read, the number can't
        # be checked, and the answer says why in next-number's words.
        url = reverse("sale-check-number")
        for params, words in (({}, "Pick the firm."), ({"business_id": "abc"}, "Pick the firm."),
                              ({"business_id": "424242"}, "Pick the firm."),
                              ({"business_id": self.kgh.pk, "invoice_date": "30/09/2026"},
                               "Type the date like 2026-09-30."),
                              ({"business_id": self.kgh.pk, "invoice_date": "2100-01-01"},
                               "Pick a date from 2000 to 2099.")):
            with self.subTest(params=params):
                r = self.client.get(url, {"invoice_number": " 34 ", **params})
                self.assertEqual((r.status_code, r.data), (200, {
                    "invoice_number": "34", "counter": 34, "code": "unchecked", "problem": words, "bill": None,
                    "binned": None, "note": "", "same_counter": None, "next": None}))

    def test_a_typed_number_that_cant_be_used_gets_words(self):
        rule_46 = 'Use only letters, digits, "-" and "/" (GST rule 46). Spaces and other marks aren\'t allowed.'
        for typed, words in (("3\x004", rule_46), ("٣٤", rule_46), ("1" * 5000,
                             "A GST bill number can have at most 16 characters; this has 5000.")):
            with self.subTest(typed=typed[:20]):
                data = self.check(typed)
                self.assertEqual((data["code"], data["problem"]), ("shape", words))

    def test_an_exclude_id_that_isnt_a_bill_is_ignored(self):
        for exclude in ("abc", "²", "99999999999999999999999"):
            with self.subTest(exclude_id=exclude):
                self.assertEqual(self.check("34", exclude_id=exclude)["code"], "number_taken")

    def test_a_deleted_bill_whose_customer_and_deleter_v2_deleted(self):
        # Ruling 1A-6: the bin row names neither, so the check still answers.
        binned, _entry = bin_bill(sale(self.kgh, self.cust, "KGH/2026-27/27", "2026-09-24"), None, "Entered twice")
        BinnedInvoice.objects.filter(pk=binned.pk).update(customer_id=424242, deleted_by_id=424242)
        self.assertEqual(self.check("27")["binned"]["id"], binned.pk)

    def test_a_deleted_bill_with_the_same_number_part_is_a_note(self):
        # Ruling 1A-30: a deleted "KGH-18" doesn't hold 18, so 18 is free; but restored, the two would read alike. The
        # note says so, and same_counter stays null (a deleted bill has no BillRef). A row v2's undo already brought
        # back is no deleted bill (Ruling 1A-6).
        _binned, entry = bin_bill(sale(self.kgh, self.cust, "KGH-18", "2026-09-24"), None, "Entered twice")
        data = self.check("18")
        self.assertEqual((data["invoice_number"], data["code"], data["bill"], data["binned"], data["same_counter"]),
                         ("KGH/2026-27/18", "", None, None, None))
        self.assertEqual(data["note"], "KGH-18 in the bin has the same number part (18). If it's restored, customers "
                                       "and your CA may mix them up.")
        entry.snapshot = {**entry.snapshot, "_undo": {"at": "2026-10-01T10:00:00+05:30", "by": None, "log": entry.pk}}
        entry.save(update_fields=["snapshot"])
        self.assertEqual(self.check("18")["note"], "")


class PaperBookTest(TestCase):
    def setUp(self):
        self.client = client_for(person("manoj", *ROLE_GROUPS["viewer"]))
        self.kgh = firm(invoice_prefix="KGH", paper_full_number_from=date(2026, 4, 1))
        cust = buyer()
        sale(self.kgh, cust, "KGH/2026-27/16", "2026-08-30")
        for n in (17, 18, 20, 21, 22, 28, 29):
            sale(self.kgh, cust, f"KGH/2026-27/{n}", "2026-09-02", paper=True)
        sale(self.kgh, cust, "22", "2026-09-05")  # the same number part twice
        sale(self.kgh, cust, "KGH/2026-27/19", "2026-09-03", status=BILL_CANCELLED, cancel_reason="Customer returned it")
        bin_bill(sale(self.kgh, cust, "KGH/2026-27/27", "2026-09-24"), None, "Entered twice by mistake")
        for n in (30, 31):
            sale(self.kgh, cust, f"KGH/2026-27/{n}", "2026-10-02")

    def book(self, month="2026-09"):
        return self.client.get(reverse("sale-paper-book"), {"business_id": self.kgh.pk, "month": month}).data

    def test_the_month_as_the_paper_book_sees_it(self):
        data = self.book()
        self.assertEqual(data["entered"], 9)
        self.assertEqual(data["runs"], [[17, 22], [27, 29]])
        self.assertEqual(data["missing"], [23, 24, 25, 26])
        self.assertEqual([(e["counter"], e["kind"], e["reason"]) for e in data["explained"]],
                         [(19, "cancelled", "Customer returned it"), (27, "deleted", "Entered twice by mistake")])
        self.assertEqual(data["twice"], [22])
        self.assertEqual(data["next"], {"counter": 23, "invoice_number": "KGH/2026-27/23", "invoice_date": "2026-09-05"})
        self.assertEqual((data["locked"], data["gstr1_due"], data["fy"]), (False, "2026-10-11", "2026-27"))
        self.assertTrue(data["bills"][0]["paper"])

    def test_numbers_later_months_used_are_skipped(self):
        for n in (23, 24, 25, 26):
            sale(self.kgh, buyer(f"B{n}"), f"KGH/2026-27/{n}", "2026-09-29")
        data = self.book()
        self.assertEqual(data["missing"], [])
        self.assertEqual((data["next"]["counter"], data["after"], data["after_months"]), (32, [30, 31], ["2026-10"]))

    def test_a_deleted_bills_later_month_is_named_too(self):
        # Its number is used, so it is skipped to reach the next one, and its month is one that used it.
        for n in (23, 24, 25, 26):
            sale(self.kgh, buyer(f"B{n}"), f"KGH/2026-27/{n}", "2026-09-29")
        bin_bill(sale(self.kgh, buyer("B32"), "KGH/2026-27/32", "2026-11-03"), None)
        data = self.book()
        self.assertEqual((data["next"]["counter"], data["after"], data["after_months"]),
                         (33, [30, 31, 32], ["2026-10", "2026-11"]))

    def test_a_closed_month_and_bad_params(self):
        FiledPeriod.objects.create(business=self.kgh, year=2026, month=9)
        self.assertTrue(self.book()["locked"])
        self.assertEqual(self.book("2026-9"), {"month": ["Give the month like 2026-09."]})

    # Beyond the plan's tests: Rulings 1A-1 and 1D-3 (the span), 1A-5 and 1A-6.

    def test_the_missing_numbers_are_counted(self):
        data = self.book()
        self.assertEqual((data["missing_count"], data["missing"]), (4, [23, 24, 25, 26]))

    def test_only_the_series_shapes_make_the_span(self):
        # An odd number ("P20000") is listed and counted as the month's bill, but only the series shapes make the span
        # the gaps and runs are read across, in the month or before it: no 19,998 rows (Ruling 1A-1; review fix 1). A
        # deleted bill of the month is explained whatever its number's shape (Ruling 1A-29).
        cust = buyer("Odd Import")
        sale(self.kgh, cust, "P20000", "2026-09-10")
        sale(self.kgh, cust, "P1778291284", "2026-08-10")
        bin_bill(sale(self.kgh, cust, "COMBINED-TEST-1778345121", "2026-09-11"), None)
        data = self.book()
        self.assertEqual((data["entered"], data["missing_count"], data["missing"]), (10, 4, [23, 24, 25, 26]))
        self.assertEqual((data["runs"], data["next"]["counter"], data["twice"]), ([[17, 22], [27, 29]], 23, [22]))
        self.assertEqual((data["bills"][-1]["invoice_number"], data["bills"][-1]["counter"]), ("P20000", 20000))
        self.assertEqual([e["counter"] for e in data["explained"]], [19, 27, 1778345121])
        self.assertEqual(self.book("2026-10")["next"]["counter"], 32)  # August's stray doesn't start the next month

    def test_a_stray_fills_a_hole_but_never_widens_the_span(self):
        # Ruling 1A-29 with 1A-1: a stray number's counter fills its hole inside the span the series numbers make
        # ("P24" is 24); one far past it ("P20000", "P1778291284") widens nothing and adds no run.
        cust = buyer("Odd Import")
        for number in ("P24", "P20000", "P1778291284"):
            sale(self.kgh, cust, number, "2026-09-10")
        data = self.book()
        self.assertEqual((data["entered"], data["missing"], data["missing_count"]), (12, [23, 25, 26], 3))
        self.assertEqual((data["runs"], data["next"]["counter"]), ([[17, 22], [24, 24], [27, 29]], 23))

    def test_a_stray_number_is_counted_not_listed(self):
        # A number that is a series shape but far off ("1778291284", as a timestamp) spans a billion numbers: they
        # are counted, and only the first 500 are listed, so the worker never builds them all.
        sale(self.kgh, buyer("Stray"), "1778291284", "2026-09-12")
        data = self.book()
        used = {17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 1778291284}  # 17 up to the stray number
        self.assertEqual(data["missing_count"], (1778291284 - 17 + 1) - len(used))
        self.assertEqual(len(data["missing"]), 500)
        self.assertEqual(data["missing"][:6], [23, 24, 25, 26, 32, 33])
        self.assertEqual(data["missing"][-1], 17 + 500 + 11 - 1)  # the 500th from 17, past the 11 used on the way
        self.assertEqual((data["runs"][-1], data["next"]["counter"]), ([1778291284, 1778291284], 23))

    def test_a_stray_number_in_an_earlier_month_runs_on_as_next_number_does(self):
        sale(self.kgh, buyer("Stray"), "1778291284", "2026-08-12")
        data = self.book()
        self.assertEqual((data["missing_count"], data["missing"]), (4, [23, 24, 25, 26]))
        self.assertEqual(self.book("2026-10")["next"]["counter"], 1778291285)  # the series' highest + 1, as next-number

    def test_a_span_over_500(self):
        meera = firm("MEERA ORNAMENTS", gstin="24AAAAA0000A1Z5", state="GUJARAT")
        cust = buyer("Hemant Dave")
        for n in ("1", "600"):
            sale(meera, cust, n, "2026-09-02")
        data = self.client.get(reverse("sale-paper-book"), {"business_id": meera.pk, "month": "2026-09"}).data
        self.assertEqual((data["missing_count"], len(data["missing"])), (598, 500))
        self.assertEqual((data["missing"][0], data["missing"][-1], data["next"]["counter"]), (2, 501, 2))
        self.assertEqual(data["runs"], [[1, 1], [600, 600]])

    def test_a_firm_or_month_that_cant_be_read(self):
        url = reverse("sale-paper-book")
        for params, words in (({"month": "2026-09"}, {"business_id": ["Pick the firm."]}),
                              ({"business_id": "abc", "month": "2026-09"}, {"business_id": ["Pick the firm."]}),
                              ({"business_id": self.kgh.pk}, {"month": ["Give the month like 2026-09."]}),
                              ({"business_id": self.kgh.pk, "month": "1999-09"}, {"month": ["Give the month like 2026-09."]})):
            with self.subTest(params=params):
                r = self.client.get(url, params)
                self.assertEqual((r.status_code, r.data), (400, words))

    def test_bin_rows_v2_brought_back_or_whose_people_v2_deleted(self):
        # Ruling 1A-6: a row v2's undo brought back explains nothing (the bill is in Sales again); a row whose
        # customer or deleter v2 deleted still explains its number, and nothing 500s.
        binned = BinnedInvoice.objects.get()
        BinnedInvoice.objects.filter(pk=binned.pk).update(customer_id=424242, deleted_by_id=424242)
        self.assertEqual([e["counter"] for e in self.book()["explained"]], [19, 27])
        entry = AuditLog.objects.get(pk=binned.audit_log_id)
        entry.snapshot = {**entry.snapshot, "_undo": {"at": "2026-10-01T10:00:00+05:30", "by": None, "log": entry.pk}}
        entry.save(update_fields=["snapshot"])
        data = self.book()
        self.assertEqual(([e["counter"] for e in data["explained"]], data["missing"]), ([19], [23, 24, 25, 26, 27]))

    def test_the_next_date_in_the_current_month_is_today(self):
        meera = firm("MEERA ORNAMENTS", gstin="24AAAAA0000A1Z5", state="GUJARAT")
        with patch("billing.numbering.timezone.localdate", return_value=date(2026, 10, 9)):
            data = self.client.get(reverse("sale-paper-book"), {"business_id": meera.pk, "month": "2026-10"}).data
        self.assertEqual(data["next"], {"counter": 1, "invoice_number": "1", "invoice_date": "2026-10-09"})
        self.assertEqual(data["gstr1_due"], "2026-11-11")


class PaperBookEveryBillTest(TestCase):
    """Review fixes 1 and 2: the paper book lists every bill of the month and counts it in `entered`, whatever its
    number's shape, with `counter` as BillRow gives it (the trailing digits, or null). Every bill's and deleted bill's
    number part fills its place, so a "KGH-18" is 18: never "not entered yet" or the next number, and entering 18 again
    shows as twice (Ruling 1A-29). Only the span's ends read the series shapes (Ruling 1A-1)."""

    def setUp(self):
        self.owner = client_for(person("kailash", *ROLE_GROUPS["owner"]))
        self.kgh = firm(invoice_prefix="KGH", paper_full_number_from=date(2026, 4, 1))
        self.cust = buyer()
        sale(self.kgh, self.cust, "KGH/2026-27/16", "2026-08-30")
        sale(self.kgh, self.cust, "KGH/2026-27/17", "2026-09-02")
        self.b18 = sale(self.kgh, self.cust, "KGH/2026-27/18", "2026-09-03")
        sale(self.kgh, self.cust, "KGH/2026-27/19", "2026-09-04")

    def book(self):
        return self.owner.get(reverse("sale-paper-book"), {"business_id": self.kgh.pk, "month": "2026-09"}).data

    def explained(self):
        return [(e["counter"], e["kind"], e["invoice_number"]) for e in self.book()["explained"]]

    def test_a_bill_renumbered_kgh_18_fills_18(self):
        r = self.owner.post(reverse("sale-renumber", args=[self.b18.pk]), {"invoice_number": "KGH-18"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        data = self.book()
        self.assertEqual([(b["invoice_number"], b["counter"]) for b in data["bills"]],
                         [("KGH/2026-27/17", 17), ("KGH-18", 18), ("KGH/2026-27/19", 19)])
        self.assertEqual((data["entered"], data["missing"], data["missing_count"], data["runs"], data["twice"]),
                         (3, [], 0, [[17, 19]], []))
        self.assertEqual(data["next"], {"counter": 20, "invoice_number": "KGH/2026-27/20", "invoice_date": "2026-09-04"})

    def test_entering_18_again_shows_as_twice(self):
        Invoice.objects.filter(pk=self.b18.pk).update(invoice_number="KGH-18")
        sale(self.kgh, buyer("Second Entry"), "KGH/2026-27/18", "2026-09-03")
        data = self.book()
        self.assertEqual((data["entered"], data["twice"], data["missing"], data["runs"]), (4, [18], [], [[17, 19]]))

    def test_a_cancelled_or_deleted_kgh_18_is_explained(self):
        Invoice.objects.filter(pk=self.b18.pk).update(invoice_number="KGH-18", status=BILL_CANCELLED,
                                                      cancel_reason="Customer returned it")
        self.assertEqual((self.explained(), self.book()["missing"]), ([(18, "cancelled", "KGH-18")], []))
        bin_bill(Invoice.objects.get(pk=self.b18.pk), None, "Entered twice by mistake")
        self.assertEqual((self.explained(), self.book()["missing"]), ([(18, "deleted", "KGH-18")], []))

    def test_an_odd_number_in_a_later_month_is_skipped_and_its_month_named(self):
        # Review minor: after and after_months read every bill's number part, not the series shapes only (Ruling
        # 1A-29). October's "KGH-20" uses 20, so September's next is 21, and October is the month that used it.
        sale(self.kgh, self.cust, "KGH-20", "2026-10-02")
        data = self.book()
        self.assertEqual((data["next"]["counter"], data["after"], data["after_months"]), (21, [20], ["2026-10"]))

    def test_a_number_of_any_shape_is_listed(self):
        Invoice.objects.filter(pk=self.b18.pk).update(invoice_number="KGH/26-27/18")  # as v2 may have stored it
        sale(self.kgh, self.cust, "OPENING", "2026-09-01")  # no number part: counter null, listed first, fills nothing
        data = self.book()
        self.assertEqual([(b["invoice_number"], b["counter"]) for b in data["bills"]],
                         [("OPENING", None), ("KGH/2026-27/17", 17), ("KGH/26-27/18", 18), ("KGH/2026-27/19", 19)])
        self.assertEqual((data["entered"], data["runs"], data["missing"]), (4, [[17, 19]], []))


class NarrowReadsTest(TestCase):
    """Ruling 1A-39 (Neon's 5 GB of public transfer a month): v3 reads around the cache, so every byte it reads crosses
    the wire. The paper book and the number checks read only the columns they use."""

    # Columns neither the paper book nor a number check uses: a query that has one reads whole rows.
    WIDE = ('"billing_invoice"."notes"', '"billing_invoice"."firm_snapshot"', '"billing_customer"."address"',
            '"billing_customer"."gst_number"', '"billing_binnedinvoice"."data"')

    def setUp(self):
        self.client = client_for(person("manoj", *ROLE_GROUPS["viewer"]))
        self.kgh = firm(invoice_prefix="KGH", paper_full_number_from=date(2026, 4, 1))
        anil = buyer(address="15 Demo Road", mobile_number="9829041122")
        sale(self.kgh, anil, "KGH/2026-27/15", "2026-07-10")
        self.b16 = sale(self.kgh, anil, "KGH/2026-27/16", "2026-08-30", notes="Order 77")
        sale(self.kgh, anil, "KGH/2026-27/17", "2026-09-02", paper=True)
        sale(self.kgh, anil, "KGH/2026-27/18", "2026-09-03", status=BILL_CANCELLED, cancel_reason="Customer returned it")
        sent = sale(self.kgh, anil, "KGH/2026-27/21", "2026-09-04")
        Invoice.objects.filter(pk=sent.pk).update(sent_at="2026-09-04T10:00:00+05:30")
        sale(self.kgh, anil, "KGH-20", "2026-10-02")  # an odd shape in a later month
        bin_bill(sale(self.kgh, anil, "KGH/2026-27/27", "2026-09-24"), None, "Entered twice")
        bin_bill(sale(self.kgh, anil, "KGH-19", "2026-10-03"), None, "Typo")

    def asked(self, url, **params):
        with CaptureQueriesContext(connection) as seen:
            r = self.client.get(reverse(url), {"business_id": self.kgh.pk, **params})
        self.assertEqual(r.status_code, 200, r.data)
        return r.data, [q["sql"] for q in seen.captured_queries]

    def test_the_paper_book_reads_the_months_bills_and_the_years_numbers(self):
        # The month's bills in the columns the book shows, naming their customers; the rest of the FY by number and
        # date only, which is all `used`, the span and after_months read; the bin without the bills it keeps.
        data, sqls = self.asked("sale-paper-book", month="2026-09")
        self.assertEqual([sql for sql in sqls if any(column in sql for column in self.WIDE)], [])
        self.assertEqual(len([sql for sql in sqls if '"billing_customer"' in sql]), 1)
        self.assertEqual([(b["invoice_number"], b["customer_name"], b["status"], b["paper"], b["sent"]) for b in data["bills"]],
                         [("KGH/2026-27/17", "Anil Gupta", "active", True, False),
                          ("KGH/2026-27/18", "Anil Gupta", "cancelled", False, False),
                          ("KGH/2026-27/21", "Anil Gupta", "active", False, True)])
        self.assertEqual([(e["counter"], e["kind"], e["reason"]) for e in data["explained"]],
                         [(18, "cancelled", "Customer returned it"), (27, "deleted", "Entered twice")])
        self.assertEqual((data["runs"], data["missing"], data["next"]["counter"], data["after"]),
                         ([[17, 18], [21, 21], [27, 27]], [22, 23, 24, 25, 26], 22, []))
        # August's next skips the numbers later months used, a deleted "KGH-19" and an odd "KGH-20" among them.
        data, _sqls = self.asked("sale-paper-book", month="2026-08")
        self.assertEqual((data["missing"], data["next"]["counter"], data["after"], data["after_months"]),
                         ([], 22, [17, 18, 19, 20, 21], ["2026-09", "2026-10"]))

    def test_the_paper_book_never_reads_a_column_later(self):
        loads = []
        refresh = Model.refresh_from_db

        def recorded(instance, *args, **kwargs):
            loads.append((type(instance).__name__, kwargs.get("fields")))
            return refresh(instance, *args, **kwargs)

        with patch.object(Model, "refresh_from_db", recorded):
            for month in ("2026-08", "2026-09", "2026-10"):
                self.asked("sale-paper-book", month=month)
        self.assertEqual(loads, [])

    def test_the_number_checks_read_numbers_and_the_bill_they_name(self):
        # Free, in use, deleted, the same number part as a bill or as a deleted bill, a shape problem: each check
        # compares numbers, and reads a whole bill (its BillRef's columns) only for the one it names.
        answers = {}
        for typed in ("35", "kgh/2026-27/16", "27", "KGH-16", "19", ""):
            with self.subTest(typed=typed):
                answers[typed], sqls = self.asked("sale-check-number", invoice_date="2026-09-30", invoice_number=typed)
                self.assertEqual([sql for sql in sqls if any(column in sql for column in self.WIDE)], [])
        ref16 = {"id": self.b16.pk, "invoice_number": "KGH/2026-27/16", "invoice_date": "2026-08-30",
                 "customer_name": "Anil Gupta", "status": "active"}
        self.assertEqual((answers["kgh/2026-27/16"]["code"], answers["kgh/2026-27/16"]["bill"]), ("number_taken", ref16))
        self.assertEqual((answers["27"]["code"], answers["27"]["binned"]["reason"]), ("number_deleted", "Entered twice"))
        self.assertEqual(answers["KGH-16"]["same_counter"], ref16)
        self.assertEqual(answers["19"]["note"], "KGH-19 in the bin has the same number part (19). If it's restored, "
                                                "customers and your CA may mix them up.")
        self.assertEqual(answers["35"]["note"], "Numbers 28 to 34 would be skipped. GSTR-1 lists skipped numbers, so only "
                                                "do this on purpose.")
        data, sqls = self.asked("sale-next-number", invoice_date="2026-09-30")
        self.assertEqual(data["counter"], 28)
        numbers = [sql for sql in sqls if sql.startswith("SELECT") and ('"billing_invoice"' in sql or '"billing_binnedinvoice"' in sql)]
        self.assertEqual(len(numbers), 2)
        for sql in numbers:
            self.assertRegex(sql, r'^SELECT "billing_(invoice|binnedinvoice)"\."invoice_number" AS "invoice_number" FROM')


class RenumberAndMoveTest(TestCase):
    def setUp(self):
        self.owner = client_for(person("kailash", *ROLE_GROUPS["owner"]))
        self.kgh = firm(invoice_prefix="KGH", paper_full_number_from=date(2026, 4, 1))
        self.mo = firm("MEERA ORNAMENTS", gstin="24AAAAA0000A1Z5", state="GUJARAT", invoice_prefix="MO",
                       paper_full_number_from=date(2026, 4, 1))
        self.cust = buyer()
        self.bill = sale(self.kgh, self.cust, "KGH/2026-27/17", "2026-09-10")

    def renumber(self, typed, client=None):
        return (client or self.owner).post(reverse("sale-renumber", args=[self.bill.pk]), {"invoice_number": typed},
                                           format="json")

    def move(self, business, typed):
        return self.owner.post(reverse("sale-move", args=[self.bill.pk]), {"business": business, "invoice_number": typed},
                               format="json")

    def test_renumber(self):
        r = self.renumber("34")
        self.assertEqual(r.data, {"id": self.bill.pk, "invoice_number": "KGH/2026-27/34", "previous": "KGH/2026-27/17"})
        entry = AuditLog.objects.get(action="renumbered")
        self.assertEqual(entry.details, "KGH/2026-27/17 → KGH/2026-27/34")
        self.assertEqual(entry.changes, {"invoice_number": {"old": "KGH/2026-27/17", "new": "KGH/2026-27/34"}})

    def test_renumber_refusals(self):
        self.assertEqual(self.renumber("17").data, {"invoice_number": [
            "KGH/2026-27/17 is this bill's number already. Type the new number."]})
        sale(self.kgh, self.cust, "KGH/2026-27/34", "2026-09-11")
        self.assertEqual(self.renumber("34").data["code"], "number_taken")
        staff = client_for(person("rakesh", *ROLE_GROUPS["staff"]))
        self.assertEqual(self.renumber("35", staff).data["needs"], "bill.edit")
        Invoice.objects.filter(pk=self.bill.pk).update(status=BILL_CANCELLED)
        self.assertEqual(self.renumber("35").data["code"], "cancelled")

    def test_renumber_waits_for_an_open_month(self):
        FiledPeriod.objects.create(business=self.kgh, year=2026, month=9)
        r = self.renumber("35")
        self.assertEqual((r.status_code, r.data["code"]), (409, "month_closed"))
        self.assertIn("so its bills can't be renumbered", r.data["detail"])

    def test_undoing_an_older_edit_keeps_the_renumber(self):
        self.owner.patch(reverse("invoice-detail", args=[self.bill.pk]), {"payment_mode": "cash"}, format="json")
        edit = AuditLog.objects.get(action="updated", entity_id=self.bill.pk)
        self.renumber("34")
        self.owner.post(reverse("auditlog-undo", args=[edit.pk]))
        self.bill.refresh_from_db()
        self.assertEqual((self.bill.payment_mode, self.bill.invoice_number), ("", "KGH/2026-27/34"))

    def test_move_to_another_firm(self):
        r = self.move(self.mo.pk, "31")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data, {"id": self.bill.pk, "business": self.mo.pk, "invoice_number": "MO/2026-27/31",
                                  "previous": {"business": self.kgh.pk, "invoice_number": "KGH/2026-27/17"}})
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.firm_snapshot["name"], "MEERA ORNAMENTS")
        li = self.bill.lineitem_set.get()
        self.assertEqual((li.cgst, li.igst), (0, 300))  # Gujarat firm, Rajasthan buyer: IGST now
        self.assertEqual(AuditLog.objects.get(action="moved").details, "KGH/2026-27/17 → MO/2026-27/31 (MEERA ORNAMENTS)")

    def test_move_refusals(self):
        self.assertEqual(self.move(self.kgh.pk, "31").data, {"business": [
            "The bill is in KIRAN GOLD HOUSE already. Pick the firm to move it to."]})
        FiledPeriod.objects.create(business=self.mo, year=2026, month=9)
        self.assertEqual(self.move(self.mo.pk, "31").data["code"], "month_closed")

    # Beyond the plan's tests: the rulings' edges.

    def test_a_move_freezes_the_new_firm_and_keeps_the_total(self):
        before = self.bill.total_amount
        self.move(self.mo.pk, "31")
        self.bill.refresh_from_db()
        self.assertEqual((self.bill.firm_snapshot, self.bill.total_amount), (firm_snapshot(self.mo), before))
        self.assertEqual(AuditLog.objects.get(action="moved").changes, {
            "business": {"old": self.kgh.pk, "new": self.mo.pk},
            "invoice_number": {"old": "KGH/2026-27/17", "new": "MO/2026-27/31"}})

    def test_move_refusals_in_the_new_firms_series_and_months(self):
        sale(self.mo, self.cust, "MO/2026-27/31", "2026-09-01")
        self.assertEqual(self.move(self.mo.pk, "31").data["code"], "number_taken")
        bin_bill(sale(self.mo, self.cust, "MO/2026-27/32", "2026-09-01"), None)
        self.assertEqual(self.move(self.mo.pk, "32").data["code"], "number_deleted")
        self.assertEqual(self.move(self.mo.pk, "33 A").data, {"invoice_number": [
            'Use only letters, digits, "-" and "/" (GST rule 46). Spaces and other marks aren\'t allowed.']})
        FiledPeriod.objects.create(business=self.kgh, year=2026, month=9)  # the old firm's month counts too
        r = self.move(self.mo.pk, "33")
        self.assertEqual((r.status_code, r.data["code"]), (409, "month_closed"))
        self.assertIn("so its bills can't move to another firm", r.data["detail"])
        FiledPeriod.objects.all().delete()
        Invoice.objects.filter(pk=self.bill.pk).update(status=BILL_CANCELLED)
        self.assertEqual(self.move(self.mo.pk, "33").data["code"], "cancelled")
        staff = client_for(person("rakesh", *ROLE_GROUPS["staff"]))
        r = staff.post(reverse("sale-move", args=[self.bill.pk]), {"business": self.mo.pk, "invoice_number": "33"},
                       format="json")
        self.assertEqual((r.status_code, r.data["needs"]), (403, "bill.edit"))
        self.bill.refresh_from_db()
        self.assertEqual((self.bill.business_id, self.bill.invoice_number), (self.kgh.pk, "KGH/2026-27/17"))

    def test_a_number_that_cant_be_used_gets_the_contracts_words(self):
        # Ruling 1A-5: never DRF's own words. A number missing, null, not text, or a body that isn't an object is no
        # number typed; a null character is a mark Rule 46 doesn't allow. The bill keeps its number.
        type_it = {"invoice_number": ["Type the bill number, or use the next free one, KGH/2026-27/18."]}
        url = reverse("sale-renumber", args=[self.bill.pk])
        for body in ({}, {"invoice_number": None}, {"invoice_number": ""}, {"invoice_number": ["34"]},
                     {"invoice_number": {"n": "34"}}, {"invoice_number": True}, ["34"], "34"):
            with self.subTest(body=body):
                r = self.owner.post(url, body, format="json")
                self.assertEqual((r.status_code, r.data), (400, type_it))
        r = self.owner.post(url, "null", content_type="application/json")
        self.assertEqual((r.status_code, r.data), (400, type_it))
        self.assertEqual(self.renumber("3\x004").data, {"invoice_number": [
            'Use only letters, digits, "-" and "/" (GST rule 46). Spaces and other marks aren\'t allowed.']})
        self.assertEqual(self.renumber("1" * 5000).data, {"invoice_number": [
            "A GST bill number can have at most 16 characters; this has 5000."]})
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.invoice_number, "KGH/2026-27/17")
        self.assertFalse(AuditLog.objects.filter(action="renumbered").exists())
        self.assertEqual(self.renumber(34).data["invoice_number"], "KGH/2026-27/34")  # a JSON number is its digits

    def test_a_firm_that_cant_be_used_gets_the_contracts_words(self):
        pick = {"business": ["Pick the firm to move it to."]}
        url = reverse("sale-move", args=[self.bill.pk])
        for body in ({}, {"invoice_number": "31"}, {"business": None, "invoice_number": "31"},
                     {"business": "", "invoice_number": "31"}, {"business": "abc", "invoice_number": "31"},
                     {"business": [self.mo.pk], "invoice_number": "31"}, {"business": True, "invoice_number": "31"},
                     {"business": 424242, "invoice_number": "31"}, {"business": 10 ** 30, "invoice_number": "31"},
                     [self.mo.pk, "31"], "31"):
            with self.subTest(body=body):
                r = self.owner.post(url, body, format="json")
                self.assertEqual((r.status_code, r.data), (400, pick))
        r = self.owner.post(url, "null", content_type="application/json")
        self.assertEqual((r.status_code, r.data), (400, pick))
        self.assertEqual(self.move(self.mo.pk, None).data, {"invoice_number": [
            "Type the bill number, or use the next free one, MO/2026-27/1."]})
        self.bill.refresh_from_db()
        self.assertEqual((self.bill.business_id, self.bill.invoice_number), (self.kgh.pk, "KGH/2026-27/17"))
        self.assertFalse(AuditLog.objects.filter(action="moved").exists())

    def test_a_bill_deleted_after_it_was_found_is_a_404(self):
        # Ruling 1A-17: another request deletes the bill between get_object() and the row lock.
        found = SalesViewSet.get_object

        def found_then_deleted(view):
            bill = found(view)
            Invoice.objects.filter(pk=bill.pk).delete()
            return bill

        for name, body in (("sale-renumber", {"invoice_number": "34"}),
                           ("sale-move", {"business": self.mo.pk, "invoice_number": "31"})):
            with self.subTest(action=name), patch.object(SalesViewSet, "get_object", found_then_deleted):
                bill = sale(self.kgh, self.cust, f"KGH/2026-27/{40 + len(name)}", "2026-09-10")
                r = self.owner.post(reverse(name, args=[bill.pk]), body, format="json")
                self.assertEqual((r.status_code, r.data), (404, {"detail": "No Invoice matches the given query."}))
        self.assertFalse(AuditLog.objects.filter(action__in=("renumbered", "moved")).exists())

    def test_a_race_for_one_number_is_the_409_clash(self):
        # Two saves racing for one number both pass the check; the database's unique guard catches the second, which
        # save_number turns into the clash, naming the bill that has it, not a 500.
        other = sale(self.kgh, self.cust, "KGH/2026-27/34", "2026-09-11")
        with patch("billing.services.sales.checked_number", return_value="KGH/2026-27/34"):
            r = self.renumber("34")
        self.assertEqual((r.status_code, r.data["code"], r.data["bill"]["id"]), (409, "number_taken", other.pk))
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.invoice_number, "KGH/2026-27/17")
        self.assertFalse(AuditLog.objects.filter(action="renumbered").exists())

    def test_a_clash_the_check_cant_explain_is_still_refused(self):
        # A unique-guard clash with no holder to name (none in the series as the check reads it) stays an error,
        # and nothing is written.
        with patch("billing.services.sales.checked_number", return_value="KGH/2026-27/35"), \
                patch.object(Invoice, "save", side_effect=IntegrityError("uniq_outward_number_per_business_fy")), \
                self.assertRaises(IntegrityError):
            self.renumber("35")
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.invoice_number, "KGH/2026-27/17")

    def test_undoing_an_older_edit_keeps_the_move(self):
        self.owner.patch(reverse("invoice-detail", args=[self.bill.pk]), {"payment_mode": "cash"}, format="json")
        edit = AuditLog.objects.get(action="updated", entity_id=self.bill.pk)
        self.move(self.mo.pk, "31")
        self.owner.post(reverse("auditlog-undo", args=[edit.pk]))
        self.bill.refresh_from_db()
        self.assertEqual((self.bill.payment_mode, self.bill.business_id, self.bill.invoice_number),
                         ("", self.mo.pk, "MO/2026-27/31"))
        self.assertEqual(self.bill.firm_snapshot["name"], "MEERA ORNAMENTS")


class PaperFlagTest(TestCase):
    def test_v2_reads_but_cant_write_it(self):
        owner = client_for(person("kailash", *ROLE_GROUPS["owner"]))
        bill = sale(firm(), buyer(), "1", "2026-09-10")
        r = owner.patch(reverse("invoice-detail", args=[bill.pk]), {"paper": True}, format="json")
        self.assertEqual((r.status_code, r.data["paper"]), (200, False))

    # Beyond the plan's tests.

    def test_v2s_saves_and_undo_leave_it_alone(self):
        owner = client_for(person("kailash", *ROLE_GROUPS["owner"]))
        bill = sale(firm(), buyer(), "1", "2026-09-10", paper=True)
        owner.patch(reverse("invoice-detail", args=[bill.pk]), {"payment_mode": "cash"}, format="json")
        edit = AuditLog.objects.get(action="updated", entity_id=bill.pk)
        Invoice.objects.filter(pk=bill.pk).update(paper=False)  # as if set later by v3
        owner.post(reverse("auditlog-undo", args=[edit.pk]))
        bill.refresh_from_db()
        self.assertEqual((bill.payment_mode, bill.paper), ("", False))

    def test_a_deleted_paper_bill_comes_back_as_one(self):
        owner = client_for(person("kailash", *ROLE_GROUPS["owner"]))
        bill = sale(firm(), buyer(), "1", "2026-09-10", paper=True)
        binned, _entry = bin_bill(bill, None)
        self.assertEqual(owner.post(reverse("bin-restore", args=[binned.pk])).status_code, 200)
        self.assertTrue(Invoice.objects.get(pk=bill.pk).paper)

    def test_v2s_businesses_set_the_full_number_date(self):
        # Contract section 7: businesses/ gains the writable paper_full_number_from (a v2 editor may set it: Ruling 1A-10).
        owner = client_for(person("kailash", *ROLE_GROUPS["owner"]))
        kgh = firm(invoice_prefix="KGH")
        r = owner.patch(reverse("business-detail", args=[kgh.pk]), {"paper_full_number_from": "2026-09-01"}, format="json")
        self.assertEqual((r.status_code, r.data["paper_full_number_from"]), (200, "2026-09-01"))
        kgh.refresh_from_db()
        self.assertEqual(kgh.paper_full_number_from, date(2026, 9, 1))
        r = owner.patch(reverse("business-detail", args=[kgh.pk]), {"paper_full_number_from": None}, format="json")
        self.assertEqual((r.status_code, r.data["paper_full_number_from"]), (200, None))


class MoveAndV2SaveTest(TestCase):
    """Ruling 1A-26: a v2 save never writes back the firm a v3 move set while leaving the moved firm frozen."""

    def setUp(self):
        self.kgh, self.cust = firm(), buyer()
        self.meera = firm("MEERA ORNAMENTS", gstin="08AAECM1234K1Z2")
        self.owner = client_for(person("kailash", *ROLE_GROUPS["owner"]))
        self.bill = sale(self.kgh, self.cust, "1", "2026-09-10", firm_snapshot=firm_snapshot(self.kgh))

    def moved_meanwhile(self):
        done = []

        def hook(*args, **kwargs):
            # A move (business, number and the frozen firm) commits after the admin read the bill, before it saves.
            if not done:
                done.append(1)
                Invoice.objects.filter(pk=self.bill.pk).update(business=self.meera, invoice_number="M-1",
                                                               firm_snapshot=firm_snapshot(self.meera))
            return assert_period_unlocked(*args, **kwargs)
        return hook

    def state(self):
        self.bill.refresh_from_db()
        return self.bill.business.name, self.bill.invoice_number, (self.bill.firm_snapshot or {}).get("name")

    def test_the_admins_save_reads_the_stored_firm(self):
        # The admin's change form stays unlocked (owner-only, accepted): its save writes the firm it read back. The
        # firm it compares with is the one stored, under the row lock, so the moved firm is never left frozen on it.
        admin_client = Client()
        admin_client.force_login(User.objects.create_superuser("root", "root@example.com", "pw"))
        with patch("billing.admin.assert_period_unlocked", self.moved_meanwhile()):
            r = admin_client.post(reverse("admin:billing_invoice_change", args=[self.bill.pk]), {
                "customer": self.cust.pk, "business": self.kgh.pk, "invoice_number": "1",
                "invoice_date": "2026-09-10", "type_of_invoice": "outward",
                "lineitem_set-TOTAL_FORMS": "0", "lineitem_set-INITIAL_FORMS": "0",
                "lineitem_set-MIN_NUM_FORMS": "0", "lineitem_set-MAX_NUM_FORMS": "1000"})
        self.assertEqual(r.status_code, 302)
        self.assertEqual(self.state(), ("KIRAN GOLD HOUSE", "1", None))

    def test_a_patch_reads_the_bill_inside_its_transaction(self):
        # v2's PATCH reads, checks and saves in one transaction that opens with the row lock (MoveLockTest proves the
        # lock on Postgres). The test's own transactions are the baseline.
        outer, seen = len(connection.atomic_blocks), []

        def watch(*args, **kwargs):
            seen.append(len(connection.atomic_blocks))
            return assert_period_unlocked(*args, **kwargs)

        with patch("billing.api.views.assert_period_unlocked", watch), \
                patch.object(Invoice.objects, "select_for_update", wraps=Invoice.objects.select_for_update) as lock:
            r = self.owner.patch(reverse("invoice-detail", args=[self.bill.pk]), {"payment_mode": "cash"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(seen and all(depth > outer for depth in seen), (outer, seen))
        self.assertTrue(lock.called)

    def test_a_very_long_name_still_gets_its_created_row(self):
        # Review fix 3: v2's audit name for a bill ("#number - customer") is cut to the column's 255 characters, as v3's
        # entity_name() is. Longer, Postgres refuses the row, and _log's savepoint would save the bill without it.
        long_named = buyer("A" * 255)
        r = self.owner.post(reverse("invoice-list"), {"invoice_number": "77", "invoice_date": "2026-09-10",
                                                      "business": self.kgh.pk, "customer": long_named.pk,
                                                      "type_of_invoice": "outward"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        entry = AuditLog.objects.get(action="created", entity_id=r.data["id"])
        self.assertEqual(entry.entity_name, f"#77 - {'A' * 249}")
        self.assertEqual(len(entry.entity_name), 255)

    def test_an_audit_row_the_database_refuses_never_undoes_the_patch(self):
        # The PATCH now runs in one transaction. v2 swallows a failed audit write (a 255-character entity name on
        # Postgres): the row's own savepoint takes the failure, so the transaction and the save go on.
        refused = DatabaseError("value too long for type character varying(255)")
        with patch.object(AuditLog, "_do_insert", side_effect=refused), \
                self.assertLogs("billing.api.mixins", level="ERROR") as logs:
            r = self.owner.patch(reverse("invoice-detail", args=[self.bill.pk]), {"payment_mode": "cash"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertIn("Failed to write audit log entry", logs.output[0])
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.payment_mode, "cash")


@skipUnlessDBFeature("has_select_for_update")
class MoveLockTest(TransactionTestCase):
    """Ruling 1A-26 on a database with row locks: v2's PATCH reads the bill row-locked, so a v3 move that lands while
    it is in flight waits for it, then moves the bill. The moved firm, number and frozen firm stay."""

    def test_a_move_waits_for_a_v2_patch_in_flight(self):
        from billing.services.sales import move_bill

        owner = person("kailash", *ROLE_GROUPS["owner"])
        kgh = firm(invoice_prefix="KGH", paper_full_number_from=date(2026, 4, 1))
        mo = firm("MEERA ORNAMENTS", gstin="24AAAAA0000A1Z5", state="GUJARAT", invoice_prefix="MO",
                  paper_full_number_from=date(2026, 4, 1))
        bill = sale(kgh, buyer(), "KGH/2026-27/17", "2026-09-10", firm_snapshot=firm_snapshot(kgh))
        moved, mover = threading.Event(), []

        def move():
            try:
                move_bill(bill, owner, mo, "31")
                moved.set()
            finally:
                connection.close()

        def move_meanwhile(*args, **kwargs):
            # The move starts after the PATCH read the bill. Under the PATCH's lock it can't finish, so the PATCH goes
            # on after 2 s; without the lock it would finish first, and the PATCH would write the old firm back.
            if not mover:
                # A daemon: were a regression to leave it waiting past join(10), pytest still exits (review fix 5).
                mover.append(threading.Thread(target=move, daemon=True))
                mover[0].start()
                moved.wait(2)
            return assert_period_unlocked(*args, **kwargs)

        with patch("billing.api.views.assert_period_unlocked", move_meanwhile):
            r = client_for(owner).patch(reverse("invoice-detail", args=[bill.pk]), {"payment_mode": "cash"}, format="json")
        mover[0].join(10)
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(moved.is_set())  # then the move went through, after the PATCH
        bill.refresh_from_db()
        self.assertEqual((bill.business_id, bill.invoice_number, bill.firm_snapshot["name"], bill.payment_mode),
                         (mo.pk, "MO/2026-27/31", "MEERA ORNAMENTS", "cash"))
