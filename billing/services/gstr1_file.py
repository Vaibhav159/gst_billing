"""The existing portal builder, shared by v2, GST screens and filing snapshots.

Arithmetic stays Decimal until the portal's numeric JSON boundary. The same rate
buckets feed the file, its table view, and immutable per-bill filing snapshots.
"""

from collections import Counter, defaultdict
from copy import deepcopy
from datetime import date
from decimal import Decimal
from itertools import pairwise

from django.db.models import Count, Prefetch
from django.db.models.functions import Trim
from django.utils import timezone

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


def build_gstr1(business, year, month, *, amendments=True):
    """Return file/meta (v2), sections (§3.2), figures and per-id bill snapshots."""
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
                             "description": li.product_name or "", "rate": percent(rate_as_percent(li.gst_tax_rate))}
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
    hsn_tabs = {}
    for tab, rows in hsn_agg.items():
        if not rows:
            continue
        hsn_tabs[tab] = []
        for i, ((hsn, uqc, rt), row) in enumerate(rows.items(), 1):
            qty = portal_number(row["quantity"])
            description = hsn_description(hsn, descriptions=descriptions[hsn])
            hsn_tabs[tab].append({"num": i, "hsn_sc": hsn, "desc": description[:30], "uqc": uqc,
                                  "qty": qty, "rt": float(rt), **portal_figures(row)})
            sections["hsn"][tab.removeprefix("hsn_")].append({
                "hsn": hsn, "description": description,
                "uqc": uqc, "quantity": f"{Decimal(str(qty)):.3f}", "rate": percent(rt),
                **wire_figures(row), "service": _is_service(hsn), "bills": len(row["ids"])})
    if hsn_tabs:
        file_obj["hsn"] = hsn_tabs
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
    if amendments:
        from billing.services.filing import pending_amendments

        changes = pending_amendments(business, year, month)
        extra = build_amendments(business, year, month, changes)
        for section, rows in extra.items():
            if section in ("gstin", "fp", "version", "hash"):
                continue
            if section in ("b2b", "b2cl"):
                key = "ctin" if section == "b2b" else "pos"
                groups = {r[key]: r for r in file_obj.get(section, [])}
                for row in rows:
                    groups.setdefault(row[key], {key: row[key], "inv": []})["inv"].extend(row["inv"])
                file_obj[section] = list(groups.values())
            else:
                file_obj.setdefault(section, []).extend(rows)
            if section in sections["amendments"]:
                sections["amendments"][section] = sum(len(row.get("inv", [row])) for row in rows)
    return {"file": file_obj, "meta": {"business": business.name, "gstin": clean_gstin(business.gst_number),
                                      "fp": f"{month:02d}{year}", "invoice_counts": counts,
                                      "taxable_total": portal_number(totals["taxable"]),
                                      "skipped": skipped, "warnings": warnings},
            "sections": sections, "figures": {**wire_figures(totals), "bills": len(snapshots)},
            "bills": snapshots, "gaps": gaps}


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


def build_amendments(business, year, month, changes, before_gstr3b=False, today=None):
    """Emit amended invoice records and restated original-month B2CS groups.

    Each change is {month, before, after}; snapshots are build_gstr1()['bills']
    values. A null after means cancelled/deleted. The entire current B2CS row
    is read for touched places/rates, because amendment values are replacements.
    """
    today = today or timezone.localdate()
    result = period_header(business, year, month)
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
        current = build_gstr1(business, y, m, amendments=False)["file"].get("b2cs", [])
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

    return build_amendments(business, year, month, changes_for_month(business, year, month), before_gstr3b=True)
