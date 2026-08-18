"""Find (and optionally repair) line items filed under the wrong GST head.

Interstate sales created through the V2 invoice form were saved as CGST+SGST
because the form's business/customer lookup compared a number id against a
string id and silently failed, so the auto-IGST switch never fired. The grand
total was always right, which is why nothing looked wrong on screen — but
GSTR-1 and GSTR-3B report the wrong heads and the buyer's ITC won't match.

Read-only by default. Nothing is written without --apply.

    python manage.py fix_tax_heads                      # report only
    python manage.py fix_tax_heads --business 1         # scope to one firm
    python manage.py fix_tax_heads --from 2026-04-01    # scope to an FY
    python manage.py fix_tax_heads --apply              # write the fix

The repair preserves each line's total tax and its amount — only the column
changes — so invoice totals never move.
"""

from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from billing.tax_rules import is_interstate, normalize_tax_heads
from billing.models import Invoice, LineItem


class Command(BaseCommand):
    help = "Report or repair line items whose CGST/SGST/IGST split contradicts the supply direction."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true",
                            help="Write the corrected heads. Without this, reports only.")
        parser.add_argument("--business", type=int, default=None, help="Limit to one business id.")
        parser.add_argument("--from", dest="date_from", default=None, help="Invoice date >= YYYY-MM-DD.")
        parser.add_argument("--to", dest="date_to", default=None, help="Invoice date <= YYYY-MM-DD.")

    def handle(self, *args, **opts):
        qs = Invoice.objects.select_related("business", "customer").prefetch_related("lineitem_set")
        if opts["business"]:
            qs = qs.filter(business_id=opts["business"])
        if opts["date_from"]:
            qs = qs.filter(invoice_date__gte=opts["date_from"])
        if opts["date_to"]:
            qs = qs.filter(invoice_date__lte=opts["date_to"])

        wrong = []
        for inv in qs:
            interstate = is_interstate(inv.business, inv.customer)
            for li in inv.lineitem_set.all():
                total = (li.cgst or 0) + (li.sgst or 0) + (li.igst or 0)
                if total == 0:
                    continue
                filed_interstate = (li.igst or 0) > 0 and (li.cgst or 0) == 0 and (li.sgst or 0) == 0
                if filed_interstate != interstate:
                    wrong.append((inv, li, interstate, Decimal(total)))

        if not wrong:
            self.stdout.write(self.style.SUCCESS("No mis-filed tax heads found."))
            return

        self.stdout.write(
            self.style.WARNING(f"{len(wrong)} line item(s) filed under the wrong head:\n")
        )
        seen_invoices = set()
        for inv, li, interstate, total in wrong:
            seen_invoices.add(inv.id)
            should = "IGST" if interstate else "CGST+SGST"
            now = "IGST" if (li.igst or 0) > 0 else "CGST+SGST"
            self.stdout.write(
                f"  #{inv.invoice_number:<18} {inv.business.gst_number[:2]}→"
                f"{(inv.customer.gst_number or '--')[:2]}  {inv.invoice_date}  "
                f"{li.product_name[:22]:<22} tax {total:>10}  filed {now:<9} should be {should}"
            )

        self.stdout.write(
            f"\n{len(wrong)} line item(s) across {len(seen_invoices)} invoice(s). "
            "Totals will not change — only which column the tax sits in."
        )

        if not opts["apply"]:
            self.stdout.write(self.style.NOTICE("\nDry run. Re-run with --apply to write these changes."))
            return

        with transaction.atomic():
            for _inv, li, interstate, _total in wrong:
                li.cgst, li.sgst, li.igst = normalize_tax_heads(
                    li.cgst, li.sgst, li.igst, interstate
                )
                LineItem.objects.filter(pk=li.pk).update(
                    cgst=li.cgst, sgst=li.sgst, igst=li.igst
                )
        self.stdout.write(self.style.SUCCESS(f"\nRepaired {len(wrong)} line item(s)."))
