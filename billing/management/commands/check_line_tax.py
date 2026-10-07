"""List lines whose tax isn't their rate (review of H10 and M14).

H10's Excel import taxed a cell shown as "3%" at 0.03% (Rs 18 of tax on
Rs 60,000 of a 3% line), and before M14 the line-item API and every invoice
write took a line's tax as sent, so a 3% line could carry Rs 0. Both are
refused now; this lists what is already on file: each line whose tax (CGST +
SGST + IGST) is more than Rs 1 off its taxable value at its rate, with the
tax the rate implies and whether its month is filed.

The taxable value is quantity x rate as the returns read it, or the amount
less tax for a line stored without one (fix_amount_only_lines restores
those). A rate stored the old way (0.25 meaning 0.25%) is read as the slab it
means; fix_gst_rates repairs the stored value.

Read-only: it changes nothing. Which figure is wrong, the rate or the tax, is
for a person to decide; a sale already issued is corrected with a debit or
credit note, not by editing it.

    python manage.py check_line_tax
    python manage.py check_line_tax --business 1 --from 2025-04-01
"""

from collections import Counter
from decimal import Decimal

from django.core.management.base import BaseCommand

from billing.management.commands._repair import filed_months, scope
from billing.models import LineItem
from billing.tax_rules import LINE_MONEY_TOLERANCE, normalize_rate, rate_as_percent, to_paise


class Command(BaseCommand):
    help = "Report lines whose tax is more than Rs 1 off their taxable value at their rate (read-only)."

    def add_arguments(self, parser):
        parser.add_argument("--business", type=int, default=None, help="Limit to one business id.")
        parser.add_argument("--from", dest="date_from", default=None, help="Invoice date >= YYYY-MM-DD.")
        parser.add_argument("--to", dest="date_to", default=None, help="Invoice date <= YYYY-MM-DD.")

    def handle(self, *args, **opts):
        qs = scope(LineItem.objects.select_related("invoice"), opts, "invoice__").order_by(
            "invoice__invoice_date", "invoice_id", "id")
        filed = filed_months()
        off, months, gap = [], Counter(), Counter()
        for li in qs.iterator(chunk_size=2000):
            tax = (li.cgst or 0) + (li.sgst or 0) + (li.igst or 0)
            taxable = (li.quantity or 0) * (li.rate or 0) or (li.amount or 0) - tax
            rate = normalize_rate(li.gst_tax_rate or 0, assume="fraction")
            expected = to_paise(taxable * rate)
            if abs(tax - expected) <= LINE_MONEY_TOLERANCE:
                continue
            inv = li.invoice
            key = (inv.business_id, inv.invoice_date.year, inv.invoice_date.month)
            months[key] += 1
            gap[key] += expected - tax
            off.append(li)
            self.stdout.write(
                f"  #{str(inv.invoice_number)[:14]:<14} {inv.invoice_date}  {inv.type_of_invoice:<7} "
                f"{li.product_name[:22]:<22} {rate_as_percent(rate)}% of {to_paise(taxable)}: tax on file {tax}, "
                f"the rate gives {expected}" + ("  FILED" if key in filed else "")
            )
        if not off:
            self.stdout.write(self.style.SUCCESS("Every line's tax is its rate, within Rs 1."))
            return
        short = sum(gap.values(), Decimal("0"))
        self.stdout.write(self.style.WARNING(
            f"\n{len(off)} line(s) in {len(months)} month(s) carry tax that isn't their rate: "
            f"{short} {'less' if short > 0 else 'more'} than their rates give, in all."
        ))
        filed_hit = sorted(k for k in months if k in filed)
        if filed_hit:
            self.stdout.write(self.style.WARNING(
                "Filed months whose returns carried these figures: "
                + ", ".join(f"{m:02d}/{y} (business {b}, {months[(b, y, m)]} line(s))" for b, y, m in filed_hit)
            ))
