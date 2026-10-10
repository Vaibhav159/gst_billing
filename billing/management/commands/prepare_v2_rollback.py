"""Get the books ready for v2 before a rollback, and back again after (design §3.6, §8).

v2 doesn't know a bill can be cancelled: on v2's images every cancelled sale would count again.
Run this with the v3 image, before the images go back to v2. It moves each cancelled sale to
the bin (kind "cancelled") with a v2-shaped "deleted" row in the audit log, so v2 sees a deleted
bill it could bring back, and it counts in no v2 figure. --reverse, run with the v3 image after
going forward again, puts them back as cancelled bills under their own ids. Without --apply
either way only reports. Like every repair command it bypasses the month locks: a cancelled bill
in a filed month moves too.

    python manage.py prepare_v2_rollback            # what would move
    python manage.py prepare_v2_rollback --apply
    python manage.py prepare_v2_rollback --reverse --apply
"""

from django.core.management.base import BaseCommand

from billing.constants import BILL_CANCELLED
from billing.models import BinnedInvoice, Invoice
from billing.refusals import Refusal
from billing.services.bin import bin_bill, restore_from_bin


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
        bills = list(Invoice.objects.sales().filter(status=BILL_CANCELLED).select_related("business", "customer"))
        for inv in bills:
            self.stdout.write(f"  {inv.business.name} {inv.invoice_number} of {inv.invoice_date}: cancelled "
                              f"({inv.cancel_reason or 'no reason given'})")
            if apply:
                bin_bill(inv, None, inv.cancel_reason, kind=BinnedInvoice.KIND_CANCELLED, check_month=False,
                         details=f"Cancelled in v3, set aside for v2: {inv.cancel_reason or 'no reason given'}")
        self.stdout.write(f"{len(bills)} cancelled bill(s) {'moved' if apply else 'to move'} to the bin for v2.")

    def _reverse(self, apply):
        # No join on the firm: a row whose firm v2 deleted is reported, not skipped (Ruling 1A-6).
        rows = list(BinnedInvoice.objects.filter(kind=BinnedInvoice.KIND_CANCELLED, restored_at__isnull=True))
        back = 0
        for binned in rows:
            where = f"  {binned.data.get('business_name', '')} {binned.invoice_number}"
            if not apply:
                self.stdout.write(f"{where}: to put back as cancelled")
                continue
            try:
                restore_from_bin(binned, None, check_month=False)
                back += 1
            except Refusal as refusal:
                self.stdout.write(f"{where}: left in the bin. {refusal.detail['detail']}")
        self.stdout.write(f"{back if apply else len(rows)} cancelled bill(s) {'put back' if apply else 'to put back'}.")
