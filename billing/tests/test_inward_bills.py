"""Tests for the Inward Bills module."""

from decimal import Decimal as D

from django.test import SimpleTestCase

from billing.api.inward_bills_service import (
    compute_lines,
    gstin_matches,
    resolve_tax,
)


class InwardBillsServiceTest(SimpleTestCase):
    """Pure tax + validation helpers (no DB)."""

    def test_resolve_tax_intra(self):
        self.assertEqual(
            resolve_tax(D("468544"), D("0.03"), intra=True),
            (D("7028.16"), D("7028.16"), D("0")),
        )

    def test_resolve_tax_inter(self):
        self.assertEqual(
            resolve_tax(D("76889.09"), D("0.03"), intra=False),
            (D("0"), D("0"), D("2306.67")),
        )

    def test_compute_lines_intra_amounts(self):
        lines = [{"taxable": D("3883.5"), "rate": D("0.03")}]
        out, total = compute_lines(lines, intra=True)
        self.assertEqual(out[0]["cgst"], D("58.25"))
        self.assertEqual(out[0]["sgst"], D("58.25"))
        self.assertEqual(out[0]["amount"], D("4000.00"))
        self.assertEqual(total, D("4000.00"))

    def test_compute_lines_absorbs_roundoff_to_bill_total(self):
        # printed total 31533.00; natural sum 31533.24 -> last line absorbs -0.24
        lines = [
            {"taxable": D("5368.80"), "rate": D("0.03")},
            {"taxable": D("25246.00"), "rate": D("0.03")},
        ]
        out, total = compute_lines(lines, intra=True, bill_total=D("31533.00"))
        self.assertEqual(total, D("31533.00"))
        self.assertEqual(sum(l["amount"] for l in out), D("31533.00"))
        self.assertEqual(out[0]["cgst"], D("80.53"))
        self.assertEqual(out[1]["cgst"], D("378.69"))
        self.assertEqual(out[1]["amount"], D("26003.14"))

    def test_compute_lines_inter_sets_igst_only(self):
        lines = [{"taxable": D("76889.09"), "rate": D("0.03")}]
        out, _ = compute_lines(lines, intra=False)
        self.assertEqual(out[0]["igst"], D("2306.67"))
        self.assertEqual(out[0]["cgst"], D("0"))
        self.assertEqual(out[0]["sgst"], D("0"))

    def test_gstin_matches(self):
        self.assertTrue(gstin_matches("08AAGPL3375F1ZO", "08AAGPL3375F1ZO"))
        self.assertTrue(gstin_matches("08aagpl3375f1zo", "08AAGPL3375F1ZO"))
        self.assertFalse(gstin_matches("", "08AAGPL3375F1ZO"))  # B2C / unregistered
        self.assertFalse(gstin_matches(None, "08AAGPL3375F1ZO"))
        self.assertFalse(gstin_matches("27AABCR1718E1ZP", "08AAGPL3375F1ZO"))
