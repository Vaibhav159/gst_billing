"""Shared audit field words and v2-compatible snapshot foreign keys."""
from decimal import Decimal, InvalidOperation

from billing.cache import uncached
from billing.models import Business, Customer, Invoice, Product
from billing.text import inr

MODEL_MAP = {"invoice": Invoice, "customer": Customer, "product": Product, "business": Business}
LABELS = {"mobile_number": "Phone", "gst_number": "GSTIN", "pan_number": "PAN", "hsn_code": "HSN",
          "gst_tax_rate": "GST rate", "usual_rate": "Usual rate", "default_unit": "Unit",
          "purchase_only": "Bought only", "bank_account_number": "Account number", "bank_ifsc_code": "IFSC",
          "signature_image": "Signature picture", "signature_on_bills": "Signature on bills", "short_name": "Short name",
          "default_business": "Default firm", "customer_type": "Type"}


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
