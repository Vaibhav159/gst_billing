"""Add-only backup restore. Preview and apply share normalization and planning."""

import hashlib
import json
import re
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError as ModelValidationError
from django.core.serializers.json import DjangoJSONEncoder
from django.utils.dateparse import parse_date
from rest_framework.exceptions import ValidationError

from billing.api.inward_bills_service import find_duplicate, inward_number_key, supplier_key
from billing.cache import uncached
from billing.constants import GST_CODE
from billing.fy import fy_of
from billing.gstin import validate as valid_gstin
from billing.models import BinnedInvoice, Business, Customer, Invoice, LineItem, Product
from billing.numbering import counter_of
from billing.period_lock import assert_sales_open
from billing.refusals import Refusal
from billing.services.line_items import build_line_items
from billing.services.sales import FIRM_FIELDS, LINE_MOST, MOST, _too_big
from billing.tax_rules import normalize_rate, normalize_state_name

KINDS = ("firms", "customers", "products", "bills", "purchases")
MODELS = {"firms": Business, "customers": Customer, "products": Product}
LISTS = ("businesses", "customers", "products", "invoices")
MAX_BYTES = 25 * 1024 * 1024
OLD_PURCHASE = "Purchase bills from the old app go through Purchases → Import, which checks each supplier's GSTIN and the credit month"
CHANGED = "The books changed since the preview. Check the new plan, then restore."
MASTER_FIELDS = {
    "firms": ("name", "gst_number", "address", "mobile_number", "email", "pan_number", "state_name", "bank_name",
              "bank_account_number", "bank_ifsc_code", "bank_branch_name", "invoice_prefix", "paper_full_number_from",
              "primary_color_theme", "short_name", "city", "pin_code", "jurisdiction", "declaration", "signature_on_bills"),
    "customers": ("name", "gst_number", "address", "mobile_number", "email", "pan_number", "state_name", "customer_type", "city"),
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
    elif version == "4.0":
        kind, words = "old_v4", "Old app backup (v4.0)"
    elif version == "3.0":
        kind, words = "old_v3", "Old app export (v3.0)"
    else:
        _bad(name)
    info = {"name": name, "kind": kind, "kind_words": words,
            "size": f"{max(1, (len(raw) + 512) // 1024)} KB",
            "made": data.get("made", data.get("exportedAt")) or None,
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
        if not gst.is_finite() or not 0 <= gst <= 1 or gst.as_tuple().exponent < -4:
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
            "purchase": key(raw.get("type" if old else "type_of_invoice")) == "inward",
            "fields": _clean_fields(Invoice, raw, BILL_FIELDS)}


def _rows(model, fields):
    return list(uncached(model).order_by("pk").values(*fields))


def _state():
    """Only matching, money-placement and version columns cross the wire."""
    state = {kind: _rows(model, ("id", "name", "updated_at") +
                         (("gst_number", "state_name") if kind != "products" else ()))
             for kind, model in MODELS.items()}
    state["bills"] = _rows(Invoice, ("id", "business_id", "customer_id", "invoice_date", "invoice_number", "type_of_invoice", "updated_at"))
    state["bin"] = list(BinnedInvoice.objects.live().order_by("pk").values(
        "id", "original_id", "business_id", "customer_id", "invoice_date", "invoice_number", "deleted_at", "audit_log_id", "type_of_invoice"))
    return state


def _find(rows, row):
    gstin = key(row.get("gst_number"))
    return (next((r for r in rows if gstin and key(r.get("gst_number")) == gstin), None)
            or next((r for r in rows if key(r["name"]) == key(row["name"])), None))


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


def _plan(data, info, raw_hash):
    state = _state()
    plan = {kind: {"add": [], "skip": [], "fail": [], "add_count": 0, "skip_count": 0, "fail_count": 0} for kind in KINDS}
    ops, maps = {kind: [] for kind in KINDS}, {"firms": {}, "customers": {}}
    candidates = {kind: list(state[kind]) for kind in MODELS}
    locked = []

    def record(kind, action, name, why="", detail=""):
        bucket = plan[kind]
        bucket[f"{action}_count"] += 1
        if len(bucket[action]) < 200:
            bucket[action].append({"name": name, **({"why": why} if why else {}), **({"detail": detail} if detail else {})})

    for kind, source in zip(("firms", "customers", "products"), LISTS, strict=False):
        for index, raw in enumerate(data[source]):
            row = _master(kind, raw, info["kind"] == "old_v3")
            name = row["name"]
            hit = _find(candidates[kind], row)
            if hit:
                why = ("listed twice in the file" if isinstance(hit["id"], str) else
                       f"same GSTIN as {hit['name']}" if row.get("gst_number") and key(hit.get("gst_number")) == key(row["gst_number"]) else
                       f"same name as {hit['name']}")
                record(kind, "skip", name, why)
            elif not name:
                record(kind, "fail", f"A { {'firms': 'firm', 'customers': 'customer', 'products': 'product'}[kind]} with no name", "No name in the file")
            elif row.get("gst_number") and not valid_gstin(row["gst_number"])[0]:
                record(kind, "fail", name, f"Its GSTIN {row['gst_number']} doesn't check out")
            elif kind == "products" and not row["hsn_code"]:
                record(kind, "fail", name, "No HSN code; add it by hand with its HSN and rate")
            else:
                hit = {**row, "id": f"new:{kind}:{index}"}
                if kind == "customers":
                    refs = raw.get("businesses", [])
                    if not isinstance(refs, list):
                        raise ValueError("businesses")
                    hit["_businesses"] = [matched["id"] for ref in refs if (matched := maps["firms"].get(("id", key(ref))))]
                candidates[kind].append(hit)
                ops[kind].append(hit)
                record(kind, "add", name)
            if hit and kind in maps:
                if key(raw.get("id")):
                    maps[kind][("id", key(raw.get("id")))] = hit
                maps[kind][("name", key(name))] = hit

    seen, seen_purchases = set(), set()
    for raw in data["invoices"]:
        row = _bill(raw, info["kind"] == "old_v3")
        name = row["number"] or "A bill with no number"
        if row["purchase"] and info["kind"] != "this_app":
            record("purchases", "fail", name, OLD_PURCHASE)
            continue
        kind = "purchases" if row["purchase"] else "bills"
        firm = maps["firms"].get(("id", key(row["firm"]))) or maps["firms"].get(("name", key(row["firm_name"])))
        if not firm and row["firm_name"]:
            firm = _find(candidates["firms"], {"name": row["firm_name"]})
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
            supplier = maps["customers"].get(("id", key(row["customer"]))) or maps["customers"].get(("name", key(row["customer_name"])))
            if not supplier and row["customer_name"]:
                supplier = _find(candidates["customers"], {"name": row["customer_name"], "gst_number": row["customer_gstin"]})
                supplier = supplier or {"id": f"new:purchase-supplier:{key(row['customer_name'])}",
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
            else:
                # ponytail: part 2's unpublished create/bin APIs are a hard integration prerequisite (X-40).
                # Matching a bin row must never route it through sales' restore_from_bin.
                record("purchases", "fail", name, "can't add yet")
                if binned_purchase is not None:
                    locked.append({"purchase_bin": binned_purchase.pk})
            continue
        marker = (firm["id"], fy_of(day), key(row["number"]))
        if marker in seen:
            record("bills", "skip", name, "listed twice in the file")
            continue
        seen.add(marker)
        series = [bill for bill in state["bills"] if bill["type_of_invoice"] == "outward" and
                  bill["business_id"] == firm["id"] and fy_of(bill["invoice_date"]) == fy_of(day)]
        existing = next((bill for bill in series if key(bill["invoice_number"]) == key(row["number"])), None)
        clash = next((bill for bill in series if counter_of(bill["invoice_number"]) == counter_of(row["number"])), None)
        if existing or clash:
            why = f"already on file as {existing['invoice_number']}" if existing else f"same number part as {clash['invoice_number']} on file"
            record("bills", "skip", name, why)
            continue
        binned = next((bill for bill in state["bin"] if bill["type_of_invoice"] == "outward" and bill["business_id"] == firm["id"] and fy_of(bill["invoice_date"]) == fy_of(day)
                       and key(bill["invoice_number"]) == key(row["number"])), None)
        binned_clash = next((bill for bill in state["bin"] if bill["type_of_invoice"] == "outward" and bill["business_id"] == firm["id"] and fy_of(bill["invoice_date"]) == fy_of(day)
                             and counter_of(bill["invoice_number"]) == counter_of(row["number"])), None)
        if binned_clash and not binned:
            record("bills", "skip", name, f"same number part as {binned_clash['invoice_number']} on file")
            continue
        day = binned["invoice_date"] if binned else day
        if isinstance(firm["id"], int):
            try:
                assert_sales_open(firm["id"], day, "restore")
            except Refusal as error:
                if error.detail["code"] != "month_closed":
                    raise
                locked.append(error.detail)
                record("bills", "fail", name, f"{day:%B %Y} is filed for {firm['name']}. Have the owner unlock {day:%B %Y} in GST returns first.")
                continue
        customer = maps["customers"].get(("id", key(row["customer"]))) or maps["customers"].get(("name", key(row["customer_name"])))
        if not customer and row["customer_name"]:
            customer = _find(candidates["customers"], {"name": row["customer_name"], "gst_number": row["customer_gstin"]})
        if not customer and not row["customer_name"]:
            record("bills", "fail", name, "No customer name on the bill")
            continue
        if not customer:
            customer = {"id": f"new:customers:bill:{len(ops['customers'])}", "name": row["customer_name"],
                        "gst_number": row["customer_gstin"], "state_name": firm.get("state_name", "")}
            if customer["gst_number"] and not valid_gstin(customer["gst_number"])[0]:
                record("bills", "fail", name, f"Its GSTIN {customer['gst_number']} doesn't check out")
                continue
            candidates["customers"].append(customer)
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
        record("bills", "add", name, detail=f"deleted {binned['deleted_at']:%d %b %Y}; comes back from the bin" if binned else "")
        ops["bills"].append({**row, "day": day, "business": firm["id"], "buyer": customer["id"], "bin": binned["id"] if binned else None})
        state["bills"].append({"id": None, "business_id": firm["id"], "invoice_date": day, "invoice_number": row["number"], "type_of_invoice": "outward"})
    for plural, action in (("adds", "add"), ("skips", "skip"), ("fails", "fail")):
        plan[plural] = sum(plan[kind][f"{action}_count"] for kind in KINDS)
    names = ("firm", "customer", "product", "sales bill", "purchase bill")
    words = [f"{plan[kind]['add_count']} {word}{'' if plan[kind]['add_count'] == 1 else 's'}"
             for kind, word in zip(KINDS, names, strict=True) if plan[kind]["add_count"]]
    plan["words"] = ", ".join(words[:-1]) + " and " + words[-1] if len(words) > 1 else next(iter(words), "nothing")
    digest = hashlib.sha256(json.dumps([raw_hash, state, ops, locked], cls=DjangoJSONEncoder, sort_keys=True).encode()).hexdigest()
    return {"file": info, "plan": plan, "fingerprint": digest}, ops


def preview(file):
    data, info, raw_hash = _read(file)
    try:
        return _plan(data, info, raw_hash)[0]
    except (ValueError, TypeError, InvalidOperation, ModelValidationError, OverflowError):
        _bad(info["name"])
