"""Customers' figures and statement, and the shop settings (plan 1A, Task 9)."""

from unittest.mock import patch

from django.db import connection
from django.db.models import Model
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from billing.constants import BILL_CANCELLED
from billing.gstin import check_digit
from billing.models import AuditLog, Customer, Invoice, ShopSetting
from billing.services.bin import bin_bill
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, line, person, sale

GSTIN = "08AAKFS4821M1Z9"
GOOD_GSTIN = "08AAKFS4821M1Z" + check_digit("08AAKFS4821M1Z")
PICK_A_FIRM = ["Pick a firm from the list."]
NO_FIGURES = {"bills": 0, "total": "0.00", "cancelled": 0, "udhaar_bills": 0, "udhaar_total": "0.00", "last_bill": None}
# What a list or a statement never needs of a bill, a line or a firm (Ruling 1A-36).
WIDE = ('"notes"', '"firm_snapshot"', '"source_file"', '"transporter_name"', '"eway_bill_number"', '"place_of_supply"',
        '"product_name"', '"hsn_code"', '"bank_account_number"', '"signature_image"')


def writes(queries):
    return [q["sql"] for q in queries if q["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE"))]


class CustomerFiguresTest(TestCase):
    def setUp(self):
        self.client = client_for(person("manoj", *ROLE_GROUPS["viewer"]))
        self.kgh, self.mo = firm(), firm("MEERA ORNAMENTS", gstin="08AAAAA0000A1Z5")
        self.anil = buyer()
        self.rathore = Customer.objects.create(name="Rathore Gems", gst_number=GSTIN, state_name="RAJASTHAN")
        self.walkin = buyer("Walk-in Customer", customer_type="walkin")
        sale(self.kgh, self.anil, "1", "2026-09-10", payment_mode="credit")
        sale(self.kgh, self.anil, "2", "2026-10-02", line(rate="20000"), payment_mode="cash")
        sale(self.kgh, self.anil, "3", "2026-10-03", status=BILL_CANCELLED)
        sale(self.mo, self.anil, "1", "2026-10-04", line(rate="30000"))
        sale(self.kgh, self.rathore, "4", "2026-10-05")
        sale(self.kgh, self.walkin, "5", "2026-10-06", line(rate="99000"))

    def rows(self, **params):
        r = self.client.get(reverse("customer-list"), {"figures": "1", **params})
        self.assertEqual(r.status_code, 200, r.data)
        return r.data

    def row(self, name, **params):
        return next(c for c in self.rows(**params)["results"] if c["name"] == name)

    def names(self, **params):
        return [c["name"] for c in self.rows(**params)["results"]]

    def test_figures_in_the_firm_and_period(self):
        data = self.rows(figures_business_id=self.kgh.pk, start_date="2026-09-01", end_date="2026-10-31")
        anil = next(c for c in data["results"] if c["name"] == "Anil Gupta")
        self.assertEqual(anil["figures"], {
            "bills": 2, "total": "30900.00", "cancelled": 1, "udhaar_bills": 1, "udhaar_total": "10300.00",
            "last_bill": {"id": anil["figures"]["last_bill"]["id"], "invoice_number": "2", "invoice_date": "2026-10-02",
                          "total_amount": "20600.00", "business": self.kgh.pk}})
        self.assertEqual((anil["type"], anil["pan"], anil["total_revenue"], anil["invoice_count"]),
                         ("person", "", 61800.0, 3))  # v2's keys keep v2's meaning (all firms), minus cancelled
        self.assertEqual(data["summary"], {"customers": 3, "bills": 4, "total": "143170.00", "cancelled": 1,
                                           "udhaar_bills": 1, "udhaar_total": "10300.00"})

    def test_the_summary_covers_every_match_not_the_page(self):
        self.assertEqual(self.rows(page_size=1)["summary"]["customers"], 3)

    def test_filters_and_orders(self):
        names = lambda **p: [c["name"] for c in self.rows(**p)["results"]]  # noqa: E731
        self.assertEqual(names(has_gstin="1"), ["Rathore Gems"])
        self.assertEqual(names(type="walkin"), ["Walk-in Customer"])
        self.assertEqual(names(type="person"), ["Anil Gupta"])
        self.assertEqual(names(ordering="-sales"), ["Anil Gupta", "Rathore Gems", "Walk-in Customer"])
        self.assertEqual(names(ordering="-last_bill", figures_business_id=self.kgh.pk),
                         ["Rathore Gems", "Anil Gupta", "Walk-in Customer"])  # the walk-in record sorts last

    # ── beyond the brief ──────────────────────────────────────────────────

    def test_v2s_list_is_as_it_was_without_figures(self):
        data = self.client.get(reverse("customer-list")).data
        anil = next(c for c in data["results"] if c["name"] == "Anil Gupta")
        self.assertNotIn("summary", data)
        self.assertNotIn("figures", anil)
        self.assertEqual((anil["total_revenue"], anil["invoice_count"], anil["type"], anil["customer_type"], anil["city"]),
                         (61800.0, 3, "person", "", ""))
        self.assertEqual([c["name"] for c in data["results"]], ["Anil Gupta", "Rathore Gems", "Walk-in Customer"])

    def test_the_summary_adds_up_every_match_not_the_page(self):
        # 6.1: every matching customer's bills, whichever page is asked for (all firms and dates here).
        whole = {"customers": 3, "bills": 5, "total": "174070.00", "cancelled": 1, "udhaar_bills": 1,
                 "udhaar_total": "10300.00"}
        for page in ("1", "2", "3"):
            with self.subTest(page=page):
                self.assertEqual(self.rows(page_size=1, page=page)["summary"], whole)

    def test_a_customer_with_no_bills_in_the_scope(self):
        self.assertEqual(self.row("Rathore Gems", figures_business_id=self.mo.pk)["figures"], NO_FIGURES)

    def test_last_bill_is_the_newest_active_sale_in_the_firm_any_date(self):
        # 6.1: the figures count the period, but last_bill is the newest active sale in the firm scope whatever its
        # date. A cancelled bill is never it, and of two on one day the one made later is.
        sale(self.kgh, self.anil, "6", "2026-10-09", payment_mode="credit", status=BILL_CANCELLED)  # in no udhaar
        later = sale(self.kgh, self.rathore, "7", "2026-10-05")
        september = {"figures_business_id": self.kgh.pk, "start_date": "2026-09-01", "end_date": "2026-09-30"}
        anil = self.row("Anil Gupta", **september)["figures"]
        self.assertEqual((anil["bills"], anil["total"], anil["cancelled"], anil["udhaar_total"]), (1, "10300.00", 0, "10300.00"))
        self.assertEqual(anil["last_bill"]["invoice_number"], "2")
        rathore = self.row("Rathore Gems", **september)["figures"]
        self.assertEqual((rathore["bills"], rathore["last_bill"]["id"]), (0, later.pk))
        everywhere = self.row("Anil Gupta")["figures"]
        meera = Invoice.objects.get(business=self.mo, invoice_number="1")
        self.assertEqual(everywhere, {
            "bills": 3, "total": "61800.00", "cancelled": 2, "udhaar_bills": 1, "udhaar_total": "10300.00",
            "last_bill": {"id": meera.pk, "invoice_number": "1", "invoice_date": "2026-10-04", "total_amount": "30900.00",
                          "business": self.mo.pk}})

    def test_amounts_are_exact_to_the_paisa(self):
        # Ruling 1B-12: nothing is rounded to the rupee.
        sale(self.mo, self.rathore, "2", "2026-10-07", line(qty="1.001", rate="5"), payment_mode="credit")
        self.assertEqual(self.row("Rathore Gems", figures_business_id=self.mo.pk)["figures"]["udhaar_total"], "5.16")
        self.assertEqual(self.rows(figures_business_id=self.mo.pk)["summary"]["total"], "30905.16")

    def test_no_match_still_has_a_summary(self):
        data = self.rows(search="Nobody")
        self.assertEqual((data["count"], data["results"]), (0, []))
        self.assertEqual(data["summary"], {"customers": 0, "bills": 0, "total": "0.00", "cancelled": 0,
                                           "udhaar_bills": 0, "udhaar_total": "0.00"})

    def test_what_it_cant_read_is_a_400_in_words(self):
        # Rulings 1A-5 and 1A-28: contract 2.1's words for an id that isn't one and for every date, never a 500.
        # v2's own list (no figures) reads its dates and firm the same way now: a bad one was a 500.
        for params, field, words in (
            ({"figures": "1", "figures_business_id": "abc"}, "figures_business_id", PICK_A_FIRM),
            ({"figures": "1", "figures_business_id": "٣"}, "figures_business_id", PICK_A_FIRM),
            ({"figures": "1", "figures_business_id": "9" * 19}, "figures_business_id", PICK_A_FIRM),
            ({"figures": "1", "figures_business_id": "-1"}, "figures_business_id", PICK_A_FIRM),
            ({"business_id": "abc"}, "business_id", PICK_A_FIRM),
            ({"figures": "1", "start_date": "2026-13-01"}, "start_date", ["Type the date like 2026-09-30."]),
            ({"start_date": "abc"}, "start_date", ["Type the date like 2026-09-30."]),
            ({"figures": "1", "end_date": "1999-12-31"}, "end_date", ["Pick a date from 2000 to 2099."]),
            ({"figures": "1", "ordering": "-sales", "end_date": "2100-01-01"}, "end_date", ["Pick a date from 2000 to 2099."]),
        ):
            with self.subTest(params=params):
                r = self.client.get(reverse("customer-list"), params)
                self.assertEqual((r.status_code, r.data), (400, {field: words}))

    def test_an_id_not_on_file_matches_nothing(self):
        # Contract 2.1's model (Ruling 1A-33): an id that is one but isn't on file is a filter that matches nothing.
        data = self.rows(figures_business_id="424242")
        self.assertEqual({c["name"]: c["figures"] for c in data["results"]}["Anil Gupta"], NO_FIGURES)
        self.assertEqual((data["summary"]["customers"], data["summary"]["bills"]), (3, 0))
        self.assertEqual(self.rows(business_id="424242")["results"], [])

    def test_the_type_and_gstin_filters_read_a_gstin_as_customer_kind_does(self):
        Customer.objects.create(name="Kanak Traders", customer_type="business")  # stored: a business without a GSTIN
        Customer.objects.create(name="Lodha Bros", gst_number="URP")  # a placeholder is no GSTIN
        Customer.objects.create(name="Mehta & Sons", gst_number=f" {GSTIN} ")  # trimmed, it is one
        Customer.objects.create(name="Nahar Gems", gst_number=GSTIN, customer_type="person")  # the stored type wins
        self.assertEqual(self.names(has_gstin="1"), ["Mehta & Sons", "Nahar Gems", "Rathore Gems"])
        self.assertEqual(self.names(has_gstin="0"), ["Anil Gupta", "Kanak Traders", "Lodha Bros", "Walk-in Customer"])
        for kind, expected in (("business", ["Kanak Traders", "Mehta & Sons", "Rathore Gems"]),
                               ("person", ["Anil Gupta", "Lodha Bros", "Nahar Gems"]),
                               ("walkin", ["Walk-in Customer"])):
            with self.subTest(kind=kind):
                rows = self.rows(type=kind)["results"]
                self.assertEqual([c["name"] for c in rows], expected)
                self.assertEqual({c["type"] for c in rows}, {kind})  # each row's own type agrees

    def test_the_state_filter(self):
        buyer("Desai Gems", state="GUJARAT")
        self.assertEqual(self.names(state_name="gujarat"), ["Desai Gems"])
        self.assertEqual(self.names(state_name=" RAJASTHAN "), ["Anil Gupta", "Rathore Gems", "Walk-in Customer"])

    def test_a_null_character_is_read_past(self):
        # Ruling 1A-5: psycopg can't send one, and DRF's own search refused it in DRF's words.
        self.assertEqual(self.names(search="An\x00il"), ["Anil Gupta"])
        self.assertEqual(self.names(state_name="RAJ\x00ASTHAN", search="Rathore"), ["Rathore Gems"])
        r = self.client.get(reverse("customer-list"), {"search": "Gupta\x00"})
        self.assertEqual((r.status_code, [c["name"] for c in r.data["results"]]), (200, ["Anil Gupta"]))

    def test_the_orders_count_their_scope_and_customers_with_none_come_after(self):
        bharat, _ = buyer("Bharat Jewellers"), buyer("Aadi Traders")  # Aadi has no bills at all
        sale(self.kgh, bharat, "8", "2026-08-20", line(rate="500000"))  # before the period
        sale(self.kgh, self.rathore, "9", "2026-10-07", line(rate="100000"), status=BILL_CANCELLED)  # counts in neither
        sale(self.kgh, self.anil, "10", "2026-10-09", status=BILL_CANCELLED)
        period = {"start_date": "2026-09-01", "end_date": "2026-10-31"}
        self.assertEqual(self.names(ordering="-sales"),
                         ["Bharat Jewellers", "Anil Gupta", "Rathore Gems", "Aadi Traders", "Walk-in Customer"])
        self.assertEqual(self.names(ordering="-sales", **period),  # Bharat sold nothing in the period: by name
                         ["Anil Gupta", "Rathore Gems", "Aadi Traders", "Bharat Jewellers", "Walk-in Customer"])
        self.assertEqual(self.names(ordering="-last_bill", **period),  # any date: Bharat's August bill is its last
                         ["Rathore Gems", "Anil Gupta", "Bharat Jewellers", "Aadi Traders", "Walk-in Customer"])

    def test_the_orders_need_figures(self):
        # Contract 6.1: -last_bill and -sales need figures=1; without it the list keeps v2's order, which reads
        # through v2's cache (Ruling 1A-34: an order from bills must never come from it).
        sale(self.kgh, buyer("Bharat Jewellers"), "8", "2026-10-08", line(rate="500000"))
        self.assertEqual(self.names(ordering="-sales")[0], "Bharat Jewellers")
        for ordering in ("-sales", "-last_bill"):
            with self.subTest(ordering=ordering):
                r = self.client.get(reverse("customer-list"), {"ordering": ordering})
                self.assertEqual([c["name"] for c in r.data["results"]],
                                 ["Anil Gupta", "Bharat Jewellers", "Rathore Gems", "Walk-in Customer"])

    def test_reading_writes_nothing(self):
        # Ruling 1A-16.
        with CaptureQueriesContext(connection) as seen:
            self.rows(ordering="-sales", figures_business_id=self.kgh.pk, start_date="2026-09-01")
            self.rows(ordering="-last_bill")
        self.assertEqual(writes(seen.captured_queries), [])


class StatementTest(TestCase):
    def setUp(self):
        self.client = client_for(person("manoj", *ROLE_GROUPS["viewer"]))
        self.kgh, self.mo = firm(), firm("MEERA ORNAMENTS", gstin="08AAAAA0000A1Z5")
        self.anil = buyer(city="Udaipur")
        sale(self.kgh, self.anil, "1", "2026-09-10", payment_mode="credit")
        sale(self.kgh, self.anil, "2", "2026-10-02", payment_mode="cash")
        sale(self.kgh, self.anil, "3", "2026-10-03", status=BILL_CANCELLED, cancel_reason="Returned")
        sale(self.mo, self.anil, "1", "2026-10-04")

    def statement(self, **params):
        return self.client.get(reverse("customer-statement", args=[self.anil.pk]), params)

    def test_a_register_of_bills(self):
        data = self.statement(start_date="2026-09-01", end_date="2026-10-31", business_id=self.kgh.pk).data
        self.assertEqual([(b["invoice_number"], b["paid"]) for b in data["bills"]],
                         [("1", "udhaar"), ("2", "billing"), ("3", "cancelled")])
        self.assertEqual(data["totals"], {
            "bills": 2, "billed": "20600.00", "taxable": "20000.00", "tax": "600.00", "cancelled": 1,
            "paid_at_billing": {"bills": 1, "total": "10300.00"}, "udhaar": {"bills": 1, "total": "10300.00"},
            "not_recorded": {"bills": 0, "total": "0.00"}})
        self.assertEqual(data["months"], [{"month": "2026-09", "bills": 1, "total": "10300.00"},
                                          {"month": "2026-10", "bills": 1, "total": "10300.00"}])
        self.assertEqual((data["customer"]["city"], data["business"]), ("Udaipur", self.kgh.pk))

    def test_all_firms_and_all_time(self):
        data = self.statement().data
        self.assertEqual((len(data["bills"]), data["totals"]["bills"], data["totals"]["not_recorded"]["bills"]), (4, 3, 1))

    def test_dates_in_the_wrong_order(self):
        r = self.statement(start_date="2026-10-31", end_date="2026-09-01")
        self.assertEqual((r.status_code, r.data), (400, {"end_date": ["The start date is after the end date."]}))

    # ── beyond the brief ──────────────────────────────────────────────────

    def test_the_whole_answer(self):
        data = self.statement(start_date="2026-10-03", end_date="2026-10-03").data
        cancelled = Invoice.objects.get(business=self.kgh, invoice_number="3")
        self.assertEqual(data, {
            "customer": {"id": self.anil.pk, "name": "Anil Gupta", "type": "person", "mobile_number": "", "gst_number": "",
                         "pan": "", "city": "Udaipur", "state_name": "RAJASTHAN"},
            "start_date": "2026-10-03", "end_date": "2026-10-03", "business": None,
            "bills": [{"id": cancelled.pk, "business": self.kgh.pk, "business_name": "KIRAN GOLD HOUSE",
                       "invoice_number": "3", "invoice_date": "2026-10-03", "payment_mode": "", "taxable": "10000.00",
                       "tax": "300.00", "total_amount": "10300.00", "status": "cancelled", "cancel_reason": "Returned",
                       "paid": "cancelled", "itax": []}],
            "totals": {"bills": 0, "billed": "0.00", "taxable": "0.00", "tax": "0.00", "cancelled": 1,
                       "paid_at_billing": {"bills": 0, "total": "0.00"}, "udhaar": {"bills": 0, "total": "0.00"},
                       "not_recorded": {"bills": 0, "total": "0.00"}},
            "months": [],
        })

    def test_how_each_bill_was_paid(self):
        # 6.3: billing is cash, UPI or both at the counter; udhaar is credit; not recorded is blank, or anything else
        # an older bill holds.
        for number, mode in (("10", "bank"), ("11", "mixed"), ("12", "credit"), ("13", ""), ("14", "upi")):
            sale(self.kgh, self.anil, number, "2026-11-02", payment_mode=mode)
        bills = self.statement(start_date="2026-11-01").data["bills"]
        self.assertEqual([(b["payment_mode"], b["paid"]) for b in bills],
                         [("bank", "billing"), ("mixed", "billing"), ("credit", "udhaar"), ("", "not_recorded"),
                          ("upi", "not_recorded")])

    def test_a_business_customer(self):
        rathore = Customer.objects.create(name="Rathore Gems", gst_number=GOOD_GSTIN, mobile_number="9829041122",
                                          city="Jaipur", address="5 Johari Bazaar", state_name="RAJASTHAN")
        r = self.client.get(reverse("customer-statement", args=[rathore.pk]))
        self.assertEqual((r.status_code, r.data["bills"]), (200, []))
        self.assertEqual(r.data["customer"], {"id": rathore.pk, "name": "Rathore Gems", "type": "business",
                                              "mobile_number": "9829041122", "gst_number": GOOD_GSTIN,
                                              "pan": GOOD_GSTIN[2:12], "city": "Jaipur", "state_name": "RAJASTHAN"})

    def test_itax_flags_are_the_contracts_objects(self):
        # Ruling 1A-2: each bill's itax is the bill page's list of ItaxFlags, not their kinds; none on a cancelled bill.
        big = sale(self.kgh, self.anil, "4", "2026-10-05", line(rate="200000"), payment_mode="cash")
        sale(self.kgh, self.anil, "5", "2026-10-06", line(rate="200000"), payment_mode="cash", status=BILL_CANCELLED)
        bills = self.statement(start_date="2026-10-05").data["bills"]
        page = self.client.get(reverse("sale-detail", args=[big.pk])).data
        self.assertEqual([f["kind"] for f in bills[0]["itax"]], ["cash_limit", "pan"])
        self.assertEqual(bills[0]["itax"], page["itax"])
        self.assertEqual(bills[0]["itax"][0], {
            "kind": "cash_limit", "short": "Cash ≥ ₹2 lakh",
            "text": "₹2,06,000.00 taken in cash is at or over the ₹2,00,000 limit for one bill (Income Tax Sec 269ST)."})
        self.assertEqual(bills[1]["itax"], [])

    def test_the_statement_and_the_bill_page_agree_to_the_paisa(self):
        # Rulings 1A-11 and 1B-12: a bill's taxable value is each line's to the paisa (two lines of 1.001 × ₹5 are
        # ₹5.01 each), its tax the stored heads, and its total exact: as its page and the bills list send them.
        bill = sale(self.kgh, self.anil, "6", "2026-10-07", line(qty="1.001", rate="5"), line(qty="1.001", rate="5"),
                    payment_mode="bank")
        data = self.statement(start_date="2026-10-07").data
        page = self.client.get(reverse("sale-detail", args=[bill.pk])).data
        row = data["bills"][0]
        self.assertEqual((row["taxable"], row["tax"], row["total_amount"]), ("10.02", "0.30", "10.32"))
        self.assertEqual((row["taxable"], row["tax"], row["total_amount"]),
                         (page["taxable"], page["tax"], page["total_amount"]))
        self.assertEqual((data["totals"]["billed"], data["totals"]["taxable"], data["totals"]["tax"],
                          data["totals"]["paid_at_billing"], data["months"]),
                         ("10.32", "10.02", "0.30", {"bills": 1, "total": "10.32"},
                          [{"month": "2026-10", "bills": 1, "total": "10.32"}]))

    def test_sales_only_and_never_a_deleted_bill(self):
        sale(self.kgh, self.anil, "P-1", "2026-10-07", kind="inward")  # a purchase from the same party
        bin_bill(sale(self.kgh, self.anil, "7", "2026-10-08"), None, "Entered twice")
        self.assertEqual([b["invoice_number"] for b in self.statement().data["bills"]], ["1", "2", "3", "1"])

    def test_a_customer_not_on_file(self):
        for pk in ("424242", "abc", "9" * 30):
            with self.subTest(pk=pk):
                r = self.client.get(f"/api/customers/{pk}/statement/")
                self.assertEqual((r.status_code, r.data), (404, {"detail": "No Customer matches the given query."}))

    def test_what_it_cant_read_is_a_400_in_words(self):
        for params, field, words in (
            ({"business_id": "abc"}, "business_id", PICK_A_FIRM),
            ({"business_id": "9" * 19}, "business_id", PICK_A_FIRM),
            ({"start_date": "2026-13-01"}, "start_date", ["Type the date like 2026-09-30."]),
            ({"end_date": "2100-01-01"}, "end_date", ["Pick a date from 2000 to 2099."]),
        ):
            with self.subTest(params=params):
                r = self.statement(**params)
                self.assertEqual((r.status_code, r.data), (400, {field: words}))

    def test_a_firm_not_on_file_has_no_bills(self):
        data = self.statement(business_id="424242").data
        self.assertEqual((data["business"], data["bills"], data["totals"]["bills"]), (424242, [], 0))

    def test_everyone_with_view_reads_it(self):
        for role in ("owner", "accountant", "staff"):
            with self.subTest(role=role):
                self.assertEqual(client_for(person(role, *ROLE_GROUPS[role])).get(
                    reverse("customer-statement", args=[self.anil.pk])).status_code, 200)
        self.assertEqual(client_for(None).get(reverse("customer-statement", args=[self.anil.pk])).status_code, 401)

    def test_reading_writes_nothing(self):
        with CaptureQueriesContext(connection) as seen:
            self.assertEqual(self.statement(business_id=self.kgh.pk).status_code, 200)
        self.assertEqual(writes(seen.captured_queries), [])


class ReadsTest(TestCase):
    """The list's figures and the statement ask the database a fixed number of times, however many customers and
    bills (Neon's compute budget), and fetch only the columns their sums use (Ruling 1A-36)."""

    @classmethod
    def setUpTestData(cls):
        cls.viewer = person("manoj", *ROLE_GROUPS["viewer"])
        cls.kgh, cls.mo = firm(), firm("MEERA ORNAMENTS", gstin="08AAAAA0000A1Z5")
        cls.walkin = buyer("Walk-in Customer", customer_type="walkin")
        for n in range(1, 61):
            gstin = f"08AAKFS{n:04d}M1ZZ" if n % 4 == 0 else None
            customer = buyer(f"Buyer {n:02d}", gst_number=gstin, mobile_number=f"98290{n:05d}")
            customer.businesses.add(cls.kgh)
            for k in range(n % 3 + 1):
                sale((cls.kgh, cls.mo)[k % 2], customer, f"{n}-{k}", f"2026-{9 + k % 2:02d}-{10 + k:02d}",
                     line(), line(rate="500", hsn=""), payment_mode=("cash", "credit", "")[(n + k) % 3],
                     status=BILL_CANCELLED if (n + k) % 7 == 0 else "active", notes="Order note " * 3)
            sale(cls.kgh, cls.walkin, f"W{n}", "2026-09-15", payment_mode="cash")

    def setUp(self):
        self.client = client_for(self.viewer)

    def asked(self, url, **params):
        with CaptureQueriesContext(connection) as seen:
            r = self.client.get(url, params)
        self.assertEqual(r.status_code, 200, r.data)
        return seen.captured_queries, r.data

    def test_a_page_of_5_or_of_50(self):
        url = reverse("customer-list")
        self.asked(url, figures="1", page_size="1")  # anything a first request sets up
        for params in ({}, {"ordering": "-last_bill"}, {"ordering": "-sales", "figures_business_id": self.kgh.pk},
                       {"has_gstin": "0", "type": "person", "business_id": self.kgh.pk, "start_date": "2026-09-01"}):
            with self.subTest(params=params):
                five, rows5 = self.asked(url, figures="1", page_size="5", **params)
                fifty, rows50 = self.asked(url, figures="1", page_size="50", **params)
                self.assertEqual(len(rows5["results"]), 5)
                self.assertGreater(len(rows50["results"]), 40)
                self.assertEqual(len(fifty), len(five))
                self.assertLessEqual(len(fifty), 7)

    def test_a_statement_of_one_bill_or_sixty(self):
        one = Customer.objects.get(name="Buyer 03")  # one bill
        self.asked(reverse("customer-statement", args=[one.pk]))  # anything a first request sets up
        few, data = self.asked(reverse("customer-statement", args=[one.pk]))
        many, busy = self.asked(reverse("customer-statement", args=[self.walkin.pk]))
        self.assertEqual((len(data["bills"]), len(busy["bills"])), (1, 60))
        self.assertEqual(len(many), len(few))
        self.assertLessEqual(len(many), 3)

    def test_the_reads_fetch_only_the_columns_they_use(self):
        # The page itself (a LIMIT) reads whole customers for v2's keys; nothing reads a bill's, line's or firm's
        # wide columns, and the figures don't read a cancel reason either.
        list_queries, _ = self.asked(reverse("customer-list"), figures="1", page_size="50", ordering="-last_bill")
        statement_queries, _ = self.asked(reverse("customer-statement", args=[self.walkin.pk]))
        wide = [q["sql"][:150] for q in list_queries if any(c in q["sql"] for c in (*WIDE, '"cancel_reason"'))]
        wide += [q["sql"][:150] for q in statement_queries if any(c in q["sql"] for c in WIDE)]
        self.assertEqual(wide, [])

    def test_the_narrowed_reads_never_load_a_column_later(self):
        loads = []
        refresh = Model.refresh_from_db

        def recorded(instance, *args, **kwargs):
            loads.append((type(instance).__name__, kwargs.get("fields")))
            return refresh(instance, *args, **kwargs)

        sale(self.kgh, self.walkin, "W-big", "2026-09-16", line(rate="300000"), payment_mode="cash")  # itax flags
        with patch.object(Model, "refresh_from_db", recorded):
            self.asked(reverse("customer-list"), figures="1", page_size="50", ordering="-sales")
            self.asked(reverse("customer-statement", args=[self.walkin.pk]))
            self.asked(reverse("customer-statement", args=[Customer.objects.get(name="Buyer 04").pk]))
        self.assertEqual(loads, [])


class ShopSettingsTest(TestCase):
    def setUp(self):
        self.owner = person("kailash", *ROLE_GROUPS["owner"], first_name="Kailash", last_name="Mehta")

    def test_everyone_reads_the_defaults_and_reading_writes_nothing(self):
        r = client_for(person("manoj", *ROLE_GROUPS["viewer"])).get(reverse("shop-settings"))
        self.assertEqual(r.data, {
            "copies": "original", "show_bank": True,
            "share_message": "Namaste {customer}, your bill {number} for {total} from {firm} is attached. Thank you!",
            "updated_at": None, "updated_by": None})
        self.assertFalse(ShopSetting.objects.exists())

    def test_the_owner_makes_them_the_default(self):
        r = client_for(self.owner).put(reverse("shop-settings"), {"copies": "all", "show_bank": False}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual((r.data["copies"], r.data["show_bank"], r.data["updated_by"]),
                         ("all", False, {"id": self.owner.pk, "name": "Kailash Mehta"}))
        self.assertEqual(AuditLog.objects.get(entity="settings").details, "Changed copies, show_bank")

    def test_refusals(self):
        staff = client_for(person("rakesh", *ROLE_GROUPS["staff"]))
        r = staff.put(reverse("shop-settings"), {"copies": "all"}, format="json")
        self.assertEqual((r.status_code, r.data["needs"]), (403, "settings.edit"))
        r = client_for(self.owner).put(reverse("shop-settings"), {"copies": "four", "share_message": "x" * 501},
                                       format="json")
        self.assertEqual(r.data, {"copies": ["Choose Original, Duplicate, Triplicate or All three."],
                                  "share_message": ["Keep the message to 500 characters."]})

    # ── beyond the brief ──────────────────────────────────────────────────

    def test_what_a_save_answers_is_what_everyone_reads(self):
        owner = client_for(self.owner)
        saved = owner.put(reverse("shop-settings"), {"share_message": "  Your bill {number} is attached.  "},
                          format="json").data
        read = client_for(person("manoj", *ROLE_GROUPS["viewer"])).get(reverse("shop-settings")).data
        self.assertEqual(saved, read)
        self.assertEqual((read["copies"], read["show_bank"], read["share_message"]),
                         ("original", True, "Your bill {number} is attached."))
        self.assertRegex(read["updated_at"], r"^2\d{3}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+\+05:30$")
        self.assertEqual(ShopSetting.objects.get().pk, 1)

    def test_each_change_is_logged_once_and_a_save_of_the_same_is_not(self):
        owner = client_for(self.owner)
        self.assertEqual(owner.put(reverse("shop-settings"), {"copies": "original"}, format="json").status_code, 200)
        self.assertFalse(AuditLog.objects.filter(entity="settings").exists())
        owner.put(reverse("shop-settings"), {"copies": "original", "share_message": "Your bill {number}."}, format="json")
        entry = AuditLog.objects.get(entity="settings")
        self.assertEqual((entry.action, entry.entity_id, entry.entity_name, entry.user, entry.details),
                         ("updated", 1, "Shop settings", self.owner, "Changed share_message"))

    def test_refusals_are_in_the_apps_words(self):
        # Ruling 1A-5: never DRF's own words, and nothing saved.
        copies, bank = ["Choose Original, Duplicate, Triplicate or All three."], ["Choose whether bills show the bank details."]
        message = ["Write a message, or put back the standard one."]
        owner = client_for(self.owner)
        for body, errors in (
            ({"copies": None}, {"copies": copies}),
            ({"copies": ["all"]}, {"copies": copies}),
            ({"copies": ""}, {"copies": copies}),
            ({"show_bank": "maybe"}, {"show_bank": bank}),
            ({"show_bank": None}, {"show_bank": bank}),
            ({"share_message": ""}, {"share_message": message}),
            ({"share_message": "   "}, {"share_message": message}),
            ({"share_message": None}, {"share_message": message}),
            ({"share_message": {"text": "Hi"}}, {"share_message": message}),
            ({"share_message": "Hi\x00there"}, {"share_message": message}),
            ({"share_message": " " * 600}, {"share_message": message}),
            ([1, 2], {"copies": copies, "show_bank": bank, "share_message": message}),
            ("copies", {"copies": copies, "show_bank": bank, "share_message": message}),
        ):
            with self.subTest(body=body):
                r = owner.put(reverse("shop-settings"), body, format="json")
                self.assertEqual((r.status_code, r.data), (400, errors))
        self.assertFalse(ShopSetting.objects.exists())
        self.assertFalse(AuditLog.objects.filter(entity="settings").exists())

    def test_only_the_owner_changes_them(self):
        for role in ("accountant", "staff", "viewer"):
            with self.subTest(role=role):
                r = client_for(person(role, *ROLE_GROUPS[role])).put(reverse("shop-settings"), {"copies": "all"},
                                                                      format="json")
                self.assertEqual((r.status_code, r.data["needs"]), (403, "settings.edit"))
        self.assertEqual(client_for(None).get(reverse("shop-settings")).status_code, 401)
        self.assertFalse(ShopSetting.objects.exists())

    def test_a_user_v2_deleted_reads_as_nobody(self):
        # Ruling 1A-6: no database constraint ties updated_by to a user (v2 may delete one after a rollback).
        client_for(self.owner).put(reverse("shop-settings"), {"copies": "all"}, format="json")
        ShopSetting.objects.filter(pk=1).update(updated_by_id=424242)
        r = client_for(person("manoj", *ROLE_GROUPS["viewer"])).get(reverse("shop-settings"))
        self.assertEqual((r.status_code, r.data["copies"], r.data["updated_by"]), (200, "all", None))
        ShopSetting.objects.filter(pk=1).update(updated_by=self.owner)
        self.owner.delete()
        self.assertIsNone(ShopSetting.load().updated_by)
