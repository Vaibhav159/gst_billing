"""List purchases that are the same bill on file twice (review of M28 and H7).

Before M28 each purchase door had its own duplicate rule, so "SJ-101" from
the inward form and "SJ/101" from bulk import or AI import both counted. And
before H7 an undo of a deleted purchase could be used again, restoring a
copy per click. Either way the bill's input tax credit was claimed twice.

The one rule now refuses a new copy (find_duplicate: same firm, same supplier
by GSTIN, the number spelt one way, same FY). This lists the copies already
on file by that rule, with the ITC each later copy claims again and whether
its month is filed.

Read-only: it changes nothing. Delete a copy from the app (admins), which
checks the filed-month lock and can be undone once.

    python manage.py check_inward_duplicates
    python manage.py check_inward_duplicates --business 1 --from 2025-04-01
"""

from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db.models import DecimalField, F, Sum
from django.db.models.functions import Coalesce

from billing.api.inward_bills_service import fy_start, inward_number_key, supplier_key
from billing.constants import INVOICE_TYPE_INWARD
from billing.management.commands._repair import filed_months, scope
from billing.models import Invoice


class Command(BaseCommand):
    help = "Report purchases on file twice under the one duplicate rule, and the ITC claimed again (read-only)."

    def add_arguments(self, parser):
        parser.add_argument("--business", type=int, default=None, help="Limit to one business id.")
        parser.add_argument("--from", dest="date_from", default=None, help="Bill date >= YYYY-MM-DD.")
        parser.add_argument("--to", dest="date_to", default=None, help="Bill date <= YYYY-MM-DD.")

    def handle(self, *args, **opts):
        bills = (
            scope(Invoice.objects.filter(type_of_invoice=INVOICE_TYPE_INWARD), opts)
            .select_related("business", "customer")
            .annotate(itc=Coalesce(Sum(F("lineitem__cgst") + F("lineitem__sgst") + F("lineitem__igst")),
                                   Decimal("0"), output_field=DecimalField()))
            .order_by("invoice_date", "id")
        )
        groups = {}
        for bill in bills:
            key, start = inward_number_key(bill.invoice_number), fy_start(bill.invoice_date)
            if key and start:
                groups.setdefault((bill.business_id, supplier_key(bill.customer), start, key), []).append(bill)
        repeats = {k: g for k, g in groups.items() if len(g) > 1}
        if not repeats:
            self.stdout.write(self.style.SUCCESS("No purchase is on file twice."))
            return

        filed = filed_months()
        copies, again = 0, Decimal("0")
        for (_, _, start, key), group in sorted(repeats.items(), key=lambda kv: (kv[1][0].invoice_date, kv[0][3])):
            first = group[0]
            self.stdout.write(f"\n{first.business.name}: {first.customer.name} ({first.customer.gst_number or 'no GSTIN'}), "
                              f"FY {start.year}-{str(start.year + 1)[2:]}, bill {key}")
            for i, bill in enumerate(group):
                mark = "  FILED" if (bill.business_id, bill.invoice_date.year, bill.invoice_date.month) in filed else ""
                self.stdout.write(f"  #{bill.pk:<7} {bill.invoice_number[:16]:<16} {bill.invoice_date}  "
                                  f"total {bill.total_amount}  ITC {bill.itc}{'  (first)' if i == 0 else ''}{mark}")
            copies += len(group) - 1
            again += sum((bill.itc for bill in group[1:]), Decimal("0"))
        self.stdout.write(self.style.WARNING(
            f"\n{copies} bill(s) repeat another on file; together they claim {again} of ITC a second time. "
            "Check each against the supplier's bill and GSTR-2B before deleting a copy in the app."
        ))
