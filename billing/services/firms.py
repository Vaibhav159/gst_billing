"""Firm records: narrow uncached reads, legal identity freezing and print settings."""
from datetime import date

from django.apps import apps
from django.db.models import Count, F, Q, Sum, Window
from django.db.models.functions import Round, RowNumber
from django.utils import timezone

from billing.cache import uncached
from billing.constants import BILL_CANCELLED, INVOICE_TYPE_INWARD, INVOICE_TYPE_OUTWARD
from billing.fy import fy_label, fy_of, fy_range
from billing.gstin import validate
from billing.media import sign_media_path
from billing.models import (
    BinnedInvoice,
    Business,
    FiledPeriod,
    Invoice,
    InwardCapture,
    ITCReclaimLedger,
    LineItem,
    SaleDraft,
    SavedDraft,
)
from billing.numbering import (
    REF_FIELDS,
    _in_series,
    bill_ref,
    counter_of,
    full_number_on,
    next_number,
    series_bills,
    series_bin,
)
from billing.tax_rules import state_code
from billing.text import money, stamp

DECLARATION = "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct."
SLIM_FIELDS = ("name", "short_name", "gst_number", "state_name", "invoice_prefix", "city", "paper_full_number_from")
DETAIL_FIELDS = (*SLIM_FIELDS, "pan_number", "address", "pin_code", "mobile_number", "email", "bank_name",
                 "bank_account_number", "bank_ifsc_code", "bank_branch_name", "signature_image", "signature_on_bills",
                 "jurisdiction", "declaration", "updated_at")


def short_name(business):
    return business.short_name or (business.name.split()[0].title() if business.name.split() else "")


def firm_ref(business):
    return {"id": business.pk, "name": business.name, "short": short_name(business)}


def live_print_fields(business):
    return {"bank_name": business.bank_name or "", "bank_account_number": business.bank_account_number or "",
            "bank_ifsc_code": business.bank_ifsc_code or "", "bank_branch_name": business.bank_branch_name or "",
            "signature_url": sign_media_path(business.signature_image.name) if business.signature_image else None,
            "signature_on_bills": business.signature_on_bills, "city": business.city, "pin_code": business.pin_code,
            "jurisdiction_printed": business.jurisdiction or business.city or "Udaipur",
            "declaration_printed": business.declaration or DECLARATION, "short": short_name(business)}


def firm_row(business):
    return {"id": business.pk, **{key: getattr(business, key) or "" for key in SLIM_FIELDS if key != "paper_full_number_from"},
            "short": short_name(business), "state_code": state_code(business),
            "paper_full_number_from": business.paper_full_number_from.isoformat() if business.paper_full_number_from else None}


def firm_numbers(business):
    today = timezone.localdate()
    fy = fy_of(today)
    following = next_number(business, today)
    tail = str(following["counter"] - 1)
    bills = list(series_bills(business.pk, fy).filter(invoice_number__endswith=tail).select_related("customer").only(*REF_FIELDS))
    binned = list(series_bin(business.pk, fy).filter(invoice_number__endswith=tail).select_related("customer").only(
        "original_id", "invoice_number", "invoice_date", "customer__name"))
    last = max((b for b in [*bills, *binned] if _in_series(b) and counter_of(b.invoice_number) == following["counter"] - 1),
               key=lambda b: (counter_of(b.invoice_number), b.invoice_date, b.pk), default=None)
    if isinstance(last, BinnedInvoice):
        ref = {"id": last.original_id, "invoice_number": last.invoice_number,
               "invoice_date": last.invoice_date.isoformat(), "customer_name": last.customer.name, "status": "deleted"}
    else:
        ref = bill_ref(last) if last else None
    return {"fy": fy_label(fy), "last": ref, "next": following, "full_number": full_number_on(business, today)}


def optional_filing_model(name):
    """Only absent part-3 models are optional; an installed model's database errors remain visible."""
    try:
        return apps.get_model("billing", name)
    except LookupError:
        return None


def filing_dates(ids, months):
    """Narrow filing dates for the requested grid and each firm's latest filed month."""
    model = optional_filing_model("FilingRecord")
    if model is None or not months:
        return {}
    where = Q()
    for label in months:
        year, month = map(int, label.split("-"))
        where |= Q(year=year, month=month)
    return {(pk, f"{year}-{month:02d}", kind): day.isoformat() for pk, year, month, kind, day in
            uncached(model).filter(where, business_id__in=ids, kind__in=("gstr1", "gstr3b"))
            .values_list("business_id", "year", "month", "kind", "filed_on")}


def read_filings(ids, months):
    """One bulk stage call, one narrow date query and one grouped blocker call; no monthly query loop."""
    from importlib import import_module
    today = timezone.localdate()
    months = sorted(set(months))
    grouped_blockers = None
    try:
        filing = import_module("billing.services.filing")
    except ModuleNotFoundError as missing:
        if missing.name != "billing.services.filing":
            raise
        # ponytail: only the absence of part 3 selects its explicitly approved v2-lock fallback.
        closed = set(uncached(FiledPeriod).filter(business_id__in=ids).values_list("business_id", "year", "month"))
        latest = {pk: max((f"{year}-{month:02d}" for firm, year, month in closed if firm == pk), default=None) for pk in ids}
        stages = {(pk, label): "filed" if (pk, *map(int, label.split("-"))) in closed else "open"
                  for pk in ids for label in months}
    else:
        result = filing.month_stages(ids, months, today=today)
        stages, latest = result["stages"], result["latest_gstr1"]
        grouped_blockers = result.get("blockers")
    dates = filing_dates(ids, set(months) | {label for label in latest.values() if label})
    def dates_for(pk, label):
        return {"month": label, "gstr1_filed_on": dates.get((pk, label, "gstr1")),
                "gstr3b_filed_on": dates.get((pk, label, "gstr3b"))}
    shown = {(pk, label): {**dates_for(pk, label), "state": stages[pk, label]} for pk in ids for label in months}
    blocked = [(pk, label) for (pk, label), state in stages.items() if state == "blocked"]
    blockers = {}
    if blocked:
        if grouped_blockers is None:
            from billing.services.gst_checks import gstr1_blockers
            grouped_blockers = gstr1_blockers(sorted({pk for pk, _ in blocked}), sorted({label for _, label in blocked}))
        blockers = {key: (grouped_blockers.get(key, {}).get("first_two") or [""])[0] for key in blocked}
    return {"months": shown, "last": {pk: dates_for(pk, label) if label else None for pk, label in latest.items()},
            "blockers": blockers}


def firm_figures(ids, fy=None, filings=None):
    today = timezone.localdate()
    fy = fy_of(today) if fy is None else fy
    start, end = fy_range(fy)
    end = min(end, today)
    scope = uncached(Invoice).filter(business_id__in=ids, invoice_date__range=(start, end))
    active = ~Q(status=BILL_CANCELLED)
    totals = {(row["business_id"], row["type_of_invoice"]): row for row in scope.values("business_id", "type_of_invoice")
              .annotate(bills=Count("pk", filter=active), total=Sum("total_amount", filter=active),
                        cancelled=Count("pk", filter=Q(status=BILL_CANCELLED)), customers=Count("customer_id", distinct=True, filter=active))
              .order_by()}
    tax = {(row["invoice__business_id"], row["invoice__type_of_invoice"]): row["tax"] for row in
           uncached(LineItem).filter(invoice__in=scope.counted().values("pk"))
           .values("invoice__business_id", "invoice__type_of_invoice")
           .annotate(tax=Sum(Round("cgst", 2) + Round("sgst", 2) + Round("igst", 2))).order_by()}
    bounds = {}
    for label, ordering in (("first_bill", ("invoice_date", "pk")), ("last_bill", ("-invoice_date", "-pk"))):
        selected = scope.counted().filter(type_of_invoice=INVOICE_TYPE_OUTWARD).annotate(
            place=Window(RowNumber(), partition_by=F("business_id"), order_by=ordering)).filter(place=1)
        bounds[label] = {b.business_id: bill_ref(b) for b in selected.select_related("customer").only("business_id", *REF_FIELDS)}
    previous = date(today.year - (today.month == 1), 12 if today.month == 1 else today.month - 1, 1).strftime("%Y-%m")
    filings = read_filings(ids, [previous]) if filings is None else filings
    result = {}
    for pk in ids:
        sale_values = totals.get((pk, INVOICE_TYPE_OUTWARD), {})
        purchase_values = totals.get((pk, INVOICE_TYPE_INWARD), {})
        state = filings["months"][pk, previous]
        result[pk] = {"fy": fy_label(fy), "from": start.isoformat(), "to": end.isoformat(),
                      "sales": {"bills": sale_values.get("bills", 0), "total": money(sale_values.get("total")),
                                "tax": money(tax.get((pk, INVOICE_TYPE_OUTWARD))), "cancelled": sale_values.get("cancelled", 0)},
                      "purchases": {"bills": purchase_values.get("bills", 0), "total": money(purchase_values.get("total")),
                                    "tax": money(tax.get((pk, INVOICE_TYPE_INWARD)))},
                      "customers": sale_values.get("customers", 0), "first_bill": bounds["first_bill"].get(pk),
                      "last_bill": bounds["last_bill"].get(pk),
                      "last_filed": filings["last"][pk],
                      "previous_month": {"month": state["month"], "state": state["state"],
                                         "blocker": filings["blockers"].get((pk, state["month"]), "") if state["state"] == "blocked" else ""}}
    return result


def firm_uses(business):
    counts = uncached(Invoice).filter(business=business).aggregate(
        sales=Count("pk", filter=Q(type_of_invoice=INVOICE_TYPE_OUTWARD) & ~Q(status=BILL_CANCELLED)),
        cancelled=Count("pk", filter=Q(type_of_invoice=INVOICE_TYPE_OUTWARD, status=BILL_CANCELLED)),
        purchases=Count("pk", filter=Q(type_of_invoice=INVOICE_TYPE_INWARD)))
    retained = {}
    for key, name in (("filing_records", "FilingRecord"), ("filing_months", "FilingMonth"), ("opening_credits", "OpeningCredit")):
        model = optional_filing_model(name)
        retained[key] = uncached(model).filter(business_id=business.pk).count() if model is not None else 0
    downloads = optional_filing_model("ReturnDownload")
    if downloads is not None:
        retained["filing_records"] += uncached(downloads).filter(business_id=business.pk).count()
    retained["opening_credits"] += uncached(ITCReclaimLedger).filter(business_id=business.pk).count()
    retained["filed_periods"] = uncached(FiledPeriod).filter(business_id=business.pk).count()
    return {**counts, **retained, "bin": BinnedInvoice.objects.live().filter(business=business).count(),
            "drafts": SaleDraft.objects.filter(business=business).exclude(pk__in=SavedDraft.objects.values("pk")).count(),
            "captures": InwardCapture.objects.filter(business=business).count()}


def assert_firm_unused(business, uses=None, history_only=False):
    """One deletion guard for v3, audit and legacy v2; all retained GST history wins."""
    from billing.refusals import Refusal
    uses = firm_uses(business) if uses is None else uses
    if any(uses[key] for key in ("filing_records", "filing_months", "filed_periods", "opening_credits")):
        raise Refusal(f"{business.name} has filing records or opening credit, so it can't be deleted. "
                      "Its GST history keeps its firm.", "in_use", uses=uses)
    if not history_only and any(uses.values()):
        raise Refusal(f"{business.name} has {uses['sales'] + uses['cancelled']} sales bills and {uses['purchases']} purchase bills, "
                      "so it can't be deleted. Bills keep their firm.", "in_use", uses=uses)
    return uses


def firm_detail(business, fy=None):
    today = timezone.localdate()
    start, end = fy_range(fy_of(today) if fy is None else fy)
    cursor, month_labels = start, []
    while cursor <= min(today, end):
        month_labels.append(cursor.strftime("%Y-%m"))
        cursor = date(cursor.year + cursor.month // 12, cursor.month % 12 + 1, 1)
    previous = date(today.year - (today.month == 1), 12 if today.month == 1 else today.month - 1, 1).strftime("%Y-%m")
    filings = read_filings([business.pk], [*month_labels, previous])
    months = [filings["months"][business.pk, label] for label in month_labels]
    recent = Invoice.objects.sales().filter(business=business).select_related("customer").only(
        *REF_FIELDS, "payment_mode", "total_amount").order_by("-invoice_date", "-pk")[:6]
    data = {field: getattr(business, field) or "" for field in DETAIL_FIELDS if field not in ("signature_image", "updated_at", "paper_full_number_from")}
    return {**data, **firm_row(business), **live_print_fields(business), "gstin_valid": validate(business.gst_number)[0],
            "has_bank": bool(business.bank_account_number), "numbers": firm_numbers(business),
            "figures": firm_figures([business.pk], fy, filings)[business.pk], "months": months, "uses": firm_uses(business),
            "recent": [{**bill_ref(b), "payment_mode": b.payment_mode, "total_amount": money(b.total_amount)} for b in recent],
            "plain_after_full_date": Invoice.objects.sales().filter(business=business, invoice_date__gte=business.paper_full_number_from,
                invoice_number__regex=r"^[0-9]+$").count() if business.paper_full_number_from else 0,
            "updated_at": stamp(business.updated_at)}


# Writes are kept beside the read shapes so both API and Audit log share the rules.
IDENTITY_FIELDS = {"name", "gst_number", "state_name", "pan_number", "address", "mobile_number", "email"}
TEXT_LIMITS = {"name": 255, "short_name": 20, "gst_number": 15, "address": 255, "city": 100, "pin_code": 6,
               "mobile_number": 255, "email": 255, "bank_name": 255, "bank_account_number": 18, "bank_ifsc_code": 11,
               "bank_branch_name": 255, "invoice_prefix": 4, "jurisdiction": 100, "declaration": 500}
REQUIRED_WORDS = {"name": "Enter the firm's legal name, as on its GST certificate.",
                  "gst_number": "Enter the firm's GSTIN. It prints at the top of every bill.",
                  "address": "Enter the address printed on bills.", "mobile_number": "Enter a phone number for bills."}


def validate_firm(data, business=None):
    import re

    from django.core.exceptions import ValidationError as DjangoValidationError
    from django.core.validators import validate_email
    from rest_framework.exceptions import ValidationError

    from billing.api.body import UNSTORABLE
    from billing.gstin import derive

    if not isinstance(data, dict):
        raise ValidationError({key: [words] for key, words in REQUIRED_WORDS.items()})
    result, errors = {}, {}
    for key, limit in TEXT_LIMITS.items():
        if key not in data and business is not None:
            continue
        raw = data.get(key, "")
        # An older odd value is never refused when sent back unchanged (Ruling 1C-18).
        if business is not None and raw == getattr(business, key):
            result[key] = raw
            continue
        if not isinstance(raw, str) or UNSTORABLE.search(raw):
            errors[key] = [REQUIRED_WORDS.get(key, f"Enter the {key.replace('_', ' ')} as text.")]
            continue
        value = raw.strip()
        if key in ("gst_number", "bank_ifsc_code"):
            value = value.upper()
        if key == "mobile_number":
            value = re.sub(r"\s+", "", value).removeprefix("+")
            if value.startswith("91") and len(value) == 12:
                value = value[2:]
            elif value.startswith("0") and len(value) == 11:
                value = value[1:]
        problem = ""
        if not value and key in REQUIRED_WORDS:
            problem = REQUIRED_WORDS[key]
        elif key == "gst_number":
            problem = validate(value)[1]
        elif key == "pin_code" and value and not re.fullmatch(r"[0-9]{6}", value):
            problem = f"A PIN code has 6 digits; this has {sum(c in '0123456789' for c in value)}."
        elif key == "mobile_number" and not re.fullmatch(r"[0-9]{10}", value):
            problem = f"A mobile number has 10 digits; this has {sum(c in '0123456789' for c in value)}."
        elif key == "bank_account_number" and value and not re.fullmatch(r"[0-9]{9,18}", value):
            problem = f"Account numbers have 9 to 18 digits; this has {sum(c in '0123456789' for c in value)}."
        elif key == "bank_ifsc_code" and value and not re.fullmatch(r"[A-Z]{4}0[A-Z0-9]{6}", value):
            problem = "An IFSC has 11 characters: 4 letters, a zero, then 6 letters or digits (like SBIN0UDR014)."
        elif key == "invoice_prefix" and value and not re.fullmatch(r"[A-Z]{1,4}", value):
            problem = "Use 1 to 4 capital letters, like KGH. A GST bill number can have at most 16 characters."
        elif key == "email" and value:
            try:
                validate_email(value)
            except DjangoValidationError:
                problem = "That email looks incomplete. It should look like accounts@example.in."
        if not problem and len(value) > limit:
            label = "short name" if key == "short_name" else key.replace("_", " ")
            problem = f"Keep the {label} to {limit} characters."
        if problem:
            errors[key] = [problem]
        else:
            result[key] = value
    if "paper_full_number_from" in data:
        value = data["paper_full_number_from"]
        try:
            day = date.fromisoformat(value) if isinstance(value, str) and len(value) == 10 else None
            if value is not None and day is None:
                raise ValueError
            if day is not None and not 2000 <= day.year <= 2099:
                errors["paper_full_number_from"] = ["Pick a date from 2000 to 2099."]
            else:
                result["paper_full_number_from"] = day
        except ValueError:
            errors["paper_full_number_from"] = ["Type the date like 2027-04-01."]
    if "signature_on_bills" in data:
        if type(data["signature_on_bills"]) is not bool:
            errors["signature_on_bills"] = ["Choose whether bills show the signature."]
        else:
            result["signature_on_bills"] = data["signature_on_bills"]
    if errors:
        raise ValidationError(errors)
    check_firm_unique(result, business)
    if "gst_number" in result and (business is None or result["gst_number"] != business.gst_number):
        derived = derive(result["gst_number"])
        result.update(state_name=derived["state_name"], pan_number=derived["pan"])
    return result


def check_firm_unique(values, business=None):
    """Identity/name collisions only; audit restores keep legacy field formats unchanged."""
    from rest_framework.exceptions import ValidationError

    errors = {}
    def effective(key):
        return values.get(key, getattr(business, key, "")) or ""
    name, short = effective("name"), effective("short_name")
    short = short or (name.split()[0].title() if name.split() else "")
    for other in uncached(Business).exclude(pk=getattr(business, "pk", None)).only("name", "short_name", "gst_number", "invoice_prefix"):
        for key, value, theirs, words in (
            ("name", name, other.name, f"There's already a firm called {other.name}. Firm names have to be different."),
            ("short_name", short, short_name(other), f"{other.name} already goes by {short_name(other)}. Pick another short name."),
            ("gst_number", effective("gst_number"), other.gst_number, f"{other.name} has this GSTIN. Each firm has its own registration."),
            ("invoice_prefix", effective("invoice_prefix"), other.invoice_prefix,
             f"{other.name} already uses {other.invoice_prefix}. Each firm needs its own prefix, or bill numbers would clash."),
        ):
            changed = business is None or (key in values and values[key] != getattr(business, key))
            if key == "short_name":
                changed = business is None or short.casefold() != short_name(business).casefold()
            if changed and value and value.casefold() == (theirs or "").casefold():
                errors[key] = [words]
    if errors:
        raise ValidationError(errors)


def freeze_older_bills(business, changed_fields):
    """Freeze pre-snapshot sales, including restorable bin rows, while holding the firm's lock."""
    from billing.cache import invalidate
    from billing.services.sales import firm_snapshot
    if not IDENTITY_FIELDS.intersection(changed_fields):
        return 0
    snapshot = firm_snapshot(business)
    total = Invoice.objects.sales().filter(business=business, firm_snapshot__isnull=True).update(firm_snapshot=snapshot)
    if total:
        invalidate(Invoice)
    binned = list(uncached(BinnedInvoice).live().select_for_update().filter(
        Q(data__invoice__firm_snapshot__isnull=True) | Q(data__invoice__firm_snapshot=None),
        business=business, type_of_invoice=INVOICE_TYPE_OUTWARD,
    ).only("data").order_by("pk"))
    for row in binned:
        row.data = {**row.data, "invoice": {**row.data["invoice"], "firm_snapshot": snapshot}}
    if binned:
        BinnedInvoice.objects.bulk_update(binned, ["data"], batch_size=100)
        invalidate(BinnedInvoice)
    return total + len(binned)


def save_firm(data, user, business=None):
    from django.db import transaction

    from billing.api.mixins import snapshot_of
    from billing.models import AuditLog, Customer, ShopSetting
    with transaction.atomic():
        if business is None:
            # Also serializes creation into an empty shop, where no firm row exists to lock.
            ShopSetting.objects.select_for_update().get_or_create(pk=1)
        list(uncached(Business).select_for_update(no_key=True).order_by("pk").values_list("pk", flat=True))
        if business is not None:
            business = uncached(Business).get(pk=business.pk)
        validated = validate_firm(data, business)
        if business is None:
            first = not uncached(Business).exists()
            business = Business.objects.create(**validated)
            if first and not uncached(Customer).filter(Q(customer_type="walkin") | Q(name__iexact="Walk-in Customer")).exists():
                Customer.objects.create(name="Walk-in Customer", customer_type="walkin")
            AuditLog.objects.create(action="created", entity="business", entity_id=business.pk, entity_name=business.name,
                user=user, snapshot=snapshot_of(business), details=f"GSTIN {business.gst_number} · bills "
                f"{business.invoice_prefix + '/' + fy_label(fy_of(timezone.localdate())) + '/' if business.invoice_prefix else ''}1 onwards")
            return business, {}, 0
        before = snapshot_of(business)
        changed = {key: value for key, value in validated.items() if getattr(business, key) != value}
        if not changed:
            return business, {}, 0
        frozen = freeze_older_bills(business, changed)
        for key, value in changed.items():
            setattr(business, key, value)
        business.save(update_fields=[*changed, "updated_at"])
        after = snapshot_of(business)
        changes = {key: {"old": before[key], "new": after[key]} for key in changed}
        from billing.services.audit import change_rows
        shown = change_rows(Business, changes)
        detailed = {"gst_number", "invoice_prefix", "bank_account_number", "bank_ifsc_code"}
        details = " · ".join(f"{row['field']}: {row['from']} → {row['to']}" if row["key"] in detailed else row["field"] for row in shown)
        AuditLog.objects.create(action="updated", entity="business", entity_id=business.pk, entity_name=business.name,
                                user=user, changes=changes, snapshot=before, details=details)
        return business, changes, frozen


def delete_firm(business, user):
    from django.db import transaction

    from billing.api.mixins import drop_settled_party_rows, snapshot_of
    from billing.models import AuditLog, ShopSetting
    with transaction.atomic():
        # Deleting the default firm clears its ShopSetting FK: use the create/audit lock order.
        ShopSetting.objects.select_for_update().get_or_create(pk=1)
        business = uncached(Business).select_for_update().get(pk=business.pk)
        assert_firm_unused(business)
        entry = AuditLog.objects.create(action="deleted", entity="business", entity_id=business.pk, entity_name=business.name,
                                        user=user, snapshot=snapshot_of(business))
        drop_settled_party_rows(business)
        business.delete()
        return entry


def save_signature(business, image, user, remove=False):
    from decimal import Decimal

    from django.db import transaction
    from PIL import Image, UnidentifiedImageError
    from rest_framework.exceptions import ValidationError

    from billing.api.mixins import snapshot_of
    from billing.models import AuditLog
    if not remove:
        if image is None or not hasattr(image, "size"):
            raise ValidationError({"image": ["Choose the picture of the signature."]})
        if image.size > 1024 * 1024:
            size = (Decimal(image.size) / (1024 * 1024)).quantize(Decimal("0.1"))
            raise ValidationError({"image": [f"That picture is {size} MB. Pick one under 1 MB; a phone photo cropped to the signature is fine."]})
        try:
            with Image.open(image) as picture:
                if picture.format not in {"PNG", "JPEG", "WEBP"}:
                    raise ValueError
                picture.verify()
            image.seek(0)
        except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError):
            raise ValidationError({"image": [f"{image.name} isn't a picture. Pick a PNG or JPG of the signature."]}) from None
    with transaction.atomic():
        business = uncached(Business).select_for_update().get(pk=business.pk)
        before = snapshot_of(business)
        # Old files stay for Audit log restore/revert; only the model's path changes.
        business.signature_image = "" if remove else image
        business.signature_on_bills = not remove
        business.save(update_fields=["signature_image", "signature_on_bills", "updated_at"])
        after = snapshot_of(business)
        changes = {key: {"old": before[key], "new": after[key]} for key in ("signature_image", "signature_on_bills") if before[key] != after[key]}
        AuditLog.objects.create(action="updated", entity="business", entity_id=business.pk, entity_name=business.name,
                                user=user, changes=changes, snapshot=before,
                                details="Signature picture: A picture → " + ("Removed" if remove else "A new picture"))
        return business
