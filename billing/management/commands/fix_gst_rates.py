"""Find (and optionally repair) GST rates stored a hundred times too large.

Every write path used to normalize rates with `value > 1 ? value / 100 : value`.
That reads correctly for 1.5/3/5/12/18/28 and wrongly for the two slabs at or
below 1, which were stored verbatim:

    0.25%  ->  stored 0.25  (read back as 25%)
    1%     ->  stored 1     (read back as 100%)

25% and 100% are not GST slabs, so the intent is recoverable — see
billing/tax_rules.py.

Read-only by default. Nothing is written without --apply.

    python manage.py fix_gst_rates                   # report only
    python manage.py fix_gst_rates --business 1      # scope to one firm
    python manage.py fix_gst_rates --from 2026-04-01 # scope to an FY
    python manage.py fix_gst_rates --apply           # write the fix

Only the rate column is rewritten. Recorded cgst/sgst/igst and amounts are
never touched, so no invoice total moves and no filed figure changes silently.

Freshly created lines normally have the *right* tax already — the amount came
from the product master while only the rate field was mis-stored — so fixing
the rate makes the row self-consistent. A line that was edited after creation
may have been recomputed at the inflated rate; those have tax that disagrees
with the repaired rate, and are listed separately at the end. Deciding what a
filed invoice should say is not a thing a script should do on its own.
"""

from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from billing.models import LineItem, Product
from billing.tax_rules import GST_SLABS, normalize_rate, rate_as_percent


def _misstored(stored):
    """True when the slab allowlist disagrees with reading `stored` as a fraction.

    A correctly stored 0.03 reads as 3% either way. A mis-stored 0.25 reads as
    0.25% by the allowlist and 25% as a plain fraction — that gap is the bug.
    """
    if stored is None:
        return False
    return rate_as_percent(stored) != Decimal(str(stored)) * 100


class Command(BaseCommand):
    help = "Report or repair GST rates stored 100x too large (the 0.25% and 1% slabs)."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true",
                            help="Write the corrected rates. Without this, reports only.")
        parser.add_argument("--business", type=int, default=None, help="Limit to one business id.")
        parser.add_argument("--from", dest="date_from", default=None, help="Invoice date >= YYYY-MM-DD.")
        parser.add_argument("--to", dest="date_to", default=None, help="Invoice date <= YYYY-MM-DD.")

    def handle(self, *args, **opts):
        # Only a value equal to a non-zero slab *percent* can be mis-stored
        # (0.25 meaning 0.25%, 1 meaning 1%), so let the database narrow the
        # candidates instead of pulling every line item into Python.
        suspects = [slab for slab in GST_SLABS if slab]
        products = [
            p for p in Product.objects.filter(gst_tax_rate__in=suspects)
            if _misstored(p.gst_tax_rate)
        ]

        qs = (
            LineItem.objects.filter(gst_tax_rate__in=suspects)
            .select_related("invoice")
            .order_by("id")
        )
        if opts["business"]:
            qs = qs.filter(invoice__business_id=opts["business"])
        if opts["date_from"]:
            qs = qs.filter(invoice__invoice_date__gte=opts["date_from"])
        if opts["date_to"]:
            qs = qs.filter(invoice__invoice_date__lte=opts["date_to"])
        lines = [li for li in qs if _misstored(li.gst_tax_rate)]

        if not products and not lines:
            self.stdout.write(self.style.SUCCESS("No mis-stored GST rates found."))
            return

        if products:
            self.stdout.write(self.style.WARNING(f"\n{len(products)} product(s) in the master:\n"))
            for p in products:
                self.stdout.write(
                    f"  {p.name[:34]:<34} {p.gst_tax_rate}  ->  "
                    f"{normalize_rate(p.gst_tax_rate, assume='fraction')}  "
                    f"({rate_as_percent(p.gst_tax_rate)}%)"
                )

        recomputed = []
        if lines:
            self.stdout.write(self.style.WARNING(f"\n{len(lines)} line item(s):\n"))
            for li in lines:
                fixed = normalize_rate(li.gst_tax_rate, assume="fraction")
                recorded = (li.cgst or 0) + (li.sgst or 0) + (li.igst or 0)
                net = (li.quantity or 0) * (li.rate or 0)
                if net == 0:
                    # Amount-only rows (bulk import stores qty=rate=0 for them):
                    # the taxable value is whatever is left of the gross.
                    net = (li.amount or 0) - recorded
                expected = net * fixed
                # Tax closer to the inflated rate than the true one means this
                # line was recomputed while the bug was live.
                if abs(recorded - expected) > abs(recorded - net * Decimal(str(li.gst_tax_rate))):
                    recomputed.append((li, recorded, expected))
                self.stdout.write(
                    f"  inv #{str(getattr(li.invoice, 'invoice_number', '?'))[:14]:<14} "
                    f"{li.product_name[:22]:<22} {li.gst_tax_rate} -> {fixed}  "
                    f"({rate_as_percent(li.gst_tax_rate)}%)  tax on file {recorded:>12}"
                )

        self.stdout.write(
            f"\n{len(products)} product(s) and {len(lines)} line item(s). "
            "Only the rate column is rewritten — no amount or tax figure moves."
        )

        if recomputed:
            self.stdout.write(self.style.ERROR(
                f"\n{len(recomputed)} line(s) also carry tax computed at the inflated "
                "rate. The rate fix alone will NOT correct these — their money is "
                "wrong on file and needs a human decision:\n"
            ))
            for li, recorded, expected in recomputed:
                self.stdout.write(
                    f"  inv #{str(getattr(li.invoice, 'invoice_number', '?'))[:14]:<14} "
                    f"{li.product_name[:22]:<22} tax on file {recorded:>12}, "
                    f"correct rate implies {expected:>12}"
                )

        if not opts["apply"]:
            self.stdout.write(self.style.NOTICE("\nDry run. Re-run with --apply to write these changes."))
            return

        with transaction.atomic():
            for p in products:
                Product.objects.filter(pk=p.pk).update(
                    gst_tax_rate=normalize_rate(p.gst_tax_rate, assume="fraction")
                )
            for li in lines:
                LineItem.objects.filter(pk=li.pk).update(
                    gst_tax_rate=normalize_rate(li.gst_tax_rate, assume="fraction")
                )
        self.stdout.write(self.style.SUCCESS(
            f"\nRepaired {len(products)} product(s) and {len(lines)} line item(s)."
        ))
