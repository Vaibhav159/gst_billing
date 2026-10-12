"""GSTR-1 checks, with the same database predicates for detail and bulk reads."""

import re
from datetime import date
from decimal import Decimal

from django.db.models import (
    BooleanField,
    Case,
    CharField,
    Count,
    DecimalField,
    Exists,
    ExpressionWrapper,
    F,
    IntegerField,
    OuterRef,
    Prefetch,
    Q,
    Subquery,
    Sum,
    Value,
    When,
)
from django.db.models.functions import (
    Cast,
    Coalesce,
    Concat,
    Length,
    Lower,
    Mod,
    Replace,
    Round,
    StrIndex,
    Substr,
    Trim,
    Upper,
)

from billing.cache import uncached
from billing.constants import BILL_ACTIVE, GST_CODE
from billing.fy import fy_label, fy_of, fy_range
from billing.models import Business, Invoice, LineItem
from billing.numbering import bill_ref
from billing.services.bill_reads import _tax_off
from billing.services.gstr1_file import build_gstr1
from billing.tax_rules import normalize_state_name, registered
from billing.text import day_text, inr, money

KINDS = ("duplicate", "gstin", "badgstin", "empty", "hsn", "state", "head")


def _trim_gstin(expr):
    for ch in "\t\n\r\f\v":
        expr = Replace(expr, Value(ch), Value(""))
    return Upper(Trim(expr))


def _state(prefix):
    """SQL mirror of tax_rules.state_code, required for aggregate head checks."""
    gstin = _trim_gstin(Coalesce(F(prefix + "gst_number"), Value("")))
    name = prefix + "state_name__iregex"
    choices = []
    for code, state in GST_CODE.items():
        tokens = normalize_state_name(state).split()
        pattern = r"^\s*" + r"\s+".join("(?:AND|&)" if t == "AND" else re.escape(t) for t in tokens) + r"\s*$"
        choices.append(When(**{name: pattern}, then=Value(code)))
    return Case(When(registered(prefix + "gst_number"), then=Substr(gstin, 1, 2)),
                *choices, default=Value(""), output_field=CharField())


def _checksum():
    alphabet = Value("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    terms = []
    for i in range(14):
        product = (StrIndex(alphabet, Substr(F("_gstin"), i + 1, 1)) - 1) * (2 if i % 2 else 1)
        # Both supported databases divide integer operands as integers. Valid
        # GSTIN characters give non-negative products, so this is floor(p / 36).
        quotient = ExpressionWrapper(product / Value(36), output_field=IntegerField())
        terms.append(quotient + Mod(product, 36, output_field=IntegerField()))
    while len(terms) > 1:
        terms = [terms[i] + terms[i + 1] if i + 1 < len(terms) else terms[i]
                 for i in range(0, len(terms), 2)]
    total = terms[0]
    remainder = Mod(total, 36, output_field=IntegerField())
    index = Cast(Mod(36 - remainder, 36, output_field=IntegerField()) + 1, IntegerField())
    return Substr(alphabet, index, 1)


def checked_bills(business_ids, year, month):
    """Narrow, uncached sales with one flag per check; no line data crosses the wire."""
    first, stop = date(year, month, 1), date(year + month // 12, month % 12 + 1, 1)
    fy = fy_of(first)
    start, end = fy_range(fy)
    prior = fy_range(fy - 1 if fy > 2025 else fy)
    lines = uncached(LineItem).filter(invoice_id=OuterRef("pk"))
    hsn = lines.alias(code=Trim("hsn_code"))
    missing = hsn.filter(Q(code="") | Q(code__isnull=True)).values("invoice_id").annotate(n=Count("pk")).values("n")
    duplicates = Invoice.objects.sales().filter(business_id=OuterRef("business_id"), invoice_date__range=(start, end),
                                                invoice_number__iexact=OuterRef("invoice_number")).exclude(pk=OuterRef("pk"))
    turnover = (uncached(LineItem).filter(invoice__business_id=OuterRef("business_id"),
                                          invoice__type_of_invoice="outward", invoice__status=BILL_ACTIVE,
                                          invoice__invoice_date__range=prior)
                .values("invoice__business_id").annotate(total=Sum(Round(F("quantity") * F("rate"), 2)))
                .values("total"))
    bills = (Invoice.objects.sales().filter(business_id__in=business_ids, invoice_date__gte=first, invoice_date__lt=stop)
             .annotate(_gstin=_trim_gstin(Coalesce("customer__gst_number", Value(""))),
                       _own_state=_state("business__"), _buyer_state=_state("customer__"),
                       _chosen=Trim(Coalesce("place_of_supply", Value(""))))
             .annotate(_gstin_len=Length("_gstin"), _checksum=_checksum(),
                       _registered=Case(When(registered("customer__gst_number"), then=Value(True)), default=Value(False)),
                       _pos=Case(When(~Q(_chosen=""), then=F("_chosen")),
                                 When(~Q(_buyer_state=""), then=F("_buyer_state")), default=F("_own_state")),
                       _turnover=Coalesce(Subquery(turnover), Value(Decimal("0")), output_field=DecimalField()),
                       _has_lines=Exists(lines), _missing=Coalesce(Subquery(missing), 0),
                       _invalid_hsn=Exists(hsn.exclude(code__regex=r"^[0-9]{4,8}$")),
                       _short_hsn=Exists(hsn.exclude(code__regex=r"^[0-9]{6,8}$")),
                       _local_heads=Exists(lines.filter(Q(cgst__gt=0) | Q(sgst__gt=0))),
                       _inter_heads=Exists(lines.filter(igst__gt=0)))
             .annotate(_inter=Case(When(~Q(_own_state="") & ~Q(_pos=F("_own_state")), then=Value(True)),
                                   default=Value(False), output_field=BooleanField()),
                       _valid_gstin=Case(When(_gstin__regex=r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$",
                                              then=Value(True)),
                                         default=Value(False), output_field=BooleanField())))
    active = Q(status=BILL_ACTIVE)
    valid = Q(_valid_gstin=True, _checksum=Substr(F("_gstin"), 15, 1)) & Q(_gstin__regex=r"^(?:" + "|".join(GST_CODE) + ")")
    predicates = {
        "duplicate": Exists(duplicates) & ~Q(invoice_number=""),
        "gstin": active & Q(customer__customer_type="business") & ~Q(_registered=True),
        "badgstin": active & Q(_registered=True) & ~valid,
        "empty": active & Q(_has_lines=False),
        "hsn": active & (Q(_missing__gt=0) | Q(_invalid_hsn=True) | Q(_turnover__gt=50000000, _registered=True, _short_hsn=True)),
        "state": active & ~Q(_pos__in=GST_CODE),
        "head": active & (Q(_inter=True, _local_heads=True) | Q(_inter=False, _inter_heads=True)),
    }
    return bills.annotate(**{f"check_{k}": Case(When(v, then=Value(True)), default=Value(False), output_field=BooleanField())
                             for k, v in predicates.items()})


def _message(kind):
    num = F("invoice_number")
    suffix = {
        "gstin": ": business customer without a GSTIN", "empty": " has no items",
        "state": ": place of supply isn't a known state",
    }
    if kind in suffix:
        return Concat(num, Value(suffix[kind]))
    if kind == "duplicate":
        return Concat(Value("Bill number "), num, Value(" is used twice"))
    if kind == "badgstin":
        return Concat(num, Value(": "), F("customer__name"), Value("'s GSTIN "), F("_gstin"),
                      Value(" fails its check character, so the portal won't take it. Correct the GSTIN on the customer."))
    if kind == "head":
        return Concat(num, Case(When(_inter=True, then=Value(": CGST + SGST charged on an inter-state sale")),
                                default=Value(": IGST charged on a sale inside the state")))
    return Concat(num, Case(When(_missing=1, then=Value(": a line has no HSN code")),
                            When(_missing__gt=1, then=Concat(Value(": "), F("_missing"), Value(" lines have no HSN code"),
                                                           output_field=CharField())),
                            When(_invalid_hsn=True, then=Value(": an HSN code isn't 4 to 8 digits")),
                            default=Value(": an HSN code needs 6 digits for a business buyer")))


def _firm_count(firm_bills, counter):
    return Coalesce(Subquery(firm_bills.values("business_id").annotate(n=Count(counter, distinct=True)).values("n")[:1]), 0)


def gstr1_blockers(business_ids, months):
    """Only grouped counts and first witness text, never every bill or line; one query for every month."""
    business_ids = list(business_ids)
    out = {(bid, month): {"count": 0, "bills": 0, "first_two": []} for bid in business_ids for month in months}
    if not business_ids or not months:
        return out
    per_month = []
    for month in months:
        year, mm = map(int, month.split("-"))
        bills = checked_bills(business_ids, year, mm).annotate(**{f"text_{k}": _message(k) for k in KINDS})
        any_check = Q(**{f"check_{KINDS[0]}": True})
        for k in KINDS[1:]:
            any_check |= Q(**{f"check_{k}": True})
        # One row per firm, each figure a subquery over that firm's bills: a witness subquery inside an
        # aggregate would run once per bill, which SQLite took minutes over at a few hundred bills.
        firm_bills = bills.filter(business_id=OuterRef("pk"))
        fields = {"month_key": Value(month, output_field=CharField()),
                  "bills": _firm_count(firm_bills.filter(any_check), "pk")}
        for k in KINDS:
            condition = Q(**{f"check_{k}": True})
            fields[k] = _firm_count(firm_bills.filter(condition), Lower("invoice_number") if k == "duplicate" else "pk")
            texts = firm_bills.filter(condition).order_by(f"text_{k}").values(f"text_{k}").distinct()
            fields[f"first_{k}"] = Subquery(texts[:1])
            fields[f"second_{k}"] = Subquery(texts[1:2])
        per_month.append(uncached(Business).filter(pk__in=business_ids).annotate(**fields).values("pk", *fields).order_by())
    # The months run as one UNION ALL so a year's scan stays one query (P5-3).
    rows = per_month[0].union(*per_month[1:], all=True) if len(per_month) > 1 else per_month[0]
    for row in rows:
        out[row["pk"], row["month_key"]] = {"count": sum(row[k] for k in KINDS), "bills": row["bills"],
                                            "first_two": [row[f"{order}_{k}"] for k in KINDS for order in ("first", "second")
                                                          if row[f"{order}_{k}"]][:2]}
    return out
    for month in months:
        year, mm = map(int, month.split("-"))
        bills = checked_bills(business_ids, year, mm).annotate(**{f"text_{k}": _message(k) for k in KINDS})
        any_check = Q(**{f"check_{KINDS[0]}": True})
        for k in KINDS[1:]:
            any_check |= Q(**{f"check_{k}": True})
        # One row per firm, each figure a subquery over that firm's bills: a witness subquery inside an
        # aggregate would run once per bill, which SQLite took minutes over at a few hundred bills.
        firm_bills = bills.filter(business_id=OuterRef("pk"))
        fields = {"bills": _firm_count(firm_bills.filter(any_check), "pk")}
        for k in KINDS:
            condition = Q(**{f"check_{k}": True})
            fields[k] = _firm_count(firm_bills.filter(condition), Lower("invoice_number") if k == "duplicate" else "pk")
            texts = firm_bills.filter(condition).order_by(f"text_{k}").values(f"text_{k}").distinct()
            fields[f"first_{k}"] = Subquery(texts[:1])
            fields[f"second_{k}"] = Subquery(texts[1:2])
        for row in uncached(Business).filter(pk__in=business_ids).annotate(**fields).values("pk", *fields):
            out[row["pk"], month] = {"count": sum(row[k] for k in KINDS), "bills": row["bills"],
                                               "first_two": [row[f"{order}_{k}"] for k in KINDS for order in ("first", "second")
                                                             if row[f"{order}_{k}"]][:2]}
    return out


def _reference(bill, business):
    standard = re.fullmatch(re.escape((business.invoice_prefix or "").strip()) + "/" +
                            re.escape(fy_label(fy_of(bill.invoice_date))) + r"/[0-9]+", bill.invoice_number, re.I)
    return {**bill_ref(bill), "total_amount": money(bill.total_amount), "typed": bill.paper or not bool(standard)}


def month_checks(business, year, month, *, built=None):
    first = date(year, month, 1)
    flags = checked_bills([business.pk], year, month).annotate(**{f"text_{k}": _message(k) for k in KINDS})
    bills = list(flags.select_related("customer").only("invoice_number", "invoice_date", "status", "total_amount",
                                                        "paper", "customer__name", "customer__gst_number")
                 .prefetch_related(Prefetch("lineitem_set", queryset=uncached(LineItem).only(
                     "invoice_id", "quantity", "rate", "gst_tax_rate", "cgst", "sgst", "igst"), to_attr="gst_lines"))
                 .order_by("invoice_date", "pk"))
    blockers, notes, seen = [], [], set()
    for bill in bills:
        for kind in KINDS:
            if not getattr(bill, f"check_{kind}"):
                continue
            refs = [bill]
            suggested = None
            if kind == "duplicate":
                key = bill.invoice_number.casefold()
                if key in seen:
                    continue
                seen.add(key)
                start, end = fy_range(fy_of(first))
                others = Invoice.objects.sales().filter(business=business, invoice_date__range=(start, end),
                                                        invoice_number__iexact=bill.invoice_number)
                total = others.count()
                refs = list(others.select_related("customer").only("invoice_number", "invoice_date", "status",
                                                                    "total_amount", "paper", "customer__name")
                            .order_by("invoice_date", "pk")[:10])
                typed = [r for r in refs if _reference(r, business)["typed"]]
                suggested = (typed or refs)[-1].pk
            else:
                total = 1
            customer = None
            if kind in ("gstin", "badgstin"):
                customer = {"id": bill.customer_id, "name": bill.customer.name, "gst_number": bill.customer.gst_number or ""}
            blockers.append({"kind": kind, "blocks": True, "text": getattr(bill, f"text_{kind}"), "detail": "",
                             "bills": [_reference(r, business) for r in refs], "more_bills": max(0, total - 10),
                             "customer": customer, "suggested": suggested})
        if bill.status == BILL_ACTIVE and any(_tax_off(li) for li in bill.gst_lines):
            notes.append({"kind": "tax", "blocks": False, "text": f"{bill.invoice_number}: a line's tax doesn't match its GST rate",
                          "detail": "", "bills": [_reference(bill, business)], "more_bills": 0, "customer": None, "suggested": None})
    if built is None:
        built = build_gstr1(business, year, month, amendments=False)
    for gap in built["gaps"]:
        notes.append({"kind": "gap", "blocks": False, "text": f"Numbers {gap['list']} aren't on any bill",
                      "detail": "Table 13 files them as cancelled. If they're paper bills not entered yet, enter them before filing.",
                      "bills": [], "more_bills": 0, "customer": None, "suggested": None})
    for row in built["sections"]["cancelled"]:
        if row["kind"] == "deleted":
            notes.append({"kind": "deleted", "blocks": False,
                          "text": f"{row['bill']['invoice_number']} was deleted on {day_text(date.fromisoformat(row['on']))}",
                          "detail": "Its number counts as cancelled in Documents issued.", "bills": [row["bill"]],
                          "more_bills": 0, "customer": None, "suggested": None})
    # Part 2A owns needs_review/itc_month. This capability guard is only for the
    # task replay before that additive migration lands; the plan orders 2A first.
    if any(field.name == "needs_review" for field in Invoice._meta.fields):
        stop = date(year + month // 12, month % 12 + 1, 1)
        purchases = uncached(Invoice).filter(business=business, type_of_invoice="inward", needs_review=True).filter(
            Q(itc_month=first) | Q(itc_month__isnull=True, invoice_date__gte=first, invoice_date__lt=stop))
        for purchase in purchases.values("id", "invoice_number", "customer__name").annotate(
                tax=Coalesce(Sum(F("lineitem__cgst") + F("lineitem__sgst") + F("lineitem__igst")), Decimal("0"))):
            notes.append({"kind": "to_confirm", "blocks": False,
                          "text": f"GSTR-3B · credit to confirm: {purchase['invoice_number']} · {inr(purchase['tax'])}",
                          "detail": f"{purchase['customer__name']} · read from a photo, not checked yet. It's inside 4(A)(5) until someone checks it.",
                          "bills": [{"id": purchase["id"], "bill_no": purchase["invoice_number"],
                                     "supplier_name": purchase["customer__name"], "tax": money(purchase["tax"])}],
                          "more_bills": 0, "customer": None, "suggested": None})
    bad = {r["kind"] for r in blockers + notes}
    passes = [text for kinds, text in [({"duplicate"}, "Every bill number is used once"),
              ({"hsn", "tax"}, "Every line has an HSN code and a GST rate"),
              ({"empty"}, "Every bill has at least one item"),
              ({"state", "head"}, "Place of supply and tax type agree on every bill")] if not kinds & bad]
    if not {"gstin", "badgstin"} & bad:
        n = sum(b.status == BILL_ACTIVE and b._registered for b in bills)
        if n:
            passes.append(f"{n} business {'bill has' if n == 1 else 'bills have'} a valid GSTIN")
    return {"blockers": blockers, "notes": notes, "passes": passes}
