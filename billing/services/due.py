"""Due items: role gates precede reads; wording is shared by every surface."""
from collections import defaultdict
from datetime import timedelta
from importlib.util import find_spec

from django.db.models import Count, Exists, OuterRef, Q, Window

from billing.cache import uncached
from billing.fy import due_dates, fy_of, fy_range
from billing.models import BinnedInvoice, FiledPeriod, Invoice, InwardCapture, SaleDraft, SavedDraft
from billing.numbering import Numbered, missing_numbers
from billing.rates import firm_short
from billing.roles import can
from billing.services.bill_reads import itax_summary
from billing.services.sales import mobile_of

ORDER = ("blocker", "file_gstr1", "pay_3b", "gaps", "open_blocker", "credit", "itax", "captures", "unsent", "drafts", "review")
KEYS = {"blocker": "gst.file", "file_gstr1": "gst.file", "pay_3b": "gst.file", "gaps": "bill.create",
        "open_blocker": "bill.edit", "credit": "gst.file", "itax": "gst.file", "captures": "purchase.create",
        "unsent": "bill.send", "drafts": "bill.create", "review": "purchase.edit"}


def item(kind, count, title, detail, due=None, firm=None, month=None, **more):
    return {"kind": kind, "due": due.isoformat() if due else None, "count": count, "title": title, "detail": detail,
            "firm": firm, "month": month, "draft_id": None, "from": None, "to": None, "badge": None, **more}


def possessive(name):
    return name + ("'" if name.lower().endswith("s") else "'s")


def operational_items(user, firms, business_id, today, stages=None):
    out, ids = [], [f.pk for f in firms]
    ended = today.replace(day=1) - timedelta(days=1)
    month, name = ended.strftime("%Y-%m"), ended.strftime("%B")
    due = due_dates(ended.year, ended.month)["gstr1"]
    if can(user, "bill.create") and (due - today).days <= 15:
        closed = set()
        if stages is None:
            # Filing presence, not whether sales are currently editable: unlocking keeps the record.
            recorded = uncached(FiledPeriod).filter(business_id__in=ids, year=ended.year, month=ended.month).order_by().values_list("business_id", flat=True)
            if find_spec("billing.services.filing") is not None:
                from billing.models import FilingRecord
                recorded = recorded.union(uncached(FilingRecord).filter(business_id__in=ids,
                    year=ended.year, month=ended.month, kind="gstr1").order_by().values_list("business_id", flat=True))
            closed = {(pk, ended.year, ended.month) for pk in recorded}
        eligible = [f for f in firms if (stages.get((f.pk, month), "") not in {"gstr1", "filed", "unlocked"}
                    if stages is not None else (f.pk, ended.year, ended.month) not in closed)]
        numbers = defaultdict(list)
        eligible_ids = [f.pk for f in eligible]
        queries = [Invoice.objects.sales(), uncached(BinnedInvoice).live().filter(type_of_invoice="outward")]
        for query in queries:
            for firm_id, number, day in query.filter(business_id__in=eligible_ids, invoice_date__range=fy_range(fy_of(ended))).values_list("business_id", "invoice_number", "invoice_date"):
                numbers[firm_id].append(Numbered(number, day))
        for f in eligible:
            count, first = missing_numbers(f.pk, ended.year, ended.month, numbers[f.pk])
            if count:
                words = f"number {first[0]}" if count == 1 else f"{count} numbers ({', '.join(map(str, first))}{'…' if count > 4 else ''})"
                out.append(item("gaps", count, f"{possessive(firm_short(f))} {name} skips {words}",
                    "Paper bills not entered yet? Enter them before GSTR-1, or note why the number was skipped", due, f.pk, month))
    sales = Invoice.objects.sales().filter(business_id__in=ids).counted()
    if can(user, "gst.file"):
        first = fy_range(fy_of(today))[0]
        count, kinds = itax_summary(sales.filter(invoice_date__range=(first, today)))
        if count:
            address = kinds.get("b2b_address", 0) + kinds.get("b2c_address", 0)
            label = "income-tax or address" if address else "income-tax"
            parts = [(kinds.get("cash_limit", 0), "cash bills at or over ₹2 lakh (Sec 269ST)"),
                     (kinds.get("pan", 0) + kinds.get("walkin_limit", 0), "over ₹2 lakh without the buyer's PAN (Rule 114B)"),
                     (kinds.get("b2b_address", 0), "to a business without its address (Rule 46)"),
                     (kinds.get("b2c_address", 0), "of ₹50,000 or more without the buyer's address (Rule 46(f))")]
            out.append(item("itax", count, f"{count} {'bill needs' if count == 1 else 'bills need'} an {label} check",
                       " · ".join(f"{n} {text.replace('cash bills', 'cash bill') if n == 1 else text}" for n, text in parts if n), **{"from": first.isoformat(), "to": today.isoformat()}))
    if can(user, "purchase.create") and hasattr(InwardCapture, "discarded_at"):
        captures = uncached(InwardCapture).filter(status="new", discarded_at__isnull=True)
        if business_id is not None:
            captures = captures.filter(Q(business_id=business_id) | Q(business_id__isnull=True))
        count = captures.count()
        if count:
            out.append(item("captures", count, f"{count} captured {'bill' if count == 1 else 'bills'} to fill in", "Photos of supplier bills waiting to become purchases"))
    if can(user, "bill.send"):
        unsent = sales.filter(invoice_date=today, paper=False, sent_at__isnull=True).order_by("-created_at", "-id")
        names = [f"{number} · {name}" for number, name, mobile in unsent.values_list("invoice_number", "customer__name", "customer__mobile_number") if mobile_of(mobile)]
        if names:
            count = len(names)
            detail = ", ".join(names[:5]) + (f" and {count - 5} more" if count > 5 else "")
            out.append(item("unsent", count, f"{count} of today's bills {'hasn’t' if count == 1 else 'haven’t'} been sent".replace("’", "'"), detail))
    if can(user, "bill.create"):
        drafts = uncached(SaleDraft).exclude(Exists(uncached(SavedDraft).filter(pk=OuterRef("pk"))))
        if business_id is not None:
            drafts = drafts.filter(business_id=business_id)
        row = drafts.order_by("-updated_at", "-id").annotate(total=Window(Count("pk"))).values("pk", "total").first()
        if row:
            out.append(item("drafts", row["total"], f"{row['total']} unfinished {'bill' if row['total'] == 1 else 'bills'}", "Saved as you typed; open to finish or discard", draft_id=str(row["pk"])))
    if can(user, "purchase.edit") and hasattr(Invoice, "needs_review"):
        count = uncached(Invoice).counted().filter(type_of_invoice="inward", business_id__in=ids, needs_review=True).count()
        if count:
            out.append(item("review", count, f"{count} purchase {'bill needs' if count == 1 else 'bills need'} a check", "Read from a photo; confirm the GST rate"))
    return out


def due_next(user, firms, business_id, today, returns=False):

    from billing.services.due_gst import collect_gst, gst_items, returns_card
    keys = {key for key in KEYS.values() if can(user, key)}
    ready = find_spec("billing.services.filing") is not None
    facts = collect_gst(firms, today, keys, returns) if ready and (returns or keys & {"gst.file", "bill.edit"}) else None
    items = operational_items(user, firms, business_id, today, facts["stages"] if facts else None) if keys else []
    if facts:
        items.extend(gst_items(keys, firms, today, facts))
    return {"today": today.isoformat(), "items": sorted(items, key=lambda i: (i["due"] or "9999", ORDER.index(i["kind"]))),
            "returns": returns_card(firms, today, facts) if returns and facts else None}
