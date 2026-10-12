"""Add-only backup restore. Preview and apply share normalization and planning."""

import hashlib
import hmac
import json
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from types import SimpleNamespace

from django.core.exceptions import ValidationError as ModelValidationError
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from simple_history.utils import bulk_create_with_history

from billing.api.inward_bills_service import find_duplicate, inward_number_key, supplier_key
from billing.api.mixins import snapshot_of
from billing.cache import invalidate, uncached
from billing.constants import GST_CODE
from billing.fy import fy_label, fy_of, parse_fy
from billing.gstin import validate as valid_gstin
from billing.models import AuditLog, BinnedInvoice, Business, Customer, Invoice, LineItem, Product
from billing.numbering import counter_of, lock_firms
from billing.period_lock import assert_sales_open
from billing.refusals import Refusal
from billing.services.bin import restore_many_from_bin, v2_snapshot
from billing.services.line_items import build_line_items
from billing.services.sales import FIRM_FIELDS, LINE_MOST, MOST, _date_problem, _too_big
from billing.tax_rules import (
    GST_SLABS,
    clean_gstin,
    gstin_problem,
    itc_refusal,
    normalize_rate,
    normalize_state_name,
    rate_as_percent,
)
from billing.text import day_text, money

KINDS = ("firms", "customers", "products", "bills", "purchases")
MODELS = {"firms": Business, "customers": Customer, "products": Product}
LISTS = ("businesses", "customers", "products", "invoices")
MAX_BYTES = 25 * 1024 * 1024
GST_RATES = frozenset(normalize_rate(slab) for slab in GST_SLABS)
OLD_PURCHASE = "Purchase bills from the old app go through Purchases → Import, which checks each supplier's GSTIN and the credit month"
CHANGED = "The books changed since the preview. Check the new plan, then restore."
MASTER_FIELDS = {
    "firms": ("name", "gst_number", "address", "mobile_number", "email", "pan_number", "state_name", "bank_name",
              "bank_account_number", "bank_ifsc_code", "bank_branch_name", "invoice_prefix", "paper_full_number_from",
              "primary_color_theme", "short_name", "city", "pin_code", "jurisdiction", "declaration", "signature_on_bills"),
    "customers": ("name", "gst_number", "address", "mobile_number", "email", "pan_number", "state_name", "customer_type", "city", "is_supplier"),
    "products": ("name", "hsn_code", "gst_tax_rate", "description", "default_unit", "kind", "purity", "usual_rate", "purchase_only"),
}
BILL_FIELDS = ("payment_mode", "place_of_supply", "notes", "paper", "status", "cancel_reason", "cancelled_at",
               "sent_at", "last_sent_at", "sent_count", "sent_to", "sent_via", "firm_snapshot", "eway_bill_number",
               "transporter_name", "transporter_gstin", "vehicle_number", "vehicle_type", "transport_mode", "distance_km")


def text(value):
    return str(value).strip() if isinstance(value, (str, int, Decimal)) and not isinstance(value, bool) else ""


def key(value):
    return text(value).casefold()


def _bad(name):
    raise ValidationError({"file": [f"{name} is a .json file, but not a backup. Pick a file named like gst-backup-2026-10-08.json."]})


def _read(file):
    if file is None:
        raise ValidationError({"file": ["Choose the backup file."]})
    name = file.name
    if file.size > MAX_BYTES:
        raise ValidationError({"file": [f"That file is {Decimal(file.size) / 1048576:.1f} MB. A backup this app can restore is at most 25 MB."]})
    if not name.lower().endswith(".json"):
        raise ValidationError({"file": [f"{name} isn't a backup file. Backups are .json files, named like gst-backup-2026-10-08.json."]})
    file.seek(0)
    raw = file.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValidationError({"file": ["That file is more than 25 MB. A backup this app can restore is at most 25 MB."]})
    try:
        data = json.loads(raw.decode("utf-8-sig"), parse_float=Decimal,
                          parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    except (ValueError, UnicodeError, RecursionError):
        _bad(name)
    if not isinstance(data, dict):
        _bad(name)
    missing = [field for field in LISTS if not isinstance(data.get(field), list)]
    if missing:
        if len(missing) < len(LISTS):
            raise ValidationError({"file": [f"{name} looks like a backup from the old app, but it has no {', '.join(missing)} list. It may have been cut short; download it again from the old app."]})
        _bad(name)
    if any(not isinstance(row, dict) for field in LISTS for row in data[field]):
        _bad(name)
    version = str(data.get("version", ""))
    if data.get("app") == "gst-billing" and version == "5.0":
        kind, words = "this_app", "This app's backup"
        extra = data.get("v3", {})
        if not isinstance(extra, dict) or not isinstance(extra.get("cancelled", []), list):
            _bad(name)
        cancelled = extra.get("cancelled", [])
        if any(not isinstance(row, dict) or row.get("type_of_invoice", "outward") != "outward"
               or row.get("status", "cancelled") != "cancelled" for row in cancelled):
            _bad(name)
        data = {**data, "invoices": [*data["invoices"], *({**row, "status": "cancelled"} for row in cancelled)]}
    elif version == "4.0":
        kind, words = "old_v4", "Old app backup (v4.0)"
    elif version == "3.0":
        kind, words = "old_v3", "Old app export (v3.0)"
    else:
        _bad(name)
    info = {"name": name, "kind": kind, "kind_words": words,
            "size": f"{max(1, (len(raw) + 512) // 1024)} KB",
            "made": text(data.get("made", data.get("exportedAt")))[:40] or None,
            "by": text(data.get("by")) if kind == "this_app" else ""}
    return data, info, hashlib.sha256(raw).hexdigest()


def _clean_fields(model, row, names):
    """Allowlisted concrete values; unknown future fields stay out of writes."""
    fields = {field.name: field for field in model._meta.concrete_fields}
    out = {}
    for name in names:
        if name not in row or name not in fields:
            continue
        field, value = fields[name], row[name]
        if value is None:
            if field.null:
                out[name] = None
            continue
        if isinstance(value, (list, dict)) and field.get_internal_type() != "JSONField":
            raise ValueError(name)
        if field.get_internal_type() == "JSONField" and value is not None and not isinstance(value, dict):
            raise ValueError(name)
        if name == "firm_snapshot":
            if any(value.get(key) is not None and not isinstance(value.get(key), str) for key in FIRM_FIELDS):
                raise ValueError(name)
            value = {key: value[key] for key in FIRM_FIELDS if key in value}
            value["signature_image"] = ""
            if any("\x00" in (item or "") or any(0xD800 <= ord(c) <= 0xDFFF for c in (item or "")) for item in value.values()):
                raise ValueError(name)
        if isinstance(value, str) and ("\x00" in value or any(0xD800 <= ord(c) <= 0xDFFF for c in value)):
            raise ValueError(name)
        value = field.to_python(value)
        if field.max_length and len(str(value)) > field.max_length:
            raise ValueError(name)
        if isinstance(value, Decimal) and not value.is_finite():
            raise ValueError(name)
        if value not in (None, ""):
            field.run_validators(value)
        if field.choices and value not in (None, "") and value not in dict(field.choices):
            raise ValueError(name)
        out[name] = value
    return out


def _master(kind, raw, old):
    data = {**raw, "name": text(raw.get("name"))}
    if kind in ("firms", "customers"):
        aliases = {"gst_number": ("gstin", "gst"), "mobile_number": ("mobile",), "pan_number": ("pan",),
                   "state_name": ("state",), "bank_name": ("bankName",), "bank_account_number": ("accountNo",),
                   "bank_ifsc_code": ("ifsc",), "bank_branch_name": ("branch",)}
        for field, choices in aliases.items():
            data[field] = raw.get(field) or next((raw[c] for c in choices if raw.get(c)), "")
        data["gst_number"] = text(data["gst_number"]).upper()
        state = text(data["state_name"])
        if state in GST_CODE:
            state = GST_CODE[state]
        data["state_name"] = normalize_state_name(state)
    else:
        data["hsn_code"] = text(raw.get("hsn_code", raw.get("hsn")))
        data["gst_tax_rate"] = normalize_rate(raw.get("gst_tax_rate", raw.get("gstRate", 0)),
                                                assume="percent" if old and "gst_tax_rate" not in raw else "fraction")
        if data["gst_tax_rate"] not in GST_RATES:
            raise ValueError("tax rate")
        data["default_unit"] = raw.get("default_unit", raw.get("defaultUnit", "gms"))
    return _clean_fields(MODELS[kind], data, MASTER_FIELDS[kind])


def _amount(value, maximum):
    if isinstance(value, bool) or not isinstance(value, (str, int, Decimal)):
        raise TypeError("money")
    value = Decimal(str(value))
    if not value.is_finite() or value < 0 or value > maximum or value.as_tuple().exponent < -3:
        raise ValueError("money")
    return value


def _bill(raw, old):
    items = raw.get("items", []) if old else raw.get("line_items", [])
    if not isinstance(items, list) or any(not isinstance(row, dict) for row in items):
        raise ValueError("items")
    lines = []
    for row in items:
        gst = normalize_rate(row.get("gstRate" if old else "gst_tax_rate", 0), assume="percent" if old else "fraction")
        if not gst.is_finite() or gst not in GST_RATES or gst.as_tuple().exponent < -4:
            raise ValueError("tax rate")
        lines.append({"product_name": text(row.get("productName" if old else "product_name")),
                      "hsn_code": text(row.get("hsn" if old else "hsn_code")),
                      "quantity": _amount(row.get("qty" if old else "quantity", 0), LINE_MOST),
                      "rate": _amount(row.get("rate", 0), MOST),
                      "gst_tax_rate": gst,
                      "unit": row.get("unit", "gms"), "note": text(row.get("note"))})
    return {"number": text(raw.get("invoiceNumber" if old else "invoice_number")),
            "day": text(raw.get("invoice_date")), "firm": raw.get("businessId" if old else "business"),
            "firm_name": text(raw.get("businessName" if old else "business_name")),
            "customer": raw.get("customerId" if old else "customer"),
            "customer_name": text(raw.get("customerName" if old else "customer_name")),
            "customer_gstin": text(raw.get("customerGST")).upper(), "lines": lines,
            "file_total": raw.get("total" if old else "total_amount"),
            "file_heads": [{head: item[head] for head in ("cgst", "sgst", "igst") if head in item} for item in items],
            "purchase": key(raw.get("type" if old else "type_of_invoice")) == "inward",
            "fields": _clean_fields(Invoice, raw, BILL_FIELDS),
            "purchase_fields": {name: raw[name] for name in ("payment_mode", "itc_month", "itc_eligible",
                "buyer_gstin", "buyer_ack", "needs_review", "source") if name in raw}}


def _rows(model, fields):
    return list(uncached(model).order_by("pk").values(*fields))


def _state():
    """Only matching, money-placement and version columns cross the wire."""
    state = {kind: _rows(model, ("id", "name") +
                         (("gst_number", "state_name") if kind != "products" else ()))
             for kind, model in MODELS.items()}
    state["bills"] = _rows(Invoice, ("id", "business_id", "customer_id", "invoice_date", "invoice_number", "type_of_invoice"))
    state["bin"] = list(BinnedInvoice.objects.live().order_by("pk").values(
        "id", "original_id", "business_id", "customer_id", "invoice_date", "invoice_number", "deleted_at", "audit_log_id", "type_of_invoice"))
    return state


class _Candidates:
    """Index once; a name fallback never joins two different registered parties (X-74)."""

    def __init__(self, rows):
        self.ids, self.gstins, self.names = set(), {}, {}
        for row in rows:
            self.add(row)

    def add(self, row):
        self.ids.add(row["id"])
        if gstin := key(row.get("gst_number")):
            self.gstins.setdefault(gstin, row)
        self.names.setdefault(key(row["name"]), row)

    def find(self, row):
        gstin = key(row.get("gst_number"))
        found = self.gstins.get(gstin) if gstin else None
        named = self.names.get(key(row["name"]))
        return found or (named if not self.conflict(row, named) else None)

    def conflict(self, row, named=None):
        named = named or self.names.get(key(row["name"]))
        gstin = key(row.get("gst_number"))
        if named and gstin and key(named.get("gst_number")) and gstin != key(named["gst_number"]):
            return f"same name as {named['name']}, but a different GSTIN"
        return ""

    def __contains__(self, row):
        return row["id"] in self.ids


def _party(candidates, mapping, reference, name, gstin=""):
    row = {"name": name, "gst_number": gstin}
    found = mapping.get(("id", key(reference)))
    if found is None:
        found = candidates.gstins.get(key(gstin)) or mapping.get(("name", key(name)))
    if found and "_problem" in found:
        return found
    if found:
        problem = candidates.conflict(row, found)
        return {"_problem": problem} if problem else found
    found = candidates.find(row) if name or gstin else None
    problem = candidates.conflict(row) if found is None else ""
    return {"_problem": problem} if problem else found


def _money_detail(row, lines, total):
    def differs(value, actual):
        try:
            given = Decimal(str(value))
            return not given.is_finite() or given != actual
        except InvalidOperation:
            return True
    words = []
    if any(differs(value, getattr(line, head)) for given, line in zip(row["file_heads"], lines, strict=True)
           for head, value in given.items()):
        words.append("Recalculated tax heads differ from the file.")
    if row["file_total"] is not None and differs(row["file_total"], total):
        words.append(f"Recalculated total differs from the file ({money(total)}).")
    return " ".join(words)


class _Sales:
    """Outward bills keyed by (firm, FY, number) and (firm, FY, number part); the first on file wins."""

    def __init__(self, rows):
        self.numbers, self.counters = {}, {}
        for bill in rows:
            self.add(bill)

    def add(self, bill):
        if bill["type_of_invoice"] != "outward" or bill["invoice_date"] is None:
            return
        place = (bill["business_id"], fy_of(bill["invoice_date"]))
        self.numbers.setdefault((*place, key(bill["invoice_number"])), bill)
        self.counters.setdefault((*place, counter_of(bill["invoice_number"])), bill)

    def match(self, business, day, number):
        place = (business, fy_of(day))
        return self.numbers.get((*place, key(number))), self.counters.get((*place, counter_of(number)))


def _purchase_match(firm, supplier, number, day):
    """Use part 2's one identity for live and binned purchases (X-7).

    New records have temporary string ids. They cannot already have a saved bill;
    their within-file identity is still checked through supplier_key below.
    """
    if not isinstance(firm["id"], int) or not isinstance(supplier["id"], int):
        return None, None
    party = Customer(pk=supplier["id"], gst_number=supplier.get("gst_number", ""))
    live = find_duplicate(firm["id"], number, party, day,
                          queryset=uncached(Invoice).only("id", "invoice_number"))
    if live is not None:
        return live, None
    binned = find_duplicate(firm["id"], number, party, day,
                            queryset=BinnedInvoice.objects.live().nocache().only("id", "invoice_number", "deleted_at"))
    return None, binned



# The part 2 contract: a purchase's source is one of these ("" made in v2 or before v3).
PURCHASE_SOURCES = {"typed", "capture", "photos", "excel", ""}


def _purchase_services():
    """2A's purchase save, restore and credit-month services."""
    from billing.api.purchases import PurchaseSerializer
    from billing.credit import choose_credit_month, credit_month_of
    from billing.period_lock import assert_purchase_open
    from billing.services.purchase_bin import restore_purchase
    from billing.services.purchases import save_purchase

    return SimpleNamespace(save_purchase=save_purchase, restore_purchase=restore_purchase,
        PurchaseSerializer=PurchaseSerializer, choose_credit_month=choose_credit_month,
        credit_month_of=credit_month_of, assert_purchase_open=assert_purchase_open)


def _credit_input(value, day):
    if day < date(2025, 4, 1):
        return None
    if value is None:
        return day.strftime("%Y-%m")
    if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-01", value):
        value = value[:7]
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}", value):
        raise ValidationError({"itc_month": ["Give the month like 2026-09."]})
    return value


def _purchase_input(row, day, business, supplier, services):
    """Backup fractions/dates become 2A's validated purchase input, with local parties."""
    if not 2000 <= day.year <= 2099:
        raise ValidationError({"invoice_date": ["Pick a date from 2000 to 2099."]})
    today = timezone.localdate()
    if day > today:
        raise ValidationError({"invoice_date": [f"That's after today ({day_text(today)}). Check the date on the bill."]})
    payload = {**row["purchase_fields"], "invoice_number": row["number"], "invoice_date": day,
               "itc_month": _credit_input(row["purchase_fields"].get("itc_month"), day),
               "duplicate_ok": False, "capture": None,
               # 2A's line fields read text or JSON numbers, so the file's decimals go in as text.
               "lines": [{**{name: str(value) if isinstance(value, Decimal) else value
                             for name, value in item.items() if name != "gst_tax_rate"},
                          "gst_percent": str(rate_as_percent(item["gst_tax_rate"]))} for item in row["lines"]]}
    source = serializers.CharField(max_length=10, allow_blank=True).run_validation(payload.get("source", "typed"))
    if source not in PURCHASE_SOURCES:
        raise ValidationError({"source": ["That bill's source isn't one this app records."]})
    # The public serializer accepts typed/capture; a backup also retains 2A import sources.
    payload["source"] = "typed"
    validator = services.PurchaseSerializer(data=payload)
    validator.fields.pop("business", None)
    validator.fields.pop("supplier", None)
    validator.is_valid(raise_exception=True)
    data = {**validator.validated_data, "business": business, "supplier": supplier, "source": source}
    problem = gstin_problem(supplier.gst_number) or itc_refusal(supplier.gst_number, row["lines"])
    if problem:
        raise ValidationError({"supplier": [problem]})
    if data.get("buyer_gstin") and data["buyer_gstin"] != clean_gstin(business.gst_number) and not data.get("buyer_ack"):
        raise ValidationError({"buyer_gstin": [f"This bill isn't addressed to {business.name}'s GSTIN."]})
    draft = Invoice(business=business, customer=supplier, type_of_invoice="inward")
    lines, total = build_line_items(draft, row["lines"], source="api")
    if _too_big(lines) or total > MOST:
        raise ValueError("money")
    return data, _money_detail(row, lines, total)


def _purchase_credit(services, cache, business, day, value, *, binned=False):
    marker = ("purchase", business.pk, day.replace(day=1), value, binned)
    if marker not in cache:
        try:
            if binned:
                chosen = parse_date(value) if value else None
            else:
                chosen = services.choose_credit_month(business, day, value=value)
            month = services.credit_month_of(SimpleNamespace(invoice_date=day, itc_month=chosen))
            services.assert_purchase_open(business, month, "restore" if binned else "create")
            cache[marker] = (month, None)
        except (Refusal, ValidationError) as error:
            cache[marker] = (None, error)
    month, error = cache[marker]
    if error is not None:
        raise error
    return month


def _purchase_problem(detail):
    if isinstance(detail, dict):
        return _purchase_problem(detail.get("detail", next(iter(detail.values()))))
    if isinstance(detail, list):
        return _purchase_problem(detail[0])
    return str(detail)


def _plan(data, info, raw_hash):
    state = _state()
    plan = {kind: {"add": [], "skip": [], "fail": [], "add_count": 0, "skip_count": 0, "fail_count": 0} for kind in KINDS}
    ops, maps = {kind: [] for kind in KINDS}, {"firms": {}, "customers": {}}
    candidates = {kind: _Candidates(state[kind]) for kind in MODELS}
    live, binned_sales = _Sales(state["bills"]), _Sales(state["bin"])
    locked, months = [], {}
    binned_values = None

    def record(kind, action, name, why="", detail=""):
        bucket = plan[kind]
        bucket[f"{action}_count"] += 1
        if len(bucket[action]) < 200:
            bucket[action].append({"name": name, **({"why": why} if why else {}), **({"detail": detail} if detail else {})})

    for kind, source in zip(("firms", "customers", "products"), LISTS, strict=False):
        for index, raw in enumerate(data[source]):
            row = _master(kind, raw, info["kind"] == "old_v3")
            name = row["name"]
            hit = candidates[kind].find(row)
            problem = "" if hit else candidates[kind].conflict(row)
            if hit:
                why = ("listed twice in the file" if isinstance(hit["id"], str) else
                       f"same GSTIN as {hit['name']}" if row.get("gst_number") and key(hit.get("gst_number")) == key(row["gst_number"]) else
                       f"same name as {hit['name']}")
                record(kind, "skip", name, why)
            elif problem:
                pass
            elif not name:
                problem = "No name in the file"
            elif row.get("gst_number") and not valid_gstin(row["gst_number"])[0]:
                problem = f"Its GSTIN {row['gst_number']} doesn't check out"
            elif kind == "products" and not row["hsn_code"]:
                problem = "No HSN code; add it by hand with its HSN and rate"
            else:
                hit = {**row, "id": f"new:{kind}:{index}"}
                if kind == "customers":
                    refs = raw.get("businesses", [])
                    if not isinstance(refs, list):
                        raise ValueError("businesses")
                    hit["_businesses"] = [matched["id"] for ref in refs if (matched := maps["firms"].get(("id", key(ref)))) and "_problem" not in matched]
                candidates[kind].add(hit)
                ops[kind].append(hit)
                record(kind, "add", name)
            if problem:
                record(kind, "fail", name or f"A { {'firms': 'firm', 'customers': 'customer', 'products': 'product'}[kind]} with no name", problem)
                hit = {"_problem": problem}
            if hit and kind in maps:
                if key(raw.get("id")):
                    maps[kind][("id", key(raw.get("id")))] = hit
                maps[kind][("name", key(name))] = hit

    seen, seen_purchases = set(), set()
    purchase_services = _purchase_services() if any(key(row.get("type_of_invoice")) == "inward" for row in data["invoices"]) else None
    for raw in data["invoices"]:
        row = _bill(raw, info["kind"] == "old_v3")
        name = row["number"] or "A bill with no number"
        if row["purchase"] and info["kind"] != "this_app":
            record("purchases", "fail", name, OLD_PURCHASE)
            continue
        kind = "purchases" if row["purchase"] else "bills"
        firm = _party(candidates["firms"], maps["firms"], row["firm"], row["firm_name"])
        if firm and "_problem" in firm:
            record(kind, "fail", name, firm["_problem"])
            continue
        if not firm:
            record(kind, "fail", name, f"No firm called {row['firm_name'] or '(blank)'} on file or in the file")
            continue
        try:
            day = parse_date(row["day"]) if re.fullmatch(r"\d{4}-\d{2}-\d{2}", row["day"]) else None
        except ValueError:
            day = None
        if day is None:
            record(kind, "fail", name, "No bill date")
            continue
        if not row["number"] or (not inward_number_key(row["number"]) if row["purchase"] else counter_of(row["number"]) is None):
            record(kind, "fail", name, "No bill number")
            continue
        if len(row["number"]) > 255:
            raise ValueError("number")
        if row["purchase"]:
            supplier = _party(candidates["customers"], maps["customers"], row["customer"], row["customer_name"], row["customer_gstin"])
            if supplier and "_problem" in supplier:
                record(kind, "fail", name, supplier["_problem"])
                continue
            if not supplier and row["customer_name"]:
                supplier = {"id": f"new:purchase-supplier:{key(row['customer_name'])}",
                            "name": row["customer_name"], "gst_number": row["customer_gstin"]}
            if supplier is None:
                record("purchases", "fail", name, "No customer name on the bill")
                continue
            party = Customer(pk=supplier["id"], gst_number=supplier.get("gst_number", ""))
            identity = (firm["id"], supplier_key(party), inward_number_key(row["number"]), fy_of(day))
            if identity in seen_purchases:
                record("purchases", "skip", name, "listed twice in the file")
                continue
            seen_purchases.add(identity)
            existing, binned_purchase = _purchase_match(firm, supplier, row["number"], day)
            if existing is not None:
                record("purchases", "skip", name, f"already on file as {existing.invoice_number}")
                continue
            business = Business(**{field: firm[field] for field in ("name", "gst_number", "state_name") if field in firm})
            business.pk = firm["id"] if isinstance(firm["id"], int) else None
            party = Customer(**{field: supplier[field] for field in ("name", "gst_number", "state_name") if field in supplier})
            party.pk = supplier["id"] if isinstance(supplier["id"], int) else None
            try:
                if binned_purchase is not None:
                    saved = uncached(BinnedInvoice).filter(pk=binned_purchase.pk).values("invoice_date", "data__invoice__itc_month").get()
                    day = saved["invoice_date"]
                    month = _purchase_credit(purchase_services, months, business, day, saved["data__invoice__itc_month"], binned=True)
                else:
                    inputs, detail = _purchase_input(row, day, business, party, purchase_services)
                    month = _purchase_credit(purchase_services, months, business, day, inputs["itc_month"])
            except (ValidationError, Refusal) as error:
                locked.append(error.detail)
                record("purchases", "fail", name, _purchase_problem(error.detail))
                continue
            if supplier not in candidates["customers"]:
                supplier["state_name"] = supplier.get("state_name", firm.get("state_name", ""))
                candidates["customers"].add(supplier)
                ops["customers"].append(supplier)
                record("customers", "add", supplier["name"])
            record("purchases", "add", name, detail=f"deleted {binned_purchase.deleted_at:%d %b %Y}; comes back from the bin" if binned_purchase else detail)
            ops["purchases"].append({**row, "day": day, "business": firm["id"], "buyer": supplier["id"],
                "bin": binned_purchase.pk if binned_purchase else None, "credit_month": month})
            continue
        marker = (firm["id"], fy_of(day), key(row["number"]))
        if marker in seen:
            record("bills", "skip", name, "listed twice in the file")
            continue
        seen.add(marker)
        existing, clash = live.match(firm["id"], day, row["number"])
        if existing or clash:
            why = f"already on file as {existing['invoice_number']}" if existing else f"same number part as {clash['invoice_number']} on file"
            record("bills", "skip", name, why)
            continue
        binned, binned_clash = binned_sales.match(firm["id"], day, row["number"])
        if binned_clash and not binned:
            record("bills", "skip", name, f"same number part as {binned_clash['invoice_number']} on file")
            continue
        checked_lines = row["lines"]
        if binned:
            # Read only line checks and saved dates, once, outside the matching fingerprint.
            if binned_values is None:
                ids = [item["id"] for item in state["bin"] if item["type_of_invoice"] == "outward"]
                binned_values = {item["id"]: item for item in uncached(BinnedInvoice).filter(pk__in=ids).values(
                    "id", "data__lines", "data__invoice__invoice_date")}
            saved = binned_values[binned["id"]]
            day = parse_date(saved["data__invoice__invoice_date"]) or binned["invoice_date"]
            checked_lines = saved["data__lines"]
        problem = _date_problem(day)
        if not checked_lines:
            problem = problem or "Add at least one item: pick a product, then type its weight."
        elif any(not re.fullmatch(r"[0-9]{4,8}", item.get("hsn_code", "")) for item in checked_lines):
            problem = problem or "Type the HSN code, 4 to 8 digits (7113 for jewellery)."
        elif any(normalize_rate(item.get("gst_tax_rate", 0), assume="fraction") not in GST_RATES for item in checked_lines):
            problem = problem or "Choose the GST rate. Gold and silver jewellery is 3%; cut diamonds are 0.25%."
        if problem:
            record("bills", "fail", name, problem)
            continue
        if isinstance(firm["id"], int):
            try:
                _open_month(months, firm["id"], day, "restore")
            except Refusal as error:
                if error.detail["code"] != "month_closed":
                    raise
                locked.append(error.detail)
                record("bills", "fail", name, f"{day:%B %Y} is filed for {firm['name']}. Have the owner unlock {day:%B %Y} in GST returns first.")
                continue
        customer = _party(candidates["customers"], maps["customers"], row["customer"], row["customer_name"], row["customer_gstin"])
        if customer and "_problem" in customer:
            record("bills", "fail", name, customer["_problem"])
            continue
        if not customer and not row["customer_name"]:
            record("bills", "fail", name, "No customer name on the bill")
            continue
        if not customer:
            customer = {"id": f"new:customers:bill:{len(ops['customers'])}", "name": row["customer_name"],
                        "gst_number": row["customer_gstin"], "state_name": firm.get("state_name", "")}
            if customer["gst_number"] and not valid_gstin(customer["gst_number"])[0]:
                record("bills", "fail", name, f"Its GSTIN {customer['gst_number']} doesn't check out")
                continue
            candidates["customers"].add(customer)
            ops["customers"].append(customer)
            record("customers", "add", customer["name"])
        draft = Invoice(business=Business(**{k: v for k, v in firm.items() if k in {"name", "gst_number", "state_name"}}),
                        customer=Customer(**{k: v for k, v in customer.items() if k in {"name", "gst_number", "state_name"}}),
                        **row["fields"])
        lines, total = build_line_items(draft, row["lines"], source="api")
        if _too_big(lines) or total > MOST:
            raise ValueError("money")
        for line in lines:
            _clean_fields(LineItem, {field.name: getattr(line, field.name) for field in LineItem._meta.concrete_fields
                                    if not field.is_relation}, ("product_name", "hsn_code", "unit", "note"))
        record("bills", "add", name, detail=f"deleted {binned['deleted_at']:%d %b %Y}; comes back from the bin" if binned else _money_detail(row, lines, total))
        ops["bills"].append({**row, "day": day, "business": firm["id"], "buyer": customer["id"], "bin": binned["id"] if binned else None})
        planned = {"id": None, "business_id": firm["id"], "invoice_date": day, "invoice_number": row["number"], "type_of_invoice": "outward"}
        state["bills"].append(planned)
        live.add(planned)
    for plural, action in (("adds", "add"), ("skips", "skip"), ("fails", "fail")):
        plan[plural] = sum(plan[kind][f"{action}_count"] for kind in KINDS)
    names = ("firm", "customer", "product", "sales bill", "purchase bill")
    words = [f"{plan[kind]['add_count']} {word}{'' if plan[kind]['add_count'] == 1 else 's'}"
             for kind, word in zip(KINDS, names, strict=True) if plan[kind]["add_count"]]
    plan["words"] = ", ".join(words[:-1]) + " and " + words[-1] if len(words) > 1 else next(iter(words), "nothing")
    digest = hashlib.sha256(json.dumps([raw_hash, state, ops, locked], cls=DjangoJSONEncoder, sort_keys=True).encode()).hexdigest()
    return {"file": info, "plan": plan, "fingerprint": digest}, ops


def _open_month(cache, business, day, action):
    marker = (business, day.year, day.month)
    if marker not in cache:
        try:
            assert_sales_open(business, day, action)
        except Refusal as error:
            if error.detail["code"] != "month_closed":
                raise
            cache[marker] = error
        else:
            cache[marker] = None
    if cache[marker] is not None:
        raise cache[marker]


def _year_data(data, fy):
    counts = {}
    for row in data["invoices"]:
        try:
            day = parse_date(text(row.get("invoice_date")))
        except ValueError:
            day = None
        if day:
            label = fy_label(fy_of(day))
            counts[label] = counts.get(label, 0) + 1
    years = [{"fy": label, "bills": count, "words": f"Adding {label}: {count:,} bills…"}
             for label, count in sorted(counts.items())]
    if fy is not None:
        if not isinstance(fy, str) or parse_fy(fy) is None or fy not in counts:
            raise ValidationError({"fy": ["Choose a financial year in this backup."]})
        selected = []
        for row in data["invoices"]:
            try:
                day = parse_date(text(row.get("invoice_date")))
            except ValueError:
                day = None
            # Undated invalid rows remain visible as failures; they can never be inserted.
            if day is None or fy_label(fy_of(day)) == fy:
                selected.append(row)
        data = {**data, "invoices": selected}
    return data, years


def _preview(data, info, raw_hash, fy):
    selected, years = _year_data(data, fy)
    if len(data["invoices"]) > 3000 and fy is None:
        # Planning every year would outrun gunicorn; the overview only offers the years to walk.
        return {"file": info, "years": years, "fy": None}, None
    try:
        answer, ops = _plan(selected, info, raw_hash + (fy or ""))
    except (ValueError, TypeError, InvalidOperation, ModelValidationError, OverflowError):
        _bad(info["name"])
    if len(data["invoices"]) > 3000:
        answer.update(years=years, fy=fy)
    return answer, ops


def preview(file, fy=None):
    data, info, raw_hash = _read(file)
    return _preview(data, info, raw_hash, fy)[0]


def _imported(instance, kind, user, filename, lines=None):
    return AuditLog(user=user, action="imported", entity={"firms": "business", "customers": "customer", "products": "product", "bills": "invoice", "purchases": "invoice"}[kind],
                    entity_id=instance.pk, entity_name=instance.invoice_number if kind in ("bills", "purchases") else instance.name,
                    details=f"From the backup {filename}",
                    snapshot=v2_snapshot(instance, lines) if kind in ("bills", "purchases") else snapshot_of(instance))


def lock_restore_and_merge():
    # Restore against an empty book still needs a shared row: every authenticated request has a User.
    # Only its primary key is read. Restore and merge take it before their different row-lock orders.
    from django.contrib.auth import get_user_model
    # No-key, so audit rows that point at this user (a purchase restore's, say) aren't blocked behind it.
    get_user_model().objects.order_by("pk").select_for_update(no_key=True).values_list("pk", flat=True).first()


def _restore_locks():
    lock_restore_and_merge()
    # Purchase restores lock audit -> inward bin row -> firm (2A); sale bin restores lock audit -> firm -> bin (4A),
    # and firm edits hold the firm before its bin rows. So: audit, inward bin rows, firms, then outward bin rows.
    ids = BinnedInvoice.objects.live().exclude(audit_log_id=None).values_list("audit_log_id", flat=True)
    list(AuditLog.objects.select_for_update().filter(pk__in=ids).order_by("pk").values_list("pk", flat=True))
    live = BinnedInvoice.objects.live().select_for_update().order_by("pk")
    list(live.filter(type_of_invoice="inward").values_list("pk", flat=True))
    lock_firms(*uncached(Business).values_list("pk", flat=True))
    list(live.exclude(type_of_invoice="inward").values_list("pk", flat=True))
    for model in (Customer, Product):
        list(uncached(model).select_for_update().order_by("pk").values_list("pk", flat=True))


def apply_restore(file, fingerprint, user, fy=None):
    data, info, raw_hash = _read(file)
    if len(data["invoices"]) > 3000 and fy is None:
        raise Refusal("Restore this backup one financial year at a time.", "restore_year_required",
                      years=_year_data(data, None)[1])
    with transaction.atomic():
        _restore_locks()
        answer, ops = _preview(data, info, raw_hash, fy)
        if not isinstance(fingerprint, str) or not re.fullmatch(r"[0-9a-f]{64}", fingerprint) or not hmac.compare_digest(answer["fingerprint"], fingerprint):
            raise Refusal(CHANGED, "plan_changed", plan=answer["plan"])
        added, mapped = {kind: [] for kind in KINDS}, {"firms": {}, "customers": {}}
        audits, months = [], {}
        for kind, model in MODELS.items():
            for row in ops[kind]:
                instance = model.objects.create(**{k: v for k, v in row.items() if k != "id" and not k.startswith("_")})
                if kind in mapped:
                    mapped[kind][row["id"]] = instance
                if kind == "customers":
                    instance.businesses.set([mapped["firms"][ref].pk if ref in mapped["firms"] else ref
                                             for ref in row.get("_businesses", [])])
                added[kind].append(instance.pk)
                audits.append(_imported(instance, kind, user, info["name"]))
        for kind, model, ref in (("firms", Business, "business"), ("customers", Customer, "buyer")):
            ids = {row[ref] for row in ops["bills"] + ops["purchases"] if isinstance(row[ref], int)}
            fields = ["id", "name", "gst_number", "state_name"] + (["is_supplier"] if model is Customer else [])
            mapped[kind].update(uncached(model).only(*fields).in_bulk(ids))
        for row in ops["bills"]:
            _open_month(months, mapped["firms"][row["business"]].pk, row["day"], "backup_restore")
        bin_ids = [row["bin"] for row in ops["bills"] if row["bin"]]
        from_bin = dict(zip(bin_ids, restore_many_from_bin(bin_ids, user, check_month=False), strict=True)) if bin_ids else {}
        pending, restored = [], []
        for row in ops["bills"]:
            business, customer = mapped["firms"][row["business"]], mapped["customers"][row["buyer"]]
            if row["bin"]:
                invoice = from_bin[row["bin"]]
                restored.append((invoice, invoice._restored_lines))
            else:
                invoice = Invoice(business=business, customer=customer, invoice_number=row["number"], invoice_date=row["day"],
                                  type_of_invoice="outward", **row["fields"])
                lines, invoice.total_amount = build_line_items(invoice, row["lines"], source="api")
                pending.append((invoice, lines))
                restored.append((invoice, lines))
        bulk_create_with_history([invoice for invoice, _ in pending], Invoice, batch_size=250, default_user=user)
        all_lines = []
        for invoice, lines in pending:
            for item in lines:
                item.invoice_id = invoice.pk
            all_lines.extend(lines)
        LineItem.objects.bulk_create(all_lines, batch_size=250)
        for invoice, lines in restored:
            audits.append(_imported(invoice, "bills", user, info["name"], lines))
            added["bills"].append(invoice.pk)
        services = _purchase_services() if ops["purchases"] else None
        for row in ops["purchases"]:
            if row["bin"]:
                binned = uncached(BinnedInvoice).get(pk=row["bin"])
                invoice = services.restore_purchase(binned, user)
            else:
                inputs, _detail = _purchase_input(row, row["day"], mapped["firms"][row["business"]], mapped["customers"][row["buyer"]], services)
                # The plan, re-run under these locks, already refused file and book duplicates by 2A's identity.
                invoice = services.save_purchase({**inputs, "duplicate_ok": True}, user)
            # 2A returns its narrow read; the audit snapshot needs every field, read once.
            audits.append(_imported(uncached(Invoice).get(pk=invoice.pk), "purchases", user, info["name"]))
            added["purchases"].append(invoice.pk)
        AuditLog.objects.bulk_create(audits, batch_size=250)
        invalidate(Invoice, LineItem)
        plan = answer["plan"]
        AuditLog.objects.create(user=user, action="restored", entity="backup", entity_id=0, entity_name=info["name"],
                                details=f"Added {plan['words']} · skipped {plan['skips']} · couldn't add {plan['fails']}")
        return {"plan": plan, "added": {kind: ids[:50] for kind, ids in added.items()}}
