"""The one credit-month rule used by purchase forms, writes and GST."""
from datetime import date
from unittest.mock import patch

from django.test import TestCase
from rest_framework.exceptions import ValidationError

from billing.models import FiledPeriod
from billing.refusals import Refusal
from billing.tests.v3_helpers import buyer, firm, sale


class PurchaseCreditTests(TestCase):
    def setUp(self):
        self.business = firm()
        self.invoice = sale(self.business, buyer(), "P-1", date(2026, 8, 15), kind="inward")
        self.today = date(2026, 10, 8)

    def close(self, year, month):
        return FiledPeriod.objects.create(business=self.business, year=year, month=month)

    def test_default_is_own_month_then_earliest_open_month(self):
        from billing.credit import default_credit_month
        self.assertEqual(default_credit_month(self.business.pk, self.invoice.invoice_date, self.today), (None, False))
        self.close(2026, 8)
        self.assertEqual(default_credit_month(self.business.pk, self.invoice.invoice_date, self.today),
                         (date(2026, 9, 1), False))

    def test_deadline_and_last_month_follow_april_year(self):
        from billing.credit import credit_deadline, last_credit_month
        self.assertEqual(credit_deadline(date(2026, 3, 31)), date(2026, 11, 30))
        self.assertEqual(credit_deadline(date(2026, 4, 1)), date(2027, 11, 30))
        self.assertEqual(last_credit_month(date(2026, 3, 31)), date(2026, 10, 1))

    def test_lapsed_is_derived_and_never_switches_off_eligibility(self):
        from billing.credit import credit_lapsed
        self.invoice.invoice_date = date(2025, 8, 1)
        self.invoice.itc_month = date(2026, 11, 1)
        self.assertTrue(credit_lapsed(self.invoice))
        self.assertTrue(self.invoice.itc_eligible)
        self.invoice.itc_eligible = False
        self.assertFalse(credit_lapsed(self.invoice))

    def test_zero_tax_is_not_lapsed(self):
        from billing.credit import credit_lapsed
        invoice = sale(self.business, buyer("Untaxed"), "P-2", date(2025, 1, 1),
                       {"product_name": "Item", "quantity": "1", "rate": "10", "gst_tax_rate": "0"},
                       kind="inward", itc_month=date(2026, 10, 1))
        self.assertFalse(credit_lapsed(invoice))

    def test_batch_closed_source_is_one_query(self):
        from billing.period_lock import closed_credit_months
        self.close(2026, 8)
        with self.assertNumQueries(1):
            self.assertEqual(closed_credit_months([self.business.pk]), {(self.business.pk, 2026, 8)})

    def test_edit_keeps_chosen_month_unless_date_or_firm_changes(self):
        from billing.credit import choose_credit_month
        self.invoice.itc_month = date(2026, 9, 1)
        self.assertEqual(choose_credit_month(self.business, self.invoice.invoice_date,
                                            invoice=self.invoice, today=self.today), date(2026, 9, 1))
        self.assertIsNone(choose_credit_month(self.business, date(2026, 9, 2),
                                              invoice=self.invoice, today=self.today))
        self.assertIsNone(choose_credit_month(self.business, self.invoice.invoice_date, "2026-08",
                                              invoice=self.invoice, today=self.today))

    def test_invalid_months_are_words_and_never_a_server_error(self):
        from billing.credit import choose_credit_month
        for value in ([], {}, True, 7, "2026-13", "2026-07", "2026-11"):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                choose_credit_month(self.business, self.invoice.invoice_date, value, today=self.today)

    def test_closed_month_uses_exact_purchase_409(self):
        from billing.period_lock import assert_purchase_open
        period = self.close(2026, 8)
        with self.assertRaises(Refusal) as caught:
            assert_purchase_open(self.business, date(2026, 8, 1), "edit")
        self.assertEqual(caught.exception.detail, {
            "detail": "August 2026's GSTR-3B is filed for KIRAN GOLD HOUSE, with this bill's credit in it, "
                      "so it can't be changed. Have the owner unlock August 2026 "
                      "in GST returns first.",
            "code": "month_closed", "locked_period": {"id": period.pk, "business": self.business.pk,
                                                       "year": 2026, "month": 8}})

    def test_stage_source_can_change_without_changing_purchase_guard(self):
        from billing.period_lock import assert_purchase_open
        with patch("billing.period_lock.credit_month_closed", return_value=True), self.assertRaises(Refusal) as caught:
            assert_purchase_open(self.business, date(2026, 8, 1), "delete")
        self.assertIsNone(caught.exception.detail["locked_period"]["id"])

    def test_v2_guard_checks_bill_month_and_credit_month(self):
        from billing.period_lock import assert_inward_unlocked
        self.invoice.itc_month = date(2026, 9, 1)
        self.close(2026, 9)
        with self.assertRaises(ValidationError) as caught:
            assert_inward_unlocked(self.invoice)
        self.assertEqual(int(caught.exception.detail["locked_period"]["month"]), 9)

    def test_form_options_include_due_dates_and_in_time_flags(self):
        from billing.credit import credit_month_choices
        self.close(2026, 8)
        result = credit_month_choices(self.business, self.invoice.invoice_date, today=self.today)
        self.assertEqual(result, {"bill_month": "2026-08", "bill_month_closed": True, "default": "2026-09",
                                 "options": [{"month": "2026-09", "due": "2026-10-20", "running": False, "in_time": True},
                                             {"month": "2026-10", "due": "2026-11-20", "running": True, "in_time": True}],
                                 "deadline": "2027-11-30", "lapsed": False})

    def test_all_months_closed_refuses_without_choosing_a_future_month(self):
        from billing.credit import default_credit_month
        for month in (8, 9, 10):
            self.close(2026, month)
        with self.assertRaises(Refusal):
            default_credit_month(self.business.pk, self.invoice.invoice_date, self.today)

    def test_late_month_refused_while_in_time_month_exists(self):
        from billing.credit import choose_credit_month
        with self.assertRaises(ValidationError):
            choose_credit_month(self.business, date(2025, 8, 1), "2026-11", today=date(2026, 11, 10))

    def test_preledger_bills_keep_null_month_and_offer_no_credit_month(self):
        from billing.credit import choose_credit_month, credit_month_choices, default_credit_month
        old = date(2024, 3, 31)
        self.assertEqual(default_credit_month(self.business.pk, old, self.today), (None, False))
        with self.assertRaises(ValidationError) as caught:
            choose_credit_month(self.business, old, "2026-10", today=self.today)
        self.assertEqual(str(caught.exception.detail["itc_month"][0]),
                         "This bill is before April 2025. Its credit is in the opening balance or lapsed; leave the credit month blank.")
        choices = credit_month_choices(self.business, old, today=self.today)
        self.assertEqual(choices["options"], [])
        self.assertIsNone(choices["default"])

    def test_explicit_edit_target_uses_edit_refusal(self):
        from billing.credit import choose_credit_month
        self.close(2026, 9)
        with self.assertRaises(Refusal) as caught:
            choose_credit_month(self.business, self.invoice.invoice_date, "2026-09", invoice=self.invoice, today=self.today)
        self.assertIn("with this bill's credit in it, so it can't be changed.", str(caught.exception.detail))

    def test_outside_ledger_has_no_effective_month_or_lock(self):
        from billing.credit import credit_lapsed, credit_month_choices, credit_month_of
        from billing.period_lock import assert_purchase_open
        self.invoice.invoice_date = date(2025, 3, 31)
        self.invoice.itc_month = date(2026, 10, 1)
        self.assertIsNone(credit_month_of(self.invoice))
        self.assertFalse(credit_lapsed(self.invoice))
        self.close(2025, 3)
        with self.assertNumQueries(0):
            assert_purchase_open(self.business, None, "edit")
        self.assertFalse(credit_month_choices(self.business, date(2025, 3, 31), self.today)["bill_month_closed"])

    def test_explicit_credit_before_ledger_uses_ledger_words(self):
        from billing.credit import check_credit_month
        with self.assertRaises(ValidationError) as caught:
            check_credit_month(self.business.pk, date(2025, 4, 1), "2025-03", self.today)
        self.assertEqual(str(caught.exception.detail["itc_month"][0]),
                         "The credit ledger starts in April 2025. Pick April 2025 or later.")
