"""Synthetic GST states added only by seed_sandbox --gst; controller owns reseeding."""

from datetime import date

from django.db import transaction
from django.utils import timezone

from billing.cache import invalidate, uncached
from billing.fy import fy_of
from billing.models import Customer, FiledPeriod, Invoice, LineItem, OpeningCredit
from billing.numbering import format_number, next_counter
from billing.services.line_items import build_line_items


def seed_openings(firms, owner):
    for business, values in zip(firms, ((42000, 15000, 15000), (0, 4200, 4200), (0, 9500, 9500)), strict=True):
        OpeningCredit.objects.update_or_create(business=business,
            defaults={**dict(zip(("igst", "cgst", "sgst"), values, strict=True)), "updated_by": owner})


def add_month(day, offset):
    year, month = divmod(day.year * 12 + day.month - 1 + offset, 12)
    return date(year, month + 1, 1)


def _bill(business, customer, day, *, gst="0.03", unit="gms", quantity="1", number=None):
    row = Invoice.objects.create(business=business, customer=customer, invoice_date=day,
        invoice_number=number or format_number(business, day, str(next_counter(business.pk, fy_of(day)))),
        type_of_invoice="outward", payment_mode="bank")
    items, total = build_line_items(row, [{"product_name": "Synthetic gold", "hsn_code": "711319", "gst_tax_rate": gst,
        "unit": unit, "quantity": quantity, "rate": "10000"}], source="api")
    LineItem.objects.bulk_create(items)
    row.total_amount = total
    row.save(update_fields=["total_amount"])
    return row


@transaction.atomic
def seed_gst(firms, owner, today=None):
    from billing.services.bin import bin_bill, restore_from_bin
    from billing.services.filing import mark_filed, unlock_month
    from billing.services.gst_downloads import record_download
    from billing.services.gstr1_file import build_gstr1
    from billing.services.ledger import _purchase_lines
    today = today or timezone.localdate()
    aarav, meera, kiran = firms
    _purchase_lines(aarav)  # Refuse a seed without part 2A's purchase schema.
    seed_openings(firms, owner)
    current, last = today.replace(day=1), add_month(today.replace(day=1), -1)
    if last < date(2025, 4, 1):
        return
    walkin = uncached(Customer).filter(customer_type="walkin").first()
    _bill(kiran, walkin, last, gst="0")
    _bill(kiran, walkin, last, unit="tola", quantity="1.250")
    changed_month = max(date(2025, 4, 1), add_month(current, -3))
    binned = None
    if changed_month < last:
        restored = _bill(aarav, walkin, changed_month, number="GSTFIX/1")
        FiledPeriod.objects.filter(business=aarav, year=changed_month.year, month=changed_month.month).delete()
        binned, _ = bin_bill(restored, owner, "Synthetic bill to restore after filing")
    month = date(2025, 4, 1)
    while month < last:
        filed = min(today, add_month(month, 1).replace(day=20))
        mark_filed(aarav, month, owner, {"kind": "both", "gstr1_filed_on": filed.isoformat(),
            "filed_on": filed.isoformat(), "gstr1_arn": f"AA{month:%m%Y}0000001", "arn": f"AA{month:%m%Y}0000002", "confirm_checks": True})
        month = add_month(month, 1)
    if binned:
        unlock_month(aarav, changed_month, owner, "A deleted bill was a real sale")
        restore_from_bin(binned, owner)
    mark_filed(kiran, last, owner, {"kind": "gstr1", "filed_on": today.isoformat(), "confirm_checks": True})
    FiledPeriod.objects.filter(business=meera, year=last.year, month=last.month).delete()
    built = build_gstr1(meera, last.year, last.month)
    record_download(meera, last, "gstr1", owner, "download", built["file"])
    bad = Customer.objects.create(name="Synthetic GSTIN check", gst_number="08VRHFA2322D1Z0", state_name="RAJASTHAN", customer_type="business")
    _bill(meera, bad, last, number="GSTCHECK/1")
    _bill(meera, walkin, last, number="gstcheck/1")
    purchase = uncached(Invoice).filter(business=meera, type_of_invoice="inward").order_by("id").first()
    if purchase:
        purchase.itc_eligible = False
        purchase.save(update_fields=["itc_eligible"])
    late = uncached(Invoice).filter(business=aarav, type_of_invoice="inward", invoice_date__lt=date(fy_of(today), 4, 1)).order_by("id").first()
    if late:
        late.itc_month = current
        late.needs_review = True
        late.save(update_fields=["itc_month", "needs_review"])
    invalidate(Invoice, LineItem, Customer)
