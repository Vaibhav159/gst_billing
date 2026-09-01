"""The server's calendar date is IST, not UTC (audit A10).

TIME_ZONE was "UTC" and the date helpers were naive `datetime.now().date()` /
`date.today()`, which read the container clock. Between midnight and 05:30 IST
those answer with *yesterday* — which shifted the current financial year (and
so the next invoice number), the AI-import default date, and the ITC-aging
cutoffs, and made the date validator call today "in the future".
"""

from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from billing.models import Business, Invoice

# 2026-03-31 20:00 UTC is 2026-04-01 01:30 IST — a different day, a different
# financial year, and inside the window where the bug was live.
EARLY_MORNING_IST = datetime(2026, 3, 31, 20, 0, 0, tzinfo=dt_timezone.utc)


class LocaldateTests(TestCase):
    def test_settings_run_on_indian_time(self):
        from django.conf import settings

        self.assertEqual(settings.TIME_ZONE, "Asia/Kolkata")
        self.assertTrue(settings.USE_TZ)

    def test_localdate_is_the_ist_day_not_the_utc_one(self):
        with patch("django.utils.timezone.now", return_value=EARLY_MORNING_IST):
            self.assertEqual(timezone.localdate(), date(2026, 4, 1))
            # what the naive helpers returned:
            self.assertEqual(EARLY_MORNING_IST.date(), date(2026, 3, 31))

    def test_the_two_agree_outside_the_window(self):
        midday = datetime(2026, 4, 1, 9, 0, 0, tzinfo=dt_timezone.utc)  # 14:30 IST
        with patch("django.utils.timezone.now", return_value=midday):
            self.assertEqual(timezone.localdate(), midday.date())

    def test_every_half_hour_of_the_offending_window(self):
        """The window is 18:30-23:59 UTC = 00:00-05:29 IST the next day."""
        start = datetime(2026, 3, 31, 18, 30, tzinfo=dt_timezone.utc)
        for step in range(11):  # 18:30 .. 23:30 UTC, in half hours
            instant = start + timedelta(minutes=30 * step)
            with patch("django.utils.timezone.now", return_value=instant):
                self.assertEqual(
                    timezone.localdate(), date(2026, 4, 1), f"{instant:%H:%M} UTC"
                )

    def test_the_boundary_itself(self):
        """18:29 UTC is still 31 March in IST; 18:30 is 1 April."""
        for utc_time, expected in [
            (datetime(2026, 3, 31, 18, 29, tzinfo=dt_timezone.utc), date(2026, 3, 31)),
            (datetime(2026, 3, 31, 18, 30, tzinfo=dt_timezone.utc), date(2026, 4, 1)),
        ]:
            with patch("django.utils.timezone.now", return_value=utc_time):
                self.assertEqual(timezone.localdate(), expected, f"{utc_time:%H:%M}")


class InvoiceNumberFinancialYearTests(TestCase):
    """A1 April at 01:00 IST used to issue a number from the previous FY."""

    def setUp(self):
        self.business = Business.objects.create(
            name="LODHA JEWELLERS", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN"
        )

    def test_next_number_uses_the_ist_financial_year(self):
        from billing.models import Customer

        customer = Customer.objects.create(name="BUYER", state_name="RAJASTHAN")
        # An invoice in FY 2025-26, the year the UTC clock would still be in.
        Invoice.objects.create(
            business=self.business, customer=customer, invoice_number="42",
            invoice_date=date(2026, 3, 15), type_of_invoice="outward",
        )
        with patch("django.utils.timezone.now", return_value=EARLY_MORNING_IST):
            # It is 1 April IST: a new FY, so numbering restarts rather than
            # continuing 42 -> 43 from the year that just closed.
            nxt = Invoice.get_next_invoice_number(self.business.id)
        self.assertEqual(str(nxt), "1")


class FinancialYearsHelperTests(TestCase):
    def test_get_financial_years_runs(self):
        """Went from working to NameError when `timezone` was imported only
        inside a sibling method. No caller in the repo, so nothing else saw it."""
        with patch("django.utils.timezone.now", return_value=EARLY_MORNING_IST):
            years = Invoice.get_financial_years()
        self.assertIsInstance(years, list)  # empty book -> []; the point is it runs
