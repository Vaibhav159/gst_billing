"""Mark the counter's existing walk-in record at the switch to v3 (part 7, X-83).

Run during the switch's closed window. The default only lists customers without a GSTIN,
with the most cash sales first. Nothing is selected by name or created implicitly.

    python manage.py mark_walkin
    python manage.py mark_walkin --id 42 --apply
    python manage.py mark_walkin --add --apply  # only when there is no counter customer to choose
"""

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Count, Max, Q

from billing.cache import invalidate, uncached
from billing.models import Customer, Invoice
from billing.tax_rules import has_gstin, registered

NAME = "Walk-in Customer"
CHOOSE = "Choose a customer with --id, or add a new one with --add."


class Command(BaseCommand):
    help = "Mark the counter's walk-in customer for v3; dry run unless --apply is given."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Make the change; without it, only report.")
        choice = parser.add_mutually_exclusive_group()
        choice.add_argument("--id", type=int, help="Mark this existing customer as the walk-in record.")
        choice.add_argument("--add", action="store_true", help=f'Add a new customer "{NAME}" as the walk-in record.')

    def handle(self, *args, **opts):
        marked = uncached(Customer).filter(customer_type="walkin").only("pk", "name").order_by("pk").first()
        if marked:
            self.stdout.write(f"Already marked: {marked.name} (id {marked.pk}). Nothing to do.")
            return
        self._candidates()
        if opts["id"] is None and not opts["add"]:
            if opts["apply"]:
                raise CommandError(CHOOSE)
            self.stdout.write(CHOOSE)
            self.stdout.write("Dry run: nothing changed. Run again with --apply.")
            return
        target = self._target(opts["id"])
        if not opts["apply"]:
            what = f"mark {target.name} (id {target.pk})" if target else f'add a new customer "{NAME}"'
            self.stdout.write(f"Would {what} as the walk-in record.")
            self.stdout.write("Dry run: nothing changed. Run again with --apply.")
            return
        if target is None:
            target = Customer.objects.create(name=NAME, customer_type="walkin")
        else:
            uncached(Customer).filter(pk=target.pk).update(customer_type="walkin")
            invalidate(Customer)
        self.stdout.write(f"Marked: {target.name} (id {target.pk}) is the walk-in record.")

    def _target(self, pk):
        """Only --id selects an existing row; --add refuses a duplicate canonical name."""
        rows = uncached(Customer).only("pk", "name", "gst_number")
        if pk is None:
            named = list(rows.filter(name__iexact=NAME).order_by("pk")[:2])
            if len(named) > 1:
                raise CommandError(f'More than one customer is named "{NAME}". Choose one with --id.')
            if named:
                raise CommandError(f'A customer is already named "{NAME}". Choose it with --id.')
            return None
        found = rows.filter(pk=pk).first()
        if found is None:
            raise CommandError(f"No customer has id {pk}.")
        if has_gstin(found.gst_number):
            raise CommandError(f"{found.name} has a GSTIN; the walk-in record has none. Choose another.")
        return found

    def _candidates(self):
        """Rank before limiting: a general counter record may have any name (X-83)."""
        rows = list(uncached(Customer).exclude(registered()).only("pk", "name"))
        if not rows:
            self.stdout.write("No customers without a GSTIN.")
            return
        bills = Invoice.objects.sales().counted().filter(customer_id__in=[c.pk for c in rows]).values("customer_id").annotate(
            n=Count("pk"), cash=Count("pk", filter=Q(payment_mode="cash")), last=Max("invoice_date"))
        counts = {row["customer_id"]: (row["n"], row["cash"], row["last"]) for row in bills}
        rows.sort(key=lambda c: (-counts.get(c.pk, (0, 0, None))[1], c.name, c.pk))
        self.stdout.write("Customers without a GSTIN, with the most cash sales first:")
        for row in rows[:10]:
            n, cash, last = counts.get(row.pk, (0, 0, None))
            self.stdout.write(f"  {row.name} (id {row.pk}): {n} sales bill(s), {cash} cash sale(s), last bill {last or 'none'}")
