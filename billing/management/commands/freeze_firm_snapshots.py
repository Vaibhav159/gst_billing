"""Freeze existing bill identity once during the v3 switch's maintenance window."""
from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Q

from billing.cache import uncached
from billing.models import BinnedInvoice, Business, Invoice
from billing.numbering import lock_firms
from billing.services.firms import IDENTITY_FIELDS, freeze_older_bills


class Command(BaseCommand):
    help = "Freeze each bill's missing firm snapshot; dry run unless --apply is given."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Write missing snapshots during the switch's maintenance window.")

    def handle(self, *args, **options):
        count = 0
        for pk in uncached(Business).order_by("pk").values_list("pk", flat=True):
            with transaction.atomic():
                if options["apply"]:
                    lock_firms(pk)
                business = uncached(Business).get(pk=pk)
                if options["apply"]:
                    count += freeze_older_bills(business, IDENTITY_FIELDS, all_bills=True)
                else:
                    count += uncached(Invoice).filter(business_id=pk, firm_snapshot__isnull=True).count()
                    count += uncached(BinnedInvoice).live().filter(business_id=pk).filter(
                        Q(data__invoice__firm_snapshot__isnull=True) | Q(data__invoice__firm_snapshot=None)).count()
        self.stdout.write(f"{count} bill snapshot(s) {'written' if options['apply'] else 'to write'}.")
        if not options["apply"]:
            self.stdout.write("Dry run: nothing changed. Run again with --apply during the switch's maintenance window.")
