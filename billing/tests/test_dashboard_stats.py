"""Regression tests for /api/invoices/stats/ (the dashboard headline figures).

The endpoint mixes invoice-level sums with line-item tax sums. Doing that in a
single .aggregate() joins billing_lineitem and multiplies invoice rows, so a
multi-line invoice gets counted once per line. Every assertion here is written
against an invoice with TWO line items — with one line item the bug is
invisible, which is how it survived.
"""

from decimal import Decimal as D

from django.urls import reverse

from billing.constants import INVOICE_TYPE_INWARD, INVOICE_TYPE_OUTWARD
from billing.models import Invoice, LineItem
from billing.tests.test_base import BaseAPITestCase


class DashboardStatsTest(BaseAPITestCase):
    def _invoice(self, number, inv_type, lines):
        """lines: list of (qty, rate, gst_rate) — intra-state, so CGST+SGST."""
        inv = Invoice.objects.create(
            workspace_id=1, business=self.business, customer=self.customer,
            invoice_number=number, invoice_date="2026-05-01",
            type_of_invoice=inv_type, total_amount=0,
        )
        for qty, rate, gst in lines:
            taxable = D(str(qty)) * D(str(rate))
            tax = taxable * D(str(gst))
            LineItem.objects.create(
                workspace_id=1, customer=self.customer, invoice=inv,
                product_name="Item", hsn_code="711319", gst_tax_rate=D(str(gst)),
                quantity=D(str(qty)), rate=D(str(rate)),
                cgst=tax / 2, sgst=tax / 2, igst=D("0"),
                amount=taxable + tax, unit="gms",
            )
        inv.refresh_from_db()
        return inv

    def _stats(self):
        resp = self.client.get(reverse("invoice-stats"))
        self.assertEqual(resp.status_code, 200)
        return resp.data["totals"]

    def _db_total(self, inv_type):
        return sum(
            (i.total_amount for i in Invoice.objects.filter(type_of_invoice=inv_type)), D("0")
        )

    def test_multi_line_invoice_counted_once_in_outward_total(self):
        self._invoice("MULTI-1", INVOICE_TYPE_OUTWARD, [(10, 100, "0.03"), (5, 200, "0.03")])
        totals = self._stats()
        self.assertAlmostEqual(
            float(totals["outward"]), float(self._db_total(INVOICE_TYPE_OUTWARD)), places=2
        )

    def test_multi_line_invoice_counted_once_in_inward_total(self):
        self._invoice("MULTI-2", INVOICE_TYPE_INWARD,
                      [(10, 100, "0.03"), (5, 200, "0.03"), (1, 50, "0.03")])
        totals = self._stats()
        self.assertAlmostEqual(
            float(totals["inward"]), float(self._db_total(INVOICE_TYPE_INWARD)), places=2
        )

    def test_invoice_count_is_invoices_not_line_items(self):
        self._invoice("MULTI-3", INVOICE_TYPE_OUTWARD, [(1, 10, "0.03"), (1, 20, "0.03")])
        self._invoice("MULTI-4", INVOICE_TYPE_OUTWARD, [(1, 30, "0.03")])
        self.assertEqual(self._stats()["count"], Invoice.objects.count())

    def test_tax_totals_sum_every_line_exactly_once(self):
        self._invoice("MULTI-5", INVOICE_TYPE_OUTWARD, [(10, 100, "0.03"), (5, 200, "0.03")])
        expected = sum(
            (li.cgst + li.sgst + li.igst
             for li in LineItem.objects.filter(invoice__type_of_invoice=INVOICE_TYPE_OUTWARD)),
            D("0"),
        )
        self.assertAlmostEqual(float(self._stats()["tax"]), float(expected), places=2)

    def test_net_is_outward_minus_inward(self):
        self._invoice("MULTI-6", INVOICE_TYPE_OUTWARD, [(10, 100, "0.03"), (2, 50, "0.03")])
        self._invoice("MULTI-7", INVOICE_TYPE_INWARD, [(4, 25, "0.03")])
        totals = self._stats()
        expected = self._db_total(INVOICE_TYPE_OUTWARD) - self._db_total(INVOICE_TYPE_INWARD)
        self.assertAlmostEqual(float(totals["net"]), float(expected), places=2)


class TopProductsGroupingTest(BaseAPITestCase):
    """One product must be one row, even when its HSN drifted over time."""

    def _line(self, invoice, name, hsn, qty, rate, unit="gms"):
        taxable = D(str(qty)) * D(str(rate))
        tax = taxable * D("0.03")
        LineItem.objects.create(
            workspace_id=1, customer=self.customer, invoice=invoice, product_name=name,
            hsn_code=hsn, gst_tax_rate=D("0.03"), quantity=D(str(qty)), rate=D(str(rate)),
            cgst=tax / 2, sgst=tax / 2, igst=D("0"), amount=taxable + tax, unit=unit,
        )

    def _invoice_with(self, number, lines):
        inv = Invoice.objects.create(
            workspace_id=1, business=self.business, customer=self.customer,
            invoice_number=number, invoice_date="2026-05-01",
            type_of_invoice=INVOICE_TYPE_OUTWARD, total_amount=0,
        )
        for name, hsn, qty, rate in lines:
            self._line(inv, name, hsn, qty, rate)
        return inv

    def _top(self):
        resp = self.client.get(reverse("invoice-stats"))
        self.assertEqual(resp.status_code, 200)
        return resp.data["top_products"]

    def test_same_product_under_two_hsn_codes_is_one_row(self):
        self._invoice_with("HSN-1", [("Silver Payal", "711311", 100, 90)])
        self._invoice_with("HSN-2", [("Silver Payal", "711319", 50, 90)])
        rows = [r for r in self._top() if r["name"] == "Silver Payal"]
        self.assertEqual(len(rows), 1)
        self.assertAlmostEqual(float(rows[0]["qty"]), 150.0, places=3)

    def test_row_flags_how_many_hsn_codes_it_merged(self):
        self._invoice_with("HSN-3", [("Bangle", "711311", 10, 100)])
        self._invoice_with("HSN-4", [("Bangle", "711319", 10, 100)])
        row = [r for r in self._top() if r["name"] == "Bangle"][0]
        self.assertEqual(row["hsn_variants"], 2)

    def test_row_carries_the_line_unit(self):
        inv = self._invoice_with("UNIT-2", [])
        self._line(inv, "Anklet Pair", "711311", 3, 500, unit="pcs")
        row = [r for r in self._top() if r["name"] == "Anklet Pair"][0]
        self.assertEqual(row["unit"], "pcs")
