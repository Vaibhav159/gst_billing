"""Atomic v3 purchase writes; the shared line builder owns the money."""

from types import SimpleNamespace

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from billing.api.inward_bills_service import find_duplicate
from billing.cache import invalidate, uncached
from billing.credit import choose_credit_month, credit_month_of
from billing.fy import fy_of
from billing.models import Business, Customer, Invoice, LineItem
from billing.numbering import lock_firms
from billing.period_lock import assert_purchase_open
from billing.refusals import Refusal
from billing.services.bill_reads import lines_of
from billing.services.bin import v2_snapshot
from billing.services.line_items import build_line_items
from billing.services.purchase_reads import locked_purchase
from billing.services.sales import MOST, _audit_text, _too_big, log
from billing.tax_rules import clean_gstin, gstin_problem, itc_refusal, normalize_rate
from billing.text import day_text, inr

EDIT_FIELDS = ("business_id", "customer_id", "invoice_number", "invoice_date", "payment_mode", "itc_month",
               "itc_eligible", "buyer_gstin", "buyer_ack", "total_amount")
CHANGED_WORDS = {"business_id": "the firm", "customer_id": "the supplier", "invoice_number": "the number",
                 "invoice_date": "the date", "payment_mode": "the payment", "lines": "the items",
                 "itc_month": "the credit month", "itc_eligible": "the credit eligibility",
                 "buyer_gstin": "the buyer GSTIN", "buyer_ack": "the buyer confirmation", "total_amount": "the total"}


def duplicate_for(business, supplier, number, day, exclude_id=None):
    return find_duplicate(business, number, supplier=supplier, invoice_date=day, exclude_id=exclude_id)


def refuse_duplicate(existing, typed):
    from billing.services.purchase_reads import purchase_ref

    words = (f"Already entered for {existing.business.name}: {existing.invoice_number} from "
             f"{existing.customer.name}, {day_text(existing.invoice_date)}, {inr(existing.total_amount)}.")
    if typed != existing.invoice_number:
        words += f" “{typed}” and “{existing.invoice_number}” are the same number written differently."
    raise Refusal(words, "duplicate", purchase=purchase_ref(existing))


def _changed_words(changed):
    words = [text for key, text in CHANGED_WORDS.items() if key in changed]
    return f"Changed {', '.join(words[:-1])} and {words[-1]}" if len(words) > 1 else f"Changed {words[0]}"


def save_purchase(data, user, invoice=None):
    from billing.services.purchase_reads import purchase_queryset

    business, supplier, day = data["business"], data["supplier"], data["invoice_date"]
    with transaction.atomic():
        old = locked_purchase(invoice) if invoice else None
        before = {field: getattr(old, field) for field in EDIT_FIELDS} if old else {}
        old_lines = lines_of([old])[old.pk] if old else []
        old_snapshot = v2_snapshot(old, old_lines) if old else None
        # Filing and every purchase write share these locks, including both sides of a move.
        lock_firms(*({business.pk, old.business_id} if old else {business.pk}))
        if old:
            assert_purchase_open(old.business_id, credit_month_of(old), "edit")
        if not 2000 <= day.year <= 2099:
            raise ValidationError({"invoice_date": ["Pick a date from 2000 to 2099."]})
        if day > timezone.localdate():
            raise ValidationError({"invoice_date": [f"That's after today ({day_text(timezone.localdate())}). Check the date on the bill."]})
        month_args = {"value": data["itc_month"]} if "itc_month" in data else {}
        month = choose_credit_month(business, day, invoice=old, **month_args)
        assert_purchase_open(business, credit_month_of(SimpleNamespace(invoice_date=day, itc_month=month)),
                             "edit" if old else "create")
        number = data["invoice_number"]
        identity_changed = old is None or any((business.pk != old.business_id, supplier.pk != old.customer_id,
                                               fy_of(day) != fy_of(old.invoice_date), number != old.invoice_number))
        if identity_changed and not data.get("duplicate_ok", False):
            duplicate = duplicate_for(business, supplier, number, day, old.pk if old else None)
            if duplicate:
                refuse_duplicate(duplicate, number)
        buyer = data.get("buyer_gstin", "")
        items = [{**item, "gst_tax_rate": normalize_rate(item["gst_percent"], assume="percent")} for item in data["lines"]]
        bill = old or Invoice(type_of_invoice="inward")
        bill.business, bill.customer, bill.invoice_date = business, supplier, day
        bill.invoice_number, bill.payment_mode = number, data.get("payment_mode", "")
        bill.itc_month, bill.itc_eligible = month, data.get("itc_eligible", True)
        bill.buyer_gstin, bill.buyer_ack = buyer, data.get("buyer_ack", False)
        bill.place_of_supply = None  # purchases always follow their two parties, including an older v2 row
        checked = bool(old and old.needs_review)
        bill.needs_review = False if old else data.get("needs_review", False)
        if old is None:
            bill.source = data.get("source", "typed")
            bill.linked_sale = data.get("linked_sale")
        lines, total = build_line_items(bill, items, source="api")
        too_big = _too_big(lines)
        if too_big:
            raise ValidationError({"lines": too_big})
        if total > MOST:
            raise ValidationError({"lines": ["These items come to more than one bill can hold. Split them into two bills."]})
        changed = set()
        if old:
            changed = {f for f in EDIT_FIELDS if f != "total_amount" and before[f] != getattr(bill, f)}
            editable = ("product_name", "hsn_code", "quantity", "unit", "rate", "gst_tax_rate", "note")
            if len(lines) != len(old_lines) or any(getattr(a, f) != getattr(b, f)
                    for a, b in zip(lines, old_lines, strict=True) for f in editable):
                changed.add("lines")
            if not changed:
                if checked:
                    bill.save(update_fields=["needs_review", "updated_at"])
                    log(bill, user, "checked", "Checked against the photo")
                return purchase_queryset().get(pk=bill.pk)
            if before["total_amount"] != total:
                changed.add("total_amount")
        if buyer and buyer != clean_gstin(business.gst_number) and not data.get("buyer_ack", False):
            other = uncached(Business).filter(gst_number__iexact=buyer).only("name").first()
            words = (f"This bill is addressed to {other.name}, not {business.name}." if other else
                     f"This bill isn't addressed to {business.name}'s GSTIN.")
            raise ValidationError({"buyer_gstin": [words]})
        problem = gstin_problem(supplier.gst_number)
        if problem:
            raise ValidationError({"supplier": [problem]})
        problem = itc_refusal(supplier.gst_number, items)
        if problem:
            raise ValidationError({"lines": [problem]})
        if old:
            stale = LineItem.objects.filter(invoice_id=bill.pk)
            stale._raw_delete(stale.db)
        bill.total_amount = total
        bill.save()
        LineItem.objects.bulk_create(lines)
        if not supplier.is_supplier:
            Customer.objects.filter(pk=supplier.pk).update(is_supplier=True)
            invalidate(Customer)
        if old is None and data.get("capture") is not None:
            from billing.services.capture_reads import consume_capture
            consume_capture(data["capture"], bill)
        invalidate(Invoice, LineItem)
        if old:
            changes = {f.removesuffix("_id"): {"old": _audit_text(before[f]), "new": _audit_text(getattr(bill, f))}
                       for f in EDIT_FIELDS if f in changed}
            log(bill, user, "updated", _changed_words(changed) + (", checked" if checked else ""), changes=changes,
                snapshot=old_snapshot)
        else:
            detail = f"{supplier.name} · {inr(total)}"
            if data.get("capture") is not None:
                detail += " · from a captured photo"
            log(bill, user, "created", detail, snapshot=v2_snapshot(bill, lines))
    return purchase_queryset().get(pk=bill.pk)


def check_purchase(invoice, user):
    with transaction.atomic():
        bill = locked_purchase(invoice)
        lock_firms(bill.business_id)
        assert_purchase_open(bill.business_id, credit_month_of(bill), "checked")
        if bill.needs_review:
            bill.needs_review = False
            bill.save(update_fields=["needs_review", "updated_at"])
            log(bill, user, "checked", "Checked against the photo")
    return bill


def move_credit(invoice, user, month):
    from billing.services.purchase_reads import credit_block

    with transaction.atomic():
        bill = locked_purchase(invoice)
        lock_firms(bill.business_id)
        previous = credit_month_of(bill)
        assert_purchase_open(bill.business_id, previous, "credit-month")
        value = bill.invoice_date.strftime("%Y-%m") if month is None and previous is not None else month
        chosen = choose_credit_month(bill.business, bill.invoice_date, value=value, invoice=bill)
        effective = credit_month_of(SimpleNamespace(invoice_date=bill.invoice_date, itc_month=chosen))
        assert_purchase_open(bill.business_id, effective, "edit")
        if previous != effective:
            bill.itc_month = chosen
            bill.save(update_fields=["itc_month", "updated_at"])
            log(bill, user, "credit_set", f"Credit claimed in {effective.strftime('%B %Y')} (was {previous.strftime('%B %Y')})")
        return {"id": bill.pk, "credit": credit_block(bill), "previous": previous.strftime("%Y-%m") if previous else None}
