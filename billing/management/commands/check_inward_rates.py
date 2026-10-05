"""List inward-bill lines whose GST rate looks wrong. Report only: never writes.

Until C1 the inward capture form had no rate field and the server turned a
blank or 0 rate into 3%, so every manually entered purchase was booked at 3%
input credit, diamonds at 0.25% included. An AI-read 0.25 (meaning 0.25%)
went in verbatim and was taxed at 25%. That ITC flows into the GST summary
and GSTR-3B Table 4(A)(5), so go through this list before the next return.

    python manage.py check_inward_rates
    python manage.py check_inward_rates --business 1 --from 2026-04-01

A line is listed when
  * its stored rate, read as the fraction the column holds, is not a GST
    slab (0.25 is 25%);
  * it carries GST and the product master taxes its HSN code at another
    rate; or, with no master row for the code, it is at 3% under HSN 7102
    or 7103 (diamonds and precious stones are 0.25%).
Each line shows the ITC on file and the ITC at the suggested rate. There is
no --apply: what a filed bill says is for a person with the bill in hand to
decide, by editing that bill.
"""

from collections import defaultdict
from decimal import Decimal

from django.core.management.base import BaseCommand

from billing.constants import INVOICE_TYPE_INWARD
from billing.models import LineItem, Product
from billing.tax_rules import GST_SLABS, normalize_rate

CENT = Decimal("0.01")
THREE = Decimal("0.03")
QUARTER = Decimal("0.0025")
STONES = ("7102", "7103")  # diamonds; precious and semi-precious stones


def _pct(fraction):
    return f"{(Decimal(fraction) * 100).normalize():f}%"


class Command(BaseCommand):
    help = "List inward-bill lines whose GST rate looks wrong (report only: never writes)."

    def add_arguments(self, parser):
        parser.add_argument("--business", type=int, default=None, help="Limit to one business id.")
        parser.add_argument("--from", dest="date_from", default=None, help="Bill date >= YYYY-MM-DD.")
        parser.add_argument("--to", dest="date_to", default=None, help="Bill date <= YYYY-MM-DD.")

    def handle(self, *args, **opts):
        master = defaultdict(set)
        for hsn, rate in Product.objects.values_list("hsn_code", "gst_tax_rate"):
            if hsn and rate is not None:
                master[hsn.strip()].add(normalize_rate(rate, assume="fraction"))

        qs = (
            LineItem.objects.filter(invoice__type_of_invoice=INVOICE_TYPE_INWARD)
            .select_related("invoice__business", "invoice__customer")
            .order_by("invoice__invoice_date", "invoice_id", "id")
        )
        if opts["business"]:
            qs = qs.filter(invoice__business_id=opts["business"])
        if opts["date_from"]:
            qs = qs.filter(invoice__invoice_date__gte=opts["date_from"])
        if opts["date_to"]:
            qs = qs.filter(invoice__invoice_date__lte=opts["date_to"])

        rows = [row for row in (self._check(li, master) for li in qs) if row]
        if not rows:
            self.stdout.write(self.style.SUCCESS("No inward lines with a doubtful GST rate."))
            return

        bills = {li.invoice_id for li, *_ in rows}
        self.stdout.write(self.style.WARNING(
            f"{len(rows)} inward line(s) on {len(bills)} bill(s) have a GST rate that looks wrong:\n"
        ))
        on_file_total = suggested_total = Decimal("0")
        for li, reasons, suggested, on_file, at_suggested in rows:
            inv = li.invoice
            supplier = inv.customer.name if inv.customer_id else "?"
            target = _pct(suggested) if suggested is not None else "?"
            itc = f"ITC on file {on_file:.2f}"
            if at_suggested is not None:
                itc += f", at {target}: {at_suggested:.2f}"
                on_file_total += on_file
                suggested_total += at_suggested
            self.stdout.write(
                f"  {inv.invoice_date}  #{inv.invoice_number}  {supplier[:28]}  ({inv.business.name[:28]})\n"
                f"      {li.product_name[:30]}  HSN {li.hsn_code or '-'}  "
                f"{_pct(li.gst_tax_rate or 0)} -> {target}  {itc}\n"
                f"      " + "; ".join(reasons)
            )

        diff = on_file_total - suggested_total
        self.stdout.write(
            f"\nITC on these lines: {on_file_total:.2f} on file, {suggested_total:.2f} at the "
            f"suggested rates ({abs(diff):.2f} {'over' if diff >= 0 else 'under'}-claimed)."
        )
        self.stdout.write(self.style.NOTICE(
            "Report only: nothing was changed. Correct a bill by editing it, with the bill in hand."
        ))

    @staticmethod
    def _check(li, master):
        stored = li.gst_tax_rate or Decimal("0")
        hsn = (li.hsn_code or "").strip()
        reasons, suggested = [], None
        if stored * 100 not in GST_SLABS:
            reasons.append(f"stored as {stored.normalize()}, which is {_pct(stored)}: not a GST slab")
            fixed = normalize_rate(stored, assume="fraction")
            if fixed != stored:
                suggested = fixed
        known = master.get(hsn)
        effective = suggested if suggested is not None else stored
        if known and stored and effective not in known:
            reasons.append(f"the product master has HSN {hsn} at {' / '.join(_pct(r) for r in sorted(known))}")
            if len(known) == 1:
                suggested = next(iter(known))
        elif not known and stored == THREE and hsn.startswith(STONES):
            reasons.append(f"3% on HSN {hsn}: diamonds and precious stones are taxed at 0.25%")
            suggested = QUARTER
        if not reasons:
            return None
        on_file = (li.cgst or 0) + (li.sgst or 0) + (li.igst or 0)
        taxable = (li.quantity or 0) * (li.rate or 0)
        if taxable == 0:  # amount-only rows: the taxable value is what the tax leaves
            taxable = (li.amount or 0) - on_file
        at_suggested = (taxable * suggested).quantize(CENT) if suggested is not None else None
        return li, reasons, suggested, on_file, at_suggested
