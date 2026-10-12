"""Monthly GST credit, frozen filings and Circular 170 tables (v3 only)."""

from copy import deepcopy
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from django.core.exceptions import ImproperlyConfigured
from django.db.models import (
    BooleanField,
    Case,
    Count,
    DateField,
    Exists,
    F,
    IntegerField,
    Min,
    OuterRef,
    Q,
    Subquery,
    Sum,
    Value,
    When,
)
from django.db.models.functions import Coalesce, ExtractMonth, ExtractYear, TruncMonth
from django.utils import timezone

from billing.cache import uncached
from billing.constants import GST_CODE
from billing.fy import fy_of, fy_range
from billing.models import FiledPeriod, FilingMonth, FilingRecord, Invoice, LineItem, OpeningCredit
from billing.services.gst_amounts import (
    INTEREST_NOTE,
    add_heads,
    heads,
    late_cost,
    paise_expression,
    subtract_heads,
    taxable_expression,
)
from billing.tax_rules import HEADS, clean_gstin, is_interstate, place_of_supply, set_off, supply_interstate, to_paise
from billing.text import inr

START = date(2025, 4, 1)


def month_key(day):
    return day.strftime("%Y-%m")


def next_month(day):
    return date(day.year + (day.month == 12), day.month % 12 + 1, 1)


def months_until(upto):
    day = START
    while day <= upto:
        yield month_key(day)
        day = next_month(day)


def json_money(value):
    if isinstance(value, Decimal):
        return format(value, ".2f")
    if isinstance(value, dict):
        return {key: json_money(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_money(item) for item in value]
    if isinstance(value, (date,)):
        return value.isoformat()
    return value


def calculate_ledger(books, frozen, opening, upto, *, opening_typed=True):
    """Pure money core. Keys are YYYY-MM; frozen carries never change.

    A filed snapshot records its own base amounts and the signed corrections it
    consumed. Subtract those corrections before carrying a later change, so an
    amended source month cannot be charged a second time.
    """
    upto_date = date.fromisoformat(upto + "-01")
    consumed = {}
    for key, record in frozen.items():
        if key > upto:
            continue
        for amendment in record["figures"].get("amendments", []):
            old = consumed.setdefault(amendment["month"], {"output": heads(), "credit": heads()})
            for kind in ("output", "credit"):
                old[kind] = add_heads(old[kind], amendment[kind])
            old["taxable"] = old.get("taxable", Decimal(0)) + Decimal(str(amendment.get("taxable", 0)))
    carry, result, pending, reduction = heads(opening), {}, [], heads()
    previous, earlier_filed = None, False
    for key in months_until(upto_date):
        own = books.get(key, {})
        output, credit = heads(own.get("output")), heads(own.get("credit"))
        base_output, base_credit = output.copy(), credit.copy()
        base_taxable = taxable = to_paise(own.get("taxable", 0))
        record = frozen.get(key)
        locked = bool(record and record.get("locked", True))
        amendments = [] if locked else deepcopy(pending)
        if not locked:
            pending = []
            for amendment in amendments:
                output = add_heads(output, amendment["output"])
                credit = add_heads(credit, amendment["credit"])
                taxable += Decimal(str(amendment.get("taxable", 0)))
            output, reduction = add_heads(output, {head: -reduction[head] for head in HEADS}), heads()
        available = add_heads(carry, credit)
        # R3A-2: Table 3.1(a) is never negative per head. A reduction larger
        # than this month's tax comes off next month's 3.1(a), never credit.
        # A reversed credit larger than the available balance becomes tax to pay in cash.
        for head in HEADS:
            if output[head] < 0:
                reduction[head] -= output[head]
                output[head] = Decimal(0)
        tax_output = heads(output)
        for head in HEADS:
            if available[head] < 0:
                output[head] -= available[head]
                available[head] = Decimal(0)
        output, available = heads(output), heads(available)
        row = {"month": key, "output": tax_output, "setoff_output": output, "credit": credit,
               "base_output": base_output, "base_credit": base_credit, "base_taxable": base_taxable, "taxable": taxable,
               "carry_in": carry, "carry_source": {"heads": carry, "from": previous, "as_filed": earlier_filed,
                            "opening": previous is None},
               "available": available, **set_off(output, available),
               "filed": False, "recorded": bool(record and record.get("recorded", True)),
               "as_filed_at": None, "cash_paid": None,
               "amendments": amendments, "amendments_in": [entry["month"] for entry in amendments],
               "reduction_on": heads(reduction), "reduction_note": _reduction_note(reduction),
               "opening_missing": not opening_typed and not any(r["recorded"] for r in result.values())}
        if locked:
            figures = deepcopy(record["figures"])
            for kind in ("output", "credit", "base_output", "base_credit", "used", "cash", "carry_on", "available", "reduction_on"):
                if kind in figures:
                    figures[kind] = heads(figures[kind])
            if "carry_in" in figures:
                figures["carry_in"] = heads(figures["carry_in"])
            if "carry_source" in figures:
                figures["carry_source"]["heads"] = heads(figures["carry_source"]["heads"])
            if "steps" in figures:
                figures["steps"] = [{**step, "amount": to_paise(step["amount"])} for step in figures["steps"]]
            row.update(figures)
            # Like the carry, a filed month passes on the reduction it filed with.
            row["reduction_on"] = reduction = heads(figures.get("reduction_on"))
            row["reduction_note"] = _reduction_note(reduction)
            row.update(filed=True, recorded=record.get("recorded", True), as_filed_at=record.get("marked_at"),
                       cash_paid=record.get("cash_paid"))
            if row["recorded"]:
                row["opening_missing"] = False
            if record.get("credit_left") is not None:
                row["carry_on"] = heads(record["credit_left"])
            delta = {"month": key, "taxable": base_taxable - Decimal(str(figures.get("base_taxable", figures.get("taxable", 0))))
                     - consumed.get(key, {}).get("taxable", Decimal(0))}
            for kind, current in (("output", base_output), ("credit", base_credit)):
                delta[kind] = subtract_heads(subtract_heads(current, figures.get("base_" + kind, figures.get(kind, {}))),
                                             consumed.get(key, {}).get(kind, {}))
            if delta["taxable"] or any(delta[kind][head] for kind in ("output", "credit") for head in HEADS):
                pending.append(delta)
        result[key], carry = row, heads(row["carry_on"])
        old_cross = result.get(previous, {}).get("cross_head")
        row["cross_head"] = old_cross if old_cross and fy_of(old_cross["month"] + "-01") == fy_of(key + "-01") else None
        if row["cross_head"] is None:
            for paid, left in (("cgst", "sgst"), ("sgst", "cgst")):
                if row["cash"][paid] and row["carry_on"][left]:
                    row["cross_head"] = {"month": key, "paid": paid, "paid_amount": row["cash"][paid],
                                         "left": left, "left_amount": row["carry_on"][left]}
                    break
        previous, earlier_filed = key, locked
    return result


def _reduction_note(reduction):
    total = heads(reduction)["total"]
    return f"{inr(total)} of an earlier correction is taken off next month's tax." if total else None


def _credit_lapse(lines, *, filing_month=None, filing_date=None, today=None, bill="invoice__"):
    """Annotate Sec 16(4) from the recorded filing day, else the month rule.

    The caller supplies credit_month and credit_eligible; `bill` prefixes the
    bill's invoice_date and business_id (lines by default, "" for bills). A filing in progress
    supplies its day before its immutable FilingRecord snapshot is created.
    Correlated scalar lookup keeps this within the caller's aggregate query.
    """
    lines = (lines.annotate(bill_year=ExtractYear(f"{bill}invoice_date"), bill_month=ExtractMonth(f"{bill}invoice_date"))
             .annotate(bill_fy=F("bill_year") - Case(When(bill_month__lt=4, then=1), default=0, output_field=IntegerField()),
                       credit_year=ExtractYear("credit_month"), credit_month_number=ExtractMonth("credit_month")))
    recorded = uncached(FilingRecord).filter(business_id=OuterRef(f"{bill}business_id"), kind="gstr3b",
                                             year=OuterRef("credit_year"), month=OuterRef("credit_month_number"))
    claimed_on = Subquery(recorded.values("filed_on")[:1], output_field=DateField())
    if filing_date is not None:
        claimed_on = Case(When(credit_month=filing_month, then=Value(filing_date)), default=claimed_on, output_field=DateField())
    lines = lines.annotate(claimed_on=claimed_on).annotate(
        claim_year=ExtractYear("claimed_on"), claim_month_number=ExtractMonth("claimed_on"))
    after_month = Q(credit_year__gt=F("bill_fy") + 1) | Q(credit_year=F("bill_fy") + 1, credit_month_number__gt=10)
    # R3A-5 / R3A-9: once 30 November after the bill's year passes, any month of
    # it whose GSTR-3B is still unfiled can no longer claim the credit (Sec 16(4)).
    # Legacy months (locked or frozen before the app) count as filed.
    today = today or timezone.localdate()
    closed_fy = today.year - (1 if today > date(today.year, 11, 30) else 2)
    legacy = (uncached(FiledPeriod).filter(business_id=OuterRef(f"{bill}business_id"), year=OuterRef("credit_year"),
                                           month=OuterRef("credit_month_number")))
    frozen = (uncached(FilingMonth).filter(business_id=OuterRef(f"{bill}business_id"), year=OuterRef("credit_year"),
                                           month=OuterRef("credit_month_number"), legacy_frozen_at__isnull=False))
    after_month |= Q(bill_fy__lte=closed_fy) & ~Exists(legacy) & ~Exists(frozen)
    after_date = Q(claim_year__gt=F("bill_fy") + 1) | Q(claim_year=F("bill_fy") + 1, claim_month_number__gt=11)
    return lines.annotate(lapsed=Case(When(Q(credit_eligible=True) & (
        Q(claimed_on__isnull=True) & after_month | Q(claimed_on__isnull=False) & after_date), then=True),
        default=False, output_field=BooleanField()))


def _purchase_lines(business, *, filing_month=None, filing_date=None, today=None):
    required = {"itc_month", "itc_eligible", "needs_review"}
    if not required <= {field.name for field in Invoice._meta.fields}:
        raise ImproperlyConfigured("3A ledger requires part 2A's itc_month, itc_eligible and needs_review fields.")
    lines = (uncached(LineItem).filter(invoice__business_id=business.pk, invoice__type_of_invoice="inward",
                                      invoice__invoice_date__gte=START)
            .annotate(credit_month=Coalesce("invoice__itc_month", TruncMonth("invoice__invoice_date"), output_field=DateField()),
                      credit_eligible=F("invoice__itc_eligible")))
    return _credit_lapse(lines, filing_month=filing_month, filing_date=filing_date, today=today)


def _sums():
    return {head: Coalesce(Sum(paise_expression(head)), Decimal(0)) for head in HEADS}


def _sales_lines(business):
    return uncached(LineItem).counted().filter(invoice__business_id=business.pk, invoice__type_of_invoice="outward")


def _book_groups(business, upto, *, filing_date=None, today=None):
    end, books = next_month(upto), {}
    sales = (_sales_lines(business).filter(invoice__invoice_date__gte=START, invoice__invoice_date__lt=end)
             .annotate(month=TruncMonth("invoice__invoice_date")).values("month")
             .annotate(**_sums(), taxable=Sum(taxable_expression(), filter=Q(gst_tax_rate__gt=0))).order_by())
    for row in sales:
        books.setdefault(month_key(row["month"]), {})["output"] = heads(row)
        books[month_key(row["month"])]["taxable"] = to_paise(row["taxable"] or 0)
    purchases = (_purchase_lines(business, filing_month=upto, filing_date=filing_date, today=today).filter(credit_month__gte=START, credit_month__lt=end,
                                                  invoice__itc_eligible=True, lapsed=False)
                 .values("credit_month").annotate(**_sums()).order_by())
    for row in purchases:
        books.setdefault(month_key(row["credit_month"]), {})["credit"] = heads(row)
    return books


def _records(business, upto):
    cutoff = Q(year__lt=upto.year) | Q(year=upto.year, month__lte=upto.month)
    records = list(uncached(FilingRecord).filter(business_id=business.pk, kind="gstr3b").filter(cutoff)
                   .values("year", "month", "figures", "marked_at", "cash_total",
                           *("cash_" + head for head in HEADS), *("credit_left_" + head for head in HEADS)))
    month_rows = list(uncached(FilingMonth).filter(business_id=business.pk).filter(cutoff)
                      .annotate(legacy_figures=F("legacy_snapshot__gstr3b__figures"))
                      .values("year", "month", "unlocked_at", "relocked_at", "legacy_frozen_at", "legacy_figures"))
    opened = {(row["year"], row["month"]) for row in month_rows if row["unlocked_at"] is not None
              and (row["relocked_at"] is None or row["unlocked_at"] > row["relocked_at"])}
    frozen = {}
    for row in records:
        key = f'{row["year"]:04d}-{row["month"]:02d}'
        paid = ({head: row["cash_" + head] for head in HEADS} if row["cash_igst"] is not None
                else {head: None for head in HEADS})
        paid["total"] = row["cash_total"]
        frozen[key] = {"figures": row["figures"], "recorded": True, "marked_at": row["marked_at"], "cash_paid": paid,
                       "locked": (row["year"], row["month"]) not in opened,
                       "credit_left": (heads({head: row["credit_left_" + head] for head in HEADS})
                                       if row["credit_left_igst"] is not None else None)}
    for row in month_rows:
        key = f'{row["year"]:04d}-{row["month"]:02d}'
        if key not in frozen and row["legacy_figures"]:
            frozen[key] = {"figures": row["legacy_figures"], "recorded": False, "marked_at": row["legacy_frozen_at"],
                           "cash_paid": None, "credit_left": None,
                           "locked": (row["year"], row["month"]) not in opened}
    return frozen


def ledger(business, upto, *, today=None, opening=None, freeze=True, filing_date=None):
    today = today or timezone.localdate()
    upto = date.fromisoformat(upto + "-01") if isinstance(upto, str) else upto.replace(day=1)
    if upto < START or upto > today.replace(day=1):
        return {}
    saved = uncached(OpeningCredit).filter(business_id=business.pk).values(*HEADS).first()
    books = _book_groups(business, upto, filing_date=filing_date, today=today)
    frozen = _records(business, upto)
    effective_opening = heads(opening if opening is not None else saved)
    # Legacy locks without figures are recomputed from the opening being read
    # or previewed. The unlock service persists a baseline before books change.
    legacy = list(uncached(FiledPeriod).filter(business_id=business.pk)
                  .filter(Q(year__lt=upto.year) | Q(year=upto.year, month__lte=upto.month))
                  .values("year", "month"))
    if freeze:
        for old in sorted(legacy, key=lambda row: (row["year"], row["month"])):
            key = f'{old["year"]:04d}-{old["month"]:02d}'
            if key >= month_key(START) and key not in frozen:
                position = calculate_ledger(books, frozen, effective_opening, key,
                                            opening_typed=opening is not None or saved is not None)[key]
                frozen[key] = {"figures": position, "recorded": False, "locked": True, "credit_left": None}
    return calculate_ledger(books, frozen if freeze else {}, effective_opening,
                            month_key(upto), opening_typed=opening is not None or saved is not None)


def month_position(business, year, month, *, today=None, filing_date=None):
    return ledger(business, date(year, month, 1), today=today, filing_date=filing_date).get(f"{year:04d}-{month:02d}")


def opening_effect(business, opening, *, today=None):
    today = today or timezone.localdate()
    before = ledger(business, today, today=today)
    after = ledger(business, today, today=today, opening=opening)
    hypothetical = ledger(business, today, today=today, opening=opening, freeze=False)
    frozen = [key for key, row in before.items() if row["recorded"]]
    keys = list(before)
    reaches = keys[keys.index(frozen[0]) - 1] if frozen and keys.index(frozen[0]) else (None if frozen else keys[-1])
    changed = [key for key in frozen if any(before[key][field] != hypothetical[key][field]
                                           for field in ("cash", "carry_on"))]
    # If April is already filed, the opening change reaches no month. Report
    # March as the boundary and zero current-month effect, without inventing a ledger before April.
    target = reaches or month_key(START)
    return {"reaches": reaches or "2025-03",
            "carried_out": {"from": before[target]["carry_on"]["total"], "to": after[target]["carry_on"]["total"]},
            "cash": {"month": target, "from": before[target]["cash"]["total"], "to": after[target]["cash"]["total"]},
            "filed_differ": {"count": len(changed), "from": changed[0] if changed else None,
                             "to": changed[-1] if changed else None}}


def _party(row):
    return SimpleNamespace(gst_number=row["invoice__customer__gst_number"], state_name=row["invoice__customer__state_name"])


def _turnover(business, day):
    start, end = fy_range(max(2025, fy_of(day) - 1))
    return to_paise(_sales_lines(business).filter(invoice__invoice_date__range=(start, end))
                    .aggregate(total=Sum(taxable_expression()))["total"] or 0)


def gstr3b_tables(business, year, month, *, today=None, position=None, filing_date=None):
    today = today or timezone.localdate()
    day, key = date(year, month, 1), f"{year:04d}-{month:02d}"
    if position is None:
        position = month_position(business, year, month, today=today, filing_date=filing_date)
    if position is None:
        return None
    if position["filed"] and position.get("tables"):
        tables = deepcopy(position["tables"])
        tables.update(filed=True, as_filed_at=position["as_filed_at"], cash_paid=position["cash_paid"],
                      carry_on=position["carry_on"], interest_note=INTEREST_NOTE)
        record = position.get("recorded") and (
            uncached(FilingRecord).filter(business_id=business.pk, year=year, month=month, kind="gstr3b")
            .values("late_fee", "interest").first())
        if record:
            tables["late"] = recorded_late(tables.get("late"), record)
        return tables
    sales = (_sales_lines(business).filter(invoice__invoice_date__gte=day, invoice__invoice_date__lt=next_month(day))
             .annotate(nil=Case(When(gst_tax_rate=0, then=True), default=False, output_field=BooleanField()))
             .values("nil").annotate(bills=Count("invoice_id", distinct=True),
                                      taxable=Sum(taxable_expression()), **_sums()).order_by())
    t31a, t31c = {"bills": 0, "taxable": Decimal(0), **heads()}, {"taxable": Decimal(0)}
    for row in sales:
        if row["nil"]:
            t31c["taxable"] = to_paise(row["taxable"])
        else:
            t31a = {"bills": row["bills"], "taxable": to_paise(row["taxable"]), **heads(row)}
    t31a.update(heads(position["output"]))
    t31a["taxable"] = to_paise(position.get("taxable", t31a["taxable"]))
    t32 = {}
    for row in (_sales_lines(business).filter(invoice__invoice_date__gte=day, invoice__invoice_date__lt=next_month(day),
                                              gst_tax_rate__gt=0)
                .values("invoice__place_of_supply", "invoice__customer__gst_number", "invoice__customer__state_name")
                .annotate(bills=Count("invoice_id", distinct=True), taxable=Sum(taxable_expression()),
                          igst=Sum(paise_expression("igst"))).order_by()):
        bill = SimpleNamespace(business=business, customer=_party(row), place_of_supply=row["invoice__place_of_supply"])
        if clean_gstin(bill.customer.gst_number) or not supply_interstate(bill):
            continue
        pos = place_of_supply(bill)
        group = t32.setdefault(pos, {"place_of_supply": pos, "place_of_supply_name": GST_CODE.get(pos, ""),
                                     "bills": 0, "taxable": Decimal(0), "igst": Decimal(0)})
        for field in ("bills", "taxable", "igst"):
            group[field] += row[field]
    purchase = (_purchase_lines(business, filing_month=day, filing_date=filing_date, today=today).filter(credit_month=day)
                .values("invoice_id", "invoice__invoice_number", "invoice__invoice_date", "invoice__created_at",
                        "invoice__customer__name", "invoice__customer__gst_number", "invoice__customer__state_name",
                        "invoice__itc_eligible", "invoice__needs_review", "lapsed")
                .annotate(**_sums(), nil_taxable=Sum(taxable_expression(), filter=Q(gst_tax_rate=0)),
                          taxable=Sum(taxable_expression())).order_by())
    t4a5, t4b1, t4d2 = ({"bills": 0, "heads": heads(), "late": []},
                        {"bills": 0, "heads": heads(), "list": []}, {"bills": 0, "heads": heads(), "list": []})
    t5, confirm = {"inter": Decimal(0), "intra": Decimal(0)}, []
    for row in purchase:
        money = heads(row)
        item = {"id": row["invoice_id"], "bill_no": row["invoice__invoice_number"],
                "supplier_name": row["invoice__customer__name"], "heads": money}
        target = t4d2 if row["lapsed"] and money["total"] else t4a5
        if money["total"]:
            target["bills"] += 1
            target["heads"] = add_heads(target["heads"], money)
            if target is t4d2:
                target["list"].append(item)
            elif not row["invoice__itc_eligible"]:
                t4b1["bills"] += 1
                t4b1["heads"] = add_heads(t4b1["heads"], money)
                t4b1["list"].append(item)
            if target is t4a5 and row["invoice__invoice_date"].replace(day=1) < day:
                t4a5["late"].append({"id": item["id"], "bill_no": item["bill_no"], "heads": money,
                                      "bill_date": row["invoice__invoice_date"].isoformat(),
                                      "entered_on": timezone.localtime(row["invoice__created_at"]).date().isoformat()})
            if target is t4a5 and row["invoice__needs_review"]:
                confirm.append(item)
        party = _party(row)
        # R3A-3: Table 5 includes purchases from unregistered suppliers with no
        # GST charged (every such line), as built; the owner's CA can say otherwise.
        nil_value = row["taxable"] if not clean_gstin(party.gst_number) else row["nil_taxable"]
        t5["inter" if is_interstate(business, party) else "intra"] += to_paise(nil_value or 0)
    t4c = subtract_heads(t4a5["heads"], t4b1["heads"])
    recorded = set(uncached(FilingRecord).filter(business_id=business.pk, year=year, month=month).values_list("kind", flat=True))
    late = late_cost(year, month, cash=position["cash"], turnover=_turnover(business, day), today=today,
                     filed={"gstr1": "gstr1" in recorded or position["filed"], "gstr3b": "gstr3b" in recorded or position["filed"]},
                     nil=nil_returns(t31a, t31c, position, t4a5, t4d2))
    amendment = ({"months": position["amendments_in"],
                  **{kind: add_heads(*(entry[kind] for entry in position["amendments"])) for kind in ("output", "credit")}}
                 if position["amendments_in"] else None)
    return {"month": key, "filed": position["filed"], "as_filed_at": position["as_filed_at"],
            "t31a": t31a, "t31c": t31c, "t32": list(t32.values()), "amendments": amendment,
            "carry_in": position["carry_source"], "t4a5": t4a5, "t4b1": t4b1, "t4c": t4c, "t4d2": t4d2, "t5": t5,
            "t5_note": T5_NOTE, "reduction_on": position["reduction_on"], "reduction_note": position["reduction_note"],
            **{field: position[field] for field in ("available", "steps", "used", "cash", "cash_paid", "carry_on", "opening_missing")},
            "to_confirm": confirm, "cross_head": position.get("cross_head"), "late": late, "interest_note": INTEREST_NOTE}


T5_NOTE = "Includes purchases from unregistered suppliers with no GST charged."


def nil_returns(t31a, t31c, position, t4a5, t4d2):
    """Nil returns for late fees (Notification 19/2021, R3A-1).

    GSTR-3B is nil only with no outward supply of any kind (3.1(a)-(e); the app
    files no zero-rated, reverse-charge or non-GST supply), and no credit
    claimed in the period: this month's credit and its corrections. Credit
    carried in from earlier months doesn't count.
    """
    sales = bool(to_paise(t31a.get("taxable") or 0) or to_paise(t31c.get("taxable") or 0))
    claimed = [position.get("base_credit"), *(entry["credit"] for entry in position.get("amendments", [])),
               t4a5.get("heads"), t4d2.get("heads")]
    tax = any(heads(values)[head] for values in (t31a, *claimed) for head in HEADS)
    return {"gstr1": not sales, "gstr3b": not (sales or tax)}


def _lapsed(business, day, filed_on):
    rows = list(_purchase_lines(business, filing_month=day, filing_date=filed_on, today=filed_on)
                .filter(credit_month=day, credit_eligible=True, lapsed=True)
                .values("invoice_id", "invoice__invoice_number", "invoice__customer__name").annotate(**_sums()).order_by())
    items = [{"id": row["invoice_id"], "bill_no": row["invoice__invoice_number"], "supplier_name": row["invoice__customer__name"],
              "heads": heads(row)} for row in rows if heads(row)["total"]]
    return {"heads": add_heads(*(item["heads"] for item in items)), "list": items}


def refresh_filing_date(business, year, month, figures, old, new):
    """R3A-7: a GSTR-3B's new filing day re-works its late costs and Sec 16(4) credit.

    Only the date-bound figures move; the rest of the snapshot stays as filed.
    Returns the new figures and the credit that moved into (or out of) 4(D)(2).
    """
    day, figures = date(year, month, 1), deepcopy(figures)
    tables = figures["tables"] = figures.get("tables") or {}
    before, after = _lapsed(business, day, old), _lapsed(business, day, new)
    moved = subtract_heads(after["heads"], before["heads"])
    if any(moved[head] for head in HEADS):
        for kind in ("credit", "base_credit"):
            figures[kind] = subtract_heads(heads(figures.get(kind)), moved)
        # Re-run set-off from the tax before any cash already added for credit
        # reversed beyond the balance, so moving credit back releases that cash.
        output = heads(figures.get("output", figures.get("setoff_output")))
        excess = subtract_heads(heads(figures.get("setoff_output", output)), output)
        available = subtract_heads(subtract_heads(heads(figures.get("available")), excess), moved)
        for head in HEADS:
            if available[head] < 0:
                output[head] -= available[head]
                available[head] = Decimal(0)
        output, available = heads(output), heads(available)
        figures.update(setoff_output=output, available=available, **set_off(output, available))
        bills = len(after["list"]) - len(before["list"])
        t4a5, t4d2 = tables.setdefault("t4a5", {}), tables.setdefault("t4d2", {})
        t4a5.update(heads=subtract_heads(heads(t4a5.get("heads")), moved), bills=t4a5.get("bills", 0) - bills)
        t4d2.update(heads=add_heads(heads(t4d2.get("heads")), moved), bills=len(after["list"]), list=after["list"])
        tables["t4c"] = subtract_heads(t4a5["heads"], heads((tables.get("t4b1") or {}).get("heads")))
        tables.update({field: figures[field] for field in ("available", "steps", "used", "cash", "carry_on")})
    old_late = tables.get("late") or {}
    nil = old_late.get("nil") or nil_returns(tables.get("t31a") or {}, tables.get("t31c") or {}, figures,
                                              tables.get("t4a5") or {}, tables.get("t4d2") or {})
    tables["late"] = late_cost(year, month, cash=heads(figures.get("cash")), turnover=_turnover(business, day), nil=nil,
                               filed={"gstr1": True}, today=new)
    return json_money(figures), moved


def recorded_late(worked, record):
    """R3A-4: a recorded GSTR-3B shows the late fee and interest on its record."""
    fee, interest = to_paise(record["late_fee"] or 0), to_paise(record["interest"] or 0)
    if not fee and not interest:
        return None
    worked = worked or {}
    result = {kind: {**worked.get(kind, {}), "days": 0, "capped": False, "fee": Decimal(0)} for kind in ("gstr1", "gstr3b")}
    result["gstr3b"]["fee"] = fee
    return {**worked, **result, "interest": interest, "total": fee + interest, "recorded": True}


def interest_heads(cash, late):
    """Allocate the rounded estimate without creating a paisa by rounding twice."""
    result = heads()
    if not late or not late["interest"]:
        return result
    cash, remaining = heads(cash), to_paise(late["interest"])
    active = [head for head in ("igst", "cgst", "sgst") if cash[head] > 0]
    for head in active:
        part = remaining if head == active[-1] else min(remaining, to_paise(
            cash[head] * Decimal("0.18") * late["gstr3b"]["days"] / Decimal(365)))
        result[head], remaining = part, remaining - part
    return heads(result)


def build_gstr3b_json(business, year, month, *, today=None):
    """GSTN Save GSTR3B v7.1 keys; V5.8 utility's November 2025 section gate.

    Returns Decimal numbers. The HTTP download uses the portal JSON encoder,
    never json_money (which deliberately makes the UI's money strings).
    """
    table = gstr3b_tables(business, year, month, today=today)

    def tax(values=None):
        values = heads(values)
        return {"iamt": values["igst"], "camt": values["cgst"], "samt": values["sgst"], "csamt": Decimal(0)}

    amendment_credit = heads((table.get("amendments") or {}).get("credit"))
    additions = heads({head: max(Decimal(0), amendment_credit[head]) for head in HEADS})
    reversals = heads({head: max(Decimal(0), -amendment_credit[head]) for head in HEADS})
    result = {
        "gstin": clean_gstin(business.gst_number), "ret_period": f"{month:02d}{year:04d}",
        "sup_details": {"osup_det": {"txval": to_paise(table["t31a"]["taxable"]), **tax(table["t31a"])},
                        "osup_zero": {"txval": 0, "iamt": 0, "csamt": 0},
                        "osup_nil_exmp": {"txval": to_paise(table["t31c"]["taxable"])},
                        "isup_rev": {"txval": 0, **tax()}, "osup_nongst": {"txval": 0}},
        "eco_dtls": {"eco_sup": {"txval": 0, **tax()}, "eco_reg_sup": {"txval": 0}},
        "itc_elg": {
            "itc_avl": [{"ty": kind, **tax(add_heads(table["t4a5"]["heads"], additions) if kind == "OTH" else None)}
                        for kind in ("IMPG", "IMPS", "ISRC", "ISD", "OTH")],
            "itc_rev": [{"ty": "RUL", **tax(table["t4b1"]["heads"])}, {"ty": "OTH", **tax(reversals)}],
            "itc_net": tax(add_heads(table["t4c"], amendment_credit)),
            "itc_inelg": [{"ty": "RUL", **tax()}, {"ty": "OTH", **tax(table["t4d2"]["heads"])}]},
        "inward_sup": {"isup_details": [{"ty": "GST", **table["t5"]}, {"ty": "NONGST", "inter": 0, "intra": 0}]},
        "intr_ltfee": {"intr_details": tax(interest_heads(table["cash"], table["late"]))},
    }
    if (year, month) < (2025, 11):
        result["inter_sup"] = {"unreg_details": [{"pos": row["place_of_supply"], "txval": to_paise(row["taxable"]),
                                                   "iamt": to_paise(row["igst"])} for row in table["t32"]],
                               "comp_details": [], "uin_details": []}
    return result


def credit_at_risk_summary(business_ids, today=None):
    """One aggregate with correlated EXISTS, never one read per bill or firm."""
    today = today or timezone.localdate()
    zero = {"count": 0, "tax": Decimal("0.00"), "earliest_deadline": None, "first_business_id": None,
            "lapsed": {"count": 0, "tax": Decimal("0.00")}}
    if not business_ids:
        return zero
    source_fy = fy_of(today) - 1
    deadline = date(source_fy + 1, 11, 30)
    if source_fy < fy_of(START):
        return zero
    if today > deadline:
        # R3A-9: every month's credit with its GSTR-3B still unfiled has lapsed.
        rows = _risk_rows(business_ids, source_fy)
        return {**zero, "lapsed": {"count": rows["count"], "tax": to_paise(rows["tax"] or 0)}}
    rows = _risk_rows(business_ids, source_fy)
    return {**rows, "tax": to_paise(rows["tax"] or 0), "earliest_deadline": deadline if rows["count"] else None,
            "lapsed": zero["lapsed"]}


def _risk_rows(business_ids, source_fy):
    if not {"itc_month", "itc_eligible"} <= {field.name for field in Invoice._meta.fields}:
        raise ImproperlyConfigured("3A credit summary requires part 2A's purchase credit fields.")
    start, end = fy_range(source_fy)
    records = uncached(FilingRecord).filter(business_id=OuterRef("business_id"), year=OuterRef("credit_year"),
                                            month=OuterRef("credit_number"), kind="gstr3b")
    legacy = uncached(FiledPeriod).filter(business_id=OuterRef("business_id"), year=OuterRef("credit_year"),
                                          month=OuterRef("credit_number"))
    frozen = uncached(FilingMonth).filter(
        business_id=OuterRef("business_id"), year=OuterRef("credit_year"), month=OuterRef("credit_number"),
        legacy_frozen_at__isnull=False)
    return (uncached(Invoice).filter(business_id__in=business_ids, type_of_invoice="inward", itc_eligible=True,
                                     invoice_date__range=(start, end))
            .annotate(credit_date=Coalesce("itc_month", TruncMonth("invoice_date"), output_field=DateField()))
            .filter(credit_date__lte=date(source_fy + 1, 10, 1))
            .annotate(credit_year=ExtractYear("credit_date"), credit_number=ExtractMonth("credit_date"))
            .annotate(recorded=Exists(records), legacy=Exists(legacy), frozen=Exists(frozen))
            .filter(recorded=False, legacy=False, frozen=False)
            .filter(Q(lineitem__igst__gt=0) | Q(lineitem__cgst__gt=0) | Q(lineitem__sgst__gt=0))
            .aggregate(count=Count("pk", distinct=True), tax=Sum(paise_expression("lineitem__igst")
                                                               + paise_expression("lineitem__cgst")
                                                               + paise_expression("lineitem__sgst")),
                       first_business_id=Min("business_id")))
