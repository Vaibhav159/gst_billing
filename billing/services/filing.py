"""Filing snapshots, corrections and lock transitions; the firm is the write mutex."""
import hashlib
import json
import re
from contextlib import suppress
from copy import deepcopy
from datetime import date
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Exists, F, OuterRef, Q
from django.http import Http404
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework.exceptions import ValidationError

from billing.cache import uncached
from billing.fy import fy_of, fy_range, parse_fy
from billing.models import AuditLog, FiledPeriod, FilingMonth, FilingRecord, OpeningCredit
from billing.numbering import lock_firms
from billing.period_lock import month_status
from billing.refusals import Refusal
from billing.text import day_text, inr, money, person, stamp

HEADS = ("igst", "cgst", "sgst")
NAMES = {"gstr1": "GSTR-1", "gstr1a": "GSTR-1A", "gstr3b": "GSTR-3B"}
PERSON_FIELDS = ("id", "username", "first_name", "last_name")
SNAPSHOTS = ("figures", "bills", "file")


def month_key(day):
    return day.strftime("%Y-%m")


def next_month(day):
    return date(day.year + (day.month == 12), day.month % 12 + 1, 1)


def json_money(value):
    if isinstance(value, Decimal):
        return money(value)
    if isinstance(value, (date,)):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: json_money(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [json_money(item) for item in value]
    return value


def digest(value):
    return hashlib.sha256(json.dumps(json_money(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def _heads(values):
    result = {head: money(values.get(head, 0)) for head in HEADS}
    return {**result, "total": money(sum(Decimal(value) for value in result.values()))}


def _records(business_id, month):
    return uncached(FilingRecord).filter(business_id=business_id, year=month.year, month=month.month)


def _person_rows(query):
    return query.select_related("marked_by", "updated_by").annotate(
        _cash=F("figures__cash"), _legacy=F("figures__legacy")).only(
        *[field.name for field in FilingRecord._meta.concrete_fields if field.name not in ("figures", "bills", "file")],
        "business__id", "business__name",
        *[f"{relation}__{field}" for relation in ("marked_by", "updated_by") for field in PERSON_FIELDS])


def filing_data(record):
    figures = {"cash": record._cash, "legacy": record._legacy} if hasattr(record, "_cash") else record.figures
    cash = None
    credit = None
    if record.kind == "gstr3b":
        cash = {head: money(getattr(record, f"cash_{head}")) if getattr(record, f"cash_{head}") is not None else None for head in HEADS}
        cash["total"] = money(record.cash_total or 0)
        if record.credit_left_igst is not None:
            credit = _heads({head: getattr(record, f"credit_left_{head}") for head in HEADS})
    return {"id": record.pk, "business": record.business_id, "month": f"{record.year}-{record.month:02}",
            "kind": record.kind, "filed_on": record.filed_on.isoformat(), "arn": record.arn, "cash": cash,
            "cash_worked_out": figures.get("cash") if record.kind == "gstr3b" else None,
            "late_fee": money(record.late_fee) if record.late_fee is not None else None,
            "interest": money(record.interest) if record.interest is not None else None,
            "credit_left": credit, "marked_by": person(record.marked_by), "marked_at": stamp(record.marked_at),
            "updated_by": person(record.updated_by), "updated_at": stamp(record.updated_at),
            "legacy": bool(figures.get("legacy", False))}


def month_record(business_id, year, month):
    day = date(year, month, 1)
    rows = {row.kind: filing_data(row) for row in _person_rows(_records(business_id, day))}
    state = uncached(FilingMonth).filter(business_id=business_id, year=year, month=month).select_related(
        "unlocked_by", "relocked_by").only("unlocked_at", "unlock_reason", "relocked_at", "unlocked_by_id", "relocked_by_id", "legacy_frozen_at",
        *[f"{relation}__{field}" for relation in ("unlocked_by", "relocked_by") for field in PERSON_FIELDS]).first()
    legacy = not rows and (bool(state and state.legacy_frozen_at) or uncached(FiledPeriod).filter(business_id=business_id, year=year, month=month).exists())
    locked = rows.get("gstr3b") or rows.get("gstr1")
    unlocked = {"at": stamp(state.unlocked_at), "by": person(state.unlocked_by), "reason": state.unlock_reason} if state and state.unlocked_at else None
    return {**{kind: rows.get(kind) for kind in NAMES}, "legacy": legacy, "unlocked": unlocked,
            "relocked": {"at": stamp(state.relocked_at), "by": person(state.relocked_by)} if state and state.relocked_at else None,
            "locked_by": locked["marked_by"] if locked and not unlocked else None,
            "locked_on": locked["filed_on"] if locked and not unlocked else None}


def _audit(business, user, action, entity, details, record=None, changes=None, snapshot=None):
    return AuditLog.objects.create(user=user, action=action, entity=entity, entity_id=record.pk if record else business.pk,
        entity_name=business.name[:255], details=details, changes=json_money(changes), snapshot=json_money(snapshot))


def _blockers(business, month):
    from billing.services.gst_checks import month_checks
    return month_checks(business, month.year, month.month)["blockers"]


def _date(value, month, kind, key="filed_on", not_before=None):
    parsed = value if isinstance(value, date) else None
    if isinstance(value, str):
        with suppress(ValueError):
            parsed = parse_date(value)
    if parsed is None:
        raise ValidationError({key: [f"Type the day you filed {NAMES[kind]}, like 08 Oct 2026."]})
    if parsed < next_month(month):
        raise ValidationError({key: [f"{NAMES[kind]} for {month:%B} can't be filed before {day_text(next_month(month))}."]})
    if parsed > timezone.localdate():
        raise ValidationError({key: ["That's after today. Type the day you actually filed."]})
    if not_before and parsed < not_before:
        raise ValidationError({key: [f"{NAMES[kind]} is filed on or after GSTR-1 ({day_text(not_before)})."]})
    return parsed


def _arn(value, key="arn"):
    value = "".join(str(value or "").split()).upper()
    if value and not re.fullmatch(r"[A-Z0-9]{15}", value):
        raise ValidationError({key: [f"An ARN has 15 letters and digits (this has {len(value)}). Copy it from the portal's confirmation, or leave it empty."]})
    return value


def _amount(value, key, words, negative=None):
    try:
        if isinstance(value, (bool, dict, list)):
            raise InvalidOperation
        result = Decimal(str(value))
        if not result.is_finite() or result.copy_abs() >= Decimal("1000000000000") or result.as_tuple().exponent < -2:
            raise InvalidOperation
    except (InvalidOperation, ValueError, TypeError):
        raise ValidationError({key: [words]})
    if result < 0:
        raise ValidationError({key: [negative or words]})
    return result


def _paid(record, data):
    if record.kind != "gstr3b":
        if any(data.get(key) is not None for key in ("cash", "cash_total", "credit_left", "late_fee", "interest")):
            raise ValidationError({"cash_total": ["Type the cash paid with GSTR-3B, or 0."]})
        return
    if data.get("cash") is not None and data.get("cash_total") is not None:
        raise ValidationError({"cash_total": ["Type the cash paid with GSTR-3B, or 0."]})
    if data.get("cash") is not None:
        values = data["cash"]
        if not isinstance(values, dict):
            raise ValidationError({"cash": ["Type the cash paid with GSTR-3B, or 0."]})
        for head in HEADS:
            setattr(record, f"cash_{head}", _amount(values.get(head), "cash", "Type the cash paid with GSTR-3B, or 0."))
        record.cash_total = sum(getattr(record, f"cash_{head}") for head in HEADS)
    elif data.get("cash_total") is not None:
        record.cash_total = _amount(data["cash_total"], "cash_total", "Type the cash paid with GSTR-3B, or 0.")
        for head in HEADS:
            setattr(record, f"cash_{head}", None)
    elif record.cash_total is None:
        worked_out = record._cash if hasattr(record, "_cash") else record.figures["cash"]
        for head in HEADS:
            setattr(record, f"cash_{head}", Decimal(worked_out[head]))
        record.cash_total = sum(getattr(record, f"cash_{head}") for head in HEADS)
    for key in ("late_fee", "interest"):
        if key in data:
            setattr(record, key, None if data[key] is None else _amount(data[key], key, "Type an amount, or 0."))
    if "credit_left" in data:
        values = data["credit_left"]
        if values is not None and not isinstance(values, dict):
            raise ValidationError({"credit_left": ["Type each credit balance, or 0."]})
        for head in HEADS:
            try:
                value = None if values is None else _amount(values.get(head), head, f"Type the {head.upper()} balance, or 0.", "A credit balance can't be below zero.")
            except ValidationError as exc:
                raise ValidationError({"credit_left": exc.detail})
            setattr(record, f"credit_left_{head}", value)


def _snapshot(business, month, kind, *, filing_date=None):
    if kind == "gstr3b":
        from billing.services.ledger import gstr3b_tables, month_position
        figures = month_position(business, month.year, month.month, filing_date=filing_date)
        figures["tables"] = gstr3b_tables(business, month.year, month.month, position=figures, filing_date=filing_date)
        return json_money(figures), {}, {}
    from billing.services.gstr1_file import attach_amendments, build_amendments, build_gstr1

    month_builds = {}
    built = build_gstr1(business, month.year, month.month, amendments=False, month_builds=month_builds)
    changes = pending_amendments(business, month.year, month.month, month_builds=month_builds) if kind == "gstr1" else []
    if kind == "gstr1":
        built = attach_amendments(built, business, month.year, month.month, changes, month_builds=month_builds, strict=True)
        file = built["file"]
    else:
        file = build_amendments(business, month.year, month.month,
            changes_for_month(business, month.year, month.month, built=built), before_gstr3b=True, month_builds=month_builds)
    figures = {**built["figures"], "sections": built["sections"], "amendments": changes}
    figures["digest"] = digest({"file": file, "bills": built["bills"]})
    return json_money(figures), built["bills"], file


def _sync_lock(business, month):
    state = uncached(FilingMonth).filter(business=business, year=month.year, month=month.month).only("unlocked_at", "legacy_frozen_at").first()
    rows = list(_records(business.pk, month).only("kind", "filed_on", "arn"))
    if (any(row.kind == "gstr3b" for row in rows) or (not rows and state and state.legacy_frozen_at)) and not (state and state.unlocked_at):
        note = "; ".join(f"{NAMES[row.kind]} filed {day_text(row.filed_on)}" + (f", ARN {row.arn}" if row.arn else "") for row in rows)
        FiledPeriod.objects.update_or_create(business=business, year=month.year, month=month.month, defaults={"note": note[:255] or "Filed before the app kept filing records"})
    elif rows:
        FiledPeriod.objects.filter(business=business, year=month.year, month=month.month).delete()


def _create(business, month, user, kind, data, legacy=False):
    figures, bills, file = _snapshot(business, month, kind, **({"filing_date": data["filed_on"]} if kind == "gstr3b" else {}))
    record = FilingRecord(business=business, year=month.year, month=month.month, kind=kind,
                         filed_on=data["filed_on"], arn=_arn(data.get("arn")), figures={**figures, "legacy": legacy},
                         bills=bills, file=file, marked_by=user)
    _paid(record, data)
    record.save()
    details = f"{business.name} · {month:%B %Y} · {NAMES[kind]} filed {day_text(record.filed_on)}"
    if record.arn:
        details += f", ARN {record.arn}"
    if kind == "gstr3b":
        details += f" · {inr(record.cash_total)} paid in cash"
    _audit(business, user, "filed", "filing", details, record=record)
    return record


@transaction.atomic
def mark_filed(business, month, user, data):
    lock_firms(business.pk)
    month = month.replace(day=1)
    kind = data.get("kind")
    if kind not in (*NAMES, "both"):
        raise ValidationError({"kind": ["Choose GSTR-1, GSTR-1A, GSTR-3B or both."]})
    if month >= timezone.localdate().replace(day=1):
        raise Refusal(f"{month:%B %Y} is still running. Its returns can be filed from {day_text(next_month(month))}.",
                      "month_running", file_from=next_month(month).isoformat())
    records = {row.kind: row for row in _records(business.pk, month)}
    kinds = ["gstr1", "gstr3b"] if kind == "both" else [kind]
    for one in kinds:
        if one in records:
            record = records[one]
            raise Refusal(f"{month:%B %Y}'s {NAMES[one]} is already marked filed ({day_text(record.filed_on)}).",
                          "already_filed", filing=filing_data(record))
    if kind in ("gstr1a", "gstr3b") and "gstr1" not in records:
        raise Refusal(f"Mark {month:%B %Y}'s GSTR-1 filed first. GSTR-3B comes after it.", "needs_gstr1")
    if kind == "gstr1a" or data.get("gstr1a_filed_on"):
        if "gstr3b" in records:
            raise Refusal(f"{month:%B %Y}'s GSTR-3B is marked filed, so corrections go in the next GSTR-1, not GSTR-1A.", "gstr3b_filed")
        if not changes_for_month(business, month.year, month.month):
            raise Refusal(f"Nothing has changed since {month:%B %Y}'s GSTR-1, so there's no GSTR-1A to record.", "no_corrections")
    if "gstr1" in kinds:
        blockers = _blockers(business, month)
        if blockers and data.get("confirm_checks") is not True:
            count = len(blockers)
            raise ValidationError({"confirm_checks": [f"{count} check{'s fail' if count != 1 else ' fails'} for {month:%B}. Tick that the return is already on the GST portal to record it."]})
    legacy = not records and uncached(FiledPeriod).filter(business=business, year=month.year, month=month.month).exists()
    made = []
    if kind == "both":
        first = _date(data.get("gstr1_filed_on"), month, "gstr1", "gstr1_filed_on")
        made.append(_create(business, month, user, "gstr1", {"filed_on": first, "arn": _arn(data.get("gstr1_arn"), "gstr1_arn")}, legacy))
    else:
        first = records["gstr1"].filed_on if "gstr1" in records else None
    if kind == "gstr3b" and data.get("gstr1a_filed_on") and "gstr1a" not in records:
        filed = _date(data["gstr1a_filed_on"], month, "gstr1a", "gstr1a_filed_on", first)
        made.append(_create(business, month, user, "gstr1a", {"filed_on": filed, "arn": _arn(data.get("gstr1a_arn"), "gstr1a_arn")}))
    target = "gstr3b" if kind == "both" else kind
    filed = _date(data.get("filed_on"), month, target, not_before=first)
    one_a = next((row for row in made if row.kind == "gstr1a"), records.get("gstr1a"))
    if target == "gstr3b" and one_a and filed < one_a.filed_on:
        raise ValidationError({"filed_on": [f"GSTR-3B is filed on or after GSTR-1A ({day_text(one_a.filed_on)})."]})
    made.append(_create(business, month, user, target, {**data, "filed_on": filed}, legacy))
    if target == "gstr3b":
        state = uncached(FilingMonth).filter(business=business, year=month.year, month=month.month,
                                              unlocked_at__isnull=False).first()
        if state:
            state.unlocked_at, state.unlocked_by, state.unlock_reason = None, None, ""
            state.relocked_at, state.relocked_by = timezone.now(), user
            state.save(update_fields=["unlocked_at", "unlocked_by", "unlock_reason", "relocked_at", "relocked_by"])
            _audit(business, user, "locked", "period", f"{business.name} · locked again")
    _sync_lock(business, month)
    return made


@transaction.atomic
def edit_filing(record, user, data):
    lock_firms(record.business_id)
    record = _person_rows(uncached(FilingRecord).select_related("business").filter(pk=record.pk)).first()
    if record is None:
        raise Http404("That filing record isn't on file.")
    day = date(record.year, record.month, 1)
    old = {field: getattr(record, field) for field in ("filed_on", "arn", "cash_total", "late_fee", "interest", *[f"{prefix}_{head}" for prefix in ("cash", "credit_left") for head in HEADS])}
    if "filed_on" in data:
        rows = {row.kind: row.filed_on for row in _records(record.business_id, day).only("kind", "filed_on")}
        record.filed_on = _date(data["filed_on"], day, record.kind, not_before=rows.get("gstr1") if record.kind != "gstr1" else None)
        rows[record.kind] = record.filed_on
        if (rows.get("gstr1a") and rows.get("gstr3b") and rows["gstr1a"] > rows["gstr3b"]) or any(value < rows["gstr1"] for value in rows.values()):
            raise ValidationError({"filed_on": ["The filing dates must keep GSTR-1, GSTR-1A and GSTR-3B in that order."]})
    if "arn" in data:
        record.arn = _arn(data["arn"])
    _paid(record, data)
    changed = {key: {"old": value, "new": getattr(record, key)} for key, value in old.items() if value != getattr(record, key)}
    if not changed:
        return record
    record.updated_by, record.updated_at = user, timezone.now()
    record.save(update_fields=[*changed, "updated_by", "updated_at"])
    labels = {"filed_on": "the filing date", "arn": "the ARN", "cash_total": "the cash paid", "late_fee": "the late fee", "interest": "the interest"}
    words = list(dict.fromkeys(labels.get(key, "the credit left" if key.startswith("credit_left") else "the cash paid") for key in changed))
    _audit(record.business, user, "updated", "filing", "Changed " + " and ".join(words), record=record, changes=changed)
    _sync_lock(record.business, day)
    return record


def _reason(value, words):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= 255:
        raise ValidationError({"reason": [words]})
    return value.strip()


@transaction.atomic
def remove_filing(record, user, reason):
    lock_firms(record.business_id)
    record = uncached(FilingRecord).select_related("business").filter(pk=record.pk).only(
        *[field.name for field in FilingRecord._meta.concrete_fields], "business__id", "business__name").first()
    if record is None:
        raise Http404("That filing record isn't on file.")
    reason = _reason(reason, "Say why in a few words. It goes into the Audit log.")
    day = date(record.year, record.month, 1)
    dependent = _records(record.business_id, day).exclude(pk=record.pk).filter(kind__in=["gstr1a", "gstr3b"]).only("kind").order_by("-kind").first()
    if (record.kind == "gstr1" and dependent) or (record.kind == "gstr1a" and dependent and dependent.kind == "gstr3b"):
        raise Refusal(f"{day:%B %Y}'s {NAMES[dependent.kind]} is on record, so its {NAMES[record.kind]} record can't be removed. Remove the {NAMES[dependent.kind]} record first.", "record_in_use")
    if record.kind == "gstr3b":
        later = uncached(FilingRecord).filter(business_id=record.business_id, kind="gstr3b").filter(
            Q(year__gt=record.year) | Q(year=record.year, month__gt=record.month)).only("year", "month").order_by("year", "month").first()
        if later:
            label = date(later.year, later.month, 1).strftime("%B %Y")
            raise Refusal(f"Only the latest GSTR-3B record can be removed; {label}'s is on record after it.", "record_in_use")
    _audit(record.business, user, "removed", "filing", f"{record.business.name} · {day:%B %Y} · {NAMES[record.kind]} · {reason}", record=record,
           snapshot={field.name: getattr(record, field.attname) for field in record._meta.concrete_fields})
    business, kind = record.business, record.kind
    record.delete()
    if kind == "gstr3b":
        FiledPeriod.objects.filter(business=business, year=day.year, month=day.month).delete()
    if not _records(business.pk, day).exists():
        FilingMonth.objects.filter(business=business, year=day.year, month=day.month).delete()


@transaction.atomic
def unlock_month(business, month, user, reason):
    lock_firms(business.pk)
    state = month_status(business.pk, month.year, month.month)
    where = "GSTR-1A" if state.stage == "gstr1" else "October's GSTR-1"
    reason = _reason(reason, f"Write why {month:%B} needs unlocking, for example “Wrong GSTIN on KGH/2026-27/21: correct it and amend in {where}”.")
    if state.unlocked:
        who = person(state.unlocked.unlocked_by)
        raise Refusal(f"{month:%B %Y} is already unlocked (by {who['name'] if who else 'the owner'} on {day_text(timezone.localtime(state.unlocked.unlocked_at).date())}).",
                      "already_unlocked", unlocked={"at": stamp(state.unlocked.unlocked_at), "by": who, "reason": state.unlocked.unlock_reason})
    if not state.sales_closed:
        raise Refusal(f"{month:%B %Y} isn't filed, so there's nothing to unlock.", "not_filed")
    now = timezone.now()
    row, _ = FilingMonth.objects.get_or_create(business=business, year=month.year, month=month.month)
    if state.legacy and row.legacy_frozen_at is None and row.legacy_snapshot is None:
        row.legacy_snapshot = {}
        for kind in ("gstr1", "gstr3b"):
            figures, bills, file = _snapshot(business, month, kind)
            row.legacy_snapshot[kind] = {"figures": figures, "bills": bills, "file": file}
        row.legacy_frozen_at = now
    row.unlocked_at, row.unlocked_by, row.unlock_reason = now, user, reason
    row.save()
    FiledPeriod.objects.filter(business=business, year=month.year, month=month.month).delete()
    _audit(business, user, "unlocked", "period", f"{business.name} · {reason}")


@transaction.atomic
def relock_month(business, month, user):
    lock_firms(business.pk)
    row = uncached(FilingMonth).filter(business=business, year=month.year, month=month.month).first()
    if not row or not row.unlocked_at:
        raise Refusal(f"{month:%B %Y} isn't unlocked, so there's nothing to lock again.", "not_unlocked")
    row.unlocked_at, row.unlocked_by, row.unlock_reason = None, None, ""
    row.relocked_at, row.relocked_by = timezone.now(), user
    row.save()
    _sync_lock(business, month)
    _audit(business, user, "locked", "period", f"{business.name} · locked again")


@transaction.atomic
def filed_before(business, up_to, user):
    lock_firms(business.pk)
    if up_to >= timezone.localdate().replace(day=1) or up_to < date(2025, 4, 1):
        raise ValidationError({"up_to": ["Pick a month that is over."]})
    existing = set(uncached(FiledPeriod).filter(business=business).values_list("year", "month"))
    existing.update(uncached(FilingRecord).filter(business=business).values_list("year", "month"))
    made, day = [], date(2025, 4, 1)
    while day <= up_to:
        if (day.year, day.month) not in existing:
            FiledPeriod.objects.create(business=business, year=day.year, month=day.month, note="Filed before the app kept filing records")
            made.append(month_key(day))
        day = next_month(day)
    if made:
        _audit(business, user, "locked", "period", f"{business.name} · {len(made)} months marked as filed before the app (Apr 2025 to {up_to:%b %Y})")
    return {"months": made, "count": len(made)}


def changes_for_month(business, year, month, *, built=None, month_builds=None):
    """Raw bill deltas from the latest immutable snapshot, including consumed amendments."""
    from billing.services.gstr1_file import build_gstr1, snapshots_equal
    original = list(uncached(FilingRecord).filter(business=business, year=year, month=month, kind__in=("gstr1", "gstr1a"))
                    .only("kind", "bills").order_by("kind"))
    if original:
        baseline = deepcopy(original[-1].bills)
    else:
        frozen = uncached(FilingMonth).filter(business=business, year=year, month=month).values_list("legacy_snapshot__gstr1__bills", flat=True).first()
        if frozen is None:
            return []
        baseline = deepcopy(frozen)
    later = uncached(FilingRecord).filter(business=business, kind="gstr1").filter(
        Q(year__gt=year) | Q(year=year, month__gt=month)).order_by("year", "month").values_list("figures__amendments", flat=True)
    label = f"{year}-{month:02}"
    for amendments in later:
        for carried in amendments or []:
            if carried["month"] != label:
                continue
            row = carried.get("after") or carried["before"]
            if carried.get("after"):
                baseline[str(row["id"])] = carried["after"]
            else:
                baseline.pop(str(row["id"]), None)
    if built is None:
        built = (month_builds or {}).get((year, month))
    if built is None:
        built = build_gstr1(business, year, month, amendments=False, month_builds=month_builds)
    current = built["bills"]
    return [{"month": label, "before": baseline.get(key), "after": current.get(key)}
            for key in sorted(set(baseline) | set(current)) if not snapshots_equal(baseline.get(key), current.get(key))]


def _has_3b(business_id, day):
    return _records(business_id, day).filter(kind="gstr3b").exists() or uncached(FilingMonth).filter(
        business_id=business_id, year=day.year, month=day.month, legacy_frozen_at__isnull=False).exists()


def _carrying_month(business_id, source):
    filed = set(uncached(FilingRecord).filter(business_id=business_id, kind="gstr1", year__gte=source.year)
                .values_list("year", "month"))
    filed.update(uncached(FiledPeriod).filter(business_id=business_id, year__gte=source.year).values_list("year", "month"))
    day = next_month(source)
    while (day.year, day.month) in filed:
        day = next_month(day)
    return day


def pending_amendments(business, year, month, *, month_builds=None):
    """Only corrections routed here and not previously frozen by a carrying GSTR-1."""
    target = date(year, month, 1)
    unlocked = uncached(FilingMonth).filter(business_id=OuterRef("business_id"), year=OuterRef("year"),
                                           month=OuterRef("month"), unlocked_at__isnull=False)
    sources = uncached(FilingRecord).filter(business=business, kind="gstr3b").filter(
        Q(year__lt=year) | Q(year=year, month__lt=month)).exclude(Exists(unlocked)).values_list("year", "month")
    legacy = uncached(FilingMonth).filter(business=business, legacy_frozen_at__isnull=False, unlocked_at__isnull=True).filter(
        Q(year__lt=year) | Q(year=year, month__lt=month)).values_list("year", "month")
    changes = []
    for source_year, source_month in set(sources) | set(legacy):
        source = date(source_year, source_month, 1)
        if timezone.localdate() > date(fy_of(source) + 1, 11, 30):
            continue
        if _carrying_month(business.pk, source) == target:
            changes.extend(changes_for_month(business, source_year, source_month, month_builds=month_builds))
    return changes


def changes_since_filing(business, year, month, *, changes=None):
    from billing.models import Invoice
    if changes is None:
        changes = changes_for_month(business, year, month)
    if not changes:
        return None
    day = date(year, month, 1)
    before_3b = not _has_3b(business.pk, day)
    carrying = day if before_3b else _carrying_month(business.pk, day)
    deadline = date(fy_of(day) + 1, 11, 30)
    too_late = timezone.localdate() > deadline
    cancelled_ids = set(uncached(Invoice).filter(pk__in=[(row["before"] or row["after"])["id"] for row in changes], status="cancelled").values_list("pk", flat=True))
    rows, taxable_diff, tax_diff = [], Decimal("0"), Decimal("0")
    for change in changes:
        before, after = change["before"], change["after"]
        row = after or before
        kind = "added" if before is None else "changed" if after else "cancelled" if row["id"] in cancelled_ids else "deleted"
        section = row["table"]
        table = section.upper() if before_3b or (kind == "added" and section != "b2cs") else section.upper() + "A"
        rate = row["rates"][0]["rate"] if row.get("rates") else "0"
        goes_in = f"GSTR-1A · {table}" if before_3b else f"{carrying:%B}'s GSTR-1 · {table}"
        if not before_3b and kind == "added" and section != "b2cs":
            goes_in += f", with its {day:%B} date"
        if section == "b2cs":
            goes_in += f" ({rate}%)"
        if too_late:
            goes_in = f"Too late to amend on the portal (30 Nov {deadline.year} was the last day). Ask your CA."
        delta = sum(Decimal((after or {}).get(head, 0)) - Decimal((before or {}).get(head, 0)) for head in HEADS)
        taxable_diff += Decimal((after or {}).get("taxable", 0)) - Decimal((before or {}).get("taxable", 0))
        tax_diff += delta
        def values(value):
            return None if value is None else {**{key: value.get(key, "0.00") for key in ("taxable", *HEADS, "total")},
                "gst_number": value.get("gstin", ""), "invoice_number": value["invoice_number"]}
        rows.append({"kind": kind, "id": row["id"], "invoice_number": row["invoice_number"], "section": section,
                     "place_of_supply": row["pos"], "rate": rate, "before": values(before), "after": values(after),
                     "tax_diff": money(delta), "goes_in": goes_in, "too_late": too_late})
    filed = _records(business.pk, day).filter(kind__in=("gstr1", "gstr1a")).only("marked_at").order_by("-marked_at").first()
    frozen_at = filed.marked_at if filed else uncached(FilingMonth).filter(business=business, year=year, month=month).values_list("legacy_frozen_at", flat=True).first()
    return {"at": stamp(frozen_at), "bills_diff": len(rows), "taxable_diff": money(taxable_diff),
            "tax_diff": money(tax_diff), "rows": rows, "gstr3b": None}


_NOT_PROVIDED = object()


def amendment_plan(business, year, month, *, changes=_NOT_PROVIDED):
    if changes is _NOT_PROVIDED:
        changes = changes_since_filing(business, year, month)
    if not changes:
        return None
    day = date(year, month, 1)
    before = not _has_3b(business.pk, day)
    target = day if before else _carrying_month(business.pk, day)
    allowed = [row for row in changes["rows"] if not row["too_late"]]
    tables = {}
    for row in allowed:
        table = row["section"].upper()
        if not before and (row["kind"] != "added" or table == "B2CS"):
            table += "A"
        tables[table] = tables.get(table, 0) + 1
    summary = ", ".join(f"{count} {table} row{'s' if count != 1 else ''}" for table, count in sorted(tables.items())) or "nothing to amend"
    return {"before_gstr3b": before, "carried_by": month_key(target),
            "file": f"GSTR1A_{business.gst_number}_{target:%m%Y}.json" if before else f"GSTR1_{business.gst_number}_{target:%m%Y}_amendments.json",
            "summary": summary, "rows": len(allowed)}


def month_stages(business_ids, months, today=None):
    """Two small queries plus the aggregate blocker service; no bill snapshots."""
    from django.db.models import CharField, Max, Value

    from billing.services.gst_checks import gstr1_blockers
    today = (today or timezone.localdate()).replace(day=1)
    business_ids, months = list(business_ids), list(months)
    dates = [date.fromisoformat(month + "-01") if isinstance(month, str) else month.replace(day=1) for month in months]
    keys = {(day.year, day.month) for day in dates}
    wanted = Q(pk__in=[])
    for year, number in keys:
        wanted |= Q(year=year, month=number)
    records = uncached(FilingRecord).filter(wanted, business_id__in=business_ids).values_list("business_id", "year", "month", "kind")
    locks = uncached(FiledPeriod).filter(wanted, business_id__in=business_ids).annotate(kind=Value("legacy", output_field=CharField())).values_list("business_id", "year", "month", "kind")
    unlocked = uncached(FilingMonth).filter(wanted, business_id__in=business_ids, unlocked_at__isnull=False).annotate(kind=Value("unlocked", output_field=CharField())).values_list("business_id", "year", "month", "kind")
    state = {}
    for business_id, year, number, kind in records.union(locks, unlocked):
        state.setdefault((business_id, f"{year}-{number:02}"), set()).add(kind)
    latest = {business_id: None for business_id in business_ids}
    filed_latest = uncached(FilingRecord).filter(business_id__in=business_ids, kind="gstr1").values("business_id").annotate(
        last=Max(100 * F("year") + F("month"))).values_list("business_id", "last")
    legacy_latest = uncached(FiledPeriod).filter(business_id__in=business_ids).values("business_id").annotate(
        last=Max(100 * F("year") + F("month"))).values_list("business_id", "last")
    for business_id, last in filed_latest.union(legacy_latest):
        key = f"{last // 100}-{last % 100:02}"
        latest[business_id] = max(latest[business_id] or key, key)
    stages, open_months = {}, set()
    for business_id in business_ids:
        for day in dates:
            key = (business_id, month_key(day))
            kinds = state.get(key, set())
            stage = ("unlocked" if "unlocked" in kinds else "filed" if "legacy" in kinds or "gstr3b" in kinds else
                     "gstr1" if "gstr1" in kinds else "future" if day > today else "open" if day == today else "ready")
            stages[key] = stage
            if stage == "ready":
                open_months.add(month_key(day))
    blockers = gstr1_blockers(business_ids, sorted(open_months)) if open_months else {}
    for key, value in blockers.items():
        if stages.get(key) == "ready" and value["count"]:
            stages[key] = "blocked"
    return {"stages": stages, "latest_gstr1": latest}


def year_filings(business_ids, fy):
    """One projected UNION includes legacy locks without double-counting filed returns."""
    from django.db.models import DateField, DecimalField, Value
    start = parse_fy(fy) if isinstance(fy, str) else fy
    lower, upper = fy_range(start)
    span = Q(year=lower.year, month__gte=4) | Q(year=upper.year, month__lte=3)
    records = uncached(FilingRecord).filter(span, business_id__in=business_ids, kind="gstr3b").values_list("business_id", "year", "month", "filed_on", "cash_total")
    exists = uncached(FilingRecord).filter(business_id=OuterRef("business_id"), year=OuterRef("year"), month=OuterRef("month"), kind="gstr3b")
    locks = uncached(FiledPeriod).filter(span, business_id__in=business_ids).exclude(Exists(exists)).annotate(
        filed_on=Value(None, output_field=DateField()), cash_total=Value(Decimal("0"), output_field=DecimalField(max_digits=14, decimal_places=2))).values_list("business_id", "year", "month", "filed_on", "cash_total")
    result = {pk: {"months_filed": 0, "last_gstr3b_filed_on": None, "cash_paid": Decimal("0")} for pk in business_ids}
    for pk, _year, _month, filed_on, cash in records.union(locks):
        row = result[pk]
        row["months_filed"] += 1
        row["cash_paid"] += cash or 0
        if filed_on and (row["last_gstr3b_filed_on"] is None or filed_on > row["last_gstr3b_filed_on"]):
            row["last_gstr3b_filed_on"] = filed_on
    return result


def backup_rows():
    return {key: json_money(list(uncached(model).values())) for key, model in (
        ("filing_records", FilingRecord), ("filing_months", FilingMonth), ("opening_credits", OpeningCredit))}


def credit_at_risk_summary(business_ids, today=None):
    from billing.services.ledger import credit_at_risk_summary as summary
    return summary(business_ids, today=today)
