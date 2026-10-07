"""The report and repair commands read the database, not cacheops' cache.

Cacheops is live in production (Invoice and LineItem queries for 30 minutes),
and a report read through it could be that old. Worse, fix_invoice_totals
--apply wrote the totals that read gave: its line sums sit inside Coalesce,
which cacheops doesn't track, so a line changed since didn't invalidate the
cached query. Redis isn't available to the tests, so this checks each
command makes its reads with nocache() (review of the repair commands).
"""

from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.db.models import QuerySet

from billing.models import Business, Customer, Invoice, LineItem, Product
from billing.tests.test_base import BaseAPITestCase

READS = {
    "fix_tax_splits": {LineItem},
    "fix_placeholder_gstins": {Customer, Business, Invoice, LineItem},
    "fix_line_customers": {LineItem, Invoice},
    "fix_invoice_totals": {Invoice},
    "fix_tax_heads": {Invoice, LineItem},
    "check_inward_rates": {Product, LineItem},
    "fix_gst_rates": {Product, LineItem},
    "check_inward_duplicates": {Invoice},
}


class RepairReadsBypassTheCacheTest(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        # Something for every report to read: a placeholder GSTIN on a party
        # with an invoice, so fix_placeholder_gstins reads its lines too.
        Customer.objects.filter(pk=self.customer.pk).update(gst_number="NA")

    def test_every_report_reads_past_the_cache(self):
        for command, models in READS.items():
            with self.subTest(command=command), mock.patch.object(
                QuerySet, "nocache", autospec=True, side_effect=lambda qs: qs
            ) as nocache:
                call_command(command, stdout=StringIO())
                read = {c.args[0].model for c in nocache.call_args_list}
                self.assertLessEqual(models, read, f"{command} read {sorted(m.__name__ for m in models - read)} cached")
