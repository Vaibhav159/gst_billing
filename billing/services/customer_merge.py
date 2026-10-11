"""Owner-only customer merge, previewed and rechecked with both customers locked."""
import re
from collections import defaultdict
from copy import copy, deepcopy
from datetime import date, datetime

from django.db import transaction
from django.http import Http404
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from billing import period_lock
from billing.api.mixins import snapshot_of
from billing.cache import invalidate, uncached
from billing.constants import BILL_CANCELLED, INVOICE_TYPE_INWARD, INVOICE_TYPE_OUTWARD
from billing.models import AuditLog, BinnedInvoice, Business, Customer, Invoice, LineItem, SaleDraft
from billing.numbering import bill_ref
from billing.period_lock import assert_sales_open
from billing.refusals import Refusal
from billing.services.bill_reads import customer_ref
from billing.services.firms import firm_ref
from billing.services.sales import refile_heads
from billing.tax_rules import classify_b2c, clean_gstin, state_code, supply_interstate
from billing.text import day_text, stamp

REF_FIELDS = ("name", "gst_number", "mobile_number", "customer_type")
CUSTOMER_FIELDS = (*REF_FIELDS, "state_name", "created_at")
BILL_FIELDS = ("customer_id", "business_id", "invoice_number", "invoice_date", "type_of_invoice", "status",
               "paper", "sent_at", "sent_via", "total_amount", "place_of_supply",
               "business__name", "business__gst_number", "business__state_name")
HEAD_WORDS = {"igst": "IGST", "cgst_sgst": "CGST + SGST"}
WALKIN_WORDS = "The walk-in record can't be merged. Put each bill in the buyer's name instead."
PICK_TARGET = "Pick the customer to keep."


def _has_column(model, name):
    return any(field.name == name for field in model._meta.concrete_fields)


def target_id(raw, source_id):
    if isinstance(raw, bool) or not isinstance(raw, (str, int)):
        raise ValidationError({"into": [PICK_TARGET]})
    text = str(raw)
    if not text.isascii() or not text.isdigit() or len(text) > 18 or int(text) < 1:
        raise ValidationError({"into": [PICK_TARGET]})
    number = int(text)
    if number == source_id:
        raise ValidationError({"into": ["Pick a different customer to keep; this is the same one."]})
    return number


def duplicates():
    groups = {"gstin": defaultdict(list), "phone": defaultdict(list)}
    customers = uncached(Customer).exclude(customer_type="walkin").only(*REF_FIELDS).order_by("name", "pk")
    for customer in customers:
        reference = customer_ref(customer)
        gstin = (customer.gst_number or "").strip().upper()
        digits = re.sub(r"[^0-9]", "", customer.mobile_number or "")
        if gstin:
            groups["gstin"][gstin].append(reference)
        if digits:
            groups["phone"][digits[-10:]].append(reference)
    return {"groups": [{"what": what, "value": value, "customers": customers}
                       for what in ("gstin", "phone") for value, customers in sorted(groups[what].items())
                       if len(customers) > 1]}


def _pair(source_id, into, lock=False):
    into = target_id(into, source_id)
    fields = (*CUSTOMER_FIELDS, *(("is_supplier",) if _has_column(Customer, "is_supplier") else ()))
    customers = uncached(Customer).filter(pk__in=(source_id, into)).only(*fields).order_by("pk")
    if lock:
        customers = customers.select_for_update()
    found = {customer.pk: customer for customer in customers}
    if source_id not in found or into not in found:
        raise Http404("No Customer matches the given query.")
    return found[source_id], found[into]


def _bills(source, lock=False):
    fields = (*BILL_FIELDS, *(("itc_month",) if _has_column(Invoice, "itc_month") else ()))
    rows = uncached(Invoice).filter(customer=source).select_related("business").only(*fields).order_by("invoice_date", "pk")
    if lock:
        rows = rows.select_for_update(of=("self",))
    bills = list(rows)
    for bill in bills:
        bill.customer = source
    return bills


def _drafts(source, lock=False):
    drafts = SaleDraft.objects.filter(data__customer__id__in=(source.pk, str(source.pk))).only(
        "id", *(("data",) if lock else ()))
    return list(drafts.select_for_update() if lock else drafts)


def _bins(source, lock=False):
    # Also move restored markers: their protected customer reference must survive deleting the source.
    bins = BinnedInvoice.objects.filter(customer=source).only(
        "id", "restored_at", *(("data", "customer_id") if lock else ()))
    return list(bins.select_for_update() if lock else bins)


def _firms_added(source, target):
    through = Customer.businesses.through
    have = through.objects.filter(customer_id=target.pk).values("business_id")
    extra = through.objects.filter(customer_id=source.pk).exclude(business_id__in=have).values("business_id")
    return [firm_ref(firm) for firm in uncached(Business).filter(pk__in=extra).only("name", "short_name").order_by("name", "pk")]


def _change(bill, target):
    after = copy(bill)
    # Model.__copy__ shares its relation cache; detach it before substituting the target.
    after._state = copy(bill._state)
    after._state.fields_cache = dict(bill._state.fields_cache)
    after.customer_id = target.pk
    after._state.fields_cache["customer"] = target
    old_head = "igst" if supply_interstate(bill) else "cgst_sgst"
    new_head = "igst" if supply_interstate(after) else "cgst_sgst"
    old_segment, new_segment = classify_b2c(bill.business, bill)[0], classify_b2c(after.business, after)[0]
    heads = {"from": old_head, "to": new_head} if old_head != new_head else None
    segment = {"from": old_segment, "to": new_segment} if old_segment != new_segment else None
    gstin_changes = clean_gstin(bill.customer.gst_number) != clean_gstin(target.gst_number)
    words = []
    if heads:
        words.append(f"{HEAD_WORDS[old_head]} → {HEAD_WORDS[new_head]}")
    if segment:
        words.append(f"{old_segment.upper()} → {new_segment.upper()} in GSTR-1")
    if gstin_changes:
        words.append("Buyer GSTIN changes")
    if not words:
        return None
    return {"bill": bill_ref(bill), "sent": bool(bill.sent_at), "paper": bill.paper,
            "sent_at": stamp(bill.sent_at), "sent_via": bill.sent_via,
            "heads": heads, "segment": segment, "gstin_changes": gstin_changes, "words": ", ".join(words)}


def _closed_bills(bills):
    closed = []
    for bill in bills:
        month = bill.invoice_date.replace(day=1)
        try:
            if bill.type_of_invoice == INVOICE_TYPE_INWARD:
                if _has_column(Invoice, "itc_month"):
                    from billing.credit import credit_month_of
                    month = credit_month_of(bill)
                elif month < date(2025, 4, 1):
                    month = None
                guard = getattr(period_lock, "assert_purchase_open", None)
                if guard is not None:
                    guard(bill.business_id, month, "edit")
                elif month is not None:
                    # ponytail: part 2 supplies the credit guard; its stated fallback is FiledPeriod, not GSTR-1.
                    period = period_lock.locked_period_or_none(bill.business_id, month)
                    if period:
                        label = month.strftime("%B %Y")
                        raise Refusal(
                            f"{label} is filed and locked for {period.business.name}, so its bills can't move to another customer. "
                            f"Have the owner unlock {label} in GST returns first.", "month_closed",
                            locked_period={"id": period.pk, "business": bill.business_id, "year": month.year, "month": month.month})
            else:
                assert_sales_open(bill.business_id, bill.invoice_date, "merge")
        except Refusal as refusal:
            if refusal.detail.get("code") != "month_closed":
                raise
            if bill.type_of_invoice == INVOICE_TYPE_INWARD:
                label = month.strftime("%B %Y")
                refusal.detail["detail"] = (
                    f"{label} is filed and locked for {bill.business.name}, so {period_lock.CLOSED_WORDS['merge']}. "
                    f"Have the owner unlock {label} in GST returns first.")
            closed.append((month, refusal))
    return closed


def _join_words(words):
    return words[0] if len(words) == 1 else f"{', '.join(words[:-1])} and {words[-1]}"


def _sent_refusal(change, source, target):
    number = change["bill"]["invoice_number"]
    if change["paper"]:
        intro = f"{number} was written in the paper bill book, so the customer has it."
    else:
        sent = timezone.localtime(datetime.fromisoformat(change["sent_at"]))
        via = "WhatsApp" if change["sent_via"] == "whatsapp" else "the share sheet"
        bill_day = date.fromisoformat(change["bill"]["invoice_date"])
        intro = (f"{number} was already sent. {number} went to {source.name} on {via} "
                 f"({day_text(bill_day)}, {sent.strftime('%d %b %Y %H:%M')}).")
    code = state_code(target)
    state = f"{(target.state_name or '').title()} ({code})" if code else "state not recorded"
    gstin = clean_gstin(target.gst_number) or "no GSTIN"
    return (f"Can't merge: {intro} Under {target.name} ({state}, {gstin}) it would change: {change['words']}. "
            f"The copy the customer has wouldn't match your return. Cancel and remake {number} first, then merge.")


def _preview(source, target, bills, bins, drafts):
    sales = [bill for bill in bills if bill.type_of_invoice == INVOICE_TYPE_OUTWARD]
    purchases = [bill for bill in bills if bill.type_of_invoice == INVOICE_TYPE_INWARD]
    changes = [change for bill in sales if bill.status != BILL_CANCELLED if (change := _change(bill, target))]
    sent = [change for change in changes if change["sent"] or change["paper"]]
    closed = _closed_bills(bills)
    months = sorted({month.isoformat()[:7] for month, _ in closed})
    refusal = None
    if source.kind == "walkin" or target.kind == "walkin":
        refusal = {"code": "walkin", "detail": WALKIN_WORDS, "months": [], "bills": []}
    elif purchases and clean_gstin(source.gst_number) != clean_gstin(target.gst_number):
        numbers = _join_words([bill.invoice_number for bill in purchases])
        source_gstin = clean_gstin(source.gst_number) or "no GSTIN"
        target_gstin = clean_gstin(target.gst_number) or "no GSTIN"
        noun = "purchase bill" if len(purchases) == 1 else "purchase bills"
        words = (f"Can't merge: under {target.name} ({target_gstin}), {noun} {numbers} "
                 f"from {source.name} ({source_gstin}) would have a different supplier GSTIN. "
                 "The supplier's bills wouldn't match your purchase records. Keep both customers.")
        purchase_changes = [{"bill": bill_ref(bill), "sent": bool(bill.sent_at), "paper": bill.paper,
                             "sent_at": stamp(bill.sent_at), "sent_via": bill.sent_via,
                             "heads": None, "segment": None, "gstin_changes": True,
                             "words": "Supplier GSTIN changes"} for bill in purchases]
        refusal = {"code": "sent_changes", "detail": words, "months": [], "bills": purchase_changes}
    elif closed:
        names = _join_words([date.fromisoformat(month + "-01").strftime("%B %Y") for month in months])
        many = len(closed) != 1
        words = (f"Can't merge: {len(closed)} {'bills' if many else 'bill'} of {source.name} "
                 f"{'are' if many else 'is'} in filed months. {names} {'are' if len(months) > 1 else 'is'} filed and locked, "
                 "and merging would change returns already filed. Keep both customers, or unlock those months in GST returns first (owner only).")
        refusal = {"code": "month_closed", "detail": words, "months": months, "bills": []}
    elif sent:
        refusal = {"code": "sent_changes", "detail": _sent_refusal(sent[0], source, target), "months": [], "bills": sent}
    return ({"source": {**customer_ref(source), "state_name": source.state_name or ""},
             "target": {**customer_ref(target), "state_name": target.state_name or "",
                        "since": timezone.localtime(target.created_at).date().isoformat()},
             "can_merge": refusal is None, "refusal": refusal,
             "bills": {"count": sum(bill.status != BILL_CANCELLED for bill in sales),
                       "cancelled": sum(bill.status == BILL_CANCELLED for bill in sales),
                       "numbers": [bill.invoice_number for bill in sales]},
             "purchases": len(purchases),
             "bin": sum(row.restored_at is None for row in bins), "drafts": len(drafts), "changes": changes,
             "firms_added": _firms_added(source, target),
             "keeps": f"{target.name} keeps its name, phone, GSTIN and address."}, closed)


def merge_preview(source_id, into):
    source, target = _pair(source_id, into)
    return _preview(source, target, _bills(source), _bins(source), _drafts(source))[0]


def merge_customers(source_id, into, user):
    with transaction.atomic():
        source, target = _pair(source_id, into, lock=True)
        bills, bins, drafts = _bills(source, lock=True), _bins(source, lock=True), _drafts(source, lock=True)
        preview, closed = _preview(source, target, bills, bins, drafts)
        if refusal := preview["refusal"]:
            if refusal["code"] == "month_closed":
                first = closed[0][1].detail
                raise Refusal(first["detail"], "month_closed", months=refusal["months"],
                              **{key: value for key, value in first.items() if key not in ("code", "detail")})
            raise Refusal(refusal["detail"], refusal["code"], bills=refusal["bills"])
        snapshot = snapshot_of(uncached(Customer).get(pk=source.pk))
        ids = [bill.pk for bill in bills]
        uncached(Invoice).filter(pk__in=ids).update(customer_id=target.pk)
        uncached(LineItem).filter(customer_id=source.pk).update(customer_id=target.pk)
        invalidate(Invoice, LineItem)
        refiled = 0
        by_id = {bill.pk: bill for bill in bills}
        for change in preview["changes"]:
            if change["heads"]:
                refile_heads(by_id[change["bill"]["id"]], user,
                             details=f"Tax heads re-filed: its customer was merged into {target.name}")
                refiled += 1
        for row in bins:
            data = deepcopy(row.data) if isinstance(row.data, dict) else {}
            data["customer_name"] = target.name
            if isinstance(data.get("invoice"), dict):
                data["invoice"]["customer_id"] = str(target.pk)
            for item in data.get("lines", []):
                if isinstance(item, dict) and "customer_id" in item:
                    item["customer_id"] = str(target.pk)
            row.customer_id, row.data = target.pk, data
        if bins:
            BinnedInvoice.objects.bulk_update(bins, ["customer_id", "data"])
        for draft in drafts:
            draft.data = {**draft.data, "customer": {**draft.data["customer"], "id": target.pk, "name": target.name}}
            draft.save(update_fields=["data", "updated_at"])
        target.businesses.add(*(row["id"] for row in preview["firms_added"]))
        if _has_column(Customer, "is_supplier") and source.is_supplier and not target.is_supplier:
            target.is_supplier = True
            target.save(update_fields=["is_supplier", "updated_at"])
        moved_sales = len(bills) - preview["purchases"]
        AuditLog.objects.create(action="merged", entity="customer", entity_id=target.pk, entity_name=target.name,
                                user=user, details=f"{source.name} merged into {target.name} · {moved_sales} bills moved",
                                snapshot=snapshot, changes={"merged_customer": {"old": source.name, "new": target.name}})
        source.delete()
        return {"target": target.pk, "moved": {"bills": moved_sales, "purchases": preview["purchases"],
                "bin": preview["bin"], "drafts": preview["drafts"]}, "refiled": refiled,
                "firms_added": len(preview["firms_added"])}
