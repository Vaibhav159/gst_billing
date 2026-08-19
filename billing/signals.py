from django.db.models import Sum
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from billing.models import Invoice, LineItem

# Safety net for one-off saves (admin edits, shell fixes). Every bulk path —
# invoice create/update_line_items, inward capture, CSV/AI/GSTR-2A imports —
# uses bulk_create/_raw_delete precisely so these never fire per line; they
# set total_amount themselves from totals they already hold.


def _resync_invoice_total(invoice):
    """Sum in SQL, write with .update() (no Invoice.save() side effects), and
    keep the in-memory instance in step — callers hold references to it and a
    later instance.save() must not write a stale total back."""
    total = (
        LineItem.objects.filter(invoice_id=invoice.id).aggregate(t=Sum("amount"))["t"]
        or 0
    )
    Invoice.objects.filter(id=invoice.id).update(total_amount=total)
    invoice.total_amount = total


@receiver(post_save, sender=LineItem)
def update_invoice_total_on_line_item_save(sender, instance, **kwargs):
    _resync_invoice_total(instance.invoice)


@receiver(post_delete, sender=LineItem)
def update_invoice_total_on_line_item_delete(sender, instance, **kwargs):
    try:
        _resync_invoice_total(instance.invoice)
    except Invoice.DoesNotExist:
        # Cascade delete — the invoice went first.
        pass
