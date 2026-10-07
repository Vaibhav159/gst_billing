"""Find (and optionally repair) lines whose quantity x rate is 0 but that carry an amount (H8).

Bulk import (and Backup restore, which uses it) stored a gross-only row with
no taxable value of its own: quantity = rate = 0, or the row's own quantity
with no rate (a weighed line, 10 x 0). Every GST output reads the taxable
value as quantity x rate, so those lines filed Rs 0 of taxable in GSTR-1
(B2CS, B2B, HSN), the GST summary and GSTR-3B, while their tax and amount
were right.

Read-only by default. Nothing is written without --apply.

    python manage.py fix_amount_only_lines                  # report only
    python manage.py fix_amount_only_lines --business 1     # scope to one firm
    python manage.py fix_amount_only_lines --apply          # restore the taxable value

The repair restores quantity x rate = amount - tax (the taxable value). It
keeps the line's weight (or price) when the other figure, to three decimals,
gives the taxable value to the paisa, and otherwise stores one unit at the
taxable value, as the GSTR-2A import does (tax_rules.unit_split). No amount,
tax head or total moves. A line whose amount is all tax has no taxable value
to restore: it is listed and left alone. A filed month listed here had its
taxable value under-reported in the return already filed: that is for the CA
to correct in a later return.
"""

from collections import Counter
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Q

from billing.management.commands._repair import add_scope_arguments, filed_months, invalidate, log_repair, scope
from billing.models import LineItem
from billing.tax_rules import unit_split


class Command(BaseCommand):
    help = "Report or repair lines whose quantity x rate is 0 but that carry an amount, which file Rs 0 of taxable (H8)."

    def add_arguments(self, parser):
        add_scope_arguments(parser, "quantity x rate = the taxable value")

    def handle(self, *args, **opts):
        qs = scope(LineItem.objects.filter(Q(quantity=0) | Q(rate=0), amount__gt=0), opts, "invoice__")
        lines = list(qs.select_related("invoice").order_by("invoice__invoice_date", "id"))
        if not lines:
            self.stdout.write(self.style.SUCCESS("No amount-only lines found."))
            return

        filed = filed_months()
        months, missing = Counter(), Counter()
        fixes, all_tax = [], []
        for li in lines:
            inv = li.invoice
            taxable = li.amount - (li.cgst or 0) - (li.sgst or 0) - (li.igst or 0)
            mark = "  FILED" if (inv.business_id, inv.invoice_date.year, inv.invoice_date.month) in filed else ""
            if taxable <= 0:
                all_tax.append((li, mark))
                continue
            key = (inv.business_id, inv.invoice_date.year, inv.invoice_date.month)
            months[key] += 1
            missing[key] += taxable
            quantity, rate = unit_split(li.quantity, li.rate, taxable)
            fixes.append((li, quantity, rate))
            self.stdout.write(
                f"  #{str(inv.invoice_number)[:14]:<14} {inv.invoice_date}  {inv.type_of_invoice:<7} "
                f"{li.product_name[:22]:<22} amount {li.amount}  {li.quantity} x {li.rate}: taxable on file 0, "
                f"really {taxable} ({quantity} x {rate}){mark}"
            )
        total = sum(missing.values(), Decimal("0"))
        if fixes:
            self.stdout.write(f"\n{len(fixes)} line(s) in {len(months)} month(s): {total} of taxable value reads as 0.")
        filed_hit = sorted(k for k in months if k in filed)
        if filed_hit:
            self.stdout.write(self.style.WARNING(
                "Filed months whose returns under-reported taxable value: "
                + ", ".join(f"{m:02d}/{y} (business {b}: {missing[(b, y, m)]})" for b, y, m in filed_hit)
            ))
        if all_tax:
            self.stdout.write(self.style.ERROR(
                f"\n{len(all_tax)} line(s) whose amount is all tax, so no taxable value can be restored. "
                "They are listed, not changed:"
            ))
            for li, mark in all_tax:
                self.stdout.write(f"  #{str(li.invoice.invoice_number)[:14]:<14} {li.invoice.invoice_date}  "
                                  f"{li.product_name[:22]:<22} amount {li.amount}, tax "
                                  f"{(li.cgst or 0) + (li.sgst or 0) + (li.igst or 0)}{mark}")

        if not opts["apply"]:
            self.stdout.write(self.style.NOTICE("\nDry run. Re-run with --apply to restore these lines' taxable value."))
            return
        for li, quantity, rate in fixes:
            li.quantity, li.rate = quantity, rate
        with transaction.atomic():
            LineItem.objects.bulk_update([li for li, _, _ in fixes], ["quantity", "rate"], batch_size=500)
            if fixes:
                log_repair("fix_amount_only_lines", "invoice",
                           f"restored the taxable value of {len(fixes)} line(s) ({total})",
                           lines=[li.pk for li, _, _ in fixes])
        invalidate(LineItem)
        self.stdout.write(self.style.SUCCESS(f"\nRepaired {len(fixes)} line(s)."))
