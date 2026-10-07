"""Find (and optionally repair) lines stored as quantity 0 x rate 0 with an amount (H8).

Bulk import (and Backup restore, which uses it) stored a gross-only row as
quantity = rate = 0 after backing out its taxable value for the tax. Every
GST output reads the taxable value as quantity x rate, so those lines filed
Rs 0 of taxable in GSTR-1 (B2CS, B2B, HSN), the GST summary and GSTR-3B,
while their tax and amount were right.

Read-only by default. Nothing is written without --apply.

    python manage.py fix_amount_only_lines                  # report only
    python manage.py fix_amount_only_lines --business 1     # scope to one firm
    python manage.py fix_amount_only_lines --apply          # restore the taxable value

The repair stores quantity 1 and rate = amount - tax (the taxable value), as
the GSTR-2A import does. No amount, tax head or total moves. A filed month
listed here had its taxable value under-reported in the return already filed:
that is for the CA to correct in a later return.
"""

from collections import Counter
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from billing.management.commands._repair import add_scope_arguments, filed_months, invalidate, scope
from billing.models import LineItem


class Command(BaseCommand):
    help = "Report or repair lines stored as 0 x 0 with an amount, which file Rs 0 of taxable (H8)."

    def add_arguments(self, parser):
        add_scope_arguments(parser, "quantity 1 and rate = the taxable value")

    def handle(self, *args, **opts):
        qs = scope(LineItem.objects.filter(quantity=0, rate=0, amount__gt=0), opts, "invoice__")
        lines = list(qs.select_related("invoice").order_by("invoice__invoice_date", "id"))
        if not lines:
            self.stdout.write(self.style.SUCCESS("No amount-only lines found."))
            return

        filed = filed_months()
        months, missing = Counter(), Counter()
        for li in lines:
            inv = li.invoice
            taxable = li.amount - (li.cgst or 0) - (li.sgst or 0) - (li.igst or 0)
            key = (inv.business_id, inv.invoice_date.year, inv.invoice_date.month)
            months[key] += 1
            missing[key] += taxable
            self.stdout.write(
                f"  #{str(inv.invoice_number)[:14]:<14} {inv.invoice_date}  {inv.type_of_invoice:<7} "
                f"{li.product_name[:22]:<22} amount {li.amount}  taxable on file 0, really {taxable}"
                + ("  FILED" if key in filed else "")
            )
        total = sum(missing.values(), Decimal("0"))
        self.stdout.write(f"\n{len(lines)} line(s) in {len(months)} month(s): {total} of taxable value reads as 0.")
        filed_hit = sorted(k for k in months if k in filed)
        if filed_hit:
            self.stdout.write(self.style.WARNING(
                "Filed months whose returns under-reported taxable value: "
                + ", ".join(f"{m:02d}/{y} (business {b}: {missing[(b, y, m)]})" for b, y, m in filed_hit)
            ))

        if not opts["apply"]:
            self.stdout.write(self.style.NOTICE("\nDry run. Re-run with --apply to restore these lines' taxable value."))
            return
        with transaction.atomic():
            for li in lines:
                taxable = li.amount - (li.cgst or 0) - (li.sgst or 0) - (li.igst or 0)
                LineItem.objects.filter(pk=li.pk).update(quantity=Decimal("1"), rate=taxable)
        invalidate(LineItem)
        self.stdout.write(self.style.SUCCESS(f"\nRepaired {len(lines)} line(s)."))
