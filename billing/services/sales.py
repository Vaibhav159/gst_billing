"""v3's sales writes: one function per action, each refusing what the books can't take.

The API (billing/api/sales.py) validates what was sent and calls these; they lock the bill,
check the month (assert_sales_open), write it and its audit row in one transaction.
"""

from django.db import transaction
from django.utils import timezone

from billing.constants import BILL_ACTIVE, BILL_CANCELLED
from billing.models import AuditLog, Invoice
from billing.period_lock import assert_sales_open
from billing.refusals import Refusal

CANCELLED_WORDS = "Cancelled bills can't be changed. Make it again from the bill instead."


def entity_name(invoice):
    """The audit log's name for a bill, as v2's InvoiceViewSet writes it."""
    return f"#{invoice.invoice_number} - {invoice.customer.name}"


def log(invoice, user, action, details="", changes=None, snapshot=None):
    """One audit row for a bill. `action` fits AuditLog.action's 10 characters."""
    return AuditLog.objects.create(
        action=action, entity="invoice", entity_id=invoice.pk, entity_name=entity_name(invoice),
        user=user if user and user.is_authenticated else None,
        details=details, changes=changes, snapshot=snapshot,
    )


def locked_bill(invoice):
    """The bill again, row-locked for the rest of the transaction (two clicks can't both pass)."""
    return Invoice.objects.select_for_update(of=("self",)).select_related("customer", "business").get(pk=invoice.pk)


def refuse_cancelled(invoice, words=CANCELLED_WORDS):
    if invoice.status == BILL_CANCELLED:
        raise Refusal(words, "cancelled")


def cancel_bill(invoice, user, reason):
    """Cancel a sale: it keeps its number (Table 13 shows it cancelled) and leaves every figure.

    No undo: a cancelled bill is made again with a new number (design decision 5).
    """
    with transaction.atomic():
        invoice = locked_bill(invoice)
        refuse_cancelled(invoice, f"{invoice.invoice_number} is already cancelled.")
        assert_sales_open(invoice.business_id, invoice.invoice_date, "cancel")
        invoice.status = BILL_CANCELLED
        invoice.cancel_reason = reason
        invoice.cancelled_at = timezone.now()
        invoice.cancelled_by = user if user.is_authenticated else None
        invoice.save(update_fields=["status", "cancel_reason", "cancelled_at", "cancelled_by", "updated_at"])
        log(invoice, user, "cancelled", reason, changes={"status": {"old": BILL_ACTIVE, "new": BILL_CANCELLED}})
    return invoice
