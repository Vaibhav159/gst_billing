"""Deleting a sale to the bin, and bringing it back (design decision 6).

A deleted sale leaves the Invoice table, as v2's deletes do, so after a rollback v2 simply
doesn't have it. Its number stays used (billing.numbering reads the bin). Two records keep it:
a BinnedInvoice with every field of the bill and its lines, for v3's restore under the same
id; and v2's "deleted" audit row with v2's keys only, so v2's undo still works after a
rollback. Whichever brings the bill back marks the other used, so the two can't both fire.
"""

from django.db import transaction
from django.utils import timezone

from billing.api.mixins import mark_undone, snapshot_of
from billing.cache import invalidate
from billing.constants import V2_LINE_SNAPSHOT_FIELDS
from billing.fy import fy_label, fy_of
from billing.models import AuditLog, BinnedInvoice, Business, Customer, Invoice, LineItem
from billing.numbering import bill_ref, refuse_taken
from billing.period_lock import assert_sales_open, locked_period_or_none
from billing.refusals import Refusal
from billing.services.sales import entity_name, locked_bill, log
from billing.text import money, person, stamp

# What brought a bill back, as an already_restored refusal names it (Ruling 1A-9).
RESTORED_FROM = {"bin": "the bin", "audit_log": "the Audit log"}


def v2_snapshot(invoice):
    """What v2's audit log keeps for a bill: every field, and its lines with v2's ten keys."""
    data = snapshot_of(invoice)
    data["line_items"] = [
        {f: (str(getattr(li, f)) if getattr(li, f) is not None else None) for f in V2_LINE_SNAPSHOT_FIELDS}
        for li in invoice.lineitem_set.all()
    ]
    return data


def _row(instance, skip=()):
    """Every concrete field as JSON-safe text (None stays None), keyed by column (business_id)."""
    out = {}
    for field in instance._meta.concrete_fields:
        if field.attname in skip:
            continue
        value = field.value_from_object(instance)
        out[field.attname] = None if value is None else field.value_to_string(instance)
    return out


def _fields(model, row):
    """_row's text back into model values."""
    by_column = {f.attname: f for f in model._meta.concrete_fields}
    return {k: (None if v is None else by_column[k].to_python(v)) for k, v in row.items() if k in by_column}


def bin_bill(invoice, user, reason="", details=None, kind=BinnedInvoice.KIND_DELETED, check_month=True):
    """Move a sale to the bin; returns (the BinnedInvoice, v2's "deleted" audit row).

    The bill is row-locked and its month checked inside one transaction, so two deletes at once
    make one bin row: the second finds the bill gone, the plain 404 (Ruling 1A-11). v2's paths check
    the month first in v2's words; the rollback script passes check_month=False (commands bypass locks).
    """
    with transaction.atomic():
        invoice = locked_bill(invoice)
        if check_month:
            assert_sales_open(invoice.business_id, invoice.invoice_date, "delete")
        name = entity_name(invoice)
        who = user if user and user.is_authenticated else None
        entry = AuditLog.objects.create(
            action="deleted", entity="invoice", entity_id=invoice.pk, entity_name=name, user=who,
            details=details or (f"Deleted invoice: {name}" + (f" · {reason}" if reason else "")),
            snapshot=v2_snapshot(invoice),
        )
        binned = BinnedInvoice.objects.create(
            original_id=invoice.pk, business_id=invoice.business_id, customer_id=invoice.customer_id,
            invoice_number=invoice.invoice_number, invoice_date=invoice.invoice_date,
            type_of_invoice=invoice.type_of_invoice, total_amount=invoice.total_amount,
            kind=kind, reason=reason, audit_log_id=entry.pk, deleted_by=who,
            data={
                "invoice": _row(invoice, skip={"id"}),
                "lines": [_row(li, skip={"id", "invoice_id", "customer_id"}) for li in invoice.lineitem_set.all()],
                "customer_name": invoice.customer.name, "business_name": invoice.business.name,
            },
        )
        invoice.delete()
    return binned, entry


def _brought_back(binned, undone):
    """The bill a restore brought back: the one its marker's log row names (v2's undo gives it a new
    id), else the original id. None when it has gone again."""
    log_id = (undone or {}).get("log")
    named = AuditLog.objects.filter(pk=log_id).values_list("entity_id", flat=True).first() if log_id else None
    return Invoice.objects.select_related("customer").filter(pk=named or binned.original_id).first()


def restore_from_bin(binned, user, check_month=True, via="bin"):
    """Put a deleted sale back, with every field and line, under its own id; returns the Invoice.

    Refused (409) when it is back already, its month is closed, its firm or customer is gone, or
    another bill has its number now. The rollback script passes check_month=False: commands bypass
    locks. `via` is what restores it ("bin", or "audit_log" for the Audit log's Undo), which a later
    already_restored names (Ruling 1A-9).
    """
    with transaction.atomic():
        # The audit entry, then the bin row: the Audit log's Undo locks them in that order too.
        entry = AuditLog.objects.select_for_update().filter(pk=binned.audit_log_id).first() if binned.audit_log_id else None
        binned = BinnedInvoice.objects.select_for_update().get(pk=binned.pk)
        undone = (entry.snapshot or {}).get("_undo") if entry else None
        if binned.restored_at or undone:
            back = _brought_back(binned, undone)
            source = (undone or {}).get("via") or ("bin" if binned.restored_at else "audit_log")
            raise Refusal(f"{binned.invoice_number} is back already: it was restored from {RESTORED_FROM[source]}.",
                          "already_restored", bill=bill_ref(back) if back else None)
        if check_month:
            assert_sales_open(binned.business_id, binned.invoice_date, "restore")
        firm = Business.objects.filter(pk=binned.business_id).first()  # v2 may have deleted it (Ruling 1A-6)
        if firm is None:
            raise Refusal("The firm on this bill was deleted, so it can't come back as it was. "
                          "Make the bill again in the right firm.", "firm_gone")
        if not Customer.objects.filter(pk=binned.customer_id).exists():
            raise Refusal("The customer on this bill was deleted, so it can't come back as it was. "
                          "Make the bill again with the right customer.", "customer_gone")
        refuse_taken(firm, binned.invoice_date, binned.invoice_number, exclude_bin=binned.pk)

        fields = _fields(Invoice, binned.data["invoice"])
        fields.update(business_id=binned.business_id, customer_id=binned.customer_id)
        made = fields.pop("created_at", None)
        invoice = Invoice(**fields)
        if not Invoice.objects.filter(pk=binned.original_id).exists():
            invoice.pk = binned.original_id
        invoice.save(force_insert=True)
        LineItem.objects.bulk_create([
            LineItem(invoice=invoice, customer_id=invoice.customer_id, **_fields(LineItem, row))
            for row in binned.data["lines"]
        ])
        if made:
            Invoice.objects.filter(pk=invoice.pk).update(created_at=made)
        invalidate(Invoice, LineItem)

        binned.restored_at = timezone.now()
        binned.restored_by = user if user and user.is_authenticated else None
        binned.save(update_fields=["restored_at", "restored_by"])
        restored = log(invoice, user, "restored", "Back in Sales and in the month's GST figures")
        if entry is not None:
            mark_undone(entry, user, restored, via=via)
    return Invoice.objects.select_related("customer", "business").get(pk=invoice.pk)


def live_bin():
    """Deleted sales still in the bin, for the list (BinnedInvoice.objects.live()).

    Only the deleting user is joined, outer (one v2 deleted reads as None). The firm's and customer's
    names come from `data`, so a row whose firm or customer v2 deleted still lists (Ruling 1A-6).
    """
    return BinnedInvoice.objects.live().select_related("deleted_by")


def bin_row(binned, closed=None):
    """A deleted bill as the API sends it (part 1 API contract, BinRow). `closed`: closed months, if known.

    The firm and customer are named as the bill had them: either may be gone since (Ruling 1A-6).
    """
    day = binned.invoice_date
    if closed is None:
        locked = locked_period_or_none(binned.business_id, day) is not None
    else:
        locked = (binned.business_id, day.year, day.month) in closed
    return {
        "id": binned.pk, "original_id": binned.original_id, "kind": binned.kind,
        "business": binned.business_id, "business_name": binned.data.get("business_name", ""),
        "invoice_number": binned.invoice_number, "invoice_date": day.isoformat(), "fy": fy_label(fy_of(day)),
        "customer": {"id": binned.customer_id, "name": binned.data.get("customer_name", "")},
        "total_amount": money(binned.total_amount), "reason": binned.reason,
        "deleted_at": stamp(binned.deleted_at), "deleted_by": person(binned.deleted_by), "locked": locked,
    }
