"""Find (and optionally repair) tax heads stored with fractions of a paisa.

Until H13 the server re-split every intra-state line's tax as total / 2, so an
odd-paise tax of 16.49 was stored as 8.245 + 8.245. Each document then rounded
the half-paise its own way: 8.25 + 8.25 on the classic print, 8.24 + 8.24 in
the Tally PDF, the Excel export and GSTR-1, beside a total of 16.49. Lines the
importers derived (tax = taxable x rate) could carry any number of decimals.

Read-only by default. Nothing is written without --apply.

    python manage.py fix_tax_splits                     # report only
    python manage.py fix_tax_splits --business 1        # scope to one firm
    python manage.py fix_tax_splits --from 2026-04-01   # scope to an FY
    python manage.py fix_tax_splits --apply             # write the fix

The repair rounds each line's tax to the paisa and splits it the way the form
and the server now do: CGST the half rounded up, SGST the rest. IGST is rounded.
The line amount is never touched, so no invoice total moves. A filed month's
GSTR-1 heads move by at most a paisa per line, and those months are marked.
Lines carrying both IGST and CGST/SGST are only listed: fix_tax_heads decides
their head first.
"""

from collections import Counter

from django.core.management.base import BaseCommand
from django.db import transaction

from billing.management.commands._repair import add_scope_arguments, filed_months, invalidate, scope
from billing.models import LineItem
from billing.tax_rules import split_tax, to_paise


def _in_paise(value):
    return value is None or value == to_paise(value)


class Command(BaseCommand):
    help = "Report or repair CGST/SGST/IGST stored with fractions of a paisa (H13)."

    def add_arguments(self, parser):
        add_scope_arguments(parser, "the paise-exact heads")

    def handle(self, *args, **opts):
        qs = scope(LineItem.objects.select_related("invoice"), opts, "invoice__")
        qs = qs.order_by("invoice__invoice_date", "invoice_id", "id")
        filed = filed_months()
        fixes, mixed = [], []
        for li in qs.iterator(chunk_size=2000):
            cgst, sgst, igst = li.cgst or 0, li.sgst or 0, li.igst or 0
            if _in_paise(cgst) and _in_paise(sgst) and _in_paise(igst):
                continue
            if igst and (cgst or sgst):
                mixed.append(li)
                continue
            fixes.append((li, split_tax(cgst + sgst + igst, bool(igst))))

        if not fixes and not mixed:
            self.stdout.write(self.style.SUCCESS("No half-paise tax heads found."))
            return

        months = Counter()
        for li, (c, s, i) in fixes:
            inv = li.invoice
            key = (inv.business_id, inv.invoice_date.year, inv.invoice_date.month)
            months[key] += 1
            mark = "  FILED" if key in filed else ""
            before = f"IGST {li.igst}" if li.igst else f"{li.cgst} + {li.sgst}"
            after = f"IGST {i}" if i else f"{c} + {s}"
            self.stdout.write(
                f"  #{str(inv.invoice_number)[:14]:<14} {inv.invoice_date}  {li.product_name[:22]:<22} "
                f"{before}  ->  {after}{mark}"
            )

        moved = sum(abs((c + s + i) - ((li.cgst or 0) + (li.sgst or 0) + (li.igst or 0))) for li, (c, s, i) in fixes)
        self.stdout.write(
            f"\n{len(fixes)} line(s) in {len(months)} month(s). Amounts and invoice totals don't move; "
            f"each line's tax changes by under a paisa ({moved} in all)."
        )
        filed_hit = sorted(k for k in months if k in filed)
        if filed_hit:
            self.stdout.write(self.style.WARNING(
                "Filed months whose GSTR-1 heads would move by a paisa or less per line: "
                + ", ".join(f"{m:02d}/{y} (business {b}, {months[(b, y, m)]} line(s))" for b, y, m in filed_hit)
            ))
        if mixed:
            self.stdout.write(self.style.ERROR(
                f"\n{len(mixed)} line(s) carry both IGST and CGST/SGST. Run fix_tax_heads first; "
                "they are not touched here:"
            ))
            for li in mixed:
                self.stdout.write(f"  #{li.invoice.invoice_number}  {li.product_name[:22]}  "
                                  f"{li.cgst} + {li.sgst} + IGST {li.igst}")

        if not opts["apply"]:
            self.stdout.write(self.style.NOTICE("\nDry run. Re-run with --apply to write these changes."))
            return

        with transaction.atomic():
            for li, (c, s, i) in fixes:
                LineItem.objects.filter(pk=li.pk).update(cgst=c, sgst=s, igst=i)
        invalidate(LineItem)
        self.stdout.write(self.style.SUCCESS(f"\nRe-split {len(fixes)} line(s)."))
