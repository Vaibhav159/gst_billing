"""The existing portal builder, shared by v2, GST screens and filing snapshots.

Arithmetic stays Decimal until the portal's numeric JSON boundary. The same rate
buckets feed the file, its table view, and immutable per-bill filing snapshots.
"""

import re
from collections import Counter, defaultdict
from copy import deepcopy
from datetime import date
from decimal import Decimal
from itertools import pairwise

from django.db.models import Count, Prefetch
from django.db.models.functions import Trim
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from billing.cache import uncached
from billing.constants import BILL_CANCELLED, GST_CODE
from billing.fy import fy_of, fy_range
from billing.models import BinnedInvoice, Invoice, LineItem
from billing.numbering import bill_ref
from billing.services.bill_reads import line_taxable
from billing.services.gstr1 import _is_service, _readings, document_series
from billing.tax_rules import (
    HEADS,
    classify_b2c,
    clean_gstin,
    filed_quantity,
    gstin_problem,
    rate_as_percent,
    state_code,
    supply_interstate,
    to_paise,
    uqc_for,
)
from billing.text import money, percent

ZERO = Decimal("0")
HSN_NAMES = {"7102": "Diamonds, cut and polished", "7106": "Silver bars", "7108": "Gold bullion",
             "7113": "Jewellery, gold or silver", "7114": "Silver articles and utensils",
             "7118": "Coins, gold or silver", "4819": "Jewellery boxes",
             "9983": "Hallmarking (HUID)", "9988": "Job work by karigar"}
BILL_FIELDS = ("invoice_number", "invoice_date", "status", "cancel_reason", "total_amount", "place_of_supply",
               "customer__name", "customer__gst_number", "customer__state_name",
               "business__gst_number", "business__state_name")
LINE_FIELDS = ("invoice_id", "quantity", "rate", "gst_tax_rate", "cgst", "sgst", "igst",
               "unit", "hsn_code", "product_name")


def hsn_description(code, business=None, year=None, month=None, *, descriptions=None):
    """Shared HSN wording for returns, reports and CA Excel (X-38).

    Known four-digit families use our table. Otherwise pass a description/count
    mapping from the report's period projection, or a business and calendar month
    for one grouped, uncached query of active outward lines. Ties use lexical order;
    blank labels are ignored. With neither period nor counts, use the generic label.
    """
    code = str(code or "").strip()
    if not code:
        return "No HSN code"
    if code[:4] in HSN_NAMES:
        return HSN_NAMES[code[:4]]
    if descriptions is None and all(value is not None for value in (business, year, month)):
        first = date(year, month, 1)
        stop = date(year + month // 12, month % 12 + 1, 1)
        bills = Invoice.objects.sales().counted().filter(
            business=business, invoice_date__gte=first, invoice_date__lt=stop)
        descriptions = dict(uncached(LineItem).filter(invoice__in=bills)
                            .alias(code=Trim("hsn_code")).filter(code=code)
                            .annotate(description=Trim("product_name"))
                            .values("description").annotate(uses=Count("pk"))
                            .order_by().values_list("description", "uses"))
    counts = Counter()
    for label, count in (descriptions or {}).items():
        label = (label or "").strip()
        if label and count > 0:
            counts[label] += count
    return min(counts, key=lambda label: (-counts[label], label)) if counts else "Other goods"


def portal_number(value):
    return float(to_paise(Decimal(value or 0)))


def bucket():
    return dict.fromkeys(("taxable", *HEADS), ZERO)


def add_line(target, li):
    target["taxable"] += line_taxable(li)
    for h in HEADS:
        target[h] += to_paise(getattr(li, h) or ZERO)


def wire_figures(values):
    return {k: money(values[k]) for k in ("taxable", *HEADS)}


def portal_figures(values, interstate=None):
    heads = HEADS if interstate is None else (("igst",) if interstate else ("cgst", "sgst"))
    return {"txval": portal_number(values["taxable"]),
            **{ {"igst": "iamt", "cgst": "camt", "sgst": "samt"}[h]: portal_number(values[h]) for h in heads},
            "csamt": 0}


def period_header(business, year, month):
    return {"gstin": clean_gstin(business.gst_number), "fp": f"{month:02d}{year}",
            "version": "GST3.2.4", "hash": "hash"}


def gap_rows(docs, used):
    """Only actual holes, bounded text even when a mistyped counter is huge."""
    result = []
    for doc in docs:
        matches = [(key, lo, hi) for key, lo, _ in _readings(doc["from"])
                   for other, hi, _ in _readings(doc["to"]) if key == other and hi > lo]
        if not matches:
            continue
        key, lo, hi = max(matches, key=lambda row: row[2] - row[1])
        counters = sorted({n for number in used for k, n, _ in _readings(number)
                           if k == key and lo <= n <= hi})
        runs = [(a + 1, b - 1) for a, b in pairwise(counters) if b - a > 1]
        count = sum(b - a + 1 for a, b in runs)
        if not count:
            continue
        words = ", ".join(str(a) if a == b else f"{a}, {b}" if b == a + 1 else f"{a} to {b}"
                          for a, b in runs[:20])
        if len(runs) > 20:
            words += ", …"
        result.append({"from": doc["from"], "to": doc["to"], "count": count, "list": words})
    return result


def build_gstr1(business, year, month, *, amendments=True, month_builds=None, strict_amendments=False):
    """Return the shared books; month_builds is one business's request-local cache."""
    month_builds = {} if month_builds is None else month_builds
    if (year, month) in month_builds:
        built = month_builds[(year, month)]
        if not amendments:
            return deepcopy(built)
        from billing.services.filing import pending_amendments

        return attach_amendments(built, business, year, month,
                                 pending_amendments(business, year, month, month_builds=month_builds),
                                 month_builds=month_builds, strict=strict_amendments)
    first = date(year, month, 1)
    stop = date(year + month // 12, month % 12 + 1, 1)
    start_fy, end_fy = fy_range(fy_of(first))
    month_bills = Invoice.objects.sales().filter(business=business, invoice_date__gte=first, invoice_date__lt=stop)
    lines = uncached(LineItem).only(*LINE_FIELDS).order_by("id")
    invoices = list(month_bills.select_related("customer", "business").only(*BILL_FIELDS)
                    .prefetch_related(Prefetch("lineitem_set", queryset=lines, to_attr="gst_lines"))
                    .order_by("invoice_date", "id"))
    elsewhere = list(Invoice.objects.sales().filter(business=business, invoice_date__range=(start_fy, end_fy))
                     .exclude(invoice_date__gte=first, invoice_date__lt=stop)
                     .values_list("invoice_number", flat=True))
    bins = list(uncached(BinnedInvoice).live().filter(business=business, type_of_invoice="outward",
                                                    invoice_date__range=(start_fy, end_fy))
                .select_related("customer").only("original_id", "invoice_number", "invoice_date", "total_amount",
                                                "reason", "deleted_at", "customer__name").order_by("invoice_date", "id"))
    b2b_data, b2cl_data, b2cs_agg = {}, {}, {}
    hsn_agg = {"hsn_b2b": {}, "hsn_b2c": {}}
    nil, by_rate, snapshots = {}, {}, {}
    counts = {"b2b": 0, "b2cl": 0, "b2cs": 0}
    skipped, warnings, cancelled, live_numbers, void_numbers = [], [], [], [], []
    sections = {"b2b": [], "b2cl": [], "b2cs": [], "nil": [], "by_rate": [],
                "hsn": {"b2b": [], "b2c": []}, "docs": [], "docs_notes": [],
                "cancelled": cancelled, "amendments": {"b2ba": 0, "b2cla": 0, "b2csa": 0}}
    totals = bucket()
    descriptions = defaultdict(Counter)
    for inv in invoices:
        if inv.status != BILL_CANCELLED:
            for li in inv.gst_lines:
                descriptions[(li.hsn_code or "").strip()][(li.product_name or "").strip()] += 1
    for inv in invoices:
        if inv.status == BILL_CANCELLED:
            void_numbers.append(inv.invoice_number)
            cancelled.append({"bill": bill_ref(inv), "kind": "cancelled", "total": money(inv.total_amount),
                              "reason": inv.cancel_reason, "on": None})
            continue
        live_numbers.append(inv.invoice_number)
        label = f"{inv.invoice_number or '(no number)'} / {inv.invoice_date}"
        if not inv.invoice_number or not inv.invoice_date:
            skipped.append(f"{label}: missing invoice number or date")
            continue
        if not inv.gst_lines:
            skipped.append(f"{label}: no line items")
            continue
        table, _, pos, _ = classify_b2c(business, inv)
        inter = supply_interstate(inv)
        gstin = clean_gstin(inv.customer.gst_number)
        if gstin_problem(inv.customer.gst_number):
            warnings.append(f"{inv.invoice_number}: {inv.customer.name}'s GSTIN {inv.customer.gst_number.strip()} "
                            "isn't a GSTIN, so the sale is filed as B2C. Correct it on the customer.")
        agg, all_agg = {}, {}
        tab = hsn_agg["hsn_b2b" if gstin else "hsn_b2c"]
        for li in inv.gst_lines:
            rt = rate_as_percent(li.gst_tax_rate)
            add_line(all_agg.setdefault(rt, bucket()), li)
            add_line(totals, li)
            by = by_rate.setdefault(rt, {**bucket(), "ids": set()})
            add_line(by, li)
            by["ids"].add(inv.pk)
            if rt:
                add_line(agg.setdefault(rt, bucket()), li)
            else:
                supply = ("INTR" if inter else "INTRA") + ("B2B" if gstin else "B2C")
                n = nil.setdefault(supply, {"taxable": ZERO, "ids": set()})
                n["taxable"] += line_taxable(li)
                n["ids"].add(inv.pk)
            hsn = (li.hsn_code or "").strip()
            unit = (li.unit or "").strip().lower()
            uqc = uqc_for(unit, hsn)
            h = tab.setdefault((hsn, uqc, rt), {**bucket(), "quantity": ZERO, "ids": set()})
            add_line(h, li)
            h["quantity"] += filed_quantity(unit, li.quantity, hsn)
            h["ids"].add(inv.pk)
            if not hsn:
                warnings.append(f"{inv.invoice_number}: line '{li.product_name}' has no HSN")
        sums = {key: sum((row[key] for row in all_agg.values()), ZERO) for key in bucket()}
        snapshot = {**bill_ref(inv), "table": table, "gstin": gstin, "pos": pos, "interstate": inter,
                    "total": money(inv.total_amount), **wire_figures(sums),
                    "rates": [{"rate": percent(rt), **wire_figures(row)} for rt, row in sorted(all_agg.items())]}
        snapshot["hsn"] = [{"hsn": li.hsn_code or "", "unit": li.unit or "", "quantity": str(li.quantity),
                             "description": li.product_name or "", "rate": percent(rate_as_percent(li.gst_tax_rate)),
                             "taxable": money(line_taxable(li)),
                             **{head: money(to_paise(getattr(li, head) or ZERO)) for head in HEADS}}
                            for li in inv.gst_lines]
        snapshots[str(inv.pk)] = snapshot
        if not agg:
            continue
        counts[table] += 1
        itms = [{"num": i, "itm_det": {"rt": float(rt), **portal_figures(row, True if table == "b2cl" else None)}}
                for i, (rt, row) in enumerate(sorted(agg.items()), 1)]
        invoice = {"inum": inv.invoice_number, "idt": inv.invoice_date.strftime("%d-%m-%Y"),
                   "val": portal_number(inv.total_amount), "itms": itms}
        taxable = {key: sum((row[key] for row in agg.values()), ZERO) for key in bucket()}
        if table == "b2b":
            invoice.update(pos=pos, rchrg="N", inv_typ="R")
            b2b_data.setdefault(gstin, {"ctin": gstin, "inv": []})["inv"].append(invoice)
            sections["b2b"].append({"bill": bill_ref(inv),
                                    "customer": {"id": inv.customer_id, "name": inv.customer.name, "gst_number": gstin,
                                                 "state_code": state_code(inv.customer), "state_name": inv.customer.state_name},
                                    "place_of_supply": pos, "rates": [percent(rt) for rt in sorted(agg)],
                                    **wire_figures(taxable), "total": money(inv.total_amount)})
        elif table == "b2cl":
            b2cl_data.setdefault(pos, {"pos": pos, "inv": []})["inv"].append(invoice)
            sections["b2cl"].append({"bill": bill_ref(inv), "customer": {"id": inv.customer_id, "name": inv.customer.name},
                                     "place_of_supply": pos, "place_of_supply_name": GST_CODE.get(pos, ""),
                                     "total": money(inv.total_amount), "rates": [
                                         {"rate": percent(rt), "taxable": money(row["taxable"]), "igst": money(row["igst"])}
                                         for rt, row in sorted(agg.items())]})
        else:
            for rt, row in agg.items():
                target = b2cs_agg.setdefault((inter, pos, rt), {**bucket(), "ids": set()})
                for key in bucket():
                    target[key] += row[key]
                target["ids"].add(inv.pk)
                if (inter and (row["cgst"] or row["sgst"])) or (not inter and row["igst"]):
                    heads = "CGST/SGST" if inter else "IGST"
                    warnings.append(f"{label}: {'inter' if inter else 'intra'}-state supply carries {heads} — run fix_tax_heads")
    for b in bins:
        if first <= b.invoice_date < stop:
            void_numbers.append(b.invoice_number)
            cancelled.append({"bill": {"id": b.original_id, "bin_id": b.pk, "invoice_number": b.invoice_number,
                                      "invoice_date": b.invoice_date.isoformat(), "customer_name": b.customer.name,
                                      "status": "deleted"}, "kind": "deleted", "total": money(b.total_amount),
                              "reason": b.reason, "on": timezone.localdate(b.deleted_at).isoformat()})
        else:
            elsewhere.append(b.invoice_number)
    file_obj = period_header(business, year, month)
    if b2b_data:
        file_obj["b2b"] = list(b2b_data.values())
    if b2cl_data:
        file_obj["b2cl"] = list(b2cl_data.values())
    if b2cs_agg:
        file_obj["b2cs"] = []
        for (inter, pos, rt), row in sorted(b2cs_agg.items()):
            file_obj["b2cs"].append({"sply_ty": "INTER" if inter else "INTRA", "pos": pos, "typ": "OE",
                                     "rt": float(rt), **portal_figures(row, inter)})
            sections["b2cs"].append({"place_of_supply": pos, "place_of_supply_name": GST_CODE.get(pos, ""),
                                     "interstate": inter, "rate": percent(rt), "bills": len(row["ids"]), **wire_figures(row)})
    if nil:
        file_obj["nil"] = {"inv": [{"sply_ty": supply, "nil_amt": portal_number(row["taxable"]),
                                    "expt_amt": 0, "ngsup_amt": 0} for supply, row in sorted(nil.items())]}
        sections["nil"] = [{"supply": supply, "value": money(row["taxable"]), "bills": len(row["ids"])}
                           for supply, row in sorted(nil.items())]
    hsn_groups = {}
    for tab, rows in hsn_agg.items():
        for (hsn, uqc, rt), row in rows.items():
            description = hsn_description(hsn, descriptions=descriptions[hsn])
            hsn_groups[(tab, hsn, uqc, rt)] = {**row, "description": description}
    if hsn_groups:
        file_obj["hsn"] = _hsn_payload(hsn_groups, year, month)
        sections["hsn"] = _hsn_sections(file_obj["hsn"], hsn_groups, year, month)
    docs = document_series([n for n in live_numbers if n], elsewhere, [n for n in void_numbers if n])
    if docs:
        file_obj["doc_issue"] = {"doc_det": [{"doc_num": 1, "docs": docs}]}
    gaps = gap_rows(docs, [*live_numbers, *void_numbers, *elsewhere])
    for gap in gaps:
        warnings.append(f"{gap['from']} to {gap['to']}: {gap['count']} numbers aren't on any bill "
                        f"and go in as cancelled ({gap['list']}). If they're paper bills not entered yet, enter them before filing.")
    sections["docs"] = [{"from": r["from"], "to": r["to"], "total": r["totnum"],
                         "cancelled": r["cancel"], "net": r["net_issue"]} for r in docs]
    sections["docs_notes"] = [w for w in warnings if "numbers aren't on any bill" in w]
    if len(docs) > len(document_series(live_numbers, (), void_numbers)):
        sections["docs_notes"].insert(0, "Numbers used in another month of the year (a back-dated bill) "
                                      f"split the series into {len(docs)} rows, so nothing counts as cancelled twice.")
    sections["by_rate"] = [{"rate": percent(rt), **wire_figures(row), "tax": money(sum((row[h] for h in HEADS), ZERO)),
                            "value": money(sum((row[h] for h in HEADS), row["taxable"])), "bills": len(row["ids"])}
                           for rt, row in sorted(by_rate.items())]
    built = {"file": file_obj, "meta": {"business": business.name, "gstin": clean_gstin(business.gst_number),
                                      "fp": f"{month:02d}{year}", "invoice_counts": counts,
                                      "taxable_total": portal_number(totals["taxable"]),
                                      "skipped": skipped, "warnings": warnings},
            "sections": sections, "figures": {**wire_figures(totals), "bills": len(snapshots)},
            "bills": snapshots, "gaps": gaps}
    month_builds[(year, month)] = built
    if not amendments:
        return deepcopy(built)
    from billing.services.filing import pending_amendments

    return attach_amendments(built, business, year, month,
                             pending_amendments(business, year, month, month_builds=month_builds),
                             month_builds=month_builds, strict=strict_amendments)


def snapshots_equal(before, after):
    """Ignore newly captured money only when the older allocation is provable."""
    if not before or not after:
        return before == after
    if any(any(field not in item for field in bucket()) for item in before.get("hsn", [])):
        try:
            _snapshot_hsn(before)
        except ValidationError:
            # Equal bill/rate totals cannot prove equal HSN amounts: offsetting
            # line edits are invisible in a legacy snapshot with several groups.
            return False
    old, new = deepcopy(before), deepcopy(after)
    if len(old.get("hsn", [])) == len(new.get("hsn", [])):
        for previous, current in zip(old.get("hsn", []), new.get("hsn", []), strict=True):
            for key in bucket():
                if key not in previous:
                    current.pop(key, None)
    return old == new


def _amendment_refusal(snapshot, problem):
    number = snapshot.get("invoice_number") or "Bill without a number"
    raise ValidationError({"amendments": [(f"{number}: {problem}. Ask your CA to review this bill's "
                                          "correction on the GST portal before filing.")]},
                          code="unsupported_amendment")


def _hsn_payload(groups, year, month):
    """One combined HSN table until April 2025; GSTN's two tabs from May."""
    combined = {}
    for (tab, hsn, unit, rate), row in groups.items():
        key = (tab if (year, month) >= (2025, 5) else "data", hsn, unit, rate)
        target = combined.setdefault(key, {**bucket(), "quantity": ZERO, "description": row["description"]})
        for field in (*bucket(), "quantity"):
            target[field] += row[field]
    payload = {}
    for (tab, hsn, unit, rate), row in sorted(combined.items()):
        rows = payload.setdefault(tab, [])
        rows.append({"num": len(rows) + 1, "hsn_sc": hsn, "desc": row["description"][:30],
                     "uqc": unit, "qty": portal_number(row["quantity"]), "rt": float(rate), **portal_figures(row)})
    return payload


def _hsn_sections(payload, metadata, year, month):
    """Use the portal's actual grouped rows, retaining full descriptions and IDs."""
    combined = {}
    for (tab, code, unit, rate), row in metadata.items():
        key = (tab if (year, month) >= (2025, 5) else "data", code, unit, rate)
        target = combined.setdefault(key, {"description": row["description"], "ids": set()})
        target["ids"].update(row["ids"])
    result = {"b2b": [], "b2c": []}
    for tab, rows in payload.items():
        target = result.setdefault(tab.removeprefix("hsn_"), [])
        for row in rows:
            code, unit, rate = row["hsn_sc"], row["uqc"], Decimal(str(row["rt"]))
            info = combined[(tab, code, unit, rate)]
            target.append({"hsn": code, "description": info["description"], "uqc": unit,
                           "quantity": money(Decimal(str(row["qty"]))), "rate": percent(rate),
                           **{field: money(Decimal(str(row[portal]))) for field, portal in
                              (("taxable", "txval"), ("igst", "iamt"), ("cgst", "camt"), ("sgst", "samt"))},
                           "service": _is_service(code), "bills": len(info["ids"])})
    return result


def _snapshot_hsn(snapshot):
    """Frozen line amounts, or the only provable grouping for an older snapshot."""
    groups, incomplete = {}, set()
    rates = {Decimal(row["rate"]): row for row in snapshot["rates"]}
    if not snapshot.get("hsn"):
        _amendment_refusal(snapshot, "the filed snapshot has no HSN line details")
    for item in snapshot["hsn"]:
        code = (item.get("hsn") or "").strip()
        if not re.fullmatch(r"[0-9]{2,8}", code):
            _amendment_refusal(snapshot, "the correction has an HSN code the portal cannot accept")
        rate = Decimal(item["rate"])
        key = (code, uqc_for(item["unit"], code), rate)
        row = groups.setdefault(key, {**bucket(), "quantity": ZERO,
                                     "description": hsn_description(code, descriptions={item.get("description", ""): 1})})
        row["quantity"] += filed_quantity(item["unit"], Decimal(item["quantity"]), code)
        if all(field in item for field in bucket()):
            for field in bucket():
                row[field] += Decimal(item[field])
        else:
            incomplete.add(rate)
    for rate in incomplete:
        matches = [row for key, row in groups.items() if key[2] == rate]
        if len(matches) != 1 or rate not in rates:
            _amendment_refusal(snapshot, "the filed snapshot cannot separate the amounts between its HSN and unit groups")
        matches[0].update({field: Decimal(rates[rate][field]) for field in bucket()})
    return groups


def _supplement_changes(business, year, month, changes, month_builds):
    groups, nil = {}, defaultdict(lambda: ZERO)
    quantity_changes = defaultdict(lambda: [defaultdict(lambda: ZERO), defaultdict(lambda: ZERO)])
    changed_ids = defaultdict(set)

    def group_key(tab, code, unit, rate):
        return (tab if (year, month) >= (2025, 5) else "data", code, unit, rate)

    for change in changes:
        original = tuple(map(int, change["month"].split("-")))
        for sign, snapshot in ((-1, change["before"]), (1, change["after"])):
            if snapshot is None:
                continue
            changed_ids[original].add(str(snapshot["id"]))
            tab = "hsn_b2b" if snapshot["gstin"] else "hsn_b2c"
            for (code, unit, rate), row in _snapshot_hsn(snapshot).items():
                key = group_key(tab, code, unit, rate)
                target = groups.setdefault(key, {**bucket(), "quantity": ZERO, "description": row["description"]})
                for field in bucket():
                    target[field] += sign * row[field]
                target["description"] = row["description"]
                quantity_changes[original][0 if sign < 0 else 1][key] += row["quantity"]
            supply = ("INTR" if snapshot["interstate"] else "INTRA") + ("B2B" if snapshot["gstin"] else "B2C")
            nil[supply] += sign * sum((Decimal(row["taxable"]) for row in snapshot["rates"]
                                       if not Decimal(row["rate"])), ZERO)
    for original, (before, after) in quantity_changes.items():
        built = month_builds.get(original)
        if built is None:
            built = build_gstr1(business, *original, amendments=False, month_builds=month_builds)
        touched = set(before) | set(after)
        split_transition = original < (2025, 5) <= (year, month)
        families = {key[1:] for key in touched}
        # The portal rounds a whole HSN/rate/unit group. Unchanged bills determine
        # which side of a half-cent the group's quantity was on before correction.
        for invoice_id, snapshot in built["bills"].items():
            if invoice_id in changed_ids[original]:
                continue
            tab = "hsn_b2b" if snapshot["gstin"] else "hsn_b2c"
            for item in snapshot["hsn"]:
                code = (item["hsn"] or "").strip()
                key = group_key(tab, code, uqc_for(item["unit"], code), Decimal(item["rate"]))
                if key in touched or (split_transition and key[1:] in families):
                    quantity = filed_quantity(item["unit"], Decimal(item["quantity"]), code)
                    before[key] += quantity
                    after[key] += quantity
        if split_transition:
            for family in families:
                keys = {key for key in set(before) | set(after) if key[1:] == family}
                split_delta = sum((to_paise(after[key]) - to_paise(before[key]) for key in keys), ZERO)
                combined_delta = (to_paise(sum((after[key] for key in keys), ZERO)) -
                                  to_paise(sum((before[key] for key in keys), ZERO)))
                if split_delta != combined_delta:
                    source = next(snapshot for change in changes
                                  if tuple(map(int, change["month"].split("-"))) == original
                                  for snapshot in (change["before"], change["after"])
                                  if snapshot and family in _snapshot_hsn(snapshot))
                    _amendment_refusal(source, "the original combined HSN quantity rounding cannot be allocated "
                                       "to the portal's separate B2B and B2C tables")
        for key in touched:
            groups[key]["quantity"] += to_paise(after[key]) - to_paise(before[key])
    return ({key: row for key, row in groups.items() if any(row[field] for field in (*bucket(), "quantity"))},
            {key: amount for key, amount in nil.items() if amount})


def attach_amendments(built, business, year, month, changes, *, month_builds=None, strict=False, today=None):
    """Attach carried tables to a copy; a page may show an error that blocks export.

    today is the carrying GSTR-1's filing day when it is being recorded (R3A-7).
    """
    result = deepcopy(built)
    today = today or timezone.localdate()
    changes = _exportable_changes(changes, today)
    try:
        extra = build_amendments(business, year, month, changes, month_builds=month_builds, today=today)
    except ValidationError as exc:
        if strict:
            raise
        result["meta"]["amendment_errors"] = [str(item) for item in exc.detail["amendments"]]
        return result
    file_obj = result["file"]
    for section, rows in extra.items():
        if section in ("gstin", "fp", "version", "hash"):
            continue
        if section in ("b2b", "b2cl"):
            key = "ctin" if section == "b2b" else "pos"
            groups = {row[key]: row for row in file_obj.get(section, [])}
            for row in rows:
                groups.setdefault(row[key], {key: row[key], "inv": []})["inv"].extend(row["inv"])
            file_obj[section] = list(groups.values())
        elif section == "nil":
            groups = {row["sply_ty"]: row for row in file_obj.get("nil", {}).get("inv", [])}
            for row in rows["inv"]:
                target = groups.setdefault(row["sply_ty"], {"sply_ty": row["sply_ty"], "nil_amt": 0,
                                                            "expt_amt": 0, "ngsup_amt": 0})
                for field in ("nil_amt", "expt_amt", "ngsup_amt"):
                    target[field] = portal_number(Decimal(str(target[field])) + Decimal(str(row[field])))
            file_obj["nil"] = {"inv": list(groups.values())}
        elif section == "hsn":
            target = file_obj.setdefault("hsn", {})
            for tab, items in rows.items():
                groups = {(row["hsn_sc"], row["uqc"], row["rt"]): row for row in target.get(tab, [])}
                for row in items:
                    key = (row["hsn_sc"], row["uqc"], row["rt"])
                    if key not in groups:
                        groups[key] = row
                    else:
                        for field in ("qty", "txval", "iamt", "camt", "samt", "csamt"):
                            groups[key][field] = portal_number(Decimal(str(groups[key][field])) + Decimal(str(row[field])))
                target[tab] = [{**row, "num": i} for i, row in enumerate(groups.values(), 1)]
        else:
            file_obj.setdefault(section, []).extend(rows)
        if section in result["sections"]["amendments"]:
            result["sections"]["amendments"][section] = sum(len(row.get("inv", [row])) for row in rows)
    if "hsn" in extra or "nil" in extra:
        _sync_supplement_sections(result, changes, year, month)
    return result


def _sync_supplement_sections(built, changes, year, month):
    """Count distinct contributors, including negative corrections, without reads."""
    metadata, nil_ids = {}, defaultdict(set)

    def key_for(snapshot, code, unit, rate):
        tab = "hsn_b2b" if snapshot["gstin"] else "hsn_b2c"
        return (tab if (year, month) >= (2025, 5) else "data", code, unit, rate)

    def supply_for(snapshot):
        return ("INTR" if snapshot["interstate"] else "INTRA") + ("B2B" if snapshot["gstin"] else "B2C")

    # Keep the period's established full description when a correction joins it.
    descriptions = {row["hsn"]: row["description"] for rows in built["sections"]["hsn"].values() for row in rows}
    for snapshot in built["bills"].values():
        for item in snapshot["hsn"]:
            code = (item["hsn"] or "").strip()
            key = key_for(snapshot, code, uqc_for(item["unit"], code), Decimal(item["rate"]))
            metadata.setdefault(key, {"description": descriptions[code], "ids": set()})["ids"].add(str(snapshot["id"]))
        if any(not Decimal(row["rate"]) for row in snapshot["rates"]):
            nil_ids[supply_for(snapshot)].add(str(snapshot["id"]))
    for change in changes:
        delta, nil_delta = {}, defaultdict(lambda: ZERO)
        for sign, snapshot in ((-1, change["before"]), (1, change["after"])):
            if snapshot is None:
                continue
            for (code, unit, rate), row in _snapshot_hsn(snapshot).items():
                key = key_for(snapshot, code, unit, rate)
                info = metadata.setdefault(key, {"description": row["description"], "ids": set()})
                target = delta.setdefault(key, {**bucket(), "quantity": ZERO, "ids": set()})
                target["ids"].add(str(snapshot["id"]))
                for field in (*bucket(), "quantity"):
                    target[field] += sign * row[field]
                if code not in descriptions:
                    info["description"] = row["description"]
            nil_delta[supply_for(snapshot)] += sign * sum((Decimal(row["taxable"]) for row in snapshot["rates"]
                                                            if not Decimal(row["rate"])), ZERO)
        for key, row in delta.items():
            if any(row[field] for field in (*bucket(), "quantity")):
                metadata[key]["ids"].update(row["ids"])
        for supply, amount in nil_delta.items():
            if amount:
                nil_ids[supply].update(str(snapshot["id"]) for snapshot in (change["before"], change["after"])
                                       if snapshot and supply_for(snapshot) == supply)
    built["sections"]["hsn"] = _hsn_sections(built["file"].get("hsn", {}), metadata, year, month)
    built["sections"]["nil"] = [{"supply": row["sply_ty"], "value": money(Decimal(str(row["nil_amt"]))),
                                  "bills": len(nil_ids[row["sply_ty"]])}
                                 for row in built["file"].get("nil", {}).get("inv", [])]


def _exportable_changes(changes, today):
    return [change for change in changes if not snapshots_equal(change["before"], change["after"]) and
            today <= date(fy_of(date.fromisoformat(change["month"] + "-01")) + 1, 11, 30)]


def _snapshot_invoice(snapshot, zero=False):
    table = snapshot["table"]
    rows = []
    for rate in snapshot["rates"]:
        if not Decimal(rate["rate"]):
            continue
        values = {key: ZERO if zero else Decimal(rate[key]) for key in bucket()}
        rows.append({"num": len(rows) + 1, "itm_det": {"rt": float(Decimal(rate["rate"])),
                                                      **portal_figures(values, True if table == "b2cl" else None)}})
    result = {"inum": snapshot["invoice_number"], "idt": date.fromisoformat(snapshot["invoice_date"]).strftime("%d-%m-%Y"),
              "val": 0 if zero else portal_number(snapshot["total"]), "itms": rows}
    if table == "b2b":
        result.update(pos=snapshot["pos"], rchrg="N", inv_typ="R")
    return result


def build_amendments(business, year, month, changes, before_gstr3b=False, today=None, *, month_builds=None):
    """Emit amended invoice records and restated original-month B2CS groups.

    Each change is {month, before, after}; snapshots are build_gstr1()['bills']
    values. A null after means cancelled/deleted. The entire current B2CS row
    is read for touched places/rates, because amendment values are replacements.
    """
    today = today or timezone.localdate()
    month_builds = {} if month_builds is None else month_builds
    result = period_header(business, year, month)
    changes = _exportable_changes(changes, today)
    hsn, nil = _supplement_changes(business, year, month, changes, month_builds)
    if hsn:
        result["hsn"] = _hsn_payload(hsn, year, month)
    if nil:
        result["nil"] = {"inv": [{"sply_ty": supply, "nil_amt": portal_number(value), "expt_amt": 0,
                                    "ngsup_amt": 0} for supply, value in sorted(nil.items())]}
    grouped = defaultdict(dict)
    touched = defaultdict(set)
    for change in changes:
        original = date.fromisoformat(change["month"] + "-01")
        if today > date(fy_of(original) + 1, 11, 30):
            continue
        before, after = change["before"], change["after"]
        if before == after:
            continue
        for snap in (before, after):
            if snap and snap["table"] == "b2cs":
                for rate in snap["rates"]:
                    if Decimal(rate["rate"]):
                        touched[change["month"]].add((snap["interstate"], snap["pos"], rate["rate"]))
        source = before or after
        # A nil-only bill belongs in Table 8, never an invoice with empty itms.
        before_taxable = before and any(Decimal(row["rate"]) for row in before["rates"])
        after_taxable = after and any(Decimal(row["rate"]) for row in after["rates"])
        if not before_taxable and not after_taxable:
            continue
        if not before_taxable:
            before, source = None, after
        elif not after_taxable:
            after = None
        if source["table"] == "b2cs":
            if after and after["table"] != "b2cs":
                section = after["table"]
                group_key = after["gstin"] if section == "b2b" else after["pos"]
                grouped[section].setdefault(group_key, []).append(_snapshot_invoice(after))
            continue
        same_group = after and after["table"] == source["table"] and (
            after["gstin"] == source["gstin"] if source["table"] == "b2b" else after["pos"] == source["pos"])
        corrected = after if same_group else source
        section = source["table"] if before_gstr3b or before is None else source["table"] + "a"
        row = _snapshot_invoice(corrected, zero=not same_group and before is not None)
        if section.endswith("a"):
            row.update(oinum=before["invoice_number"],
                       oidt=date.fromisoformat(before["invoice_date"]).strftime("%d-%m-%Y"))
        group_key = source["gstin"] if source["table"] == "b2b" else source["pos"]
        grouped[section].setdefault(group_key, []).append(row)
        if after and not same_group and before is not None and after["table"] != "b2cs":
            key = after["gstin"] if after["table"] == "b2b" else after["pos"]
            grouped[after["table"]].setdefault(key, []).append(_snapshot_invoice(after))
    for section, groups in grouped.items():
        result[section] = [{("ctin" if section.startswith("b2b") else "pos"): key, "inv": rows}
                           for key, rows in sorted(groups.items())]
    b2csa_groups = {}
    for original, keys in sorted(touched.items()):
        y, m = map(int, original.split("-"))
        built = (month_builds or {}).get((y, m))
        if built is None:
            built = build_gstr1(business, y, m, amendments=False, month_builds=month_builds)
        current = built["file"].get("b2cs", [])
        rows = {(r["sply_ty"] == "INTER", r["pos"], percent(Decimal(str(r["rt"])))): r for r in current}
        for inter, pos, rate in sorted(keys):
            row = deepcopy(rows.get((inter, pos, rate), {
                "sply_ty": "INTER" if inter else "INTRA", "pos": pos, "typ": "OE",
                "rt": float(Decimal(rate)), **portal_figures(bucket(), inter)}))
            if before_gstr3b:
                result.setdefault("b2cs", []).append(row)
            else:
                detail = {k: v for k, v in row.items() if k not in ("sply_ty", "pos", "typ")}
                b2csa_groups.setdefault((original, inter, pos), {
                    "omon": f"{m:02d}{y}", "sply_ty": row["sply_ty"], "pos": pos, "typ": "OE", "itms": []
                })["itms"].append(detail)
    if b2csa_groups:
        result["b2csa"] = list(b2csa_groups.values())
    return result


def build_gstr1a(business, year, month):
    """The same-month corrections file, sourced from the latest filed baseline."""
    from billing.services.filing import changes_for_month

    month_builds = {}
    changes = changes_for_month(business, year, month, month_builds=month_builds)
    return build_amendments(business, year, month, changes, before_gstr3b=True, month_builds=month_builds)
