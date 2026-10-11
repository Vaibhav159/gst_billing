"""Read models for GST month and year pages; no polling or writes."""

from calendar import monthrange
from datetime import date, datetime, timedelta
from decimal import Decimal

from django.db.models import F
from django.utils import timezone

from billing.cache import uncached
from billing.fy import due_dates, fy_label, fy_of
from billing.models import Business, FilingMonth, FilingRecord, Invoice
from billing.period_lock import month_status
from billing.tax_rules import state_code
from billing.text import day_text, money, stamp


def wire(value):
    if isinstance(value, Decimal):
        return money(value)
    if isinstance(value, dict):
        return {key: wire(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [wire(item) for item in value]
    if isinstance(value, datetime):
        return stamp(value)
    if isinstance(value, date):
        return value.isoformat()
    return value


def due(month):
    values = due_dates(month.year, month.month)
    return {**{key: value.isoformat() for key, value in values.items()},
            "file_from": values["gstr1"].replace(day=1).isoformat()}


def firm_ref(business):
    return {"id": business.pk, "name": business.name, "short": business.name.split()[0].title(),
            "gst_number": business.gst_number or "", "state_code": state_code(business)}


def file_block(month, checks, today=None):
    today = today or timezone.localdate()
    if month >= today.replace(day=1):
        return f'{month:%B} is still running. The file can be made from {day_text(due_dates(month.year, month.month)["gstr1"].replace(day=1))}.'
    if not checks["blockers"]:
        return ""
    blocker = checks["blockers"][0]
    if blocker["kind"] == "duplicate":
        number = blocker["bills"][0]["invoice_number"]
        return f"Two bills share {number}. A bill number can be used once a year (CGST Rule 46), and Documents issued wouldn't add up. Renumber one, then download the file."
    return {
        "gstin": "A business customer has no GSTIN, so the bill can't go in B2B. Add the GSTIN, then download the file.",
        "badgstin": "A customer's GSTIN fails its check character, so the portal would refuse the bill. Correct it, then download the file.",
        "empty": "A bill has no items. Add them or cancel the bill, then download the file.",
        "hsn": "A line has no HSN code, and the HSN summary needs one on every line. Add it, then download the file.",
        "state": "A bill's place of supply isn't a known state. Fix the bill, then download the file.",
        "head": "A bill charges the wrong kind of tax for its place of supply. Fix the bill, then download the file.",
    }[blocker["kind"]]


def year_read(business, fy, today=None):
    from billing.services.filing import month_stages
    from billing.services.gst_checks import gstr1_blockers

    today = today or timezone.localdate()
    result = {"business": business.pk, "fy": fy_label(fy), "first_fy": "2025-26",
              "has_records": fy >= 2025, "months": [], "default_month": None}
    if fy < 2025:
        return result
    days = [date(fy + (m < 4), m, 1) for m in (*range(4, 13), 1, 2, 3)]
    keys = [day.strftime("%Y-%m") for day in days]
    stages = month_stages([business.pk], keys, today=today)["stages"]
    records = list(uncached(FilingRecord).filter(business_id=business.pk, year__in=(fy, fy + 1)).values(
        "year", "month", "kind", "filed_on"))
    filed = {(row["year"], row["month"], row["kind"]): row["filed_on"] for row in records}
    unlocked = {(row["year"], row["month"]): row["unlocked_at"] for row in uncached(FilingMonth).filter(
        business_id=business.pk, year__in=(fy, fy + 1), unlocked_at__isnull=False
    ).values("year", "month", "unlocked_at")}
    check_keys = [key for key in keys if key <= today.strftime("%Y-%m") and stages[business.pk, key] in ("open", "ready", "blocked", "unlocked")]
    blockers = gstr1_blockers([business.pk], check_keys) if check_keys else {}
    to_confirm = {}
    if any(field.name == "needs_review" for field in Invoice._meta.fields):
        from django.db.models import Count, Q

        from billing.services.ledger import _purchase_lines
        purchases = _purchase_lines(business).filter(invoice__needs_review=True, lapsed=False).filter(
            Q(igst__gt=0) | Q(cgst__gt=0) | Q(sgst__gt=0))
        to_confirm = {row["credit_month"].strftime("%Y-%m"): row["count"] for row in purchases.filter(
            credit_month__gte=date(fy, 4, 1), credit_month__lt=date(fy + 1, 4, 1)
        ).values("credit_month").annotate(count=Count("invoice_id", distinct=True))}
    for day, key in zip(days, keys, strict=True):
        result["months"].append({"month": key, "stage": stages[business.pk, key], "due": due(day),
            "gstr1_filed_on": filed.get((day.year, day.month, "gstr1")),
            "gstr3b_filed_on": filed.get((day.year, day.month, "gstr3b")),
            "blockers": blockers.get((business.pk, key), {}).get("count", 0), "to_confirm": to_confirm.get(key, 0),
            "unlocked_on": unlocked.get((day.year, day.month))})
    past = [item for item in result["months"] if item["month"] < today.strftime("%Y-%m")]
    work = next((item["month"] for item in past if item["stage"] in ("blocked", "unlocked", "ready", "gstr1")), None)
    result["default_month"] = work or (past[-1]["month"] if past else today.strftime("%Y-%m"))
    return wire(result)


def month_read(business, month, today=None):
    today = today or timezone.localdate()
    base = {"business": business.pk, "firm": firm_ref(business), "month": month.strftime("%Y-%m"),
            "fy": fy_label(fy_of(month)), "stage": "future", "due": due(month), "running": None,
            "record": None, "late": None, "checks": {"blockers": [], "notes": [], "passes": []},
            "gstr1": None, "gstr3b": None, "since_filing": None, "amendments": None,
            "amended_in": None, "download": None, "prev_gstr3b_missing": None}
    if month > today.replace(day=1):
        return base
    from billing.services.filing import (
        amendment_plan,
        changes_for_month,
        changes_since_filing,
        month_record,
        pending_amendments,
    )
    from billing.services.gst_checks import month_checks
    from billing.services.gst_downloads import download_state, file_name
    from billing.services.gstr1_file import attach_amendments, build_gstr1
    from billing.services.ledger import gstr3b_tables, month_position

    status = month_status(business.pk, month.year, month.month, include_checks=False)
    month_builds = {}
    own = build_gstr1(business, month.year, month.month, amendments=False, month_builds=month_builds)
    checks = month_checks(business, month.year, month.month, built=own)
    changes = changes_for_month(business, month.year, month.month, built=own, month_builds=month_builds)
    since = changes_since_filing(business, month.year, month.month, changes=changes)
    amend = amendment_plan(business, month.year, month.month, changes=since)
    carried = pending_amendments(business, month.year, month.month, month_builds=month_builds)
    built = attach_amendments(own, business, month.year, month.month, carried, month_builds=month_builds)
    position = month_position(business, month.year, month.month, today=today)
    tables = gstr3b_tables(business, month.year, month.month, today=today, position=position)
    record = month_record(business.pk, month.year, month.month)
    stage = status.stage
    if stage not in ("filed", "gstr1", "unlocked"):
        stage = "open" if month == today.replace(day=1) else "blocked" if checks["blockers"] else "ready"
    figures, sections, meta = built["figures"], built["sections"], built["meta"]
    tax = sum(Decimal(figures[key]) for key in ("igst", "cgst", "sgst"))
    cancelled = sections["cancelled"]
    why = file_block(month, checks, today) or next(iter(meta.get("amendment_errors", [])), "")
    original = uncached(FilingRecord).filter(business_id=business.pk, year=month.year, month=month.month,
        kind__in=("gstr1", "gstr1a")).annotate(**{"_" + key: F("figures__" + key)
            for key in ("bills", "taxable", "igst", "cgst", "sgst")}).values(
                "_bills", "_taxable", "_igst", "_cgst", "_sgst", "marked_at").order_by("kind").last()
    as_filed = None
    if original:
        as_filed = {"bills": original["_bills"] or 0, "taxable": original["_taxable"] or "0.00",
                    "tax": money(sum(Decimal(original["_" + key] or "0.00") for key in ("igst", "cgst", "sgst"))),
                    "at": stamp(original["marked_at"])}
    before = (month - timedelta(days=1)).replace(day=1)
    previous_missing = None
    if not status.gstr1 and before >= date(2025, 4, 1):
        previous_status = month_status(business.pk, before.year, before.month, include_checks=False)
        if not (previous_status.gstr3b or previous_status.legacy):
            previous_missing = before.strftime("%Y-%m")
    base.update({"stage": stage, "running": {"from": month.isoformat(), "to": min(today, month.replace(day=monthrange(month.year, month.month)[1])).isoformat()},
        "record": record, "checks": checks, "late": tables.get("late"),
        "gstr1": {**figures, "tax": money(tax), "total": money(sum(Decimal(row["total"]) for row in built["bills"].values())),
            "cancelled": sum(row["kind"] == "cancelled" for row in cancelled), "deleted": sum(row["kind"] == "deleted" for row in cancelled),
            "file": {"name": file_name(business, month), "b2b": meta["invoice_counts"]["b2b"], "b2cl": meta["invoice_counts"]["b2cl"],
                "b2cs_rows": len(sections["b2cs"]), "b2cs_bills": meta["invoice_counts"]["b2cs"], "nil": len(sections["nil"]),
                "hsn": sum(len(rows) for rows in sections["hsn"].values()), "docs": len(sections["docs"]),
                "amendments": sum(sections["amendments"].values()), "made": not why, "why_not": why}, "as_filed": as_filed},
        "gstr3b": {key: position[key] for key in ("output", "credit", "carry_in", "cash", "carry_on", "used", "amendments_in", "filed")},
        "since_filing": since, "amendments": amend,
        "amended_in": amend["carried_by"] if amend and amend["rows"] else None,
        "download": download_state(business, month, built["file"]),
        "prev_gstr3b_missing": previous_missing})
    base["gstr3b"].update({"late_bills": len(tables["t4a5"]["late"]), "to_confirm": len(tables["to_confirm"]),
                         "opening_missing": tables["opening_missing"]})
    return wire(base)


def month_end_read(month, today=None):
    from billing.api.gst_input import FIRM_FIELDS
    firms = []
    for business in uncached(Business).only(*FIRM_FIELDS).order_by("name", "id"):
        item = month_read(business, month, today=today)
        record, download = item["record"], item["download"]
        paid = record["gstr3b"]
        stage = item["stage"]
        next_step = "open"
        if stage == "unlocked":
            next_step = "amend" if item["since_filing"] else "relock"
        elif stage == "gstr1":
            next_step = "mark3b"
        elif stage in ("blocked", "ready"):
            next_step = "fix" if item["checks"]["blockers"] else "download" if not download or download["stale"] else "mark1"
        firms.append({"firm": item["firm"], "stage": stage, "record": record,
            "first_blocker": next(iter(item["checks"]["blockers"]), None), "blockers": len(item["checks"]["blockers"]),
            "to_confirm": item["gstr3b"]["to_confirm"], "download": download,
            "cash": {"amount": paid["cash"]["total"] if paid and stage != "unlocked" else item["gstr3b"]["cash"]["total"],
                     "kind": "books" if stage == "unlocked" else "paid" if paid else "to_pay"},
            "late": item["late"], "next": next_step})
    return {"month": month.strftime("%Y-%m"), "due": due(month), "firms": firms}
