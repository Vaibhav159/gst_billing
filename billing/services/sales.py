"""v3's sales writes: one function per action, each refusing what the books can't take.

The API (billing/api/sales.py) validates what was sent and calls these; they lock the bill,
check the month (assert_sales_open), write it and its audit row in one transaction.
"""

import re
from datetime import date
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import F
from django.http import Http404
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from billing.cache import invalidate
from billing.constants import BILL_ACTIVE, BILL_CANCELLED, INVOICE_TYPE_OUTWARD
from billing.fy import fy_of
from billing.models import AuditLog, Invoice, LineItem
from billing.numbering import checked_number, format_number, refuse_taken
from billing.period_lock import assert_sales_open
from billing.refusals import Refusal
from billing.tax_rules import default_place_of_supply, normalize_rate, normalize_tax_heads, supply_interstate
from billing.text import day_text, inr, money, stamp

CANCELLED_WORDS = "Cancelled bills can't be changed. Make it again from the bill instead."

# The firm's details a printed bill shows (design decision 7).
FIRM_FIELDS = ("name", "address", "gst_number", "state_name", "pan_number", "mobile_number", "email",
               "bank_name", "bank_account_number", "bank_ifsc_code", "bank_branch_name", "invoice_prefix")


def firm_snapshot(business):
    """The firm as a bill prints it, frozen on the bill at create and on a move to another firm."""
    data = {field: getattr(business, field) or "" for field in FIRM_FIELDS}
    data["signature_image"] = business.signature_image.name if business.signature_image else ""
    return data


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


def save_number(invoice, fields=None):
    """invoice.save() (of `fields` only, when given), with the database's unique-number guard
    (two saves racing for one number) turned into the 409 clash instead of a 500."""
    try:
        with transaction.atomic():
            invoice.save(**({"update_fields": [*fields, "updated_at"]} if fields else {}))
    except IntegrityError:
        refuse_taken(invoice.business, invoice.invoice_date, invoice.invoice_number, exclude_invoice=invoice.pk)
        raise


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


# The Audit log's words for a send: the first, and the ones after it (contract 2.10, Ruling 1A-21).
VIA_WORDS = {"whatsapp": ("WhatsApp", "Again on WhatsApp"), "share": ("On the share sheet", "Again on the share sheet")}


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
        first, repeat = VIA_WORDS[via]
        log(invoice, user, "sent", f"{repeat if again else first} to {who}")
        # Re-read under the row lock: a delete that lands now waits for this send to commit (review M2).
        invoice.refresh_from_db()
    return invoice


def renumber_bill(invoice, user, typed):
    """Give a bill a new number in its firm's series (the date stays); returns (bill, old number)."""
    with transaction.atomic():
        invoice = locked_bill(invoice)
        refuse_cancelled(invoice)
        assert_sales_open(invoice.business_id, invoice.invoice_date, "renumber")
        old = invoice.invoice_number
        number = checked_number(invoice.business, invoice.invoice_date, typed, exclude_invoice=invoice.pk)
        if number.lower() == old.strip().lower():
            raise ValidationError({"invoice_number": [f"{old} is this bill's number already. Type the new number."]})
        invoice.invoice_number = number
        save_number(invoice, ["invoice_number"])
        log(invoice, user, "renumbered", f"{old} → {number}", changes={"invoice_number": {"old": old, "new": number}})
    return invoice, old


def move_bill(invoice, user, business, typed):
    """Move a bill to another firm's series under a number of that series, with that firm frozen
    on it; its tax heads follow the new firm's state, its total stays. Returns (bill, old firm, old number).

    The row lock (locked_bill) also holds off v2's PATCH and PUT, which read the bill under it
    (Ruling 1A-26), so neither writes back what the other just changed.
    """
    with transaction.atomic():
        invoice = locked_bill(invoice)
        refuse_cancelled(invoice)
        if business.pk == invoice.business_id:
            raise ValidationError({"business": [f"The bill is in {business.name} already. Pick the firm to move it to."]})
        assert_sales_open(invoice.business_id, invoice.invoice_date, "move")
        assert_sales_open(business, invoice.invoice_date, "move")
        number = checked_number(business, invoice.invoice_date, typed)
        old_business, old_number = invoice.business, invoice.invoice_number
        invoice.business, invoice.invoice_number = business, number
        invoice.firm_snapshot = firm_snapshot(business)
        save_number(invoice, ["business", "invoice_number", "firm_snapshot"])  # Invoice.save re-files the heads
        log(invoice, user, "moved", f"{old_number} → {number} ({business.name})",
            changes={"business": {"old": old_business.pk, "new": business.pk},
                     "invoice_number": {"old": old_number, "new": number}})
    return invoice, old_business, old_number


# The header fields an edit reports old -> new (audit `changes`).
EDIT_FIELDS = ("business", "customer", "invoice_number", "invoice_date", "payment_mode", "place_of_supply", "notes",
               "total_amount")
# The most a bill's total (numeric(12, 3)) can hold.
MOST = Decimal("999999999.999")


def _audit_values(invoice):
    """EDIT_FIELDS as they are, the parties by id."""
    return {f: getattr(invoice, f + "_id" if f in ("business", "customer") else f) for f in EDIT_FIELDS}


def _audit_text(value):
    """A value as the audit log keeps it, as v2's snapshots do (text, None as None); money to the paisa."""
    return None if value is None else money(value) if isinstance(value, Decimal) else str(value)


def _changes(before, after, fields):
    """{field: {"old", "new"}} for each of `fields` whose value changed."""
    return {f: {"old": _audit_text(before[f]), "new": _audit_text(after[f])} for f in fields if before[f] != after[f]}


def _date_problem(day):
    """Why a bill can't take `day` (contract 2.3; Ruling 1A-32), or ""."""
    if day < date(2000, 1, 1):
        return "Pick a date from 2000 to 2099."
    if day > timezone.localdate():
        return f"{day_text(day)} is after today. A bill can't be dated in the future."
    return ""


def _remade(replaces):
    """The cancelled bill a new bill makes again, row-locked so two saves can't both make it again; or a 400."""
    target = Invoice.objects.sales().select_for_update().filter(pk=replaces).first()
    if target is None or target.status != BILL_CANCELLED:
        raise ValidationError({"replaces": ["Only a cancelled bill can be made again."]})
    again = Invoice.objects.sales().filter(replaces=target.pk).order_by("pk").first()
    if again is not None:
        raise ValidationError({"replaces": [f"{target.invoice_number} was made again already, as {again.invoice_number}."]})
    return target


def save_bill(data, user, invoice=None):
    """POST sales/ (no `invoice`) or PUT sales/{id}/ from validated data (part 1 API contract, 2.3).

    Paper first: the number is the one typed, never one made up. The lines go through the one
    builder (billing.services.line_items), which works out every figure the server's way. The
    number is checked only when it, the firm or the FY changes, so an older bill whose number
    predates the rules can still be edited (and a date, only when it changes); a new firm freezes
    that firm on the bill. The audit row is written before the answer is read, so the answer
    shows it.
    """
    from billing.services.bin import v2_snapshot
    from billing.services.line_items import build_line_items

    business, customer, day = data["business"], data["customer"], data["invoice_date"]
    with transaction.atomic():
        old = locked_bill(invoice) if invoice else None
        if old is not None:
            refuse_cancelled(old)
            assert_sales_open(old.business_id, old.invoice_date, "edit")
            before = _audit_values(old)
        problem = _date_problem(day) if old is None or day != old.invoice_date else ""
        if problem:
            raise ValidationError({"invoice_date": [problem]})
        assert_sales_open(business, day, "edit" if old else "create")
        moved = old is not None and business.pk != old.business_id
        number = format_number(business, day, data["invoice_number"])
        if old is not None and not moved and fy_of(day) == fy_of(old.invoice_date) and number == old.invoice_number.strip():
            number = old.invoice_number  # unchanged: kept as stored, never checked again
        else:
            number = checked_number(business, day, data["invoice_number"], exclude_invoice=old.pk if old else None)
        replaces = data["replaces"] if old is None else old.replaces
        if old is None and replaces is not None:
            replaces = _remade(replaces).pk
        chosen = data["place_of_supply"]
        if chosen == default_place_of_supply(business, customer):
            chosen = None  # NULL means the rule: stored only when it differs (rollback-safe)

        bill = old or Invoice(paper=data["paper"], replaces=replaces, type_of_invoice=INVOICE_TYPE_OUTWARD)
        if old is not None and customer.pk != old.customer_id:
            bill.sent_to = ""  # a one-off number typed for the old customer is no number for the new one
        bill.business, bill.customer, bill.invoice_number, bill.invoice_date = business, customer, number, day
        bill.payment_mode, bill.place_of_supply, bill.notes = data["payment_mode"], chosen, data["notes"]
        if old is None or moved:
            bill.firm_snapshot = firm_snapshot(business)
        lines, total = build_line_items(bill, [
            {"product_name": li["product_name"], "hsn_code": li["hsn_code"], "quantity": li["quantity"],
             "rate": li["rate"], "unit": li["unit"], "note": li["note"],
             "gst_tax_rate": normalize_rate(li["gst_percent"], assume="percent")}
            for li in data["lines"]], source="api")
        if total > MOST:
            raise ValidationError({"lines": ["These items come to more than one bill can hold. Split them into two bills."]})
        bill.total_amount = total
        if old is not None:
            stale = LineItem.objects.filter(invoice=bill)
            stale._raw_delete(stale.db)  # no per-line signal; the total is set above
        save_number(bill)
        LineItem.objects.bulk_create(lines)
        invalidate(Invoice, LineItem)  # the raw delete sends nothing, and v2's cached lists hold the bill
        if old is None:
            paper = f" · From the paper bill book, dated {day_text(day)}" if bill.paper else ""
            log(bill, user, "created", f"{customer.name} · {inr(total)}{paper}", snapshot=v2_snapshot(bill))
        else:
            changes = _changes(before, _audit_values(bill), EDIT_FIELDS)
            log(bill, user, "updated", f"Updated {', '.join(changes)}" if changes else "Updated the lines",
                changes=changes or None)
    return Invoice.objects.sales().select_related("customer", "business").get(pk=bill.pk)


EWAY_FIELDS = ("eway_bill_number", "transporter_name", "transporter_gstin", "vehicle_number", "vehicle_type",
               "transport_mode", "distance_km")


def save_eway(invoice, user, data):
    """PUT sales/{id}/eway/: the e-way bill's details, as made on the GST portal, so they print. What's sent replaces
    what's stored; a save that changes nothing writes nothing."""
    with transaction.atomic():
        invoice = locked_bill(invoice)
        refuse_cancelled(invoice)
        assert_sales_open(invoice.business_id, invoice.invoice_date, "edit")
        stored = {f: getattr(invoice, f) for f in EWAY_FIELDS}
        merged = {**stored, **data}
        if merged["transport_mode"] == "Road" and merged["eway_bill_number"] and not merged["vehicle_number"]:
            raise ValidationError({"vehicle_number": [
                "By road, the e-way bill needs the vehicle number. Add it here, or later on the portal (Part B)."]})
        changes = _changes(stored, merged, EWAY_FIELDS)
        if changes:
            for f in changes:
                setattr(invoice, f, merged[f])
            invoice.save(update_fields=[*changes, "updated_at"])
            log(invoice, user, "updated",
                f"E-way bill {invoice.eway_bill_number}" if invoice.eway_bill_number else "Transport details",
                changes=changes)
    return invoice


def refile_heads(invoice, user):
    """POST sales/{id}/fix-heads/: each line's tax onto the heads the bill's place of supply gives,
    every line's tax (and so the total) kept. One write for every line that moves; none when none does."""
    from billing.services.bill_reads import lines_of

    with transaction.atomic():
        invoice = locked_bill(invoice)
        refuse_cancelled(invoice)
        assert_sales_open(invoice.business_id, invoice.invoice_date, "edit")
        inter, now, moved = supply_interstate(invoice), timezone.now(), []
        for li in lines_of([invoice])[invoice.pk]:
            heads = normalize_tax_heads(li.cgst, li.sgst, li.igst, inter)
            if heads != (li.cgst, li.sgst, li.igst):
                (li.cgst, li.sgst, li.igst), li.updated_at = heads, now
                moved.append(li)
        if moved:
            LineItem.objects.bulk_update(moved, ["cgst", "sgst", "igst", "updated_at"])
            invalidate(LineItem)  # bulk_update sends no signal
            log(invoice, user, "updated", "Tax heads re-filed for the place of supply")
    return invoice
