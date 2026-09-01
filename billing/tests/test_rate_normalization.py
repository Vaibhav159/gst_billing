"""The GST rate slab allowlist (audit A1/A11).

Every rate crossing the app used to run through some copy of
`value > 1 ? value / 100 : value` — seven copies, three behaviours. That
heuristic is right for 1.5/3/5/12/18/28 and wrong for the two slabs below 1,
which is how a 0.25% diamond line came to be stored as 25%.
"""

from decimal import Decimal

from django.test import SimpleTestCase

from billing.tax_rules import GST_SLABS, normalize_rate, rate_as_percent


class NormalizeRateTests(SimpleTestCase):
    """Percent in, stored fraction out."""

    def test_every_slab_round_trips(self):
        for slab in GST_SLABS:
            with self.subTest(slab=str(slab)):
                stored = normalize_rate(slab)
                self.assertEqual(stored, slab / 100)
                self.assertEqual(rate_as_percent(stored), slab)

    def test_the_quarter_percent_slab(self):
        """A1: the bug that multiplied a diamond line's tax by 100."""
        self.assertEqual(normalize_rate("0.25"), Decimal("0.0025"))
        self.assertNotEqual(normalize_rate("0.25"), Decimal("0.25"))

    def test_the_one_percent_slab(self):
        """`1 > 1` is false, so the old heuristic stored 1% as 100%."""
        self.assertEqual(normalize_rate("1"), Decimal("0.01"))

    def test_old_heuristic_disagrees_exactly_where_expected(self):
        """Pin the blast radius: below 1 it was wrong, at/above 1.5 it was right."""

        def old(v):
            v = Decimal(str(v))
            return v / 100 if v > 1 else v

        for pct in ("1.5", "3", "5", "12", "18", "28"):
            self.assertEqual(old(pct), normalize_rate(pct), f"{pct}% should be unchanged")
        for pct in ("0.25", "1"):
            self.assertNotEqual(old(pct), normalize_rate(pct), f"{pct}% should be fixed")
            # and the old value was exactly 100x too big
            self.assertEqual(old(pct), normalize_rate(pct) * 100)

    def test_idempotent_on_stored_values(self):
        """A repair pass must be safe to run twice."""
        for slab in GST_SLABS:
            stored = normalize_rate(slab)
            self.assertEqual(normalize_rate(stored), stored, f"{slab}% not idempotent")

    def test_trailing_zeros_from_the_database(self):
        """numeric(13,4) hands back 0.0300, not 0.03."""
        self.assertEqual(normalize_rate(Decimal("0.0300")), Decimal("0.03"))
        self.assertEqual(rate_as_percent(Decimal("0.0300")), Decimal("3"))
        self.assertEqual(rate_as_percent(Decimal("0.0025")), Decimal("0.25"))

    def test_accepts_str_float_and_decimal(self):
        for form in ("3", 3, 3.0, Decimal("3")):
            self.assertEqual(normalize_rate(form), Decimal("0.03"), repr(form))

    def test_zero_is_not_ambiguous(self):
        self.assertEqual(normalize_rate(0), Decimal("0"))
        self.assertEqual(rate_as_percent(0), Decimal("0"))

    def test_off_slab_uses_the_declared_shape(self):
        """7% is not a GST slab, so the call site's contract decides."""
        self.assertEqual(normalize_rate("7", assume="percent"), Decimal("0.07"))
        self.assertEqual(normalize_rate("0.07", assume="fraction"), Decimal("0.07"))


class RateAsPercentTests(SimpleTestCase):
    """Stored fraction in, percent out."""

    def test_reads_stored_fractions(self):
        self.assertEqual(rate_as_percent(Decimal("0.0025")), Decimal("0.25"))
        self.assertEqual(rate_as_percent(Decimal("0.03")), Decimal("3"))
        self.assertEqual(rate_as_percent(Decimal("0.18")), Decimal("18"))

    def test_heals_a_row_written_by_the_old_heuristic(self):
        """25% and 100% are not GST slabs, so the intent is recoverable."""
        self.assertEqual(rate_as_percent(Decimal("0.25")), Decimal("0.25"))
        self.assertEqual(rate_as_percent(Decimal("1")), Decimal("1"))

    def test_no_slab_is_ambiguous(self):
        """The property the allowlist rests on: no slab is a slab again x100."""
        for slab in GST_SLABS:
            if slab == 0:
                continue
            self.assertNotIn(
                slab * 100, GST_SLABS, f"{slab} is ambiguous — allowlist is unsafe"
            )

    def test_never_returns_scientific_notation(self):
        """Decimal.normalize() turns 100 into 1E+2; exports must not print that."""
        for v in ("0.0025", "0.03", "0.25", "1", "1.00", "0.18"):
            self.assertNotIn("E", str(rate_as_percent(Decimal(v))), v)
