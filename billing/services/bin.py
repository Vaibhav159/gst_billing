"""Deleting a sale to the bin, and bringing it back (design decision 6).

A deleted sale leaves the Invoice table, as v2's deletes do, so after a rollback v2 simply
doesn't have it. Its number stays used (billing.numbering reads the bin). Two records keep it:
a BinnedInvoice with every field of the bill and its lines, for v3's restore under the same
id; and v2's "deleted" audit row with v2's keys only, so v2's undo still works after a
rollback. Whichever brings the bill back marks the other used, so the two can't both fire.
"""

from django.db import IntegrityError, transaction
from django.db.models import OuterRef, Subquery
from django.db.models.functions import Trim
from django.utils import timezone

from billing.api.mixins import mark_undone, snapshot_of
from billing.cache import invalidate, uncached
from billing.constants import INVOICE_TYPE_OUTWARD, V2_LINE_SNAPSHOT_FIELDS
from billing.fy import fy_label, fy_of
from billing.models import AuditLog, BinnedInvoice, Business, Customer, Invoice, LineItem
from billing.numbering import REF_FIELDS, bill_ref, lock_firms, refuse_taken
from billing.period_lock import assert_sales_open, locked_period_or_none
from billing.refusals import Refusal
from billing.services.bill_reads import _FY_EXPR, lines_of
from billing.services.sales import entity_name, locked_bill, log
from billing.text import money, person, stamp

# What brought a bill back, as an already_restored refusal names it (Ruling 1A-9).
RESTORED_FROM = {"bin": "the bin", "audit_log": "the Audit log"}


def v2_snapshot(invoice, lines=None):
    """What v2's audit log keeps for a bill: every field, and its lines (`lines`, else read now, around cacheops: a
    snapshot never keeps a stale line) with v2's ten keys."""
    data = snapshot_of(invoice)
    data["line_items"] = [
        {f: (str(getattr(li, f)) if getattr(li, f) is not None else None) for f in V2_LINE_SNAPSHOT_FIELDS}
        for li in (lines_of([invoice])[invoice.pk] if lines is None else lines)
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
        lock_firms(invoice.business_id)
        if check_month:
            assert_sales_open(invoice.business_id, invoice.invoice_date, "delete")
        name = entity_name(invoice)
        who = user if user and user.is_authenticated else None
        lines = lines_of([invoice])[invoice.pk]
        entry = AuditLog.objects.create(
            action="deleted", entity="invoice", entity_id=invoice.pk, entity_name=name, user=who,
            details=details or (f"Deleted invoice: {name}" + (f" · {reason}" if reason else "")),
            snapshot=v2_snapshot(invoice, lines),
        )
        binned = BinnedInvoice.objects.create(
            original_id=invoice.pk, business_id=invoice.business_id, customer_id=invoice.customer_id,
            invoice_number=invoice.invoice_number, invoice_date=invoice.invoice_date,
            type_of_invoice=invoice.type_of_invoice, total_amount=invoice.total_amount,
            kind=kind, reason=reason, audit_log_id=entry.pk, deleted_by=who,
            data={
                "invoice": _row(invoice, skip={"id"}),
                "lines": [_row(li, skip={"id", "invoice_id", "customer_id"}) for li in lines],
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
    return Invoice.objects.sales().select_related("customer").filter(pk=named or binned.original_id).first()


def restore_from_bin(binned, user, check_month=True, via="bin"):
    """Put a deleted sale back, with every field and line, under its own id; returns the Invoice.

    Refused (409) when it is back already, its month is closed, its firm or customer is gone, or
    another bill has its number now. The rollback script passes check_month=False: commands bypass
    locks. `via` is what restores it ("bin", or "audit_log" for the Audit log's Undo), which a later
    already_restored names (Ruling 1A-9).
    """
    with transaction.atomic():
        # Audit Undo holds the entry first. Firm edits freeze bin data while holding Business,
        # so restore must acquire that firm before locking and re-reading the bin row.
        entry = AuditLog.objects.select_for_update().filter(pk=binned.audit_log_id).first() if binned.audit_log_id else None
        business_id = uncached(BinnedInvoice).filter(pk=binned.pk).values_list("business_id", flat=True).get()
        firm = uncached(Business).select_for_update(no_key=True).filter(pk=business_id).first()
        binned = BinnedInvoice.objects.select_for_update().get(pk=binned.pk)
        undone = (entry.snapshot or {}).get("_undo") if entry else None
        if binned.restored_at or undone:
            back = _brought_back(binned, undone)
            source = (undone or {}).get("via") or ("bin" if binned.restored_at else "audit_log")
            raise Refusal(f"{binned.invoice_number} is back already: it was restored from {RESTORED_FROM[source]}.",
                          "already_restored", bill=bill_ref(back) if back else None)
        if firm is None:
            raise Refusal("The firm on this bill was deleted, so it can't come back as it was. "
                          "Make the bill again in the right firm.", "firm_gone")
        if check_month:
            assert_sales_open(firm, binned.invoice_date, "restore")
        if not uncached(Customer).filter(pk=binned.customer_id).exists():
            raise Refusal("The customer on this bill was deleted, so it can't come back as it was. "
                          "Make the bill again with the right customer.", "customer_gone")
        # Bills in Sales only: another deleted bill with this number never blocks it (Ruling 1A-18).
        refuse_taken(firm, binned.invoice_date, binned.invoice_number, bins=False)

        fields = _fields(Invoice, binned.data["invoice"])
        fields.update(business_id=binned.business_id, customer_id=binned.customer_id)
        made = fields.pop("created_at", None)
        invoice = Invoice(**fields)
        if not uncached(Invoice).filter(pk=binned.original_id).exists():
            invoice.pk = binned.original_id
        try:
            with transaction.atomic():
                invoice.save(force_insert=True)
        except IntegrityError:
            # A v2 writer may bypass the firm lock: name its bill after rolling back the insert (Ruling 1A-46).
            refuse_taken(firm, binned.invoice_date, binned.invoice_number, bins=False)
            raise
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
    return uncached(Invoice).select_related("customer", "business").get(pk=invoice.pk)


def restore_many_from_bin(binned_ids, user, check_month=True, via="bin"):
    """Restore sales in one transaction, returning input order and `_restored_lines`.

    The same database iexact/FY comparison as numbering.holder finds live holders;
    refuse_taken keeps its refusal words. Only a failing batch enters a single
    restore to name a collision between two requested bin rows. All its writes
    roll back with the refusal. Other bin rows never block a restore.
    """
    ids = list(dict.fromkeys(binned_ids))
    if not ids:
        return []
    with transaction.atomic():
        wanted = uncached(BinnedInvoice).filter(pk__in=ids, type_of_invoice=INVOICE_TYPE_OUTWARD)
        entries = {entry.pk: entry for entry in uncached(AuditLog).select_for_update()
                   .filter(pk__in=wanted.values("audit_log_id")).order_by("pk").only("id", "snapshot")}
        # Firm edits freeze bin data while holding Business, so take the firms before the bin rows.
        firms = {firm.pk: firm for firm in uncached(Business).select_for_update(no_key=True)
                 .filter(pk__in=set(wanted.values_list("business_id", flat=True))).order_by("pk")
                 .only("id", "name", "invoice_prefix", "paper_full_number_from")}
        by_id = {row.pk: row for row in wanted.select_for_update().order_by("pk").only(
            "id", "original_id", "business_id", "customer_id", "invoice_number", "invoice_date",
            "audit_log_id", "restored_at", "data")}
        if len(by_id) != len(ids):
            raise BinnedInvoice.DoesNotExist("A requested bill is no longer in the bin.")
        rows = [by_id[pk] for pk in ids]
        for row in rows:
            entry = entries.get(row.audit_log_id)
            undone = (entry.snapshot or {}).get("_undo") if entry else None
            if row.restored_at or undone:
                back = _brought_back(row, undone)
                source = (undone or {}).get("via") or ("bin" if row.restored_at else "audit_log")
                raise Refusal(f"{row.invoice_number} is back already: it was restored from {RESTORED_FROM[source]}.",
                              "already_restored", bill=bill_ref(back) if back else None)
        customers = uncached(Customer).only("id", "name").in_bulk({row.customer_id for row in rows})
        months = set()
        for row in rows:
            month = (row.business_id, row.invoice_date.year, row.invoice_date.month)
            if check_month and month not in months:
                assert_sales_open(row.business_id, row.invoice_date, "restore")
                months.add(month)
            if row.business_id not in firms:
                raise Refusal("The firm on this bill was deleted, so it can't come back as it was. "
                              "Make the bill again in the right firm.", "firm_gone")
            if row.customer_id not in customers:
                raise Refusal("The customer on this bill was deleted, so it can't come back as it was. "
                              "Make the bill again with the right customer.", "customer_gone")

        # Compare in SQL, preserving the database's case-insensitive matching.
        match = {"business_id": OuterRef("business_id"), "_restore_fy": OuterRef("_restore_fy"),
                 "invoice_number__iexact": Trim(OuterRef("invoice_number"))}
        holders = Invoice.objects.sales().alias(_restore_fy=_FY_EXPR).filter(**match).order_by("pk")
        previous = wanted.alias(_restore_fy=_FY_EXPR).filter(**match, pk__lt=OuterRef("pk")).order_by("pk")
        matches = {pk: (holder, prior) for pk, holder, prior in wanted.alias(_restore_fy=_FY_EXPR).annotate(
            _holder=Subquery(holders.values("pk")[:1]), _prior=Subquery(previous.values("pk")[:1])
        ).values_list("pk", "_holder", "_prior")}
        live = Invoice.objects.sales().select_related("customer").only(*REF_FIELDS).in_bulk(
            {holder for holder, _ in matches.values() if holder is not None})
        for row in rows:
            if row.invoice_number.strip():
                refuse_taken(firms[row.business_id], row.invoice_date, row.invoice_number,
                             bins=False, found=live.get(matches[row.pk][0]))
        for row in rows:
            if row.invoice_number.strip() and (prior := matches[row.pk][1]) is not None:
                restore_from_bin(by_id[prior], user, check_month=False, via=via)
                refuse_taken(firms[row.business_id], row.invoice_date, row.invoice_number, bins=False)

        occupied = set(uncached(Invoice).filter(pk__in={row.original_id for row in rows}).values_list("pk", flat=True))
        invoices, made = [], {}
        for row in rows:
            fields = _fields(Invoice, row.data["invoice"])
            fields.update(business=firms[row.business_id], customer=customers[row.customer_id])
            fields.pop("business_id", None)
            fields.pop("customer_id", None)
            made[row.pk] = fields.pop("created_at", None)
            invoice = Invoice(**fields)
            if row.original_id not in occupied:
                invoice.pk = row.original_id
                occupied.add(row.original_id)
            invoices.append(invoice)
        try:
            with transaction.atomic():
                Invoice.objects.bulk_create(invoices, batch_size=250)
        except IntegrityError:
            # A v2 writer can bypass firm locks; preserve the normal 409 on its number.
            for row in rows:
                refuse_taken(firms[row.business_id], row.invoice_date, row.invoice_number, bins=False)
            raise
        lines, dated = [], []
        for row, invoice in zip(rows, invoices, strict=True):
            if made[row.pk]:
                invoice.created_at = made[row.pk]
                dated.append(invoice)
            invoice._restored_lines = [
                LineItem(invoice=invoice, customer_id=invoice.customer_id, **_fields(LineItem, line))
                for line in row.data["lines"]
            ]
            lines.extend(invoice._restored_lines)
        Invoice.objects.bulk_update(dated, ["created_at"], batch_size=250)
        LineItem.objects.bulk_create(lines, batch_size=250)
        who = user if user and user.is_authenticated else None
        Invoice.history.bulk_history_create(invoices, batch_size=250, default_user=who)
        logs = [AuditLog(action="restored", entity="invoice", entity_id=invoice.pk,
                         entity_name=entity_name(invoice), user=who,
                         details="Back in Sales and in the month's GST figures") for invoice in invoices]
        AuditLog.objects.bulk_create(logs, batch_size=250)
        now = timezone.now()
        for row, restored in zip(rows, logs, strict=True):
            row.restored_at, row.restored_by = now, who
            if entry := entries.get(row.audit_log_id):
                mark_undone(entry, user, restored, via=via, save=False)
        BinnedInvoice.objects.bulk_update(rows, ["restored_at", "restored_by"], batch_size=250)
        AuditLog.objects.bulk_update(list(entries.values()), ["snapshot"], batch_size=250)
        invalidate(Invoice, LineItem)
        return invoices


def live_bin():
    """Deleted sales still in the bin, for the list (BinnedInvoice.objects.live()).

    Only the deleting user is joined, outer (one v2 deleted reads as None). The firm's and customer's
    names come from `data`, so a row whose firm or customer v2 deleted still lists (Ruling 1A-6).
    """
    return BinnedInvoice.objects.live().filter(type_of_invoice=INVOICE_TYPE_OUTWARD).select_related("deleted_by")


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
