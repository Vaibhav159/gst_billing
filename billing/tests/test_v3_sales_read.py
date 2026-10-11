"""What v3 shows of a sale (plan 1A, Task 7): GET /api/sales/ and /api/sales/{id}/, the income-tax
flags, the checks, and search/quick's exact number first."""

from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.db import connection
from django.db.models import Model
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone

from billing.constants import BILL_CANCELLED
from billing.gstin import check_digit
from billing.models import AuditLog, BinnedInvoice, Customer, FiledPeriod, Invoice, LineItem
from billing.services.bill_reads import bill_checks, itax_flags
from billing.services.bin import bin_bill
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, line, person, sale
from billing.text import in_words, inr, percent

GOOD_GSTIN = "08AAKFS4821M1Z" + check_digit("08AAKFS4821M1Z")
BAD_GSTIN = GOOD_GSTIN[:14] + ("A" if GOOD_GSTIN[14] != "A" else "B")
NO_SUCH_BILL = {"detail": "No Invoice matches the given query."}


class ItaxFlagsTest(TestCase):
    def setUp(self):
        self.biz = firm()

    def kinds(self, customer, rate, mode="", status="active"):
        bill = sale(self.biz, customer, str(Invoice.objects.count() + 1), "2026-09-10", line(rate=rate),
                    payment_mode=mode, status=status)
        return [f["kind"] for f in itax_flags(bill)]

    def test_cash_at_the_limit_and_over(self):
        anil = buyer(pan_number="ABCDE1234F")
        self.assertEqual(self.kinds(anil, "194174.76", "cash"), ["cash_limit"])  # ₹2,00,000.00 exactly: at the limit
        self.assertEqual(self.kinds(anil, "194174.76", "mixed"), [])  # part cash isn't flagged
        bill = sale(self.biz, anil, "X1", "2026-09-10", line(rate="258000"), payment_mode="cash")
        self.assertEqual(itax_flags(bill)[0]["text"], "₹2,65,740.00 taken in cash is at or over the ₹2,00,000 "
                                                      "limit for one bill (Income Tax Sec 269ST).")

    def test_pan_over_the_limit(self):
        self.assertEqual(self.kinds(buyer(), "194174.76"), [])  # not over
        self.assertEqual(self.kinds(buyer("Lalit"), "200000"), ["pan"])
        self.assertEqual(self.kinds(buyer("Mehta", pan_number="ABCDE1234F"), "200000"), [])
        good = Customer.objects.create(name="Rathore Gems", gst_number=GOOD_GSTIN, address="Jaipur")
        bad = Customer.objects.create(name="Kulkarni", gst_number=BAD_GSTIN, address="Pune")
        self.assertEqual(self.kinds(good, "200000"), [])  # the PAN comes from a valid GSTIN
        self.assertEqual(self.kinds(bad, "200000"), ["pan"])

    def test_walk_in_and_address(self):
        walkin = buyer("Walk-in Customer", customer_type="walkin")
        self.assertEqual(self.kinds(walkin, "200000"), ["walkin_limit"])
        noaddr = Customer.objects.create(name="Desai Gems", gst_number=GOOD_GSTIN)
        self.assertEqual(self.kinds(noaddr, "1000"), ["b2b_address"])

    def test_a_cancelled_bill_has_none(self):
        self.assertEqual(self.kinds(buyer(), "258000", "cash", status=BILL_CANCELLED), [])

    # Beyond the plan's tests: the rulings.

    def test_a_typed_pan_that_isnt_one_is_no_pan(self):
        # Ruling 1A-20: v2's imports store placeholders like "N/A" unchecked; they don't silence Rule 114B.
        self.assertEqual(self.kinds(buyer("Joshi", pan_number="N/A"), "200000"), ["pan"])
        self.assertEqual(self.kinds(buyer("Bhatt", pan_number="abcde1234f"), "200000"), [])  # a PAN, in small letters


class ChecksTest(TestCase):
    def setUp(self):
        self.biz, self.cust = firm(), buyer()

    def checks(self, bill, duplicated=False):
        return bill_checks(bill, list(bill.lineitem_set.all()), duplicated)

    def test_each_check(self):
        empty = Invoice.objects.create(business=self.biz, customer=self.cust, invoice_number="1", invoice_date="2026-09-10")
        self.assertEqual(self.checks(empty), ["no_lines"])
        self.assertEqual(self.checks(sale(self.biz, self.cust, "2", "2026-09-10", line(hsn=""))), ["no_hsn"])
        self.assertEqual(self.checks(sale(self.biz, self.cust, "3", "2026-09-10"), duplicated=True), ["duplicate"])
        wrong = sale(self.biz, self.cust, "4", "2026-09-10")
        LineItem.objects.filter(invoice=wrong).update(cgst=0, sgst=0, igst=300)
        self.assertEqual(self.checks(wrong), ["heads_mismatch"])
        short = sale(self.biz, self.cust, "5", "2026-09-10")
        LineItem.objects.filter(invoice=short).update(cgst=50, sgst=50)
        self.assertEqual(self.checks(short), ["tax_mismatch"])
        empty.status = BILL_CANCELLED
        self.assertEqual(self.checks(empty), [])

    # Beyond the plan's tests.

    def test_a_tax_a_paisa_off_is_no_mismatch(self):
        # Contract 0.2: a line's tax differs from its slab by more than 1 paisa.
        bill = sale(self.biz, self.cust, "6", "2026-09-10")  # ₹10,000 at 3%: ₹300.00
        for cgst, codes in (("150.01", []), ("149.99", []), ("150.02", ["tax_mismatch"]), ("149.98", ["tax_mismatch"])):
            with self.subTest(cgst=cgst):
                LineItem.objects.filter(invoice=bill).update(cgst=cgst)
                self.assertEqual(self.checks(bill), codes)


class SalesListTest(TestCase):
    def setUp(self):
        self.client = client_for(person("manoj", *ROLE_GROUPS["viewer"]))
        self.kgh = firm(invoice_prefix="KGH")
        self.mo = firm("MEERA ORNAMENTS", gstin="08AAAAA0000A1Z5")
        self.anil = buyer(mobile_number="9829041122")
        self.rathore = Customer.objects.create(name="Rathore Gems", gst_number=GOOD_GSTIN, address="Jaipur",
                                               state_name="RAJASTHAN")
        self.b31 = sale(self.kgh, self.anil, "KGH/2026-27/31", "2026-10-08", payment_mode="cash")
        self.b131 = sale(self.kgh, self.rathore, "KGH/2026-27/131", "2026-10-07", payment_mode="credit")
        self.cancelled = sale(self.kgh, self.anil, "KGH/2026-27/19", "2026-09-03", status=BILL_CANCELLED,
                              cancel_reason="Customer returned it")
        self.paper = sale(self.mo, self.anil, "17", "2026-09-02", paper=True)
        self.big = sale(self.mo, self.anil, "18", "2026-09-05", line(rate="258000"), payment_mode="cash")
        self.old = sale(self.kgh, self.anil, "KGH/2025-26/31", "2025-12-01")

    def get(self, **params):
        r = self.client.get(reverse("sale-list"), params)
        self.assertEqual(r.status_code, 200, r.data)
        return r.data

    def numbers(self, **params):
        return [row["invoice_number"] for row in self.get(**params)["results"]]

    def test_a_row(self):
        row = self.get(fy="2026-27", number="kgh/2026-27/31")["results"][0]
        self.assertEqual(row, {
            "id": self.b31.pk, "business": self.kgh.pk, "business_name": "KIRAN GOLD HOUSE",
            "invoice_number": "KGH/2026-27/31", "counter": 31, "fy": "2026-27", "invoice_date": "2026-10-08",
            "created_at": row["created_at"], "paper": False,
            "customer": {"id": self.anil.pk, "name": "Anil Gupta", "gst_number": "", "mobile_number": "9829041122",
                         "type": "person"},
            "payment_mode": "cash", "taxable": "10000.00", "cgst": "150.00", "sgst": "150.00", "igst": "0.00",
            "tax": "300.00", "total_amount": "10300.00", "interstate": False, "gst_percents": ["3"], "line_count": 1,
            "status": "active", "cancel_reason": "", "sent": None, "checks": [], "itax": [], "locked": False,
        })

    def test_newest_first_and_other_orders(self):
        self.assertEqual(self.numbers(fy="2026-27"), ["KGH/2026-27/31", "KGH/2026-27/131", "18", "KGH/2026-27/19", "17"])
        self.assertEqual(self.numbers(fy="2026-27", business_id=self.kgh.pk, ordering="number"),
                         ["KGH/2026-27/19", "KGH/2026-27/31", "KGH/2026-27/131"])
        self.assertEqual(self.numbers(fy="2026-27", ordering="-total")[0], "18")

    def test_filters(self):
        self.assertEqual(self.numbers(status="cancelled"), ["KGH/2026-27/19"])
        self.assertEqual(self.numbers(credit="1"), ["KGH/2026-27/131"])
        self.assertEqual(self.numbers(cash="1"), ["18"])
        self.assertEqual(self.numbers(itax="1"), ["18"])
        self.assertEqual(self.numbers(paper="1"), ["17"])
        self.assertEqual(self.numbers(fy="2026-27", unsent="1"), ["KGH/2026-27/31", "KGH/2026-27/131", "18"])
        self.assertEqual(self.numbers(month="2026-09", business_id=self.mo.pk), ["18", "17"])
        self.assertEqual(self.numbers(start_date="2026-10-01", end_date="2026-10-07"), ["KGH/2026-27/131"])
        self.assertEqual(self.numbers(segment="b2b"), ["KGH/2026-27/131"])
        self.assertEqual(self.numbers(payment_mode="none", fy="2026-27"), ["KGH/2026-27/19", "17"])
        LineItem.objects.filter(invoice=self.paper).update(hsn_code="")
        self.assertEqual(self.numbers(check="1"), ["17"])

    def test_search_puts_an_exact_number_first(self):
        self.assertEqual(self.numbers(q="31", fy="2026-27"), ["KGH/2026-27/31", "KGH/2026-27/131"])
        self.assertEqual(self.numbers(q="KGH/2026-27/131"), ["KGH/2026-27/131"])
        self.assertEqual(self.numbers(q="rath", fy="2026-27"), ["KGH/2026-27/131"])
        self.assertEqual(self.numbers(q="gem", fy="2026-27"), ["KGH/2026-27/131"])
        self.assertEqual(self.numbers(q="ems"), [])  # words start; "ems" starts none
        self.assertEqual(len(self.numbers(q="98290 41", fy="2026-27")), 4)  # Anil's phone
        self.assertEqual(self.numbers(q=GOOD_GSTIN[2:8]), ["KGH/2026-27/131"])

    def test_the_summary_counts_active_bills(self):
        summary = self.get(fy="2026-27")["summary"]
        self.assertEqual(summary, {"of": "active", "bills": 4, "taxable": "288000.00", "cgst": "4320.00",
                                   "sgst": "4320.00", "igst": "0.00", "tax": "8640.00", "total_amount": "296640.00",
                                   "average": "74160.00", "cancelled": 1})
        cancelled = self.get(fy="2026-27", status="cancelled")["summary"]
        self.assertEqual((cancelled["of"], cancelled["bills"], cancelled["total_amount"], cancelled["cancelled"]),
                         ("cancelled", 1, "10300.00", 0))

    def test_facets(self):
        FiledPeriod.objects.create(business=self.kgh, year=2026, month=9)
        today = timezone.localdate()
        facets = self.get(fy="2026-27", business_id=self.kgh.pk, facets="1")["facets"]
        sept = next(m for m in facets["months"] if m["month"] == "2026-09")
        self.assertEqual((sept["bills"], sept["locked"]), (0, True))  # its one bill there is cancelled
        self.assertEqual(facets["months"][0]["month"], "2026-04")
        self.assertEqual(facets["months"][-1]["month"], min(today, date(2027, 3, 31)).strftime("%Y-%m"))
        self.assertEqual(set(facets["views"]), {"unsent_today", "credit_month", "check", "cash"})
        every = self.get(fy="2026-27", facets="1")["facets"]
        self.assertFalse(next(m for m in every["months"] if m["month"] == "2026-09")["locked"])  # MO isn't filed
        elsewhere = self.get(fy="2026-27", q="KGH/2025", facets="1")["facets"]["elsewhere"]
        self.assertEqual(elsewhere, [{"fy": "2025-26", "bills": 1}])

    def test_bad_params(self):
        r = self.client.get(reverse("sale-list"), {"fy": "2026"})
        self.assertEqual((r.status_code, r.data), (400, {"fy": ["Give the financial year like 2026-27."]}))
        self.assertEqual(self.client.get(reverse("sale-list"), {"month": "2026-9"}).data,
                         {"month": ["Give the month like 2026-09."]})
        self.assertEqual(self.client.get(reverse("sale-list"), {"start_date": "1/9/2026"}).data,
                         {"start_date": ["Type the date like 2026-09-30."]})

    def test_purchases_are_not_sales(self):
        supplier = Customer.objects.create(name="SUPPLIER", gst_number=GOOD_GSTIN, state_name="RAJASTHAN")
        sale(self.kgh, supplier, "SJ-1", "2026-10-08", kind="inward")
        self.assertNotIn("SJ-1", self.numbers())

    # Beyond the plan's tests: the rulings.

    def test_an_id_that_isnt_a_number_is_a_400_and_one_not_on_file_matches_nothing(self):
        # Contract 2.1 as Ruling 1A-33 words it: an id that isn't a number is the 400 in the contract's words (Ruling
        # 1A-5: never a 500, as an id past the column's range was on SQLite, and never DRF's own words); an id that
        # isn't on file is a filter that matches nothing, a 200 with an empty page.
        url = reverse("sale-list")
        for key, words in (("business_id", "Pick a firm from the list."), ("customer_id", "Pick a customer from the list.")):
            for raw in ("abc", "²", "٣", "1.5", "-1", " 1", "9" * 19):
                with self.subTest(key=key, raw=raw):
                    r = self.client.get(url, {key: raw, "facets": "1"})
                    self.assertEqual((r.status_code, r.data), (400, {key: [words]}))
            self.assertEqual(self.get(**{key: "424242"})["results"], [])  # not on file: 200, an empty page (1A-33)
        self.assertEqual(self.numbers(customer_id=self.rathore.pk), ["KGH/2026-27/131"])

    def test_a_null_character_in_a_search_is_read_past(self):
        # Ruling 1A-5 (Task 3's M4): psycopg refuses a null character in a query, so it never reaches one.
        self.assertEqual(self.numbers(q="rath\x00", fy="2026-27"), ["KGH/2026-27/131"])
        self.assertEqual(self.numbers(q="\x0031", fy="2026-27"), ["KGH/2026-27/31", "KGH/2026-27/131"])
        self.assertEqual(self.numbers(number="KGH/2026-27/131\x00"), ["KGH/2026-27/131"])
        facets = self.get(q="KGH/2025\x00", fy="2026-27", facets="1")["facets"]
        self.assertEqual(facets["elsewhere"], [{"fy": "2025-26", "bills": 1}])

    def test_a_date_outside_the_years_the_app_keeps(self):
        # Ruling 1A-28, for every date parameter.
        for key in ("start_date", "end_date"):
            for day in ("1999-12-31", "2100-01-01", "9999-12-31"):
                with self.subTest(key=key, day=day):
                    r = self.client.get(reverse("sale-list"), {key: day})
                    self.assertEqual((r.status_code, r.data), (400, {key: ["Pick a date from 2000 to 2099."]}))

    def test_a_slab_as_a_percent_or_a_fraction(self):
        # A bill with two lines at the slab is listed and counted once.
        diamond = sale(self.mo, self.anil, "19", "2026-09-06", line(gst="0.0025", hsn="710239"),
                       line(gst="0.0025", hsn="710239", rate="500"))
        exempt = sale(self.mo, self.anil, "20", "2026-09-06", line(gst="0", hsn="7106"))
        for rate, bills in (("3", ["18", "17"]), ("0.03", ["18", "17"]), ("0.25", [diamond]), ("0.0025", [diamond]),
                            ("0", [exempt]), ("18", [])):
            with self.subTest(rate=rate):
                data = self.get(gst_rate=rate, business_id=self.mo.pk)
                expected = [b if isinstance(b, str) else b.invoice_number for b in bills]
                self.assertEqual([row["invoice_number"] for row in data["results"]], expected)
                self.assertEqual((data["count"], data["summary"]["bills"]), (len(expected), len(expected)))
        # A rate that names nothing the column could hold matches no bill, and is never a 500.
        for junk in ("abc", "NaN", "sNaN", "Infinity", "1e999999", "-3", "1e-9", "3%"):
            with self.subTest(gst_rate=junk):
                self.assertEqual(self.get(gst_rate=junk)["count"], 0)

    def test_v2s_drill_downs_and_the_other_segments(self):
        twice = sale(self.kgh, self.anil, "kgh/2026-27/31", "2026-10-09")  # the same number, in another case
        empty = Invoice.objects.create(business=self.kgh, customer=self.anil, invoice_number="KGH/2026-27/40",
                                       invoice_date="2026-10-09")
        LineItem.objects.filter(invoice=self.big).update(hsn_code="")
        gujarati = buyer("Desai Gems Walk-in", state="GUJARAT")
        large = sale(self.mo, gujarati, "21", "2026-09-07", line(rate="150000"))  # inter-state, unregistered, over ₹1 lakh
        self.assertEqual(self.numbers(dups="1"), [twice.invoice_number, "KGH/2026-27/31"])
        self.assertEqual(self.get(dups="1")["results"][0]["checks"], ["duplicate"])
        self.assertEqual(self.numbers(empty="1"), [empty.invoice_number])
        self.assertEqual(self.numbers(no_hsn="1"), ["18"])
        self.assertEqual(self.numbers(segment="b2cl"), [large.invoice_number])
        self.assertEqual(self.numbers(segment="b2cs", fy="2026-27", business_id=self.mo.pk), ["18", "17"])

    def test_v2s_drill_downs_list_active_bills_and_dups_keeps_cancelled_numbers(self):
        # Ruling 1A-35: a cancelled bill needs no items or HSN fixed (v2's data-quality counts leave it out), so
        # empty=1 and no_hsn=1 list active bills only; no_hsn reads a blank HSN as the check does, spaces and all;
        # dups=1 keeps a cancelled bill's number, which it still holds (contract 2.1, 7).
        Invoice.objects.create(business=self.kgh, customer=self.anil, invoice_number="KGH/2026-27/40",
                               invoice_date="2026-10-09")
        Invoice.objects.create(business=self.kgh, customer=self.anil, invoice_number="KGH/2026-27/41",
                               invoice_date="2026-10-09", status=BILL_CANCELLED, cancel_reason="Made in error")
        self.assertEqual(self.numbers(empty="1"), ["KGH/2026-27/40"])
        LineItem.objects.filter(invoice=self.big).update(hsn_code="   ")
        LineItem.objects.filter(invoice=self.paper).update(hsn_code="\t")
        LineItem.objects.filter(invoice=self.cancelled).update(hsn_code="")
        self.assertEqual(self.numbers(no_hsn="1"), ["18", "17"])
        self.assertEqual([row["checks"] for row in self.get(no_hsn="1")["results"]], [["no_hsn"], ["no_hsn"]])
        again = sale(self.kgh, self.anil, "kgh/2026-27/19", "2026-10-09")  # the cancelled 19's number again
        self.assertEqual(self.numbers(dups="1"), [again.invoice_number, "KGH/2026-27/19"])

    def test_the_views_count_by_value(self):
        # Each facet view on its boundary day (or amount), with a cancelled bill beside it that must not count.
        desai = firm("DESAI JEWELLERS", gstin="08AAAAA1111A1Z5")
        cust = buyer("Hemant Dave")
        sale(desai, cust, "1", "2026-10-09")  # today, active, made in the app, never sent: unsent_today
        sale(desai, cust, "2", "2026-10-08")  # yesterday
        sale(desai, cust, "3", "2026-10-09", status=BILL_CANCELLED)
        sale(desai, cust, "4", "2026-10-09", paper=True)
        sent = sale(desai, cust, "5", "2026-10-09")
        Invoice.objects.filter(pk=sent.pk).update(sent_at=timezone.now(), sent_count=1, sent_via="whatsapp")
        sale(desai, cust, "6", "2026-10-01", payment_mode="credit")  # this month's first day: credit_month
        sale(desai, cust, "7", "2026-09-30", payment_mode="credit")  # last month
        sale(desai, cust, "8", "2026-10-02", payment_mode="credit", status=BILL_CANCELLED)
        sale(desai, cust, "9", "2026-04-01", line(hsn=""))  # the FY's first day, no HSN: check
        sale(desai, cust, "10", "2026-03-31", line(hsn=""))  # the FY before
        sale(desai, cust, "11", "2026-04-02", line(hsn=""), status=BILL_CANCELLED)
        sale(desai, cust, "12", "2026-09-15", line(rate="194174.76"), payment_mode="cash")  # ₹2,00,000.00: cash
        sale(desai, cust, "13", "2026-09-16", line(rate="194174.75"), payment_mode="cash")  # ₹1,99,999.99
        sale(desai, cust, "14", "2026-09-17", line(rate="194174.76"), payment_mode="cash", status=BILL_CANCELLED)
        with patch("billing.services.bill_reads.timezone.localdate", return_value=date(2026, 10, 9)):
            facets = self.get(fy="2026-27", business_id=desai.pk, facets="1")["facets"]
        self.assertEqual(facets["views"], {"unsent_today": 1, "credit_month": 1, "check": 1, "cash": 1})
        self.assertEqual([(m["month"], m["bills"]) for m in facets["months"] if m["bills"]],
                         [("2026-04", 1), ("2026-09", 3), ("2026-10", 5)])
        self.assertEqual(facets["months"][-1]["month"], "2026-10")  # up to the current month

    def test_the_fy_wide_reads_fetch_only_the_columns_they_use(self):
        # Ruling 1A-36 (Neon's free plan has 5 GB of transfer a month): the facets, check=1, itax=1, the b2cl split
        # and the summary read the whole FY, so they fetch only what their checks, views and sums use. Only the page
        # itself (a LIMIT) reads whole rows, for the BillRows. One request each, so no filter's empty answer skips
        # another's read.
        wide = ('"notes"', '"firm_snapshot"', '"cancel_reason"', '"product_name"', '"bank_account_number"',
                '"transporter_name"', '"source_file"')
        whole = []
        for params in ({"facets": "1", "page_size": "1"}, {"check": "1"}, {"itax": "1"}, {"segment": "b2cl"},
                       {"q": "31", "facets": "1"}):
            with CaptureQueriesContext(connection) as seen:
                self.get(fy="2026-27", **params)
            whole += [(params, q["sql"][:120]) for q in seen.captured_queries
                      if "LIMIT" not in q["sql"] and any(c in q["sql"] for c in wide)]
        self.assertEqual(whole, [])

    def test_the_narrowed_reads_never_load_a_column_later(self):
        # The narrowed reads list every column the checks and views read: one left out would be read again a bill at
        # a time. The data reaches every branch: bills today (sent, paper, neither), udhaar this month, cash at ₹2
        # lakh, a chosen place, a firm with no GSTIN, an unregistered buyer over ₹1 lakh in another state, a walk-in
        # and a buyer with no PAN over ₹2 lakh, a business with no address.
        stateless = firm("SONI JEWELLERS", gstin="", state="RAJASTHAN")
        gujarati = buyer("Desai Gems Walk-in", state="GUJARAT")
        walkin = buyer("Walk-in Customer", customer_type="walkin")
        noaddr = Customer.objects.create(name="Desai Gems", gst_number=GOOD_GSTIN)
        for n, (cust, day, kw) in enumerate((
                (self.anil, "2026-10-09", {}), (self.anil, "2026-10-09", {"paper": True}),
                (self.anil, "2026-10-09", {"sent_at": timezone.now()}), (self.anil, "2026-10-02", {"payment_mode": "credit"}),
                (walkin, "2026-09-20", {"payment_mode": "cash"}), (gujarati, "2026-09-21", {"place_of_supply": "24"}),
                (noaddr, "2026-09-22", {}), (buyer("Lalit"), "2026-09-23", {})), start=1):
            sale(stateless, cust, str(n), day, line(rate="200000", hsn="" if n % 2 else "711319"), **kw)
        loads = []
        refresh = Model.refresh_from_db

        def recorded(instance, *args, **kwargs):
            loads.append((type(instance).__name__, kwargs.get("fields")))
            return refresh(instance, *args, **kwargs)

        with patch.object(Model, "refresh_from_db", recorded), \
                patch("billing.services.bill_reads.timezone.localdate", return_value=date(2026, 10, 9)):
            for params in ({"facets": "1", "page_size": "1"}, {"check": "1"}, {"itax": "1"}, {"segment": "b2cl"},
                           {"segment": "b2cs"}):
                self.get(fy="2026-27", **params)
        self.assertEqual(loads, [])

    def test_a_facets_request_reads_the_fy_once(self):
        # Ruling 1A-39: the facets' check view reads the firm's FY numbers and its active bills' lines; the page's twins
        # and lines and the summary use what it read, and answer as they do without the facets. A page can hold bills
        # the facets don't read (cancelled, or of another FY), and a list of every year has a summary they don't
        # cover: those are read as before.
        fy = {"fy": "2026-27"}
        for params, reads in (({**fy, "business_id": self.kgh.pk, "facets": "1", "page": "1", "page_size": "1"}, (1, 1)),
                              ({**fy, "business_id": self.kgh.pk, "facets": "1", "q": "Anil"}, (1, 2)),
                              ({**fy, "facets": "1"}, (1, 2)),
                              ({"business_id": self.kgh.pk, "facets": "1"}, (2, 3))):
            with self.subTest(params=params), patch.object(timezone, "localdate", return_value=date(2026, 10, 9)):
                with CaptureQueriesContext(connection) as seen:
                    shown = self.get(**params)
                sqls = [q["sql"] for q in seen.captured_queries]
                numbers = [sql for sql in sqls if '"billing_invoice"."invoice_number" AS "invoice_number"' in sql]
                lines = [sql for sql in sqls if 'FROM "billing_lineitem"' in sql]
                self.assertEqual((len(numbers), len(lines)), reads)
                alone = self.get(**{k: v for k, v in params.items() if k != "facets"})
                self.assertEqual((shown["results"], shown["summary"]), (alone["results"], alone["summary"]))

    def test_itax_finds_a_business_without_an_address(self):
        noaddr = Customer.objects.create(name="Desai Gems", gst_number=f" {GOOD_GSTIN} ")
        sale(self.mo, noaddr, "22", "2026-09-08", line(rate="1000"))
        self.assertEqual(self.numbers(itax="1"), ["22", "18"])

    def test_a_cancelled_bill_whose_canceller_v2_deleted_still_lists(self):
        # Ruling 1A-6: the row names no user, so it lists; the bill's page reads the canceller as unknown.
        Invoice.objects.filter(pk=self.cancelled.pk).update(cancelled_by_id=424242)
        self.assertEqual(self.numbers(status="cancelled"), ["KGH/2026-27/19"])
        r = self.client.get(reverse("sale-detail", args=[self.cancelled.pk]))
        self.assertEqual((r.status_code, r.data["cancelled_by"]), (200, None))

    def test_a_page_past_the_end(self):
        r = self.client.get(reverse("sale-list"), {"page": "9"})
        self.assertEqual((r.status_code, r.data), (404, {"detail": "This list has no page 9."}))

    def test_reading_writes_nothing(self):
        # Ruling 1A-16: the list, its facets and a bill's page only read.
        with CaptureQueriesContext(connection) as seen:
            self.get(fy="2026-27", facets="1", q="31", check="1", itax="1", dups="1")
            self.get(fy="2026-27", segment="b2cs")
            self.assertEqual(self.client.get(reverse("sale-detail", args=[self.b31.pk])).status_code, 200)
        writes = [q["sql"] for q in seen.captured_queries
                  if q["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE"))]
        self.assertEqual(writes, [])


class SalesDetailTest(TestCase):
    def setUp(self):
        self.owner = person("rakesh", *ROLE_GROUPS["owner"], first_name="Rakesh", last_name="Soni")
        self.client = client_for(person("manoj", *ROLE_GROUPS["viewer"]))
        self.kgh = firm(invoice_prefix="KGH", pan_number="ABCDE1234F", bank_name="Sandbox Bank")
        self.anil = buyer(mobile_number="9829041122", address="15 Demo Road", city="Udaipur")
        self.bill = sale(self.kgh, self.anil, "KGH/2026-27/31", "2026-10-08",
                         line(name="Gold Ring 22K", qty="12.345", rate="6512.50", hsn="711319"),
                         line(name="Gold Chain 22K", qty="1", rate="4150", hsn="711319", unit="pcs"),
                         payment_mode="cash", notes="Order 77")

    def get(self, pk=None):
        return self.client.get(reverse("sale-detail", args=[pk or self.bill.pk]))

    def test_the_bill_page_and_print_data(self):
        data = self.get().data
        self.assertEqual((data["taxable"], data["tax"], data["total_amount"]), ("84546.81", "2536.40", "87083.21"))
        self.assertEqual(data["total_in_words"], "Eighty Seven Thousand Eighty Three Rupees and Twenty One Paise Only")
        self.assertEqual(data["tax_in_words"], "Two Thousand Five Hundred Thirty Six Rupees and Forty Paise Only")
        self.assertEqual(data["lines"][0], {
            "id": data["lines"][0]["id"], "product_name": "Gold Ring 22K", "hsn_code": "711319", "quantity": "12.345",
            "unit": "gms", "rate": "6512.500", "gst_percent": "3", "taxable": "80396.81", "cgst": "1205.95",
            "sgst": "1205.95", "igst": "0.00", "tax": "2411.90", "amount": "82808.71", "note": ""})
        self.assertEqual(data["slabs"], [{"gst_percent": "3", "taxable": "84546.81", "cgst": "1268.20", "sgst": "1268.20",
                                          "igst": "0.00", "tax": "2536.40"}])
        self.assertEqual([(h["hsn_code"], h["unit"], h["quantity"]) for h in data["hsn_summary"]],
                         [("711319", "gms", "12.345"), ("711319", "pcs", "1.000")])
        self.assertEqual((data["place_of_supply"], data["place_of_supply_name"], data["place_of_supply_chosen"],
                          data["segment"]), ("08", "RAJASTHAN", None, "b2cs"))
        self.assertEqual((data["firm"]["name"], data["firm"]["state_code"], data["firm"]["frozen"]),
                         ("KIRAN GOLD HOUSE", "08", False))
        self.assertEqual((data["customer"]["city"], data["customer"]["gstin_valid"], data["customer"]["pan"]),
                         ("Udaipur", None, ""))
        self.assertEqual(data["notes"], "Order 77")
        self.assertFalse(data["eway"]["may_be_needed"])  # jewellery (HSN 71) needs no e-way bill

    def test_frozen_firm_history_and_links(self):
        Invoice.objects.filter(pk=self.bill.pk).update(firm_snapshot={"name": "KIRAN GOLD HOUSE (OLD)", "gst_number": "",
                                                                      "state_name": "RAJASTHAN", "signature_image": ""})
        AuditLog.objects.create(action="created", entity="invoice", entity_id=self.bill.pk, entity_name="x",
                                user=self.owner, details="Anil Gupta · ₹87,083.21")
        again = sale(self.kgh, self.anil, "KGH/2026-27/32", "2026-10-08", replaces=self.bill.pk)
        data = self.get().data
        self.assertEqual((data["firm"]["name"], data["firm"]["frozen"]), ("KIRAN GOLD HOUSE (OLD)", True))
        self.assertEqual(data["history"]["activity"][0]["by"], "Rakesh Soni")
        self.assertEqual(data["replaced_by"]["id"], again.pk)
        self.assertEqual(self.get(again.pk).data["replaces"]["invoice_number"], "KGH/2026-27/31")

    def test_e_way_hint_for_goods_outside_chapter_71(self):
        bill = sale(self.kgh, self.anil, "KGH/2026-27/40", "2026-10-08", line(rate="60000", hsn="391990"))
        self.assertTrue(self.get(bill.pk).data["eway"]["may_be_needed"])

    def test_a_deleted_bill_is_a_404_with_its_bin_row(self):
        binned, _ = bin_bill(self.bill, None, "Entered twice")
        r = self.get()
        self.assertEqual((r.status_code, r.data["code"], r.data["binned"]["id"]), (404, "deleted", binned.pk))

    def test_a_purchase_or_nothing_is_a_plain_404(self):
        # Ruling 1A-8: a purchase's id too, with the contract's body (2.2).
        supplier = Customer.objects.create(name="Soni Bullion Suppliers", gst_number=GOOD_GSTIN, state_name="RAJASTHAN")
        purchase = sale(self.kgh, supplier, "SB-4", "2026-10-08", kind="inward")
        for pk in (purchase.pk, 999999, 10 ** 20):
            with self.subTest(pk=pk):
                r = self.get(pk)
                self.assertEqual((r.status_code, r.data), (404, NO_SUCH_BILL))

    def test_restore_now_answers_the_bill(self):
        binned, _ = bin_bill(self.bill, None)
        r = client_for(self.owner).post(reverse("bin-restore", args=[binned.pk]))
        self.assertEqual((r.data["id"], r.data["total_amount"]), (self.bill.pk, "87083.21"))

    # Beyond the plan's tests: the rulings.

    def test_no_rupee_rounding(self):
        # Ruling 1B-12: the total and its words are exact to the paisa; there is no payable or round-off.
        self.assertFalse({"payable", "round_off", "payable_in_words"} & set(self.get().data))

    def test_the_taxable_value_is_each_lines_to_the_paisa(self):
        # Contract 0.2: taxable = Σ paise(quantity × rate). Two lines of 1.001 × ₹5 are ₹5.01 each (half-up), so the
        # bill's ₹10.02, never the ₹10.01 a rounded sum would give: the list, the bill and its summary agree.
        bill = sale(self.kgh, self.anil, "KGH/2026-27/60", "2026-10-08", line(qty="1.001", rate="5"),
                    line(qty="1.001", rate="5"))
        data = self.get(bill.pk).data
        self.assertEqual((data["lines"][0]["taxable"], data["taxable"], data["slabs"][0]["taxable"], data["tax"],
                          data["total_amount"]), ("5.01", "10.02", "10.02", "0.30", "10.32"))
        listed = self.client.get(reverse("sale-list"), {"number": "KGH/2026-27/60"}).data
        self.assertEqual((listed["results"][0]["taxable"], listed["summary"]["taxable"]), ("10.02", "10.02"))

    def test_the_whole_bill_page(self):
        data = self.get().data
        self.assertEqual(set(data), {
            "id", "business", "business_name", "invoice_number", "counter", "fy", "invoice_date", "created_at", "paper",
            "customer", "payment_mode", "taxable", "cgst", "sgst", "igst", "tax", "total_amount", "interstate",
            "gst_percents", "line_count", "status", "cancel_reason", "sent", "checks", "itax", "locked",
            "place_of_supply", "place_of_supply_name", "place_of_supply_chosen", "segment", "notes", "replaces",
            "replaced_by", "cancelled_at", "cancelled_by", "firm", "lines", "slabs", "hsn_summary", "total_in_words",
            "tax_in_words", "eway", "duplicates", "history"})
        self.assertEqual(data["firm"], {
            "name": "KIRAN GOLD HOUSE", "address": "12 Sandbox Bazaar", "gst_number": "08ABCDE1234A1Z5",
            "state_name": "RAJASTHAN", "state_code": "08", "pan_number": "ABCDE1234F", "mobile_number": "9000000003",
            "email": "", "bank_name": "Sandbox Bank", "bank_account_number": "", "bank_ifsc_code": "",
            "bank_branch_name": "", "invoice_prefix": "KGH", "signature_url": None, "frozen": False})
        self.assertEqual(data["customer"], {
            "id": self.anil.pk, "name": "Anil Gupta", "type": "person", "address": "15 Demo Road", "city": "Udaipur",
            "state_name": "RAJASTHAN", "state_code": "08", "gst_number": "", "gstin_valid": None, "pan_number": "",
            "pan": "", "mobile_number": "9829041122", "email": ""})
        self.assertEqual(data["eway"], {"eway_bill_number": "", "transporter_name": "", "transporter_gstin": "",
                                        "vehicle_number": "", "vehicle_type": "Regular", "transport_mode": "Road",
                                        "distance_km": None, "may_be_needed": False})
        self.assertEqual((data["replaces"], data["replaced_by"], data["cancelled_at"], data["cancelled_by"],
                          data["duplicates"]), (None, None, None, None, []))
        self.assertEqual(data["history"]["created_by"], None)  # made in a test, by nobody

    def test_a_frozen_firm_has_every_key(self):
        # A snapshot frozen with fewer keys (or none) still answers the contract's firm, blanks for what it lacks.
        Invoice.objects.filter(pk=self.bill.pk).update(firm_snapshot={"name": "KIRAN GOLD HOUSE (OLD)"})
        firm_block = self.get().data["firm"]
        self.assertEqual((firm_block["name"], firm_block["address"], firm_block["state_code"], firm_block["frozen"]),
                         ("KIRAN GOLD HOUSE (OLD)", "", "", True))
        self.assertEqual(len(firm_block), 15)

    def test_the_customers_pan_and_gstin(self):
        # Ruling 1A-20: the PAN to print is a PAN-shaped typed one, else a valid GSTIN's, else none.
        Customer.objects.filter(pk=self.anil.pk).update(pan_number="N/A")
        self.assertEqual((self.get().data["customer"]["pan_number"], self.get().data["customer"]["pan"]), ("N/A", ""))
        Customer.objects.filter(pk=self.anil.pk).update(gst_number=GOOD_GSTIN)
        customer = self.get().data["customer"]
        self.assertEqual((customer["pan"], customer["gstin_valid"], customer["type"]), (GOOD_GSTIN[2:12], True, "business"))
        Customer.objects.filter(pk=self.anil.pk).update(gst_number=BAD_GSTIN)
        self.assertEqual((self.get().data["customer"]["pan"], self.get().data["customer"]["gstin_valid"]), ("", False))

    def test_a_chosen_place_of_supply(self):
        # Task 5's carry: the chosen place reads as every reader reads it (chosen_place): trimmed, "  " is none.
        gujarat = sale(self.kgh, self.anil, "KGH/2026-27/41", "2026-10-08", place_of_supply="24")
        data = self.get(gujarat.pk).data
        self.assertEqual((data["place_of_supply"], data["place_of_supply_name"], data["place_of_supply_chosen"],
                          data["interstate"], data["igst"], data["segment"]), ("24", "GUJARAT", "24", True, "300.00", "b2cs"))
        blank = sale(self.kgh, self.anil, "KGH/2026-27/42", "2026-10-08", place_of_supply="  ")
        data = self.get(blank.pk).data
        self.assertEqual((data["place_of_supply"], data["place_of_supply_chosen"], data["interstate"]), ("08", None, False))

    def test_the_same_number_twice(self):
        # The bill page finds its twins as the list's duplicate check does: in the firm and FY, any case, any spaces
        # around the number as stored (v2's imports).
        twin = sale(self.kgh, self.anil, "kgh/2026-27/31", "2026-10-09")  # another case: the same number
        spaced = sale(self.kgh, self.anil, "KGH/2026-27/31 ", "2026-10-10")
        sale(self.kgh, self.anil, "KGH/2026-27/310", "2026-10-09")  # contains it, but isn't it
        sale(self.kgh, self.anil, "KGH/2026-27/31", "2027-04-02")  # the next FY's
        data = self.get().data
        self.assertEqual((data["checks"], [d["id"] for d in data["duplicates"]]), (["duplicate"], [twin.pk, spaced.pk]))
        self.assertEqual([d["id"] for d in self.get(twin.pk).data["duplicates"]], [self.bill.pk, spaced.pk])
        rows = self.client.get(reverse("sale-list"), {"dups": "1"}).data["results"]
        self.assertEqual({row["id"] for row in rows}, {self.bill.pk, twin.pk, spaced.pk})

    def test_the_page_asks_only_for_numbers_with_its_number_part(self):
        # Ruling 1A-39: the database narrows the firm's FY to the numbers that contain the bill's number part, and
        # _number_key still decides, as in the list's duplicate check (test_the_same_number_twice). A number without a
        # number part in plain digits (none, or another script's) is looked for among every number of the FY.
        twin = sale(self.kgh, self.anil, " kgh/2026-27/31", "2026-10-09")
        for n in (310, 131, 32):
            sale(self.kgh, self.anil, f"KGH/2026-27/{n}", "2026-10-09")
        with CaptureQueriesContext(connection) as seen:
            data = self.get().data
        self.assertEqual((data["checks"], [d["id"] for d in data["duplicates"]]), (["duplicate"], [twin.pk]))
        numbers = [q["sql"] for q in seen.captured_queries if '"billing_invoice"."invoice_number" AS "invoice_number"' in q["sql"]]
        self.assertEqual(len(numbers), 1)
        self.assertIn("%31%", numbers[0])
        for number, alike in (("INV-A", "inv-a "), ("KGH/٣١", "kgh/٣١")):
            with self.subTest(number=number):
                bill, other = sale(self.kgh, self.anil, number, "2026-10-08"), sale(self.kgh, self.anil, alike, "2026-10-09")
                self.assertEqual([d["id"] for d in self.get(bill.pk).data["duplicates"]], [other.pk])

    def test_a_cancelled_bill(self):
        Invoice.objects.filter(pk=self.bill.pk).update(status=BILL_CANCELLED, cancel_reason="Customer returned it",
                                                       cancelled_at=timezone.now(), cancelled_by=self.owner)
        data = self.get().data
        self.assertEqual((data["status"], data["cancel_reason"], data["cancelled_by"], data["itax"], data["checks"]),
                         ("cancelled", "Customer returned it", {"id": self.owner.pk, "name": "Rakesh Soni"}, [], []))
        self.assertIsNotNone(data["cancelled_at"])

    def test_deleted_bin_rows_and_people_v2_deleted(self):
        # Ruling 1A-6: a bin row v2's undo already brought back is no deleted bill, so the old id is a plain 404; a
        # row whose firm, customer and deleter v2 deleted still answers, with the names the bill had.
        binned, entry = bin_bill(self.bill, self.owner, "Entered twice")
        BinnedInvoice.objects.filter(pk=binned.pk).update(business_id=424241, customer_id=424242, deleted_by_id=424243)
        r = self.get()
        self.assertEqual((r.status_code, r.data["code"], r.data["detail"]), (404, "deleted", "This bill was deleted."))
        self.assertEqual((r.data["binned"]["business_name"], r.data["binned"]["customer"]["name"],
                          r.data["binned"]["deleted_by"], r.data["binned"]["locked"]),
                         ("KIRAN GOLD HOUSE", "Anil Gupta", None, False))
        entry.snapshot = {**entry.snapshot, "_undo": {"at": "2026-10-01T10:00:00+05:30", "by": None, "log": entry.pk}}
        entry.save(update_fields=["snapshot"])
        r = self.get()
        self.assertEqual((r.status_code, r.data), (404, NO_SUCH_BILL))

    def test_a_restored_bill_whose_canceller_v2_deleted(self):
        # Ruling 1A-6: restore reads the bill back without joining its canceller, who may be gone: no 500.
        Invoice.objects.filter(pk=self.bill.pk).update(status=BILL_CANCELLED, cancel_reason="Customer returned it",
                                                       cancelled_by_id=424242)
        binned, _ = bin_bill(Invoice.objects.get(pk=self.bill.pk), None)
        r = client_for(self.owner).post(reverse("bin-restore", args=[binned.pk]))
        self.assertEqual((r.status_code, r.data["status"], r.data["cancelled_by"]), (200, "cancelled", None), r.data)

    def test_a_bills_page_takes_as_many_queries_however_many_lines(self):
        many = sale(self.kgh, self.anil, "KGH/2026-27/50", "2026-10-08", *[line(rate=str(1000 + n)) for n in range(20)])
        for n in range(5):
            AuditLog.objects.create(action="updated", entity="invoice", entity_id=many.pk, entity_name="x",
                                    user=self.owner, details=f"Change {n}")
        self.get()  # anything a first request sets up
        with CaptureQueriesContext(connection) as one:
            self.get()
        with CaptureQueriesContext(connection) as twenty:
            self.assertEqual(len(self.get(many.pk).data["lines"]), 20)
        self.assertEqual(len(twenty), len(one))
        self.assertLessEqual(len(one), 9)


class ListQueriesTest(TestCase):
    """The list asks the database a fixed number of times, however long the page (Neon's compute budget)."""

    def test_a_page_of_50(self):
        client = client_for(person("manoj", *ROLE_GROUPS["viewer"]))
        owner = person("kailash", *ROLE_GROUPS["owner"])
        firms = (firm(), firm("MEERA ORNAMENTS", gstin="08AAAAA0000A1Z5"))
        for n in range(1, 56):
            gstin = f"08AAKFS{n:04d}M1ZZ" if n % 11 == 0 else None  # a business with no address: itax's b2b_address
            bill = sale(firms[n % 2], buyer(f"Buyer {n}", mobile_number=f"98290{n:05d}", gst_number=gstin), str(n),
                        "2026-09-10", line(), line(rate="500", hsn=""), payment_mode="cash" if n % 3 else "credit")
            if n % 5 == 0:
                Invoice.objects.filter(pk=bill.pk).update(status=BILL_CANCELLED, cancelled_by=owner)
            if n % 7 == 0:
                Invoice.objects.filter(pk=bill.pk).update(sent_at=timezone.now(), last_sent_at=timezone.now(),
                                                          sent_count=1, sent_via="whatsapp")
        FiledPeriod.objects.create(business=firms[0], year=2026, month=9)

        def asked(**params):
            with CaptureQueriesContext(connection) as seen:
                r = client.get(reverse("sale-list"), {"fy": "2026-27", **params})
            self.assertEqual(r.status_code, 200, r.data)
            return len(seen.captured_queries), len(r.data["results"])

        asked(page_size=1)  # anything a first request sets up
        (five, rows5), (fifty, rows50) = asked(page_size=5), asked(page_size=50)
        self.assertEqual((rows5, rows50), (5, 50))
        self.assertEqual(fifty, five)
        self.assertLessEqual(fifty, 10)
        # The facets, check=1 and itax=1 read the whole FY in a fixed number of queries too: what they read of
        # each bill comes in one query (Ruling 1A-36's narrowed reads never fetch a column a bill at a time).
        before = [asked(page_size=50, **{flag: "1"})[0] for flag in ("facets", "check", "itax")]
        for n in range(56, 66):
            sale(firms[0], buyer(f"Buyer {n}", gst_number=f"08AAKFS{n:04d}M1ZZ"), str(n), "2026-09-11",
                 line(rate="200000", hsn=""), payment_mode="cash")
        self.assertEqual([asked(page_size=50, **{flag: "1"})[0] for flag in ("facets", "check", "itax")], before)


class WordsTest(TestCase):
    """billing.text's words mirror web/src/core/format.ts, so a bill reads the same from the server and the screen."""

    def test_in_words(self):
        for value, words in (
            ("87083.21", "Eighty Seven Thousand Eighty Three Rupees and Twenty One Paise Only"),
            ("0", "Zero Rupees Only"),
            ("0.5", "Zero Rupees and Fifty Paise Only"),
            ("100", "One Hundred Rupees Only"),
            ("1000.01", "One Thousand Rupees and One Paise Only"),
            ("100000", "One Lakh Rupees Only"),
            ("123456789.99", ("Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Rupees "
                              "and Ninety Nine Paise Only")),
            ("10000000000", "One Thousand Crore Rupees Only"),
            ("2536.405", "Two Thousand Five Hundred Thirty Six Rupees and Forty One Paise Only"),  # half-up to the paisa
            ("-500", "Five Hundred Rupees Only"),
        ):
            with self.subTest(value=value):
                self.assertEqual(in_words(Decimal(value)), words)

    def test_inr_and_percent(self):
        for value, text in (("265740.48", "₹2,65,740.48"), ("87083.21", "₹87,083.21"), ("999", "₹999.00"),
                            ("0", "₹0.00"), ("-5", "−₹5.00"), ("23200075.5", "₹2,32,00,075.50")):
            with self.subTest(value=value):
                self.assertEqual(inr(Decimal(value)), text)
        for rate, text in (("0.03", "3"), ("0.0025", "0.25"), ("0", "0"), ("0.015", "1.5"), ("0.4", "40"),
                           ("0.0300", "3"), ("3", "3")):
            with self.subTest(rate=rate):
                self.assertEqual(percent(Decimal(rate)), text)


class QuickSearchTest(TestCase):
    def test_an_exact_number_comes_first(self):
        biz, cust = firm(), buyer()
        newer = sale(biz, cust, "131", str(timezone.localdate()))
        exact = sale(biz, cust, "31", str(timezone.localdate() - timedelta(days=30)), status=BILL_CANCELLED)
        rows = client_for(person("manoj", *ROLE_GROUPS["viewer"])).get(reverse("quick-search"), {"q": "31"}).data["invoices"]
        self.assertEqual([r["id"] for r in rows], [exact.pk, newer.pk])
        self.assertEqual((rows[0]["status"], rows[0]["paper"], rows[0]["business_id"]), ("cancelled", False, biz.pk))
        self.assertEqual(Decimal(rows[1]["total_amount"]), Decimal("10300"))

    # Beyond the plan's tests.

    def test_a_null_character_is_read_past(self):
        # Ruling 1A-5: as GET sales/'s search, so a null character can't be a 500 on Postgres.
        biz, cust = firm(), buyer()
        bill = sale(biz, cust, "31", str(timezone.localdate()))
        r = client_for(person("manoj", *ROLE_GROUPS["viewer"])).get(reverse("quick-search"), {"q": "31\x00"})
        self.assertEqual((r.status_code, [row["id"] for row in r.data["invoices"]]), (200, [bill.pk]))

    def test_a_bare_paper_number_finds_its_bills_past_newer_numbers_that_hold_it(self):
        # Ruling 1A-40: "31" found at most 8 numbers containing 31, newest first. Once nine newer numbers held 31
        # (/310 to /316, /131, /231), bill 31 itself fell out. A number whose number part is 31 now comes before them,
        # in any firm, newest first, after a number that is exactly "31".
        kgh, mo, cust = firm(), firm("MEERA ORNAMENTS", gstin="08AAAAA0000A1Z5"), buyer()
        today = timezone.localdate()
        ours = sale(kgh, cust, "KGH/2026-27/31", str(today - timedelta(days=40)))
        theirs = sale(mo, cust, "MO-031", str(today - timedelta(days=50)), status=BILL_CANCELLED)
        newer = [sale(kgh, cust, f"KGH/2026-27/{n}", str(today - timedelta(days=k)))
                 for k, n in enumerate((310, 311, 312, 313, 314, 315, 316, 131, 231))]
        viewer = client_for(person("manoj", *ROLE_GROUPS["viewer"]))

        def found(q):
            r = viewer.get(reverse("quick-search"), {"q": q})
            self.assertEqual(r.status_code, 200)
            return [row["id"] for row in r.data["invoices"]]

        self.assertEqual(found("31"), [ours.pk, theirs.pk, *(b.pk for b in newer[:6])])
        self.assertEqual(found("031"), [ours.pk, theirs.pk])  # leading zeros say the same number
        self.assertEqual(found("0031"), [ours.pk, theirs.pk])
        exact = sale(firm("NEW FIRM", gstin="08BBBBB0000B1Z5"), cust, "31", str(today - timedelta(days=90)))
        self.assertEqual(found("31")[:3], [exact.pk, ours.pk, theirs.pk])  # the exact number still first
        # Only plain digits are a number part: "/31" finds what holds it, newest first, as before, and another
        # script's digits find nothing.
        self.assertEqual(found("/31"), [*(b.pk for b in newer[:7]), ours.pk])
        self.assertEqual(found("٣١"), [])

    def test_the_search_for_a_number_stays_one_narrow_bounded_read(self):
        # Ruling 1A-40 within Rulings 1A-34 and 1A-39: one read of the bills, at most 8 rows, around the cache (the
        # pin in test_v3_cacheops runs q=31), in only the columns the rows show.
        kgh, cust = firm(), buyer()
        for n in range(1, 41):
            sale(kgh, cust, f"KGH/2026-27/{n}31", "2026-10-01", notes="Order note " * 5)
        viewer = client_for(person("manoj", *ROLE_GROUPS["viewer"]))
        viewer.get(reverse("quick-search"), {"q": "31"})  # anything a first request sets up
        with CaptureQueriesContext(connection) as seen:
            r = viewer.get(reverse("quick-search"), {"q": "31"})
        self.assertEqual(len(r.data["invoices"]), 8)
        bills = [q["sql"] for q in seen.captured_queries if 'FROM "billing_invoice"' in q["sql"]]
        self.assertEqual(len(bills), 1, bills)
        self.assertIn("LIMIT 8", bills[0])
        self.assertEqual([column for column in ('"notes"', '"firm_snapshot"', '"place_of_supply"', '"cancel_reason"',
                                                '"address"', '"pan_number"') if column in bills[0]], [])
