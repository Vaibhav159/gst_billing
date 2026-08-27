"""Reconciliation service — the CA's tie-outs, exact to the paisa."""

from datetime import date
from decimal import Decimal as D

from django.urls import reverse

from billing.models import Customer, Invoice, LineItem
from billing.reconciliation import (
    ROUNDING_TOLERANCE, fy_bounds, payment_split, quarter_of, reconcile,
)
from billing.tests.test_base import BaseAPITestCase


def line(taxable, rate="0.03", igst=False):
    t = D(taxable)
    r = D(rate)
    tax = (t * r).quantize(D("0.01"))
    if igst:
        return {"taxable": t, "cgst": D("0"), "sgst": D("0"), "igst": tax, "rate": r}
    half = (tax / 2).quantize(D("0.01"))
    # igst carries only the paisa remainder of the half-split (normally 0)
    return {"taxable": t, "cgst": half, "sgst": half, "igst": tax - 2 * half, "rate": r}


def row(i, dt, gstin, mode, lines):
    gross = sum((ln["taxable"] + ln["cgst"] + ln["sgst"] + ln["igst"] for ln in lines), D("0"))
    return {
        "id": i, "invoice_number": f"R-{i}", "invoice_date": dt,
        "customer_gstin": gstin, "payment_mode": mode,
        "total_amount": gross, "lines": lines,
    }


class ServiceMathTest(BaseAPITestCase):
    def test_quarters_and_fy_bounds(self):
        self.assertEqual(quarter_of(date(2025, 4, 1)), 1)
        self.assertEqual(quarter_of(date(2025, 9, 30)), 2)
        self.assertEqual(quarter_of(date(2025, 12, 31)), 3)
        self.assertEqual(quarter_of(date(2026, 3, 31)), 4)
        self.assertEqual(fy_bounds("2025-26"), (date(2025, 4, 1), date(2026, 3, 31)))

    def _fixture(self):
        return [
            row(1, date(2025, 5, 1), "27X", "bank", [line("100000")]),
            row(2, date(2025, 8, 1), "", "cash", [line("200000")]),
            row(3, date(2025, 11, 1), "", "bank", [line("300000")]),
            row(4, date(2026, 2, 1), "27X", "", [line("400000")]),
        ]

    def test_rollup_identities_all_pass(self):
        res = reconcile("2025-26", self._fixture())
        self.assertFalse([c for c in res.checks if c.status == "fail"],
                         [f"{c.id}@{c.period}:{c.difference}" for c in res.checks if c.status == "fail"])
        fy = res.rollup["gstr3b"]["FY"]
        self.assertEqual(fy.taxable, D("1000000.00"))
        self.assertEqual(fy.cgst + fy.sgst, D("30000.00"))
        b2b = res.rollup["b2b"]["FY"]
        self.assertEqual(b2b.taxable, D("500000.00"))

    def test_mode_buckets_are_exact_and_tie(self):
        modes = payment_split(self._fixture())
        by = {b.mode: b for b in modes}
        self.assertEqual(by["bank"].taxable, D("400000.00"))
        self.assertEqual(by["cash"].taxable, D("200000.00"))
        self.assertEqual(by["(not set)"].taxable, D("400000.00"))
        total_taxable = sum((b.taxable for b in modes), D("0"))
        self.assertEqual(total_taxable, D("1000000.00"), "buckets must tie exactly")
        self.assertEqual(sum((b.share_pct for b in modes), D("0")), D("100.0000"),
                         "residual-last: shares sum to exactly 100")

    def test_deliberate_break_fails_in_quarter_and_fy(self):
        rows = self._fixture()
        rows[1]["lines"][0]["taxable"] += D("500")  # taxable drifts, tax doesn't
        res = reconcile("2025-26", rows)
        rate_fails = [c for c in res.checks if c.id.startswith("rate_") and c.status == "fail"]
        periods = {c.period for c in rate_fails}
        self.assertIn("JUL-SEP", periods)
        self.assertIn("FY", periods)
        fy_fail = next(c for c in rate_fails if c.period == "FY")
        self.assertEqual(abs(fy_fail.difference), D("15.00"))  # 500 × 3%

    def test_rounding_band_is_amber_not_fail(self):
        rows = [row(1, date(2025, 5, 1), "", "bank", [line("100000")])]
        rows[0]["total_amount"] += D("0.05")  # invoice total 5p above lines
        res = reconcile("2025-26", rows)
        gross = next(c for c in res.checks if c.id == "mode_gross")
        self.assertEqual(gross.status, "rounding")
        self.assertEqual(gross.difference, D("0.05"))
        self.assertLessEqual(abs(gross.difference), ROUNDING_TOLERANCE)

    def test_multi_rate_bucketing(self):
        rows = [row(1, date(2025, 5, 1), "", "bank",
                    [line("100000", "0.03"), line("50000", "0.0025")])]
        res = reconcile("2025-26", rows)
        q1 = res.rate_buckets[1]
        self.assertEqual(set(q1.keys()), {D("0.03"), D("0.0025")})
        rate_checks = [c for c in res.checks if c.id.startswith("rate_") and c.period == "APR-JUN"]
        self.assertEqual(len(rate_checks), 2)
        self.assertTrue(all(c.status == "pass" for c in rate_checks))

    def test_empty_invoice_surfaces_in_coverage(self):
        rows = self._fixture() + [row(9, date(2025, 6, 1), "", "bank", [])]
        res = reconcile("2025-26", rows)
        cov = next(c for c in res.checks if c.id == "coverage" and c.period == "APR-JUN")
        self.assertEqual(cov.status, "pass")
        self.assertIn("1 empty", cov.label)


class ReconciliationApiTest(BaseAPITestCase):
    def test_endpoint_shape_and_fy_scoping(self):
        cust = Customer.objects.create(workspace_id=1, name="RECON B2B",
                                       gst_number="27AAPFU0939F1ZV")
        for num, dt, mode in [("A-1", "2025-05-10", "bank"), ("A-2", "2026-02-10", "cash"),
                              ("OUT", "2026-06-01", "bank")]:  # OUT = next FY
            inv = Invoice.objects.create(
                workspace_id=1, business=self.business, customer=cust,
                invoice_number=num, invoice_date=dt, type_of_invoice="outward",
                total_amount=D("10300"), payment_mode=mode)
            LineItem.objects.create(
                workspace_id=1, customer=cust, invoice=inv, product_name="S",
                hsn_code="711311", gst_tax_rate=D("0.03"), quantity=D("10000"),
                rate=D("1"), cgst=D("150"), sgst=D("150"), igst=0,
                unit="gms", amount=D("10300"))
        r = self.client.get(reverse("reconciliation"), {"fy": "2025-26"})
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["fy"], "2025-26")
        self.assertEqual(len(r.data["quarters"]), 4)
        self.assertEqual(r.data["total"]["gstr3b"]["taxable"], "20000.00")
        self.assertEqual(r.data["total"]["b2b"]["taxable"], "20000.00")
        modes = {m["mode"]: m for m in r.data["payment_split"]}
        self.assertEqual(modes["bank"]["taxable"], "10000.00")
        self.assertEqual(modes["cash"]["taxable"], "10000.00")
        self.assertTrue(all(c["status"] in ("pass", "rounding") for c in r.data["checks"]),
                        [c for c in r.data["checks"] if c["status"] == "fail"])

    def test_bad_fy_is_400(self):
        r = self.client.get(reverse("reconciliation"), {"fy": "garbage"})
        self.assertEqual(r.status_code, 400)


class SegmentFilterTest(BaseAPITestCase):
    def test_b2b_b2c_segment_filter(self):
        reg = Customer.objects.create(workspace_id=1, name="SEG REG",
                                      gst_number="27AAPFU0939F1ZV")
        unreg = Customer.objects.create(workspace_id=1, name="SEG UNREG")
        for num, c in [("SEG-B2B", reg), ("SEG-B2C", unreg)]:
            Invoice.objects.create(
                workspace_id=1, business=self.business, customer=c,
                invoice_number=num, invoice_date="2025-06-01",
                type_of_invoice="outward", total_amount=D("100"))
        b2b = self.client.get(reverse("invoice-list"), {"segment": "b2b"})
        nums = [i["invoice_number"] for i in b2b.data["results"]]
        self.assertIn("SEG-B2B", nums)
        self.assertNotIn("SEG-B2C", nums)
        b2c = self.client.get(reverse("invoice-list"), {"segment": "b2c"})
        nums = [i["invoice_number"] for i in b2c.data["results"]]
        self.assertIn("SEG-B2C", nums)
        self.assertNotIn("SEG-B2B", nums)
