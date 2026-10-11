"""The purchase bin preserves each bill's original identity, credit and files."""
from types import SimpleNamespace

from django.db import transaction
from django.utils import timezone

from billing.api.mixins import mark_undone
from billing.cache import invalidate, uncached
from billing.credit import credit_month_of
from billing.models import AuditLog, BinnedInvoice, Business, Customer, Invoice, InwardCapture, LineItem
from billing.period_lock import assert_purchase_open, closed_credit_months
from billing.refusals import Refusal
from billing.services.bin import _fields, bin_bill, bin_row
from billing.services.purchase_reads import locked_purchase, purchase_queryset, purchase_ref, supplier_ref
from billing.services.sales import log
from billing.text import inr


def purchase_bin_row(binned):
    data = binned.data.get("invoice", {})
    month = data.get("itc_month")
    from datetime import date
    month = credit_month_of(SimpleNamespace(invoice_date=binned.invoice_date,
        itc_month=date.fromisoformat(month) if month else None))
    closed = closed_credit_months({binned.business_id})
    out = bin_row(binned, set())
    out.pop("customer")
    return {**out, "type": "purchase", "supplier": binned.data.get("supplier", {
        "id": binned.customer_id, "name": binned.data.get("customer_name", ""), "gst_number": "",
        "state_code": "", "state_name": "", "city": ""}),
        "locked": bool(month and (binned.business_id, month.year, month.month) in closed)}


def bin_purchase(invoice, user, reason=""):
    with transaction.atomic():
        invoice = locked_purchase(invoice)
        assert_purchase_open(invoice.business_id, credit_month_of(invoice), "delete")
        supplier = supplier_ref(invoice.customer)
        captures = list(uncached(InwardCapture).filter(invoice_id=invoice.pk).values_list("pk", flat=True))
        binned, _entry = bin_bill(invoice, user, reason, check_month=False,
            details=f"{invoice.customer.name} · {inr(invoice.total_amount)} · restorable")
        binned.data.update(supplier=supplier, captures=captures)
        binned.save(update_fields=["data"])
    return binned


def restore_purchase(binned, user, check_month=True, via="bin"):
    with transaction.atomic():
        entry = uncached(AuditLog).select_for_update().filter(pk=binned.audit_log_id).first()
        binned = uncached(BinnedInvoice).select_for_update().get(pk=binned.pk, type_of_invoice="inward")
        undone = (entry.snapshot or {}).get("_undo") if entry else None
        if binned.restored_at or undone:
            restored_id = (uncached(AuditLog).filter(pk=undone.get("log")).values_list("entity_id", flat=True).first()
                           if undone else None)
            purchase = purchase_queryset().filter(pk=restored_id or binned.original_id).first()
            raise Refusal(f"{binned.invoice_number} is back already.", "already_restored",
                          purchase=purchase_ref(purchase) if purchase else None)
        firm = uncached(Business).select_for_update(no_key=True).filter(pk=binned.business_id).first()
        if firm is None:
            raise Refusal("The firm on this bill was deleted, so it can't come back as it was. Enter the bill again in the right firm.", "firm_gone")
        if not uncached(Customer).filter(pk=binned.customer_id).exists():
            raise Refusal("The supplier on this bill was deleted, so it can't come back as it was. Enter the bill again.", "supplier_gone")
        fields = _fields(Invoice, binned.data["invoice"])
        month = credit_month_of(SimpleNamespace(invoice_date=binned.invoice_date, itc_month=fields.get("itc_month")))
        if check_month:
            assert_purchase_open(firm, month, "restore")
        fields.update(business_id=binned.business_id, customer_id=binned.customer_id)
        made = fields.pop("created_at", None)
        bill = Invoice(pk=binned.original_id, **fields)
        # No duplicate check: this identity occupied the books before it reached the bin.
        if uncached(Invoice).filter(pk=bill.pk).exists():
            existing = purchase_queryset().filter(pk=bill.pk).first()
            raise Refusal(f"{binned.invoice_number} is back already.", "already_restored",
                          purchase=purchase_ref(existing) if existing else None)
        bill.save(force_insert=True)
        LineItem.objects.bulk_create([LineItem(invoice=bill, customer_id=bill.customer_id, **_fields(LineItem, row))
                                      for row in binned.data["lines"]])
        if made:
            Invoice.objects.filter(pk=bill.pk).update(created_at=made)
        InwardCapture.objects.filter(pk__in=binned.data.get("captures", [])).update(invoice_id=bill.pk)
        invalidate(Invoice, LineItem, InwardCapture)
        binned.restored_at, binned.restored_by = timezone.now(), user
        binned.save(update_fields=["restored_at", "restored_by"])
        bill = purchase_queryset().get(pk=bill.pk)
        restored = log(bill, user, "restored", "Back in Purchases; outside the credit ledger" if month is None else
                       "Back in Purchases and in the month's input tax credit")
        if entry:
            mark_undone(entry, user, restored, via=via)
    return bill
