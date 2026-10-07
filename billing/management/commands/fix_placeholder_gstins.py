"""Find (and optionally blank) GSTINs that are placeholders, not GSTINs (H12).

"NA", "URP", "-" or a mistyped 14 characters stored as a party's GSTIN used to
be read as a registration: its first two characters became the state code, so
a local walk-in saved with "NA" was booked as IGST and filed in GSTR-1 with
pos "NA", and bulk import put every walk-in typed "URP" on one customer.

Read-only by default. Nothing is written without --apply.

    python manage.py fix_placeholder_gstins              # report only
    python manage.py fix_placeholder_gstins --business 1 # parties of one firm
    python manage.py fix_placeholder_gstins --apply      # blank the customers' values

The app already ignores placeholders when it reads them. Blanking them makes
the stored party say so too. A mistyped GSTIN (one with digits that isn't a
GSTIN) is listed but never blanked: blank, a registered buyer would turn B2C
and lose the credit. A person corrects it on the party. Lines already filed under the head a placeholder
implied are listed. fix_tax_heads (report only) re-files them, preserving every
total. A firm with a placeholder is reported, never changed: it needs its real
GSTIN, set on the Businesses page.
"""

from types import SimpleNamespace

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Q

from billing.management.commands._repair import fresh_lines, invalidate, log_repair
from billing.models import Business, Customer, Invoice
from billing.tax_rules import gstin_problem, has_gstin, is_interstate


def _placeholders(qs):
    return [p for p in qs.exclude(gst_number__isnull=True).exclude(gst_number="") if not has_gstin(p.gst_number)]


def _mistyped(party):
    return bool(gstin_problem(party.gst_number))


class Command(BaseCommand):
    help = "Report or blank party GSTINs that are placeholders (NA, URP, -, mistyped) (H12)."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true",
                            help="Blank the customers' placeholder GSTINs. Without this, reports only.")
        parser.add_argument("--business", type=int, default=None,
                            help="Only parties linked to, or invoiced by, this business id.")

    def handle(self, *args, **opts):
        # Read past cacheops, as every repair does (_repair.scope).
        customers = Customer.objects.nocache().order_by("name")
        firms = Business.objects.nocache().order_by("name")
        if opts["business"]:
            customers = customers.filter(
                Q(businesses__id=opts["business"]) | Q(invoice__business_id=opts["business"])
            ).distinct()
            firms = firms.filter(id=opts["business"])
        bad_customers = _placeholders(customers)
        bad_firms = _placeholders(firms)

        if not bad_customers and not bad_firms:
            self.stdout.write(self.style.SUCCESS("No placeholder GSTINs found."))
            return

        refile_total = 0
        if bad_customers:
            self.stdout.write(self.style.WARNING(f"\n{len(bad_customers)} customer(s) with a placeholder GSTIN:\n"))
        for c in bad_customers:
            invoices = (Invoice.objects.nocache().filter(customer=c).select_related("business")
                        .prefetch_related(fresh_lines()))
            sales = sum(1 for inv in invoices if inv.type_of_invoice == "outward")
            purchases = sum(1 for inv in invoices if inv.type_of_invoice == "inward")
            # The head each line would be filed under once the placeholder is
            # gone, against the head it carries.
            unregistered = SimpleNamespace(gst_number="", state_name=c.state_name)
            refile = 0
            for inv in invoices:
                inter = is_interstate(inv.business, unregistered)
                for li in inv.lineitem_set.all():
                    on_igst = bool(li.igst) and not (li.cgst or li.sgst)
                    taxed = bool(li.igst or li.cgst or li.sgst)
                    if taxed and on_igst != inter:
                        refile += 1
            refile_total += refile
            self.stdout.write(
                f"  {c.name[:34]:<34} {c.gst_number!r:<18} {sales} sale(s), {purchases} purchase(s)"
                + (f"; {refile} line(s) under the other head" if refile else "")
                + ("  MISTYPED: correct it on the customer; never blanked" if _mistyped(c) else "")
            )

        if bad_firms:
            self.stdout.write(self.style.ERROR(
                f"\n{len(bad_firms)} firm(s) with a placeholder GSTIN. Set the real GSTIN on the "
                "Businesses page; this command doesn't change firms:"
            ))
            for b in bad_firms:
                self.stdout.write(f"  {b.name[:34]:<34} {b.gst_number!r}")

        if refile_total:
            self.stdout.write(self.style.WARNING(
                f"\n{refile_total} line(s) were filed under the head the placeholder implied. After blanking, "
                "run `manage.py fix_tax_heads` (report only) to see them re-filed with totals unchanged."
            ))
        if bad_customers:
            self.stdout.write(
                "Bulk imports put walk-ins sharing a placeholder on one customer: check these customers' "
                "invoices belong to them before relying on their statements."
            )

        if not opts["apply"]:
            self.stdout.write(self.style.NOTICE("\nDry run. Re-run with --apply to blank the customers' values."))
            return
        placeholders = [c for c in bad_customers if not _mistyped(c)]
        if placeholders:
            with transaction.atomic():
                Customer.objects.filter(pk__in=[c.pk for c in placeholders]).update(gst_number="")
                log_repair("fix_placeholder_gstins", "customer",
                           f"blanked {len(placeholders)} placeholder GSTIN(s): "
                           + ", ".join(f"{c.name} ({c.gst_number!r})" for c in placeholders[:20]),
                           customers=[c.pk for c in placeholders])
            invalidate(Customer, Invoice)
        self.stdout.write(self.style.SUCCESS(f"\nBlanked {len(placeholders)} customer GSTIN(s)."))
        if len(placeholders) < len(bad_customers):
            self.stdout.write(self.style.WARNING(
                f"{len(bad_customers) - len(placeholders)} mistyped GSTIN(s) left as they are: correct them by hand."))
