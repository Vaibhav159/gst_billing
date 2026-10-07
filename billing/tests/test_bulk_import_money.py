"""Bulk import's money contract: what a sheet row books (H9, H10, M11, C1b).

Backup restore posts to the same endpoint, so whatever this import gets
wrong, a restore gets wrong too.
"""

from decimal import Decimal as D

from django.urls import reverse

from billing.models import Business, Customer, Invoice
from billing.tests.test_base import BaseAPITestCase


class BulkImportMoneyCase(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.biz = Business.objects.create(name="LODHA JEWELLERS", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN")
        self.buyer = Customer.objects.create(name="LOCAL BUYER", state_name="RAJASTHAN")
        self.buyer.businesses.add(self.biz)

    def _import(self, *rows):
        r = self.client.post(reverse("bulk-invoice-import"), {"business_id": self.biz.id, "invoices": list(rows)}, format="json")
        self.assertEqual(r.status_code, 201, getattr(r, "data", None))
        return r.data

    def _row(self, number, item, kind="OUTWARD", customer="LOCAL BUYER", gst="", date="2026-05-10"):
        return {"invoiceNumber": number, "invoice_date": date, "customerName": customer, "customerGST": gst,
                "type": kind, "total": item.get("amount", 0), "items": [item]}

    def _line(self, number):
        return Invoice.objects.get(invoice_number=number, business=self.biz).lineitem_set.get()


class TaxableValueTest(BulkImportMoneyCase):
    """H9: a register with no Qty/Rate columns came in as 60,000 x 900."""

    def test_a_row_with_only_its_taxable_value_is_one_unit_at_that_value(self):
        self._import(self._row("T-1", {"productName": "Gold", "hsn": "711319", "gstRate": 3, "qty": 0, "rate": 0,
                                       "taxable": 60000, "cgst": 900, "sgst": 900, "igst": 0, "amount": 61800}))
        li = self._line("T-1")
        self.assertEqual((li.quantity, li.rate, li.cgst, li.sgst, li.amount),
                         (D("1"), D("60000"), D("900"), D("900"), D("61800")))

    def test_a_weighed_row_without_a_rate_keeps_its_weight(self):
        # Review of H8: stored as 1 x 60,000, GSTR-1's Table 12 said 1 GMS.
        self._import(self._row("T-5", {"productName": "Gold", "hsn": "711319", "gstRate": 3, "qty": 10.5, "rate": 0,
                                       "taxable": 60000, "cgst": 900, "sgst": 900, "igst": 0, "amount": 61800}))
        li = self._line("T-5")
        self.assertEqual((li.quantity, li.rate, li.amount), (D("10.5"), D("5714.286"), D("61800")))

    def test_quantity_times_rate_far_from_the_taxable_value_is_refused(self):
        data = self._import(self._row("T-2", {"productName": "Gold", "hsn": "711319", "gstRate": 3, "qty": 60000,
                                              "rate": 900, "taxable": 60000, "cgst": 900, "sgst": 900, "igst": 0,
                                              "amount": 61800}))
        self.assertFalse(Invoice.objects.filter(invoice_number="T-2").exists())
        self.assertTrue(any("taxable value" in e for e in data["errors"]), data["errors"])

    def test_quantity_times_rate_far_from_the_amount_is_refused(self):
        # A sender that doesn't say the taxable value (an older Excel import, a backup).
        data = self._import(self._row("T-3", {"productName": "Gold", "hsn": "711319", "gstRate": 3, "qty": 60000,
                                              "rate": 900, "cgst": 900, "sgst": 900, "igst": 0, "amount": 61800}))
        self.assertFalse(Invoice.objects.filter(invoice_number="T-3").exists())
        self.assertTrue(any("amount" in e for e in data["errors"]), data["errors"])

    def test_a_consistent_row_still_imports(self):
        self._import(self._row("T-4", {"productName": "Gold", "hsn": "711319", "gstRate": 3, "qty": 10, "rate": 6000,
                                       "taxable": 60000, "cgst": 900, "sgst": 900, "igst": 0, "amount": 61800}))
        li = self._line("T-4")
        self.assertEqual((li.quantity, li.rate, li.amount), (D("10"), D("6000"), D("61800")))


class FileHeadsTest(BulkImportMoneyCase):
    """H10: the server normalised the rate to 3% but kept the file's heads, so
    the line said 3% while carrying Rs 18 of tax on Rs 60,000.

    Review: H10 then recomputed such heads from the rate. With the rate wrong
    and the tax right, that booked tax the bill never charged (on a purchase,
    ITC on neither the bill nor 2B), and a gross-only row was taxed again on
    top of its gross. Heads that aren't the rate are refused instead."""

    def test_heads_that_are_not_the_rate_are_refused(self):
        data = self._import(self._row("H-1", {"productName": "Gold", "hsn": "711319", "gstRate": 3, "qty": 10,
                                              "rate": 6000, "taxable": 60000, "cgst": 9, "sgst": 9, "igst": 0,
                                              "amount": 60018}))
        self.assertFalse(Invoice.objects.filter(invoice_number="H-1").exists())
        self.assertTrue(any("H-1" in e and "1800" in e for e in data["errors"]), data["errors"])

    def test_a_wrong_rate_does_not_rewrite_the_files_tax(self):
        data = self._import(self._row("H-3", {"productName": "Gold", "hsn": "711319", "gstRate": 18, "qty": 10,
                                              "rate": 6000, "taxable": 60000, "cgst": 900, "sgst": 900, "igst": 0,
                                              "amount": 61800}, kind="INWARD", customer="SUPPLIER",
                                       gst="08AAECD1234K1Z2"))
        self.assertFalse(Invoice.objects.filter(invoice_number="H-3").exists())
        self.assertTrue(any("H-3" in e and "18%" in e for e in data["errors"]), data["errors"])

    def test_a_gross_only_row_with_heads_off_its_rate_is_refused_not_taxed_again(self):
        # It was stored as 1 x 10,282 with 308.46 of tax: an amount of 10,590.46.
        data = self._import(self._row("H-4", {"productName": "Gold", "hsn": "711319", "gstRate": 3,
                                              "cgst": 9, "sgst": 9, "igst": 0, "amount": 10300}))
        self.assertFalse(Invoice.objects.filter(invoice_number="H-4").exists())
        self.assertTrue(any("H-4" in e for e in data["errors"]), data["errors"])

    def test_heads_within_a_rupee_of_the_rate_are_kept(self):
        self._import(self._row("H-2", {"productName": "Gold", "hsn": "711319", "gstRate": 3, "qty": 1, "rate": 549.67,
                                       "taxable": 549.67, "cgst": 8.25, "sgst": 8.24, "igst": 0, "amount": 566.16}))
        li = self._line("H-2")
        self.assertEqual((li.cgst, li.sgst, li.amount), (D("8.25"), D("8.24"), D("566.16")))


class OneBadRowTest(BulkImportMoneyCase):
    """M11: a row reusing an outward number already used earlier in the FY
    (another date, so the duplicate check let it by) failed bulk_create; the
    per-row fallback save had no savepoint, and on Postgres that first
    IntegrityError aborted the whole transaction: a 500, nothing imported.
    Backup restore sends 100 invoices per request, so one bad row lost the
    chunk. SQLite doesn't abort, which is how the tests missed it."""

    def test_a_number_already_used_in_the_fy_is_one_row_error(self):
        Invoice.objects.create(business=self.biz, customer=self.buyer, invoice_number="101",
                               invoice_date="2026-05-01", type_of_invoice="outward")
        item = {"productName": "Gold", "hsn": "711319", "gstRate": 3, "qty": 1, "rate": 10000,
                "cgst": 150, "sgst": 150, "igst": 0, "amount": 10300}
        data = self._import(self._row("101", item, date="2026-05-15"), self._row("102", item, date="2026-05-15"))
        self.assertTrue(Invoice.objects.filter(invoice_number="102").exists())
        self.assertEqual(Invoice.objects.filter(invoice_number="101").count(), 1)
        self.assertTrue(any("101" in e for e in data["errors"]), data["errors"])
        self.assertEqual(data["created"], 1)

    def test_a_row_the_database_refuses_costs_only_that_row(self):
        # Postgres refuses a total over numeric(12,3); SQLite stores it, so this
        # proves nothing there. The bulk insert fails and each row is retried.
        item = {"productName": "Gold", "hsn": "711319", "gstRate": 3, "qty": 1, "rate": 10000,
                "cgst": 150, "sgst": 150, "igst": 0, "amount": 10300}
        huge = self._row("201", item)
        huge["total"] = 10 ** 12
        data = self._import(huge, self._row("202", item))
        self.assertTrue(Invoice.objects.filter(invoice_number="202").exists(), data)


class NoGstinNoItcTest(BulkImportMoneyCase):
    """C1b at the last door: bulk import (and so Backup restore) still booked
    input tax on a purchase from a supplier with no GSTIN."""

    def setUp(self):
        super().setUp()
        from billing.models import Product

        Product.objects.create(name="Old gold", hsn_code="711319", gst_tax_rate=D("0"))

    def test_a_taxed_purchase_without_a_supplier_gstin_is_refused(self):
        data = self._import(self._row("NG-1", {"productName": "Gold bar", "hsn": "710813", "gstRate": 3, "qty": 1,
                                               "rate": 10000, "cgst": 150, "sgst": 150, "igst": 0, "amount": 10300},
                                      kind="INWARD", customer="WALK-IN SELLER", gst="URP"))
        self.assertFalse(Invoice.objects.filter(invoice_number="NG-1").exists())
        self.assertTrue(any("NG-1" in e and "no GSTIN" in e for e in data["errors"]), data["errors"])

    def test_an_untaxed_purchase_from_them_imports(self):
        self._import(self._row("NG-2", {"productName": "Old gold", "hsn": "711319", "gstRate": 0, "qty": 1,
                                        "rate": 10000, "amount": 10000}, kind="INWARD", customer="WALK-IN SELLER"))
        li = self._line("NG-2")
        self.assertEqual((li.cgst, li.sgst, li.igst, li.amount), (D("0"), D("0"), D("0"), D("10000")))

    def test_a_supplier_with_a_gstin_on_file_may_carry_tax(self):
        Customer.objects.create(name="SJ GOLD", gst_number="08AAECD1234K1Z2", state_name="RAJASTHAN")
        self._import(self._row("NG-3", {"productName": "Gold bar", "hsn": "710813", "gstRate": 3, "qty": 1,
                                        "rate": 10000, "cgst": 150, "sgst": 150, "igst": 0, "amount": 10300},
                               kind="INWARD", customer="SJ GOLD"))
        self.assertEqual(self._line("NG-3").cgst, D("150"))


class RefusedLineTest(BulkImportMoneyCase):
    """Review of H9: a refused line was skipped after its invoice had been
    written, so a two-line invoice was stored with one line and counted as
    created, and re-importing the corrected sheet was then skipped as a
    duplicate: the missing line could never come in."""

    GOOD = {"productName": "Gold", "hsn": "711319", "gstRate": 3, "qty": 10, "rate": 6000, "taxable": 60000,
            "cgst": 900, "sgst": 900, "igst": 0, "amount": 61800}
    BAD = {**GOOD, "productName": "Silver", "qty": 11}  # 11 x 6,000 is not its 60,000 of taxable

    def _two_lines(self, number, second):
        row = self._row(number, self.GOOD)
        row["items"] = [self.GOOD, second]
        row["total"] = 123600
        return row

    def test_one_refused_line_refuses_its_whole_invoice(self):
        data = self._import(self._two_lines("R-1", self.BAD))
        self.assertEqual((data["created"], data["skipped"]), (0, 1), data)
        self.assertFalse(Invoice.objects.filter(invoice_number="R-1").exists())
        self.assertTrue(any("R-1" in e and "Silver" in e for e in data["errors"]), data["errors"])

    def test_the_corrected_sheet_then_comes_in_whole(self):
        self._import(self._two_lines("R-2", self.BAD))
        data = self._import(self._two_lines("R-2", self.GOOD | {"productName": "Silver"}))
        self.assertEqual(data["created"], 1, data)
        inv = Invoice.objects.get(invoice_number="R-2")
        self.assertEqual((inv.lineitem_set.count(), inv.total_amount), (2, D("123600")))


class ExplicitZeroRateTest(BulkImportMoneyCase):
    """Review of M19: bulk import (and so Backup restore) still read a 0% line
    as "no rate" and took the product master's. A URP purchase at 0% with no
    tax was refused by C1b ("set the line to 0%": it was), and a restored 0%
    sale of a 3% product failed its money checks. Only a missing rate is
    missing."""

    def setUp(self):
        super().setUp()
        from billing.models import Product

        Product.objects.create(name="Gold", hsn_code="711319", gst_tax_rate=D("0.03"))

    def test_a_zero_rated_purchase_from_a_seller_without_a_gstin_imports(self):
        data = self._import(self._row("Z-1", {"productName": "Gold", "hsn": "711319", "gstRate": 0, "qty": 1,
                                              "rate": 10000, "cgst": 0, "sgst": 0, "igst": 0, "amount": 10000},
                                      kind="INWARD", customer="WALK-IN SELLER", gst="URP"))
        self.assertEqual(data["created"], 1, data)
        self.assertEqual(self._line("Z-1").gst_tax_rate, D("0"))

    def test_a_zero_rated_sale_of_a_three_percent_product_stays_zero(self):
        for i, rate in enumerate((0, "0", "0.0000")):
            with self.subTest(rate=rate):
                number = f"Z-2-{i}"
                data = self._import(self._row(number, {"productName": "Gold", "hsn": "711319", "gstRate": rate,
                                                       "qty": 1, "rate": 10000, "amount": 10000}))
                self.assertEqual(data["created"], 1, data)
                li = self._line(number)
                self.assertEqual((li.gst_tax_rate, li.cgst + li.sgst + li.igst, li.amount), (D("0"), D("0"), D("10000")))

    def test_a_missing_rate_still_comes_from_the_product(self):
        self._import(self._row("Z-3", {"productName": "Gold", "hsn": "711319", "gstRate": None, "qty": 1,
                                       "rate": 10000}))
        li = self._line("Z-3")
        self.assertEqual((li.gst_tax_rate, li.cgst, li.sgst), (D("0.03"), D("150"), D("150")))


class UnreadableNumberTest(BulkImportMoneyCase):
    """Review of M11: a line value that isn't a number raised in the import's
    write phase, a 500 that lost the good rows too. It is now one row's
    error, saying which value; a rate written "3%" is read as 3%."""

    GOOD = {"productName": "Gold", "hsn": "711319", "gstRate": 3, "qty": 1, "rate": 10000}

    def test_a_value_that_isnt_a_number_is_its_rows_error_and_says_which(self):
        data = self._import(self._row("N-1", self.GOOD | {"qty": "ten"}), self._row("N-2", self.GOOD))
        self.assertEqual((data["created"], data["skipped"]), (1, 1), data)
        self.assertTrue(any("N-1" in e and "qty" in e and "'ten'" in e for e in data["errors"]), data["errors"])

    def test_a_rate_written_with_a_percent_sign_is_read(self):
        self._import(self._row("N-3", self.GOOD | {"gstRate": "3%"}))
        self.assertEqual(self._line("N-3").gst_tax_rate, D("0.03"))


class AmountTest(BulkImportMoneyCase):
    """Review of H9: with a taxable value given, a line's amount was stored as
    the file had it, whatever it was: the invoice total then disagreed with
    the taxable value and tax the returns file. A line's amount is its taxable
    value plus its tax, within a rupee."""

    LINE = {"productName": "Gold", "hsn": "711319", "gstRate": 3, "qty": 10, "rate": 6000, "taxable": 60000,
            "cgst": 900, "sgst": 900, "igst": 0}

    def test_an_amount_that_isnt_taxable_plus_tax_is_refused(self):
        data = self._import(self._row("AM-1", self.LINE | {"amount": 65000}))
        self.assertFalse(Invoice.objects.filter(invoice_number="AM-1").exists())
        self.assertTrue(any("AM-1" in e and "61800" in e for e in data["errors"]), data["errors"])

    def test_an_amount_within_a_rupee_is_kept(self):
        self._import(self._row("AM-2", self.LINE | {"amount": 61800.40}))
        self.assertEqual(self._line("AM-2").amount, D("61800.40"))


class PartyGstinTest(BulkImportMoneyCase):
    """Review of C1b: C1b passed on the row's GSTIN, but the bill was booked on
    the party matched by name, whose GSTIN on file stayed empty (the inward
    form and AI import keep the bill's), or was another one (review of M26)."""

    PURCHASE = {"productName": "Gold bar", "hsn": "710813", "gstRate": 3, "qty": 1, "rate": 10000,
                "cgst": 150, "sgst": 150, "igst": 0, "amount": 10300}

    def test_the_rows_gstin_is_kept_on_a_party_that_had_none(self):
        karigar = Customer.objects.create(name="KARIGAR", state_name="RAJASTHAN")
        self._import(self._row("PG-1", self.PURCHASE, kind="INWARD", customer="KARIGAR", gst="08AAECD1234K1Z2"))
        karigar.refresh_from_db()
        self.assertEqual(karigar.gst_number, "08AAECD1234K1Z2")
        self.assertEqual(Invoice.objects.get(invoice_number="PG-1").customer_id, karigar.id)

    def test_the_rows_gstin_decides_the_head(self):
        # Nothing on file says where KARIGAR is; the bill's 27... GSTIN does.
        Customer.objects.create(name="KARIGAR", state_name="")
        self._import(self._row("PG-3", self.PURCHASE, kind="INWARD", customer="KARIGAR", gst="27ABCDE1234A1Z5"))
        li = self._line("PG-3")
        self.assertEqual((li.cgst, li.sgst, li.igst), (D("0"), D("0"), D("300")))

    def test_a_refused_row_leaves_the_party_as_it_was(self):
        karigar = Customer.objects.create(name="KARIGAR", state_name="RAJASTHAN")
        self._import(self._row("PG-4", self.PURCHASE | {"amount": 99999}, kind="INWARD", customer="KARIGAR",
                               gst="08AAECD1234K1Z2"))
        karigar.refresh_from_db()
        self.assertFalse(karigar.gst_number)

    def test_a_party_on_file_under_another_gstin_refuses_the_row(self):
        for kind in ("INWARD", "OUTWARD"):
            with self.subTest(kind=kind):
                Customer.objects.get_or_create(name="BRANCH GOLD", defaults={"gst_number": "08AAAAA0000A1Z5"})
                number = f"PG-2-{kind}"
                data = self._import(self._row(number, self.PURCHASE, kind=kind, customer="BRANCH GOLD",
                                              gst="08AAECD1234K1Z2"))
                self.assertFalse(Invoice.objects.filter(invoice_number=number).exists())
                self.assertTrue(any(number in e and "08AAAAA0000A1Z5" in e for e in data["errors"]), data["errors"])
        self.assertEqual(Customer.objects.get(name="BRANCH GOLD").gst_number, "08AAAAA0000A1Z5")
