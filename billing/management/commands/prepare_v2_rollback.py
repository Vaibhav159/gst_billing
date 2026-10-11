"""Get the books ready for v2 before a rollback, and back again after (design §3.6, §8).

v2 doesn't know a bill can be cancelled: on v2's images every cancelled sale would count again.
Run this with the v3 image, before the images go back to v2. It moves each cancelled sale to
the bin (kind "cancelled") with a v2-shaped "deleted" row in the audit log, so v2 sees a deleted
bill it could bring back, and it counts in no v2 figure. It also lists the bills whose place of
supply was chosen by hand, which v2 files under the customer's state. --reverse, run with the
v3 image after going forward again, puts the cancelled bills back under their own ids. Without
--apply either way only reports. Like every repair command it bypasses the month locks: a
cancelled bill in a filed month moves too.

    python manage.py prepare_v2_rollback            # what would move
    python manage.py prepare_v2_rollback --apply
    python manage.py prepare_v2_rollback --reverse --apply
"""

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Exists, OuterRef

from billing.cache import uncached
from billing.constants import BILL_CANCELLED
from billing.models import BinnedInvoice, FiledPeriod, FilingMonth, FilingRecord, Invoice
from billing.numbering import lock_firms
from billing.refusals import Refusal
from billing.services.bin import bin_bill, restore_from_bin
from billing.tax_rules import chosen_place, default_place_of_supply


class Command(BaseCommand):
    help = "Move cancelled sales to the bin before a rollback to v2 (--reverse puts them back)."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Make the change; without it, only report.")
        parser.add_argument("--reverse", action="store_true", help="Put the set-aside bills back (after v3 is back).")

    def handle(self, *args, **opts):
        if opts["reverse"]:
            self._reverse(opts["apply"])
        else:
            self._forward(opts["apply"])
        if not opts["apply"]:
            self.stdout.write("Dry run: nothing changed. Run again with --apply.")

    def _forward(self, apply):
        # Past cacheops (sales() reads around it): a report shows the database (_repair.scope's rule), and --apply
        # moves what it read.
        bills = list(Invoice.objects.sales().filter(status=BILL_CANCELLED).select_related("business", "customer"))
        for inv in bills:
            self.stdout.write(f"  {inv.business.name} {inv.invoice_number} of {inv.invoice_date}: cancelled "
                              f"({inv.cancel_reason or 'no reason given'})")
            if apply:
                bin_bill(inv, None, inv.cancel_reason, kind=BinnedInvoice.KIND_CANCELLED, check_month=False,
                         details=f"Cancelled in v3, set aside for v2: {inv.cancel_reason or 'no reason given'}")
        self.stdout.write(f"{len(bills)} cancelled bill(s) {'moved' if apply else 'to move'} to the bin for v2.")
        self._chosen_places()
        self._gstr1_locks(apply)

    def _chosen_places(self):
        """Bills whose place of supply was chosen by hand: v2 files them under the customer's state. The place is
        read as every reader reads it (chosen_place): trimmed, so "  " is no place."""
        chosen = (Invoice.objects.sales().counted().exclude(place_of_supply__isnull=True)
                  .exclude(place_of_supply="").select_related("business", "customer"))
        moved = [(inv, chosen_place(inv), default_place_of_supply(inv.business, inv.customer)) for inv in chosen]
        moved = [(inv, place, usual) for inv, place, usual in moved if place and usual != place]
        for inv, place, usual in moved:
            self.stdout.write(f"  {inv.business.name} {inv.invoice_number} of {inv.invoice_date}: place of supply "
                              f"{place}, v2 reads {usual or 'none'}")
        self.stdout.write(f"{len(moved)} bill(s) with a place of supply chosen by hand. v2 files them under the "
                          "customer's state; don't run fix_tax_heads on v2 before the CA has seen this list.")

    def _gstr1_locks(self, apply):
        unlocked = uncached(FilingMonth).filter(business_id=OuterRef("business_id"), year=OuterRef("year"),
                                               month=OuterRef("month"), unlocked_at__isnull=False)
        filed3 = uncached(FilingRecord).filter(business_id=OuterRef("business_id"), year=OuterRef("year"),
                                               month=OuterRef("month"), kind="gstr3b")
        rows = uncached(FilingRecord).filter(kind="gstr1").exclude(Exists(unlocked)).exclude(Exists(filed3))
        for row in rows.only("business_id", "year", "month"):
            self.stdout.write(f"  Firm {row.business_id} {row.year}-{row.month:02}: GSTR-1 only")
            if apply:
                with transaction.atomic():
                    lock_firms(row.business_id)
                    FiledPeriod.objects.get_or_create(business_id=row.business_id, year=row.year, month=row.month,
                        defaults={"note": "GSTR-1 only: protected for v2 rollback"})

    def _reverse(self, apply):
        if apply:
            FiledPeriod.objects.filter(note="GSTR-1 only: protected for v2 rollback").delete()
        # No join on the firm: a row whose firm v2 deleted is reported, not skipped (Ruling 1A-6).
        rows = BinnedInvoice.objects.filter(kind=BinnedInvoice.KIND_CANCELLED, restored_at__isnull=True)
        live = set(rows.live().values_list("pk", flat=True))
        back = 0
        for binned in rows:
            where = f"  {binned.data.get('business_name', '')} {binned.invoice_number}"
            if binned.pk not in live:
                # v2's Undo brought it back during the rollback, as an active bill (review M5).
                self.stdout.write(f"{where}: already back, skipped")
            elif not apply:
                self.stdout.write(f"{where}: to put back as cancelled")
            else:
                try:
                    restore_from_bin(binned, None, check_month=False)
                    back += 1
                except Refusal as refusal:
                    self.stdout.write(f"{where}: left in the bin. {refusal.detail['detail']}")
        self.stdout.write(f"{back if apply else len(live)} cancelled bill(s) {'put back' if apply else 'to put back'}.")
