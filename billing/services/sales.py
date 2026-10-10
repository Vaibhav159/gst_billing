"""v3's sales writes: one function per action, each refusing what the books can't take.

The API (billing/api/sales.py) validates what was sent and calls these; they lock the bill,
check the month (assert_sales_open), write it and its audit row in one transaction.
"""

import re

from django.db import transaction
from django.db.models import F
from django.http import Http404
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from billing.cache import invalidate
from billing.constants import BILL_ACTIVE, BILL_CANCELLED
from billing.models import AuditLog, Invoice
from billing.period_lock import assert_sales_open
from billing.refusals import Refusal
from billing.text import stamp

CANCELLED_WORDS = "Cancelled bills can't be changed. Make it again from the bill instead."


def entity_name(invoice):
    """The audit log's name for a bill, as v2's InvoiceViewSet writes it, kept to the column's 255
    characters: a 255-character customer name would make Postgres refuse the row (a 500)."""
    return f"#{invoice.invoice_number} - {invoice.customer.name}"[:255]


def log(invoice, user, action, details="", changes=None, snapshot=None):
    """One audit row for a bill. `action` fits AuditLog.action's 10 characters."""
    return AuditLog.objects.create(
        action=action, entity="invoice", entity_id=invoice.pk, entity_name=entity_name(invoice),
        user=user if user and user.is_authenticated else None,
        details=details, changes=changes, snapshot=snapshot,
    )


def locked_bill(invoice):
    """The bill again, row-locked for the rest of the transaction (two clicks can't both pass).

    A bill another request deleted since this one found it is the plain 404, not a 500 (Ruling 1A-17).
    """
    bill = (Invoice.objects.select_for_update(of=("self",)).select_related("customer", "business")
            .filter(pk=invoice.pk).first())
    if bill is None:
        raise Http404("No Invoice matches the given query.")
    return bill


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


def mobile_of(text):
    """A 10-digit Indian mobile from what was typed ("+91 98290-41122" -> "9829041122"), or "".

    Digits 0-9 only: \\d also takes other scripts' digits ("98290४११२२"), which no wa.me link reads.
    """
    digits = re.sub(r"[^0-9]", "", text or "")
    digits = re.sub(r"^(91|0)(?=[0-9]{10}$)", "", digits)
    return digits if re.fullmatch(r"[6-9][0-9]{9}", digits) else ""


def sent_block(invoice):
    """The bill's sends as the API gives them, or None when it was never sent."""
    if not invoice.sent_at:
        return None
    return {"at": stamp(invoice.sent_at), "last_at": stamp(invoice.last_sent_at), "count": invoice.sent_count,
            "via": invoice.sent_via, "to": invoice.sent_to}


VIA_WORDS = {"whatsapp": "WhatsApp", "share": "the share sheet"}


def record_send(invoice, user, via, to=""):
    """Note that the bill went out (design §4.3). No month check: sending a filed bill is fine.

    `to` is a one-off number typed for this bill, kept on the bill and never on the customer;
    a customer without a mobile number needs one (or the one their last send went to).
    """
    with transaction.atomic():
        invoice = locked_bill(invoice)
        refuse_cancelled(invoice, f"{invoice.invoice_number} is cancelled, so it can't be sent.")
        customer = invoice.customer
        if not to and not (customer.mobile_number or "").strip():
            to = invoice.sent_to
            if not to:
                raise ValidationError({"to": [
                    "A walk-in has no number on record. Type theirs to send the bill to their WhatsApp."
                    if customer.kind == "walkin" else
                    f"{customer.name} has no mobile number on record. Type the WhatsApp number to send it to."]})
        again = invoice.sent_count > 0
        now = timezone.now()
        Invoice.objects.filter(pk=invoice.pk).update(
            sent_at=invoice.sent_at or now, last_sent_at=now, sent_count=F("sent_count") + 1,
            sent_via=via, sent_to=to,
        )
        invalidate(Invoice)
        who = f"+91 {to[:5]} {to[5:]}" if to else customer.name
        how = VIA_WORDS[via]
        log(invoice, user, "sent", f"Again on {how} to {who}" if again else f"{how[0].upper()}{how[1:]} to {who}")
    invoice.refresh_from_db()
    return invoice
