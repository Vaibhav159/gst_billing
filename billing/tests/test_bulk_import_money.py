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
    the line said 3% while carrying Rs 18 of tax on Rs 60,000."""

    def test_heads_that_are_not_the_rate_are_recomputed_and_said_so(self):
        data = self._import(self._row("H-1", {"productName": "Gold", "hsn": "711319", "gstRate": 3, "qty": 10,
                                              "rate": 6000, "taxable": 60000, "cgst": 9, "sgst": 9, "igst": 0,
                                              "amount": 60018}))
        li = self._line("H-1")
        self.assertEqual((li.gst_tax_rate, li.cgst, li.sgst, li.igst, li.amount),
                         (D("0.03"), D("900"), D("900"), D("0"), D("61800")))
        self.assertTrue(any("H-1" in e and "1800" in e for e in data["errors"]), data["errors"])

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
