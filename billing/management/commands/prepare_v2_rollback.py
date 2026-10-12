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
    python manage.py prepare_v2_rollback --reverse --apply   # then: freeze_firm_snapshots --apply
"""

from contextlib import suppress

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Exists, OuterRef
from django.utils import timezone

from billing.cache import invalidate, uncached
from billing.constants import BILL_CANCELLED, ROLLBACK_GSTR1_LOCK
from billing.models import BinnedInvoice, Business, FiledPeriod, FilingMonth, FilingRecord, Invoice
from billing.numbering import lock_firms
from billing.refusals import Refusal
from billing.services.bin import bin_bill, restore_from_bin
from billing.tax_rules import chosen_place, default_place_of_supply

PROTECTED = ROLLBACK_GSTR1_LOCK


def _firm_names(rows):
    """Firm names for the report; a firm v2 deleted is still named by its id (Ruling 1A-6)."""
    ids = {row.business_id for row in rows}
    if not ids:
        return {}
    names = dict(uncached(Business).filter(pk__in=ids).values_list("pk", "name"))
    return {pk: names.get(pk) or f"Firm {pk}" for pk in ids}


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
        self._blacklist_tokens(apply)

    def _blacklist_tokens(self, apply):
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

        tokens = OutstandingToken.objects.filter(blacklistedtoken__isnull=True)
        count = tokens.count()
        if apply:
            BlacklistedToken.objects.bulk_create(
                [BlacklistedToken(token_id=pk) for pk in tokens.values_list("pk", flat=True)],
                batch_size=500, ignore_conflicts=True)
        self.stdout.write(f"{count} outstanding token(s) {'blacklisted' if apply else 'to blacklist'}. "
                          "Everyone must sign in once after the rollback to v2.")

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
        rows = list(uncached(FilingRecord).filter(kind="gstr1").exclude(Exists(unlocked)).exclude(Exists(filed3))
                    .only("business_id", "year", "month").order_by("business_id", "year", "month"))
        names = _firm_names(rows)
        for row in rows:
            self.stdout.write(f"  {names[row.business_id]} {row.year}-{row.month:02}: GSTR-1 only")
            if apply:
                with transaction.atomic():
                    lock_firms(row.business_id)
                    FiledPeriod.objects.get_or_create(business_id=row.business_id, year=row.year, month=row.month,
                        defaults={"note": PROTECTED})

    def _reverse_locks(self, apply):
        fields = ("business_id", "year", "month")
        months = list(uncached(FilingRecord).values_list(*fields).union(
            uncached(FiledPeriod).values_list(*fields), uncached(FilingMonth).values_list(*fields)).order_by(*fields))
        names = dict(uncached(Business).filter(pk__in={row[0] for row in months}).values_list("pk", "name"))
        removed = 0
        for business_id, year, month in months:
            with transaction.atomic():
                if apply:
                    lock_firms(business_id)
                scope = {"business_id": business_id, "year": year, "month": month}
                kinds = set(uncached(FilingRecord).filter(**scope).values_list("kind", flat=True))
                lock = uncached(FiledPeriod).filter(**scope).first()
                state = uncached(FilingMonth).filter(**scope).only(
                    "unlocked_at", "unlocked_by_id", "unlock_reason", "relocked_at", "relocked_by_id").first()
                where = f"  {names.get(business_id, f'Firm {business_id}')} {year}-{month:02}"
                protected = lock is not None and lock.note == PROTECTED
                unlocked = state is not None and state.unlocked_at is not None
                if protected and ("gstr3b" not in kinds or unlocked):
                    self.stdout.write(f"{where}: v2 rollback lock {'removed' if apply else 'to remove'}")
                    if apply:
                        lock.delete()
                    lock = None
                    removed += 1
                if lock is not None and not protected and unlocked:
                    self.stdout.write(f"{where}: month locked again in v2; "
                                      f"{'recorded as relocked' if apply else 'to record as relocked'}")
                    if apply:
                        state.unlocked_at, state.unlocked_by, state.unlock_reason = None, None, ""
                        state.relocked_at, state.relocked_by = timezone.now(), None
                        state.save(update_fields=["unlocked_at", "unlocked_by", "unlock_reason", "relocked_at", "relocked_by"])
                    unlocked = False
                # R3A-6: forward skipped a deliberate v3 unlock; without a new v2 lock it stays open.
                if "gstr3b" in kinds and not unlocked and (lock is None or protected):
                    if business_id not in names:
                        self.stdout.write(f"{where}: firm no longer exists; GSTR-3B lock could not be restored")
                        continue
                    self.stdout.write(f"{where}: GSTR-3B whole-month lock {'restored' if apply else 'to restore'}")
                    if apply:
                        note = "GSTR-3B recorded in v3; lock restored after v2 rollback"
                        if lock is None:
                            FiledPeriod.objects.create(**scope, note=note)
                        else:
                            lock.note = note
                            lock.save(update_fields=["note"])
                elif lock is not None and "gstr1" in kinds and "gstr3b" not in kinds:
                    self.stdout.write(f"{where}: GSTR-3B filed before the app; lock kept; add its filing details in v3")
        self.stdout.write(f"{removed} v2 rollback lock(s) {'removed' if apply else 'to remove'}. A month whose "
                          "GSTR-3B was filed on v2 needs its GSTR-3B recorded in v3.")

    def _reverse(self, apply):
        self._reverse_locks(apply)
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

        self._moved_firms(apply)

    def _moved_firms(self, apply):
        """Bills v2 moved to another firm while it ran: v2 doesn't know firm_snapshot, so they still carry the old
        firm's details and would print its name and GSTIN (Ruling 1A-45, part 7 Ruling 7-D14). --apply clears those
        snapshots; freeze_firm_snapshots --apply then freezes each bill's own firm. A snapshot without a firm id
        predates 1A-45 and is left alone."""
        rows = uncached(Invoice).filter(firm_snapshot__has_key="business_id").values_list(
            "pk", "business_id", "firm_snapshot__business_id", "invoice_number", "invoice_date")
        moved = [row for row in rows if str(row[2]) != str(row[1])]
        names = dict(uncached(Business).values_list("pk", "name")) if moved else {}
        for _pk, firm_id, frozen_id, number, day in moved:
            frozen_name = f"firm {frozen_id}"
            with suppress(TypeError, ValueError, OverflowError):
                frozen_name = names.get(int(frozen_id), frozen_name)
            self.stdout.write(f"  {names.get(firm_id, f'Firm {firm_id}')} {number} of {day}: frozen with "
                              f"{frozen_name}'s details")
        if apply and moved:
            with transaction.atomic():
                lock_firms(*sorted({firm_id for _pk, firm_id, *_rest in moved}))
                uncached(Invoice).filter(pk__in=[row[0] for row in moved]).update(firm_snapshot=None)
            invalidate(Invoice)
        self.stdout.write(f"{len(moved)} bill(s) moved to another firm while v2 ran: frozen details "
                          f"{'cleared' if apply else 'to clear'}. Run freeze_firm_snapshots --apply next.")
