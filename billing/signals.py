import contextlib

from django.contrib.auth.models import User
from django.db.models import Sum
from django.db.models.signals import m2m_changed, post_delete, post_save
from django.dispatch import receiver

from billing.cache import invalidate
from billing.models import Invoice, LineItem

# Safety net for one-off saves (admin edits, shell fixes). Every bulk path —
# invoice create/update_line_items, inward capture, CSV/AI/GSTR-2A imports —
# uses bulk_create/_raw_delete precisely so these never fire per line; they
# set total_amount themselves from totals they already hold. A bill's own
# delete skips them too: its lines go with it.


def _resync_invoice_total(invoice):
    """Sum in SQL, write with .update() (no Invoice.save() side effects), and
    keep the in-memory instance in step — callers hold references to it and a
    later instance.save() must not write a stale total back."""
    total = (
        LineItem.objects.filter(invoice_id=invoice.id).aggregate(t=Sum("amount"))["t"]
        or 0
    )
    Invoice.objects.filter(id=invoice.id).update(total_amount=total)
    invalidate(Invoice)  # update() sends no signal: v2's cached bills would keep the old total (Ruling 1A-34)
    invoice.total_amount = total


@receiver(post_save, sender=LineItem)
def update_invoice_total_on_line_item_save(sender, instance, **kwargs):
    _resync_invoice_total(instance.invoice)


@receiver(post_delete, sender=LineItem)
def update_invoice_total_on_line_item_delete(sender, instance, origin=None, **kwargs):
    if isinstance(origin, Invoice):
        # The bill's own delete, cascading to its lines: no total is left to keep, and cacheops' delete handlers
        # drop the rows' cached queries. A 20-line bill to the bin used to re-read, re-sum and re-write the bill
        # 20 times over (Task 7's re-review).
        return
    # Cascade delete — the invoice went first.
    with contextlib.suppress(Invoice.DoesNotExist):
        _resync_invoice_total(instance.invoice)


@receiver(m2m_changed, sender=User.groups.through)
def forget_group_names(sender, instance, **kwargs):
    """billing.roles.group_names reads a user's groups once; a change to them is read again."""
    if isinstance(instance, User):
        instance.__dict__.pop("_group_names", None)
