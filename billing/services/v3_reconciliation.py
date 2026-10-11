"""v3 reconciliation response over the existing Decimal rollup/check engine."""
from decimal import Decimal

from django.utils import timezone

from billing.fy import fy_range, parse_fy
from billing.reconciliation import PERIODS, quarter_of, rollup
from billing.reconciliation import _check as old_check
from billing.reconciliation import reconcile as old_reconcile
from billing.services.v3_reports import (
    COLUMNS,
    ZERO,
    _active,
    _dated,
    amounts,
    months_between,
    payment_split,
    reconciliation_rows,
    wire,
)
from billing.tax_rules import HEADS, to_paise
from billing.text import money, percent

QUARTERS = ("Apr to Jun", "Jul to Sep", "Oct to Dec", "Jan to Mar")


def _cell(cell, bills):
    return {**{key: getattr(cell, key) for key in COLUMNS}, "bills": bills}


def _totals(rows):
    return {key: sum((Decimal(str(row.get(key, 0))) for row in rows if row is not None), ZERO) for key in COLUMNS} | {
        "bills": sum(row.get("bills", 0) for row in rows if row is not None),
    }


def _check(key, label, period, expected, actual, *, tolerance=Decimal("1"), link=None):
    check = old_check(key, label, period, to_paise(expected), to_paise(actual))
    status = check.status
    if check.difference and abs(check.difference) <= tolerance:
        status = "rounding"
    return {"id": check.id, "label": check.label, "period": check.period, "expected": money(check.expected), "actual": money(check.actual),
            "diff": money(check.difference), "status": status, "link": link}


def reconcile(business_id, fy, sales, *, filed=None, stages=None, amendments=None, split=False, today=None):
    """Snapshot inputs are keyed YYYY-MM; gstr1 is the latest amended as-filed totals."""
    filed, stages, amendments = filed or {}, stages or {}, amendments or {}
    today = today or timezone.localdate()
    start, end = fy_range(parse_fy(fy))
    sales = [bill for bill in _active(_dated(sales, start, min(end, today))) if bill["business"]["id"] == business_id]
    legacy_rows = reconciliation_rows(sales)
    # The shared classifier already picked the sections when the register was read.
    for bill, row in zip(sales, legacy_rows, strict=True):
        row["customer_gstin"] = bill["customer"]["gst_number"] if bill["section"] == "b2b" else ""
    legacy = old_reconcile(fy, legacy_rows)
    large = rollup([row for bill, row in zip(sales, legacy_rows, strict=True) if bill["section"] == "b2cl"])
    all_months = list(months_between(start, end))
    sections, periods, checks = [], [], []
    numeric = {}
    for index, period in enumerate(PERIODS):
        key = f"q{period}" if period != "FY" else "fy"
        months = all_months[index * 3:index * 3 + 3] if period != "FY" else all_months
        label = f"{QUARTERS[index]} {months[-1][:4]}" if period != "FY" else f"FY {fy}"
        selected = [bill for bill in sales if period == "FY" or quarter_of(bill["date"]) == period]
        section = {"all": _cell(legacy.rollup["gstr3b"][period], len(selected)),
                   "b2b": _cell(legacy.rollup["b2b"][period], sum(bill["section"] == "b2b" for bill in selected)),
                   "b2cl": _cell(large.rollup["gstr3b"][period], sum(bill["section"] == "b2cl" for bill in selected))}
        small = legacy.rollup["b2c"][period]
        section["b2c"] = {column: getattr(small, column) - section["b2cl"][column] for column in COLUMNS}
        section["b2c"]["bills"] = sum(bill["section"] == "b2cs" for bill in selected)
        numeric[key] = section
        sections.append({"key": key, **{section_key: wire(value) for section_key, value in section.items()},
                         "adds_up": all(section["all"][column] == sum((section[name][column] for name in ("b2b", "b2cl", "b2c")), ZERO) for column in (*COLUMNS, "bills"))})
        so_far = {"from": months[0] + "-01", "to": today.isoformat()} if today.strftime("%Y-%m") in months else None
        periods.append({"key": key, "label": label, "months": months, "so_far": so_far})
        for column in COLUMNS:
            word = "taxable value" if column == "taxable" else column.upper()
            checks.append(_check(f"split-{column}", f"B2B + B2CL + B2C {word} = GSTR-3B {word}", label,
                                 section["all"][column], sum((section[name][column] for name in ("b2b", "b2cl", "b2c")), ZERO)))
        line_count = sum(len(bill["lines"]) for bill in selected)
        tolerance = max(Decimal("1"), Decimal("0.01") * line_count)
        for rate, cell in sorted(legacy.rate_buckets[period].items()):
            pct = percent(rate)
            checks.append(_check(f"rate-{pct}", f"Tax at {pct}% = taxable value × {pct}%", label,
                                 to_paise(cell.taxable * rate), sum((getattr(cell, head) for head in HEADS), ZERO), tolerance=tolerance,
                                 link={"to": f"/sales?gst_rate={pct}", "label": "Open these bills"}))
        counts = legacy.invoice_counts[period]
        empty = counts["empty"]
        empty_words = f"; {empty} {'bill' if empty == 1 else 'bills'} with no items" if empty else ""
        checks.append(_check("coverage", f"Bills counted: {counts['rolled']} of {counts['in']}{empty_words}", label,
                             Decimal(counts["in"]), Decimal(counts["rolled"] + empty),
                             link={"to": "/sales?empty=1", "label": "Open bills with no items"} if empty else None))
    for section in ("all", "b2b", "b2cl", "b2c"):
        for column in COLUMNS:
            label = "GSTR-3B · all sales" if section == "all" else section.upper()
            word = "taxable value" if column == "taxable" else column.upper()
            checks.append(_check(f"qsum-{section}-{column}", f"Quarters add up to the year ({label} {word})", f"FY {fy}",
                                 numeric["fy"][section][column], sum((numeric[f"q{q}"][section][column] for q in range(1, 5)), ZERO)))
    modes = payment_split(sales) if split else []
    if split:
        total = amounts(sales)
        checks.extend([
            _check("mode-value", "Payment modes add up to the bill value (taxable value + GST)", f"FY {fy}", total["taxable"] + total["tax"], sum((Decimal(row["value"]) for row in modes), ZERO)),
            _check("mode-taxable", "Payment modes add up to the taxable value", f"FY {fy}", total["taxable"], sum((Decimal(row["taxable"]) for row in modes), ZERO)),
        ])
    month_rows = []
    for month in all_months:
        if month > today.strftime("%Y-%m"):
            continue
        raw = amounts([bill for bill in sales if bill["date"].strftime("%Y-%m") == month])
        books = {key: raw[key] for key in (*COLUMNS, "bills")}
        snapshot = filed.get(month, {})
        gstr1, gstr3b = snapshot.get("gstr1"), snapshot.get("gstr3b")
        diff = {column: books[column] - Decimal(str(gstr1[column])) for column in COLUMNS} | {"bills": books["bills"] - gstr1["bills"]} if gstr1 is not None else None
        default_stage = "filed" if gstr3b else "gstr1" if gstr1 else "open" if month == today.strftime("%Y-%m") else "ready"
        month_rows.append({"month": month, "stage": stages.get(month, default_stage), "books": wire(books),
                           "gstr1": wire(_totals([gstr1])) if gstr1 is not None else None,
                           "gstr3b": {head: money(Decimal(str(gstr3b[head]))) for head in HEADS} if gstr3b is not None else None,
                           "diff": wire(diff) if diff is not None else None, "differs": bool(diff and any(diff.values())), "amended_in": amendments.get(month)})
    for period in periods:
        rows = [row for row in month_rows if row["month"] in period["months"]]
        period.update({key: wire(_totals([row[key] for row in rows])) for key in ("books", "gstr1", "gstr3b", "diff")})
        period.update(filed_months=sum(row["gstr1"] is not None for row in rows), differs=[row["month"] for row in rows if row["differs"]])
    return {"business": business_id, "fy": fy, "filed": month_rows, "periods": periods, "sections": sections, "checks": checks, "split": modes,
            "differs": [row["month"] for row in month_rows if row["differs"]],
            "failing": sum(check["status"] == "fail" for check in checks), "roundings": sum(check["status"] == "rounding" for check in checks)}
