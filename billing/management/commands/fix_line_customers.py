"""Find (and optionally re-point) line items whose customer isn't their invoice's (H6).

A header PATCH, the Django admin and undo used to change invoice.customer
without touching the lines. While LineItem.customer was CASCADE, deleting the
old customer then deleted those lines, filed months included. It is PROTECT
now and every save re-points the lines, but rows that drifted before stay as
they are until this runs. While one does, the old customer can't be deleted
(the app answers 409).

Read-only by default. Nothing is written without --apply.

    python manage.py fix_line_customers                   # report only
    python manage.py fix_line_customers --business 1      # scope to one firm
    python manage.py fix_line_customers --apply           # re-point the lines

Only the line's customer changes. No amount, tax head or total moves.

It also lists invoices with no lines at all, which is what the cascade left
behind: the lines went with the customer and the line signals re-summed the
total to 0, so no total looks wrong. Those lines can only come back from a
backup taken before the delete; the command never touches those invoices.
"""

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import F, OuterRef, Subquery

from billing.management.commands._repair import add_scope_arguments, filed_months, invalidate, scope
from billing.models import Invoice, LineItem


class Command(BaseCommand):
    help = "Report or re-point line items whose customer differs from their invoice's (H6)."

    def add_arguments(self, parser):
        add_scope_arguments(parser, "the invoice's customer onto each line")

    def handle(self, *args, **opts):
        qs = scope(LineItem.objects.exclude(customer_id=F("invoice__customer_id")), opts, "invoice__")
        qs = qs.select_related("invoice", "invoice__customer", "customer").order_by("invoice__invoice_date", "id")
        lines = list(qs)
        filed = filed_months()
        self._report_empty_invoices(opts, filed)
        if not lines:
            self.stdout.write(self.style.SUCCESS("No line items name a customer other than their invoice's."))
            return

        invoices = {li.invoice_id for li in lines}
        self.stdout.write(self.style.WARNING(f"\n{len(lines)} line item(s) on {len(invoices)} invoice(s):\n"))
        for li in lines:
            inv = li.invoice
            mark = "  FILED" if (inv.business_id, inv.invoice_date.year, inv.invoice_date.month) in filed else ""
            self.stdout.write(
                f"  #{str(inv.invoice_number)[:14]:<14} {inv.invoice_date}  {li.product_name[:22]:<22} "
                f"line names {li.customer.name[:26]!r}, invoice is {inv.customer.name[:26]!r}{mark}"
            )
        self.stdout.write("\nOnly the line's customer changes; no amount, head or total moves.")

        if not opts["apply"]:
            self.stdout.write(self.style.NOTICE("\nDry run. Re-run with --apply to re-point these lines."))
            return
        with transaction.atomic():
            LineItem.objects.filter(pk__in=[li.pk for li in lines]).update(
                customer_id=Subquery(Invoice.objects.filter(pk=OuterRef("invoice_id")).values("customer_id")[:1])
            )
        invalidate(LineItem)
        self.stdout.write(self.style.SUCCESS(f"\nRe-pointed {len(lines)} line item(s)."))

    def _report_empty_invoices(self, opts, filed):
        empty = list(
            scope(Invoice.objects.filter(lineitem__isnull=True), opts)
            .select_related("business", "customer")
            .order_by("invoice_date", "id")
        )
        if not empty:
            return
        self.stdout.write(
            self.style.ERROR(
                f"\n{len(empty)} invoice(s) have no lines. Deleting a customer used to take the lines of "
                "invoices that had moved to another party, leaving them like this; only a backup from "
                "before the delete has those lines. They are listed, never changed:"
            )
        )
        for inv in empty:
            mark = "  FILED" if (inv.business_id, inv.invoice_date.year, inv.invoice_date.month) in filed else ""
            self.stdout.write(
                f"  #{str(inv.invoice_number)[:14]:<14} {inv.invoice_date}  {inv.type_of_invoice:<7} "
                f"{inv.business.name[:24]:<24} {inv.customer.name[:24]!r}  total {inv.total_amount}{mark}"
            )
