"""Audit words and field-level actions, shared by the log and record saves."""
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from django.db.models import Count, Exists, F, OuterRef, Subquery
from django.db.models.functions import Coalesce
from rest_framework.exceptions import NotFound, ValidationError

from billing.api.mixins import drop_settled_party_rows, links_of, mark_undone, snapshot_of
from billing.cache import uncached
from billing.models import AuditLog, BinnedInvoice, Business, Customer, Invoice, InwardCapture, LineItem, Product
from billing.refusals import Refusal
from billing.text import day_text, inr, person, stamp

MODEL_MAP = {"invoice": Invoice, "customer": Customer, "product": Product, "business": Business}
PATHS = {"invoice": "sales", "customer": "customers", "product": "products", "business": "firms"}
LABELS = {"mobile_number": "Phone", "gst_number": "GSTIN", "pan_number": "PAN", "hsn_code": "HSN",
          "gst_tax_rate": "GST rate", "usual_rate": "Usual rate", "default_unit": "Unit",
          "purchase_only": "Bought only", "bank_account_number": "Account number", "bank_ifsc_code": "IFSC",
          "signature_image": "Signature picture", "signature_on_bills": "Signature on bills", "short_name": "Short name",
          "default_business": "Default firm", "customer_type": "Type"}
GROUPS = {"created": "add", "imported": "add", "updated": "change", "reverted": "change", "renumbered": "change",
          "moved": "change", "password": "change", "deleted": "delete", "cancelled": "delete", "stopped": "delete",
          "restored": "restore", "allowed": "restore", "merged": "merge", "sent": "send", "exported": "send",
          "printed": "send", "signedout": "change", "locked": "file", "unlocked": "file", "filed": "file",
          "credit_set": "change", "checked": "change", "captured": "add", "discarded": "delete",
          "removed": "delete", "downloaded": "send", "set": "change"}
# Part 4E owns ongoing producer additions and combined fixtures (Ruling X-27).
KIND_ENTITIES = {"customer": "records", "product": "records", "business": "records",
                 "user": "admin", "settings": "admin", "session": "admin", "rates": "admin",
                 "backup": "backup", "report": "backup", "period": "filing", "filing": "filing",
                 "credit": "filing", "gst_file": "filing", "capture": "purchases", "purchase": "purchases"}
VERBS = {"created": "Added", "imported": "Imported", "updated": "Edited", "reverted": "Reverted",
         "deleted": "Deleted", "restored": "Restored", "merged": "Merged", "cancelled": "Cancelled",
         "renumbered": "Renumbered", "moved": "Moved", "sent": "Sent", "printed": "Printed", "exported": "Exported"}
EVENT_WORDS = {
    ("customer", "merged"): ("Merged customers into", ""),
    ("capture", "captured"): ("Captured supplier bill", ""),
    ("capture", "discarded"): ("Removed photo", ""),
    ("capture", "restored"): ("Restored photo", ""),
    ("filing", "filed"): ("", "marked filed"),
    ("filing", "updated"): ("Edited filing record", ""),
    ("filing", "removed"): ("Removed filing record", ""),
    ("period", "locked"): ("Locked", ""),
    ("period", "unlocked"): ("Unlocked", ""),
    ("credit", "updated"): ("Changed opening credit for", ""),
    ("gst_file", "downloaded"): ("Downloaded", ""),
    ("gst_file", "sent"): ("Sent", ""),
    ("report", "exported"): ("Exported", ""),
    ("rates", "set"): ("Set", ""),
    ("settings", "updated"): ("Changed shop settings", ""),
    ("user", "created"): ("Added", ""),
    ("user", "updated"): ("Edited", ""),
    ("user", "password"): ("Changed password for", ""),
    ("user", "stopped"): ("Stopped", "signing in"),
    ("user", "allowed"): ("Allowed", "to sign in"),
    ("session", "signedout"): ("Signed out", ""),
    ("backup", "exported"): ("Downloaded", ""),
    ("backup", "downloaded"): ("Downloaded", ""),
    ("backup", "restored"): ("Restored from", ""),
    ("invoice", "checked"): ("Checked purchase", ""),
    ("invoice", "credit_set"): ("Changed the credit month of", ""),
}
EVENT_LINKS = {"user": "/users", "session": "/profile", "settings": "/settings", "backup": "/backup",
               "period": "/gst", "filing": "/gst", "credit": "/gst?tab=credit", "gst_file": "/gst",
               "report": "/reports", "rates": "/"}


def field_label(model, key):
    if key in LABELS:
        return LABELS[key]
    try:
        return str(model._meta.get_field(key).verbose_name).replace("_", " ").capitalize()
    except Exception:
        return key.replace("_", " ").capitalize()


def value_words(key, value):
    if key == "kind" and value in (None, "", "None"):
        return "Worked out from the name"
    if value is None or value == "" or value == "None":
        return "None"
    if key == "kind":
        return dict(Product._meta.get_field("kind").choices).get(value, str(value))
    if key in {"usual_rate", "total_amount"}:
        try:
            return inr(Decimal(str(value)))
        except (InvalidOperation, ValueError):
            return str(value)
    if key == "gst_tax_rate":
        from billing.text import percent
        try:
            return percent(Decimal(str(value))) + "%"
        except (InvalidOperation, ValueError):
            return str(value)
    if key in {"signature_on_bills", "show_bank"}:
        return "Printed" if value is True or str(value) == "True" else "Not printed"
    if key == "signature_image":
        return "A picture" if value else "Removed"
    if key == "purchase_only":
        return "Bought only" if value is True or str(value) == "True" else "On sales bills"
    return str(value)


def change_rows(model, changes):
    return [{"key": key, "field": field_label(model, key), "from": value_words(key, value.get("old")),
             "to": ("A new picture" if key == "signature_image" and value.get("old") and value.get("new") else value_words(key, value.get("new")))}
            for key, value in (changes or {}).items() if isinstance(value, dict)]


def _resolve_fk(field, raw_value):
    if raw_value in (None, "None", ""):
        return None
    try:
        return int(raw_value)
    except (TypeError, ValueError):
        related = field.related_model
        for candidate in ("name", "invoice_number", "username"):
            if hasattr(related, candidate):
                found = uncached(related).filter(**{candidate: raw_value}).values_list("pk", flat=True).first()
                if found is not None:
                    return found
        return None


def read_entries():
    used = AuditLog.objects.filter(pk=OuterRef("pk"), snapshot__has_key="_undo")
    return AuditLog.objects.select_related("user").only(
        "id", "timestamp", "user_id", "action", "entity", "entity_id", "entity_name", "details", "changes",
        "user__id", "user__username", "user__first_name", "user__last_name",
    ).annotate(used=Exists(used)).order_by("-timestamp", "-pk")


def record_for(entry, lock=False):
    model = MODEL_MAP.get(entry.entity)
    if model is None:
        return None
    fields = {"id"} | set((entry.changes or {}).keys())
    if entry.entity == "invoice":
        fields |= {"type_of_invoice", "business_id", "invoice_date", "status", "total_amount", "invoice_number", "itc_month"}
    else:
        fields.add("name")
    real = {field.name for field in model._meta.concrete_fields} | {field.attname for field in model._meta.concrete_fields}
    rows = uncached(model).only(*(fields & real))
    if lock:
        rows = rows.select_for_update()
    return rows.filter(pk=entry.entity_id).first()


def binned_for(entry, full=False):
    rows = BinnedInvoice.objects.live().filter(audit_log_id=entry.pk)
    if not full:
        rows = rows.only("id", "type_of_invoice", "business_id", "invoice_date", "total_amount").annotate(
            restore_lines=F("data__lines"), restored_business_name=F("data__business_name"))
    return rows.first()


def kind_for(entry, obj=None, binned=None):
    if entry.entity == "invoice":
        inward = getattr(obj, "type_of_invoice", None) == "inward" or getattr(binned, "type_of_invoice", None) == "inward"
        return "purchases" if (inward or entry.action in {"checked", "credit_set"}
                               or getattr(entry, "is_purchase", False) or getattr(entry, "was_purchase", False)
                               or entry.entity_name.startswith("Purchase ")) else "sales"
    return KIND_ENTITIES.get(entry.entity, "records")


def event_words(entry, kind, target_present):
    """One pure mapper for Audit, CSV and Dashboard; presence is read by the caller."""
    entity, action = entry.entity, entry.action
    noun = {"customer": "customer", "product": "product", "business": "firm", "invoice": "purchase" if kind == "purchases" else "bill"}.get(entity, "record")
    text = f"{VERBS[action]} {noun}" if action in VERBS else action.capitalize()
    target, after = entry.entity_name, ""
    if entity == "invoice" and action == "created":
        text = f"Made {noun}"
    text, after = EVENT_WORDS.get((entity, action), (text, after))
    if entity == "user" and action == "updated" and "role" in (entry.changes or {}):
        text = "Changed the role of"
    if entity == "settings" and action == "updated":
        target = ""
    if entity == "backup" and action in {"exported", "downloaded"} and target == "Full backup":
        target = "the full backup"
    link = EVENT_LINKS.get(entity)
    if entity in PATHS:
        route = "purchases" if entity == "invoice" and kind == "purchases" else PATHS[entity]
        link = f"/{route}/{entry.entity_id}" if target_present else None
    if entity == "capture":
        link = f"/purchases/inbox/{entry.entity_id}" if target_present else None
    return {"text": text, "target": target, "after": after}, link


def capture_present(entry):
    rows = uncached(InwardCapture).filter(pk=entry.entity_id)
    if any(field.name == "discarded_at" for field in InwardCapture._meta.concrete_fields):
        rows = rows.filter(discarded_at__isnull=True)
    elif entry.action == "discarded":
        return False
    return rows.exists()


def changed_fields(entry, obj):
    if obj is None:
        return []
    fields = {f.name: f for f in obj._meta.concrete_fields}
    bad = []
    for key, change in (entry.changes or {}).items():
        field = fields.get(key)
        if field is None or not isinstance(change, dict):
            bad.append(field_label(type(obj), key))
            continue
        current = getattr(obj, field.attname)
        try:
            expected = _resolve_fk(field, change.get("new")) if field.many_to_one else field.to_python(change.get("new"))
        except Exception:
            expected = change.get("new")
        if current != expected:
            bad.append(field_label(type(obj), key))
    return bad


def uses_for(obj):
    if isinstance(obj, Product):
        from billing.services.catalog import product_uses
        return product_uses(obj)
    if isinstance(obj, Business):
        from billing.services.firms import firm_uses
        return firm_uses(obj)
    if isinstance(obj, Customer):
        from django.db.models import Count, Q
        counts = uncached(Invoice).filter(customer_id=obj.pk).aggregate(
            sales=Count("pk", filter=Q(type_of_invoice="outward", status="active")),
            cancelled=Count("pk", filter=Q(type_of_invoice="outward", status="cancelled")),
            purchases=Count("pk", filter=Q(type_of_invoice="inward")),
        )
        counts["bin"] = BinnedInvoice.objects.live().filter(customer_id=obj.pk).count()
        counts["lines"] = uncached(LineItem).filter(customer_id=obj.pk).exclude(invoice__customer_id=obj.pk).count()
        return counts
    return {}


def use_counts(entity):
    """Correlated grouped counts stay in the page's one record query per model."""
    from billing.models import FiledPeriod, ITCReclaimLedger, SaleDraft, SavedDraft
    from billing.services.firms import optional_filing_model

    key = "business_id" if entity == "business" else "customer_id"

    def count(rows):
        grouped = rows.filter(**{key: OuterRef("pk")}).order_by().values(key).annotate(n=Count("pk")).values("n")
        return Coalesce(Subquery(grouped), 0)

    bills = uncached(Invoice)
    counts = {
        "sales": count(bills.filter(type_of_invoice="outward", status="active")),
        "cancelled": count(bills.filter(type_of_invoice="outward", status="cancelled")),
        "purchases": count(bills.filter(type_of_invoice="inward")),
        "bin": count(BinnedInvoice.objects.live()),
    }
    if entity == "customer":
        counts["lines"] = count(uncached(LineItem).exclude(invoice__customer_id=OuterRef("pk")))
    else:
        counts.update(drafts=count(uncached(SaleDraft).exclude(pk__in=SavedDraft.objects.values("pk"))),
                      captures=count(uncached(InwardCapture)), filed_periods=count(uncached(FiledPeriod)),
                      opening_credits=count(uncached(ITCReclaimLedger)))
        from django.db.models import Value
        for name, model_name in (("filing_records", "FilingRecord"), ("filing_months", "FilingMonth"),
                                 ("opening_credits", "OpeningCredit"), ("filing_records", "ReturnDownload")):
            model = optional_filing_model(model_name)
            counts[name] = counts.get(name, Value(0)) + (count(uncached(model)) if model else Value(0))
    return {"use_" + name: expression for name, expression in counts.items()}


class AuditPage:
    """Request-local records, counts and month checks; never cache write decisions."""
    def __init__(self, entries):
        self.records, self.bins, self.uses, self.statuses, self.refusals = {}, {}, {}, {}, {}
        for entity, model in MODEL_MAP.items():
            selected = [entry for entry in entries if entry.entity == entity]
            if not selected:
                continue
            fields = {"id", "name"} if entity != "invoice" else {
                "id", "type_of_invoice", "business_id", "invoice_date", "status", "total_amount", "invoice_number", "itc_month"}
            for entry in selected:
                fields.update((entry.changes or {}).keys())
            real = {f.name for f in model._meta.concrete_fields} | {f.attname for f in model._meta.concrete_fields}
            rows = uncached(model).filter(pk__in={e.entity_id for e in selected}).only(*(fields & real))
            counts = use_counts(entity) if entity in {"customer", "business"} and any(e.action in {"created", "imported"} for e in selected) else {}
            for obj in rows.annotate(**counts):
                self.records[entity, obj.pk] = obj
                if counts:
                    self.uses[entity, obj.pk] = {key.removeprefix("use_"): getattr(obj, key) for key in counts}
        products = [obj for (entity, pk), obj in self.records.items() if entity == "product" and
                    any(e.entity == entity and e.entity_id == pk and e.action in {"created", "imported"} for e in entries)]
        if products:
            from billing.services.catalog import product_uses_many
            self.uses.update({("product", pk): counts for pk, counts in product_uses_many(products).items()})
        missing = [e.pk for e in entries if e.entity == "invoice" and (e.entity, e.entity_id) not in self.records]
        if missing:
            rows = BinnedInvoice.objects.live().filter(audit_log_id__in=missing).only(
                "id", "audit_log_id", "type_of_invoice", "business_id", "invoice_date", "total_amount").annotate(
                restore_lines=F("data__lines"), restored_business_name=F("data__business_name"),
                restore_credit_month=F("data__invoice__itc_month"))
            self.bins = {row.audit_log_id: row for row in rows}
        captures = [e.entity_id for e in entries if e.entity == "capture"]
        rows = uncached(InwardCapture).filter(pk__in=captures)
        self.capture_has_discarded = any(f.name == "discarded_at" for f in InwardCapture._meta.concrete_fields)
        if self.capture_has_discarded:
            rows = rows.filter(discarded_at__isnull=True)
        self.captures = set(rows.values_list("pk", flat=True)) if captures else set()
        from billing import period_lock
        business_ids = {obj.business_id for (entity, _pk), obj in self.records.items() if entity == "invoice"}
        business_ids.update(row.business_id for row in self.bins.values())
        self.legacy_periods = None
        self.firm_names = {pk: obj.name for (entity, pk), obj in self.records.items() if entity == "business"}
        if getattr(period_lock, "month_status", None):
            missing_firms = business_ids - self.firm_names.keys()
            if missing_firms:
                self.firm_names.update(uncached(Business).filter(pk__in=missing_firms).values_list("pk", "name"))
        else:
            from billing.models import FiledPeriod
            self.legacy_periods = {(pk, year, month): name for pk, year, month, name in
                                   uncached(FiledPeriod).filter(business_id__in=business_ids)
                                   .values_list("business_id", "year", "month", "business__name")}

    def status(self, business_id, day):
        from billing import period_lock
        key = (business_id, day.year, day.month)
        if key not in self.statuses:
            reader = getattr(period_lock, "month_status", None)
            self.statuses[key] = reader(*key, include_checks=False) if reader else None
        return self.statuses[key]

    def refusal(self, business_id, day, action, purchase=False):
        from billing.period_lock import assert_sales_open
        if day is None:
            return ""
        key = (business_id, day.year, day.month, action, purchase)
        if key not in self.refusals:
            self.refusals[key] = ""
            if self.legacy_periods is not None and not purchase:
                name = self.legacy_periods.get((business_id, day.year, day.month))
                if name is not None:
                    from billing.period_lock import CLOSED_WORDS
                    month = day.strftime("%B %Y")
                    self.refusals[key] = (
                        f"{month} is filed and locked for {name}, so {CLOSED_WORDS[action]}. "
                        f"Have the owner unlock {month} in GST returns first.")
                return self.refusals[key]
            state = self.status(business_id, day)
            if state is not None and not purchase:
                if getattr(state, "sales_closed", False):
                    from billing.period_lock import CLOSED_WORDS
                    month, name = day.strftime("%B %Y"), self.firm_names.get(business_id, "")
                    # The shared guard's published words, using the state already read above.
                    if state.stage == "gstr1":
                        self.refusals[key] = (
                            f"{month}'s GSTR-1 is filed for {name}, so {CLOSED_WORDS[action]}. "
                            f"Have the owner unlock {month}'s sales bills in GST returns first.")
                    else:
                        self.refusals[key] = (
                            f"{month} is filed and locked for {name}, so {CLOSED_WORDS[action]}. "
                            f"Have the owner unlock {month} in GST returns first.")
                return self.refusals[key]
            if state is None or getattr(state, "credit_closed" if purchase else "sales_closed", True):
                try:
                    if purchase:
                        from billing.period_lock import assert_purchase_open
                        assert_purchase_open(business_id, day, action)
                    else:
                        assert_sales_open(business_id, day, action)
                except Refusal as refused:
                    self.refusals[key] = refused.detail["detail"]
        return self.refusals[key]


def entry_rows(entries):
    page = AuditPage(entries)
    return [entry_row(entry, page=page) for entry in entries]


def invoice_guard(kind, obj, binned, purchase):
    """The firm, guarded day and action one bill door checks; purchases use their credit month."""
    record = binned if kind == "restore" else obj
    day = record.invoice_date
    if purchase:
        from datetime import date
        from types import SimpleNamespace

        from billing.credit import credit_month_of
        raw = (binned.restore_credit_month if hasattr(binned, "restore_credit_month") else binned.data.get("invoice", {}).get("itc_month")) if kind == "restore" else getattr(obj, "itc_month", None)
        month = date.fromisoformat(raw) if isinstance(raw, str) else raw
        day = credit_month_of(SimpleNamespace(invoice_date=record.invoice_date, itc_month=month))
    return record, day, "restore" if kind == "restore" else "delete"


def assert_invoice_open(kind, obj, binned, purchase):
    # The same guard the list offers is enforced by the action, whatever the door's own service checks.
    from billing import period_lock
    record, day, action = invoice_guard(kind, obj, binned, purchase)
    (period_lock.assert_purchase_open if purchase else period_lock.assert_sales_open)(record.business_id, day, action)


def available(entry, obj=None, binned=None, page=None):
    if entry.used:
        return None
    kind = None
    if entry.action in {"created", "imported"} and obj is not None:
        kind = "undo"
    elif entry.action in {"updated", "reverted"} and entry.entity in {"customer", "product", "business"} and obj is not None and entry.changes:
        kind = "revert"
    elif entry.action == "deleted" and (binned is not None or (entry.entity in {"customer", "product", "business"} and obj is None)):
        kind = "restore"
    if kind is None:
        return None
    purchase = entry.entity == "invoice" and kind_for(entry, obj, binned) == "purchases"
    if purchase:
        try:
            from billing.credit import credit_month_of  # noqa: F401
            from billing.period_lock import assert_purchase_open  # noqa: F401
        except ImportError:
            # X-40: the real purchase actions activate only after predecessor 2A lands.
            return None
    disabled, effect = "", ""
    if kind == "revert":
        bad = changed_fields(entry, obj)
        if bad:
            disabled = f"{', '.join(bad)} changed again since. Revert the later change first."
    if kind == "undo" and entry.entity != "invoice":
        uses = page.uses.get((entry.entity, obj.pk), {}) if page else uses_for(obj)
        if isinstance(obj, Business):
            from billing.services.firms import assert_firm_unused
            try:
                assert_firm_unused(obj, uses)
            except Refusal as refused:
                disabled = refused.detail["detail"]
        elif any(uses.values()):
            disabled = f"{entry.entity_name} is in use, so it can’t be deleted."
    if entry.entity == "invoice":
        record, day, action = invoice_guard(kind, obj, binned, purchase)
        if page:
            disabled = page.refusal(record.business_id, day, action, purchase)
        else:
            try:
                assert_invoice_open(kind, obj, binned, purchase)
            except Refusal as refused:
                disabled = refused.detail["detail"]
        if kind == "restore" and purchase:
            effect = "Back in Purchases under its original bill number."
        elif kind == "restore":
            from types import SimpleNamespace

            from billing.services.bill_reads import sums
            from billing.services.bin import _fields
            lines = [SimpleNamespace(**_fields(LineItem, row)) for row in (binned.restore_lines if hasattr(binned, "restore_lines") else binned.data.get("lines", []))]
            tax = sums(lines)["tax"] if lines else Decimal("0")
            firm_name = binned.restored_business_name if hasattr(binned, "restored_business_name") else binned.data.get("business_name", "")
            effect = f"{firm_name}'s {binned.invoice_date.strftime('%B')} sales go up by {inr(binned.total_amount)} and its tax by {inr(tax)}."
            from billing import period_lock
            status_reader = getattr(period_lock, "month_status", None)
            state = page.status(binned.business_id, binned.invoice_date) if page else (
                status_reader(binned.business_id, binned.invoice_date.year, binned.invoice_date.month, include_checks=False) if status_reader else None)
            if state and state.unlocked:
                effect += f" {binned.invoice_date.strftime('%B %Y')} was filed before and is open for a correction, so this change needs an amendment in the next return."
    label = {"undo": "Undo…", "revert": "Revert…", "restore": "Restore…"}[kind]
    hint = {"undo": "Shows what is removed before anything changes", "revert": "Shows what goes back before anything changes", "restore": "Shows what comes back before anything changes"}[kind]
    return {"kind": kind, "label": label, "disabled": disabled, "hint": hint, "effect": effect}


def entry_row(entry, actions=True, page=None):
    obj = (page.records.get((entry.entity, entry.entity_id)) if page else record_for(entry)) if actions else None
    binned = (page.bins.get(entry.pk) if page else binned_for(entry)) if actions and entry.entity == "invoice" and obj is None else None
    kind = kind_for(entry, obj, binned)
    present = (entry.entity_id in page.captures and (page.capture_has_discarded or entry.action != "discarded") if page else capture_present(entry)) if actions and entry.entity == "capture" else obj is not None
    words, link = event_words(entry, kind, present)
    result = ("restored" if entry.action == "deleted" else "reverted" if entry.action in {"updated", "reverted"} else "undone") if entry.used else None
    return {"id": entry.pk, "at": stamp(entry.timestamp), "by": person(entry.user), "action": entry.action, "entity": entry.entity,
            "entity_id": entry.entity_id, "kind": kind, "group": GROUPS.get(entry.action, "change"),
            "words": words, "link": link, "note": "In the bin" if binned else "",
            "details": entry.details, "changes": change_rows(MODEL_MAP.get(entry.entity), entry.changes), "result": result,
            "can": available(entry, obj, binned, page) if actions else None}


def name_available(model, name, pk):
    rows = uncached(model).filter(name__iexact=name).exclude(pk=pk).only(*(["id", "name", "short_name"] if model is Business else ["id", "name"]))
    holder = rows.first()
    if holder is not None:
        what = {Product: "product", Customer: "customer", Business: "firm"}[model]
        raise Refusal(f"A {what} called {holder.name} was added since. Rename one of them first.", "name_taken", holder=({"id": holder.pk, "name": holder.name, "short": holder.short_name or holder.name.split()[0].title()} if model is Business else {"id": holder.pk, "name": holder.name}))


def firm_unique_or_refuse(values, business=None):
    from billing.services.firms import check_firm_unique, firm_ref, short_name
    try:
        check_firm_unique(values, business)
    except ValidationError as error:
        field_name, messages = next(iter(error.detail.items()))
        def effective(key):
            return values.get(key, getattr(business, key, ""))
        wanted = effective(field_name)
        if field_name == "short_name":
            wanted = wanted or (effective("name").split() or [""])[0].title()
        others = uncached(Business).exclude(pk=getattr(business, "pk", None)).only("id", "name", "short_name", "gst_number", "invoice_prefix")
        holder = next((other for other in others
                       if str(wanted or "").casefold() == str(short_name(other) if field_name == "short_name" else getattr(other, field_name, "")).casefold()), None)
        raise Refusal(str(messages[0]), "name_taken", holder=firm_ref(holder) if holder else None) from None

def snapshot_values(model, snapshot):
    values = {}
    for field in model._meta.concrete_fields:
        if field.name not in snapshot or field.primary_key:
            continue
        raw = snapshot[field.name]
        if field.many_to_one:
            values[field.attname] = _resolve_fk(field, raw)
        else:
            values[field.name] = field.to_python(None if raw == "None" and field.null else raw)
    return values


def restore_kept(obj, snapshot):
    """What a plain insert loses: the first-added date (auto_now_add) and many-to-many links still on file."""
    from django.utils.dateparse import parse_datetime
    added = parse_datetime(str(snapshot.get("created_at") or ""))
    if added and any(field.name == "created_at" for field in obj._meta.concrete_fields):
        uncached(type(obj)).filter(pk=obj.pk).update(created_at=added)
        obj.created_at = added
    for name, ids in (snapshot.get("_links") or {}).items():
        field = obj._meta.get_field(name)
        getattr(obj, name).set(uncached(field.related_model).filter(pk__in=ids).values_list("pk", flat=True))


def act(entry_id, action, user):
    with transaction.atomic():
        entry = AuditLog.objects.select_for_update().filter(pk=entry_id).first()
        if entry is None:
            raise NotFound("This entry isn't on file.")
        marker = (entry.snapshot or {}).get("_undo")
        if marker:
            from django.contrib.auth import get_user_model
            by = get_user_model().objects.filter(pk=marker.get("by")).only("id", "username", "first_name", "last_name").first()
            at = marker.get("at", "")
            from django.utils.dateparse import parse_datetime
            when = parse_datetime(at)
            date_words = day_text(when.date()) if when else at[:10]
            raise Refusal(f"This was undone already, on {date_words} by {person(by)['name'] if by else 'someone no longer here'}.", "already_undone", by=person(by), at=at)
        entry.used = False
        if entry.entity == "product":
            from billing.services.catalog import catalog_names_lock
            catalog_names_lock()
        if entry.entity == "business":
            from billing.models import ShopSetting
            ShopSetting.objects.select_for_update().get_or_create(pk=1)
            list(uncached(Business).order_by("pk").select_for_update(no_key=True).values_list("pk", flat=True))
        obj = record_for(entry, lock=True)
        binned = binned_for(entry, full=True) if entry.entity == "invoice" else None
        offered = available(entry, obj, binned)
        if offered is None or offered["kind"] != action:
            raise ValidationError({"detail": "This entry can't be undone."})
        if entry.entity == "invoice":
            from billing.services.bin import bin_bill, restore_from_bin
            purchase = kind_for(entry, obj, binned) == "purchases"
            assert_invoice_open(offered["kind"], obj, binned, purchase)
            if action == "undo":
                if purchase:
                    from billing.services.purchase_bin import bin_purchase
                    binned = bin_purchase(obj, user, reason="Undone from the Audit log")
                else:
                    binned, new = bin_bill(obj, user, reason="Undone from the Audit log")
                new = AuditLog.objects.get(pk=binned.audit_log_id)
                mark_undone(entry, user, new)
            else:
                if purchase:
                    from billing.services.purchase_bin import restore_purchase
                    obj = restore_purchase(binned, user, via="audit_log")
                else:
                    obj = restore_from_bin(binned, user, via="audit_log")
                entry.refresh_from_db()
                new = AuditLog.objects.get(pk=entry.snapshot["_undo"]["log"])
        else:
            model = MODEL_MAP[entry.entity]
            if action == "undo":
                if isinstance(obj, Business):
                    from billing.services.firms import assert_firm_unused
                    assert_firm_unused(obj)
                uses = uses_for(obj)
                if any(uses.values()):
                    raise Refusal(f"{entry.entity_name} is in use, so it can't be deleted.", "in_use", uses=uses)
                # Load a full row only for this explicit write's restorable snapshot.
                obj = uncached(model).get(pk=obj.pk)
                snapshot = {**snapshot_of(obj), **links_of(obj)}
                drop_settled_party_rows(obj)
                obj.delete()
                new = AuditLog.objects.create(user=user, action="deleted", entity=entry.entity, entity_id=entry.entity_id,
                    entity_name=entry.entity_name, details="Undone from the Audit log", snapshot=snapshot)
            elif action == "revert":
                bad = changed_fields(entry, obj)
                if bad:
                    raise Refusal(f"{', '.join(bad)} changed again since. Revert the later change first.", "changed_since", fields=bad)
                old = {key: change["old"] for key, change in entry.changes.items()}
                if "name" in old:
                    name_available(model, old["name"], obj.pk)
                values = snapshot_values(model, old)
                if model is Business:
                    from billing.services.firms import freeze_older_bills
                    # The complete legal block is needed only for this explicit write.
                    obj = uncached(Business).get(pk=obj.pk)
                    firm_unique_or_refuse(values, obj)
                    freeze_older_bills(obj, set(values))
                for key, value in values.items():
                    setattr(obj, key, value)
                obj.save(update_fields=[*values, "updated_at"])
                changes = {key: {"old": value["new"], "new": value["old"]} for key, value in entry.changes.items()}
                new = AuditLog.objects.create(user=user, action="reverted", entity=entry.entity, entity_id=obj.pk,
                    entity_name=obj.name, changes=changes, details="Put back the earlier values")
            else:
                snapshot = entry.snapshot or {}
                if not snapshot or uncached(model).filter(pk=entry.entity_id).exists():
                    raise ValidationError({"detail": "This entry can't be undone."})
                name_available(model, snapshot.get("name", ""), entry.entity_id)
                if model is Business:
                    firm_unique_or_refuse(snapshot_values(model, snapshot))
                try:
                    with transaction.atomic():
                        obj = model(pk=entry.entity_id, **snapshot_values(model, snapshot))
                        obj.save(force_insert=True)
                        restore_kept(obj, snapshot)
                except IntegrityError:
                    raise Refusal(f"A record called {entry.entity_name} was added since. Rename one of them first.", "name_taken", holder={"id": entry.entity_id, "name": entry.entity_name}) from None
                new = AuditLog.objects.create(user=user, action="restored", entity=entry.entity, entity_id=obj.pk,
                    entity_name=obj.name, details="Restored from the Audit log", snapshot=snapshot_of(obj))
            mark_undone(entry, user, new)
    answer = {"entry": entry_row(read_entries().get(pk=entry.pk)), "new_entry": entry_row(read_entries().get(pk=new.pk))}
    if action in {"restore", "revert"}:
        route = "purchases" if entry.entity == "invoice" and obj.type_of_invoice == "inward" else PATHS[entry.entity]
        answer["link"] = f"/{route}/{obj.pk}"
    return answer
