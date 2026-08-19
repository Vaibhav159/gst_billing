"""Line-item write paths must not scale queries with line count.

The resync signal (billing/signals.py) re-sums an invoice on every LineItem
save — the right behavior for one-off admin edits, and an O(n²)-reads storm
if a bulk path loops .create(). Every bulk path therefore uses bulk_create
and sets total_amount from a total it already holds. These tests pin both
halves: bulk paths stay O(1) in queries, and the signal safety net still
works for genuine single saves.
"""

import json
from decimal import Decimal as D

from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from billing.constants import INVOICE_TYPE_OUTWARD
from billing.models import Invoice, LineItem
from billing.tests.test_base import BaseAPITestCase


class InwardCaptureQueryBudgetTest(BaseAPITestCase):
    def _capture(self, n_lines, number):
        payload = {
            "business_id": self.business.id,
            "supplier_name": "QUERY BUDGET SUPPLIER",
            "invoice_number": number,
            "invoice_date": "2026-08-10",
            "lines": json.dumps([
                {"product_name": f"Item {i}", "hsn_code": "711311",
                 "quantity": "1", "rate": "100", "taxable": "100",
                 "gst_tax_rate": "0.03"}
                for i in range(n_lines)
            ]),
        }
        with CaptureQueriesContext(connection) as ctx:
            resp = self.client.post(reverse("inward-bill-list"), payload)
        self.assertEqual(resp.status_code, 201, resp.data)
        return resp.data, len(ctx.captured_queries)

    def test_query_count_does_not_grow_with_line_count(self):
        # Warm-up so the supplier get_or_create resolves to a plain get in
        # both measured runs (its INSERT + M2M add would skew the first).
        self._capture(1, "QB-WARMUP")
        # Two lines vs eight: with the old per-line .create() loop the
        # difference was 3 queries per extra line (insert + signal's
        # SELECT + UPDATE). With bulk_create it must be exactly zero.
        _, q_small = self._capture(2, "QB-SMALL")
        _, q_large = self._capture(8, "QB-LARGE")
        self.assertEqual(
            q_large, q_small,
            f"query count grew with line count ({q_small} -> {q_large}); "
            "a per-line save crept back into the inward capture path",
        )

    def test_capture_total_still_matches_the_lines(self):
        bill, _ = self._capture(3, "QB-TOTAL")
        inv = Invoice.objects.get(id=bill["id"])
        db_sum = sum(
            (li.amount for li in LineItem.objects.filter(invoice=inv)), D("0")
        )
        self.assertEqual(inv.total_amount, db_sum)
        self.assertEqual(db_sum, D("309"))  # 3 × (100 + 3% tax)


class SignalSafetyNetTest(BaseAPITestCase):
    """One-off saves (admin edits, shell fixes) still resync the total."""

    def _bare_invoice(self, number):
        return Invoice.objects.create(
            workspace_id=1, business=self.business, customer=self.customer,
            invoice_number=number, invoice_date="2026-08-01",
            type_of_invoice=INVOICE_TYPE_OUTWARD, total_amount=0,
        )

    def _line(self, invoice, amount):
        return LineItem.objects.create(
            workspace_id=1, customer=self.customer, invoice=invoice,
            product_name="Loose Item", hsn_code="711319",
            gst_tax_rate=D("0.03"), quantity=D("1"), rate=D(str(amount)),
            cgst=D("0"), sgst=D("0"), igst=D("0"), amount=D(str(amount)),
            unit="gms",
        )

    def test_single_create_resyncs_total(self):
        inv = self._bare_invoice("NET-1")
        self._line(inv, 500)
        self._line(inv, 250)
        inv.refresh_from_db()
        self.assertEqual(inv.total_amount, D("750"))

    def test_single_delete_resyncs_total(self):
        inv = self._bare_invoice("NET-2")
        keep = self._line(inv, 500)
        drop = self._line(inv, 250)
        drop.delete()
        inv.refresh_from_db()
        self.assertEqual(inv.total_amount, D("500"))
        self.assertEqual(LineItem.objects.filter(invoice=inv).get().id, keep.id)
