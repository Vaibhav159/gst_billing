"""Audit words and field-level actions, shared by the log and record saves."""
from decimal import Decimal, InvalidOperation

from django.db.models import Exists, F, OuterRef

from billing.cache import uncached
from billing.models import AuditLog, BinnedInvoice, Business, Customer, Invoice, InwardCapture, LineItem, Product
from billing.refusals import Refusal
from billing.text import inr, person, stamp

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
    if value is None or value == "" or value == "None":
        return "None"
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
        fields |= {"type_of_invoice", "business_id", "invoice_date", "status", "total_amount", "invoice_number"}
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


def available(entry, obj=None, binned=None):
    if entry.used:
        return None
    kind = None
    if entry.action in {"created", "imported"} and obj is not None:
        kind = "undo"
    elif entry.action in {"updated", "reverted"} and entry.entity in {"customer", "product", "business"} and obj is not None and entry.changes:
        kind = "revert"
    elif entry.action == "deleted" and (binned is not None or (entry.entity in {"customer", "product", "business"} and obj is None)):
        kind = "restore"
    if kind is None or (entry.entity == "invoice" and kind_for(entry, obj, binned) == "purchases"):
        return None
    disabled, effect = "", ""
    if kind == "revert":
        bad = changed_fields(entry, obj)
        if bad:
            disabled = f"{', '.join(bad)} changed again since. Revert the later change first."
    if kind == "undo" and entry.entity != "invoice":
        uses = uses_for(obj)
        if isinstance(obj, Business):
            from billing.services.firms import assert_firm_unused
            try:
                assert_firm_unused(obj, uses)
            except Refusal as refused:
                disabled = refused.detail["detail"]
        elif any(uses.values()):
            disabled = f"{entry.entity_name} is in use, so it can’t be deleted."
    if entry.entity == "invoice":
        from billing.period_lock import assert_sales_open
        record = binned if kind == "restore" else obj
        try:
            assert_sales_open(record.business_id, record.invoice_date, "restore" if kind == "restore" else "delete")
        except Refusal as refused:
            disabled = refused.detail["detail"]
        if kind == "restore":
            from types import SimpleNamespace

            from billing.services.bill_reads import sums
            from billing.services.bin import _fields
            lines = [SimpleNamespace(**_fields(LineItem, row)) for row in (binned.restore_lines if hasattr(binned, "restore_lines") else binned.data.get("lines", []))]
            tax = sums(lines)["tax"] if lines else Decimal("0")
            firm_name = binned.restored_business_name if hasattr(binned, "restored_business_name") else binned.data.get("business_name", "")
            effect = f"{firm_name}'s {binned.invoice_date.strftime('%B')} sales go up by {inr(binned.total_amount)} and its tax by {inr(tax)}."
            from billing import period_lock
            status_reader = getattr(period_lock, "month_status", None)
            if status_reader and status_reader(binned.business_id, binned.invoice_date.year, binned.invoice_date.month).unlocked:
                effect += f" {binned.invoice_date.strftime('%B %Y')} was filed before and is open for a correction, so this change needs an amendment in the next return."
    label = {"undo": "Undo…", "revert": "Revert…", "restore": "Restore…"}[kind]
    hint = {"undo": "Shows what is removed before anything changes", "revert": "Shows what goes back before anything changes", "restore": "Shows what comes back before anything changes"}[kind]
    return {"kind": kind, "label": label, "disabled": disabled, "hint": hint, "effect": effect}


def entry_row(entry, actions=True):
    obj = record_for(entry) if actions else None
    binned = binned_for(entry) if actions and entry.entity == "invoice" and obj is None else None
    kind = kind_for(entry, obj, binned)
    present = capture_present(entry) if actions and entry.entity == "capture" else obj is not None
    words, link = event_words(entry, kind, present)
    result = ("restored" if entry.action == "deleted" else "reverted" if entry.action in {"updated", "reverted"} else "undone") if entry.used else None
    return {"id": entry.pk, "at": stamp(entry.timestamp), "by": person(entry.user), "action": entry.action, "entity": entry.entity,
            "entity_id": entry.entity_id, "kind": kind, "group": GROUPS.get(entry.action, "change"),
            "words": words, "link": link, "note": "In the bin" if binned else "",
            "details": entry.details, "changes": change_rows(MODEL_MAP.get(entry.entity), entry.changes), "result": result,
            "can": available(entry, obj, binned) if actions else None}
