"""Find (and optionally re-sum) invoice headers whose total isn't their lines' sum.

An invoice's total is the sum of its line amounts: dashboards read the
header, the GSTR tables read the lines. Two paths broke that. Undo of an
"updated" invoice copied a stale total back over changed lines (M9), and a
line-item PATCH could move a line to another invoice, leaving the source's
total behind (H5). Both are fixed; this measures what they left.

Read-only by default. Nothing is written without --apply.

    python manage.py fix_invoice_totals                  # report only
    python manage.py fix_invoice_totals --business 1     # scope to one firm
    python manage.py fix_invoice_totals --apply          # re-sum the headers

Only headers change, to the sum of their lines; no line moves. An invoice
with no lines but a total is listed and never zeroed: which is wrong there,
the header or the missing lines, is for a person to decide.
"""

from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Count, DecimalField, F, OuterRef, Subquery, Sum
from django.db.models.functions import Coalesce

from billing.management.commands._repair import add_scope_arguments, filed_months, invalidate, scope
from billing.models import Invoice, LineItem


class Command(BaseCommand):
    help = "Report or re-sum invoice totals that disagree with their line items (M9, H5)."

    def add_arguments(self, parser):
        add_scope_arguments(parser, "each total as the sum of its lines")

    def handle(self, *args, **opts):
        line_sum = (LineItem.objects.filter(invoice=OuterRef("pk")).values("invoice")
                    .annotate(s=Sum("amount")).values("s"))
        qs = scope(Invoice.objects.select_related("business"), opts).annotate(
            lines_total=Coalesce(Subquery(line_sum, output_field=DecimalField()), Decimal("0"),
                                 output_field=DecimalField()),
            line_count=Coalesce(Subquery(
                LineItem.objects.filter(invoice=OuterRef("pk")).values("invoice")
                .annotate(c=Count("id")).values("c")), 0),
        ).exclude(total_amount=F("lines_total")).order_by("invoice_date", "id")
        stale = list(qs)  # compared in SQL: a production book is too big to load whole
        if not stale:
            self.stdout.write(self.style.SUCCESS("No invoice totals disagree with their lines."))
            return

        filed = filed_months()
        fixable = [inv for inv in stale if inv.line_count]
        empty = [inv for inv in stale if not inv.line_count]
        if fixable:
            self.stdout.write(self.style.WARNING(f"\n{len(fixable)} invoice(s) whose total isn't their lines' sum:\n"))
        for inv in fixable:
            mark = "  FILED" if (inv.business_id, inv.invoice_date.year, inv.invoice_date.month) in filed else ""
            self.stdout.write(
                f"  #{str(inv.invoice_number)[:14]:<14} {inv.invoice_date}  {inv.business.name[:24]:<24} "
                f"header {inv.total_amount}  lines {inv.lines_total}{mark}"
            )
        if empty:
            self.stdout.write(self.style.ERROR(
                f"\n{len(empty)} invoice(s) carry a total but no lines. They are listed, not changed:"
            ))
            for inv in empty:
                self.stdout.write(f"  #{str(inv.invoice_number)[:14]:<14} {inv.invoice_date}  header {inv.total_amount}")

        if not opts["apply"]:
            self.stdout.write(self.style.NOTICE("\nDry run. Re-run with --apply to re-sum these headers."))
            return
        # The sum as the database has it when it writes, not as it was read.
        with transaction.atomic():
            Invoice.objects.filter(pk__in=[inv.pk for inv in fixable]).update(
                total_amount=Coalesce(Subquery(line_sum, output_field=DecimalField()), Decimal("0"),
                                      output_field=DecimalField())
            )
        invalidate(Invoice)
        self.stdout.write(self.style.SUCCESS(f"\nRe-summed {len(fixable)} invoice total(s)."))
