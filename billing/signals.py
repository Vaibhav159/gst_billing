from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from billing.models import Invoice, LineItem


@receiver(post_save, sender=LineItem)
def update_invoice_total_on_line_item_save(sender, instance, **kwargs):
    """Update the invoice total amount when a line item is saved."""
    invoice = instance.invoice
    invoice.total_amount = sum(
        LineItem.objects.filter(invoice=invoice).values_list("amount", flat=True)
    )
    # Use update to avoid triggering the save method again
    Invoice.objects.filter(id=invoice.id).update(total_amount=invoice.total_amount)


@receiver(post_delete, sender=LineItem)
def update_invoice_total_on_line_item_delete(sender, instance, **kwargs):
    """Update the invoice total amount when a line item is deleted."""
    try:
        invoice = instance.invoice
        invoice.total_amount = sum(
            LineItem.objects.filter(invoice=invoice).values_list("amount", flat=True)
        )
        # Use update to avoid triggering the save method again
        Invoice.objects.filter(id=invoice.id).update(total_amount=invoice.total_amount)
    except Invoice.DoesNotExist:
        # Invoice might have been deleted already
        pass
