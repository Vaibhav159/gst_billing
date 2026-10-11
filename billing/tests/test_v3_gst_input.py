from datetime import date

from django.test import TestCase
from rest_framework.exceptions import NotFound, ValidationError

from billing.tests.v3_helpers import firm


class GstInputTest(TestCase):
    def test_month_is_exact_bounded_and_json_safe(self):
        from billing.api.gst_input import month_input
        for raw in (None, "", [], {}, True, 202609, "2026-13", "٢٠٢٦-09"):
            with self.assertRaises(ValidationError) as caught:
                month_input({"month": raw})
            self.assertEqual(str(caught.exception.detail["month"][0]), "Give the month like 2026-09.")
        with self.assertRaisesMessage(ValidationError, "The app's GST records start in April 2025."):
            month_input({"month": "2025-03"})
        self.assertEqual(month_input({"month": "2026-09"}), date(2026, 9, 1))

    def test_firm_distinguishes_malformed_and_missing_and_reads_narrowly(self):
        from billing.api.gst_input import firm_input
        business = firm()
        for raw in (None, "", [], {}, True, "²", "9" * 40):
            with self.assertRaisesMessage(ValidationError, "Pick a firm from the list."):
                firm_input({"business_id": raw})
        with self.assertRaisesMessage(NotFound, "No such firm."):
            firm_input({"business_id": "999999"})
        with self.assertNumQueries(1):
            row = firm_input({"business_id": str(business.id)})
            self.assertEqual(row.name, business.name)
        self.assertIn("address", row.get_deferred_fields())

    def test_money_refuses_nan_negative_overflow_and_non_paise(self):
        from billing.api.gst_input import opening_heads
        for raw in (None, [], {}, True, "NaN", "Infinity", "1e300", "1e999999999", "-1e999999999", "0.001"):
            with self.assertRaises(ValidationError):
                opening_heads({"igst": raw, "cgst": "0", "sgst": "0"})
        with self.assertRaisesMessage(ValidationError, "A credit balance can't be below zero."):
            opening_heads({"igst": "-1", "cgst": "0", "sgst": "0"})
        self.assertEqual(str(opening_heads({"igst": "1.50", "cgst": "0", "sgst": "0"})["igst"]), "1.50")
