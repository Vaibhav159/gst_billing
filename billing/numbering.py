"""Bill numbers: the paper book's series, one per firm per financial year (design §4.4).

Paper first: every bill carries the number written on its paper bill, and the server never
makes one up. Numbers are stored as typed, trimmed, except that on or after the firm's
paper_full_number_from date, digits alone take the firm's format. A number is in use while an
active or cancelled bill or a deleted one (in the bin) has it, compared without regard to case.
The counter is a number's trailing digits; the next number is the series' highest counter + 1,
so gaps are never refilled. Bin rows v2's undo already brought back hold no number (Ruling 1A-6).
"""

import re
from calendar import monthrange
from collections import Counter
from datetime import date
from itertools import count, islice

from django.utils import timezone
from rest_framework.exceptions import ValidationError

from billing.constants import BILL_ACTIVE, BILL_CANCELLED, INVOICE_TYPE_OUTWARD
from billing.fy import fy_label, fy_of, fy_range
from billing.models import BinnedInvoice, Invoice
from billing.period_lock import locked_period_or_none
from billing.refusals import Refusal
from billing.text import day_text, money, stamp

_TRAILING = re.compile(r"(\d+)\s*$")
_DIGITS = re.compile(r"^[0-9]+$")
_RULE_46 = re.compile(r"^[A-Za-z0-9/-]+$")
# The shapes the next number reads, as v2's next_invoice_number does: "108" and
# "KGH/2026-27/108". Anything else ("P1778291284") would leak a giant counter.
_SERIES_SHAPE = re.compile(r"^(?:\d+|[A-Za-z]+/\d{4}-\d{2}/\d+)\s*$")
# The most "not entered yet" numbers the paper book lists; missing_count says how many in all (Ruling 1A-1).
LISTED = 500


def counter_of(number):
    """The number's trailing digits: "KGH/2026-27/108" -> 108, "45" -> 45; None when it has none.

    A stored number has at most 255 characters; reading no further keeps a typed one's int() small.
    """
    m = _TRAILING.search((number or "")[-255:])
    return int(m.group(1)) if m else None


def full_number_on(business, day):
    """True when, on `day`, digits alone take the firm's format (KGH/2026-27/108)."""
    start = business.paper_full_number_from
    return bool(start and day >= start and (business.invoice_prefix or "").strip())


def format_number(business, day, typed):
    """What a typed number is stored as: trimmed, and "108" -> "KGH/2026-27/108" once the
    paper bills carry the full number (full_number_on); before that, exactly as written."""
    text = (typed or "").strip()
    if _DIGITS.match(text) and full_number_on(business, day):
        return f"{business.invoice_prefix.strip()}/{fy_label(fy_of(day))}/{text.lstrip('0') or '0'}"
    return text


def series_bills(business_id, fy):
    """The firm's sales in that FY, any status."""
    start, end = fy_range(fy)
    return Invoice.objects.sales().filter(business_id=business_id, invoice_date__range=(start, end))


def series_bin(business_id, fy):
    """The firm's deleted sales of that FY still in the bin (not ones v2's undo brought back: Ruling 1A-6)."""
    start, end = fy_range(fy)
    return BinnedInvoice.objects.live().filter(business_id=business_id, type_of_invoice=INVOICE_TYPE_OUTWARD,
                                               invoice_date__range=(start, end))


def next_counter(business_id, fy):
    """The highest counter in the series (active, cancelled and deleted bills) + 1."""
    numbers = [*series_bills(business_id, fy).values_list("invoice_number", flat=True),
               *series_bin(business_id, fy).values_list("invoice_number", flat=True)]
    counters = [counter_of(n) for n in numbers if _SERIES_SHAPE.match(n or "")]
    return max(counters, default=0) + 1


def next_number(business, day):
    """{"counter", "invoice_number"}: the next free number on that date, as it would be stored."""
    counter = next_counter(business.pk, fy_of(day))
    return {"counter": counter, "invoice_number": format_number(business, day, str(counter))}


def holder(business_id, fy, number, exclude_invoice=None, exclude_bin=None, bins=True):
    """The bill (Invoice) or deleted bill (BinnedInvoice) that has `number` in the series, or None.

    bins=False asks the bills in Sales only: a restore's check, since other deleted bills never block
    one (Ruling 1A-18).
    """
    number = (number or "").strip()
    if not number:
        return None
    bills = series_bills(business_id, fy).filter(invoice_number__iexact=number).select_related("customer")
    if exclude_invoice:
        bills = bills.exclude(pk=exclude_invoice)
    found = bills.first()
    if found is None and bins:
        binned = series_bin(business_id, fy).filter(invoice_number__iexact=number)
        if exclude_bin:
            binned = binned.exclude(pk=exclude_bin)
        found = binned.first()
    return found


def bill_ref(invoice):
    """A bill named in another answer: {"id", "invoice_number", "invoice_date", "customer_name", "status"}."""
    return {"id": invoice.pk, "invoice_number": invoice.invoice_number, "invoice_date": invoice.invoice_date.isoformat(),
            "customer_name": invoice.customer.name, "status": invoice.status}


def binned_ref(binned):
    """A deleted bill named in another answer (number_deleted's `binned`)."""
    return {"id": binned.pk, "original_id": binned.original_id, "invoice_number": binned.invoice_number,
            "invoice_date": binned.invoice_date.isoformat(), "reason": binned.reason, "deleted_at": stamp(binned.deleted_at)}


def _taken_words(found, fy, following):
    return (f"{found.invoice_number} is already used in FY {fy_label(fy)} by {found.customer.name}'s bill of "
            f"{day_text(found.invoice_date)}. The next free number is {following['invoice_number']}.")


def _deleted_words(found, following):
    return (f"{found.invoice_number} belonged to a bill that was deleted (it can be restored from the Audit log), "
            f"so it can't be used again. The next free number is {following['invoice_number']}.")


def refuse_taken(business, day, number, exclude_invoice=None, exclude_bin=None, bins=True):
    """409 number_taken or number_deleted when `number` is in use in the firm's series for `day`
    (number_taken only, with bins=False: see holder)."""
    fy = fy_of(day)
    found = holder(business.pk, fy, number, exclude_invoice, exclude_bin, bins)
    if found is None:
        return
    following = next_number(business, day)
    if isinstance(found, Invoice):
        raise Refusal(_taken_words(found, fy, following), "number_taken", bill=bill_ref(found), next=following)
    raise Refusal(_deleted_words(found, following), "number_deleted", binned=binned_ref(found), next=following)


def shape_problem(typed, final, following):
    """What's wrong with a typed number's shape (GST Rule 46), in the prototype's words; "" when none."""
    text = (typed or "").strip()
    if not text:
        return f"Type the bill number, or use the next free one, {following}."
    if len(text) > 16:
        return f"A GST bill number can have at most 16 characters; this has {len(text)}."
    if not _RULE_46.match(text):
        return 'Use only letters, digits, "-" and "/" (GST rule 46). Spaces and other marks aren\'t allowed.'
    if counter_of(text) is None:
        return "End the number with digits, like 108 or KGH/2026-27/108, so bills sort in order."
    if len(final) > 16:
        return f"{final} would have more than 16 characters. Type a shorter number."
    return ""


def checked_number(business, day, typed, exclude_invoice=None):
    """The number to store for `typed` on `day`, or 400 (its shape) / 409 (in use)."""
    final = format_number(business, day, typed)
    problem = shape_problem(typed, final, next_number(business, day)["invoice_number"])
    if problem:
        raise ValidationError({"invoice_number": [problem]})
    refuse_taken(business, day, final, exclude_invoice=exclude_invoice)
    return final


def check_number(business, day, typed, exclude_invoice=None):
    """GET sales/check-number/'s answer: what `typed` would be stored as, and whether it can be."""
    fy = fy_of(day)
    following = next_number(business, day)
    final = format_number(business, day, typed)
    out = {"invoice_number": final, "counter": counter_of(final), "code": "", "problem": "", "bill": None,
           "binned": None, "note": "", "same_counter": None, "next": following}
    problem = shape_problem(typed, final, following["invoice_number"])
    if problem:
        return {**out, "code": "shape", "problem": problem}
    found = holder(business.pk, fy, final, exclude_invoice=exclude_invoice)
    if isinstance(found, Invoice):
        return {**out, "code": "number_taken", "problem": _taken_words(found, fy, following), "bill": bill_ref(found)}
    if found is not None:
        return {**out, "code": "number_deleted", "problem": _deleted_words(found, following), "binned": binned_ref(found)}
    counter = out["counter"]
    # The same counter under another spelling ("107" beside "KGH/2026-27/107"): the database narrows by the
    # number's ending, then the counter decides ("1107" ends the same way).
    alike = (series_bills(business.pk, fy).filter(invoice_number__endswith=str(counter))
             .exclude(pk=exclude_invoice).select_related("customer").order_by("invoice_date", "pk"))
    twin = next((b for b in alike if counter_of(b.invoice_number) == counter), None)
    if twin is not None:
        return {**out, "same_counter": bill_ref(twin),
                "note": f"{twin.invoice_number} has the same number part ({counter}). Customers and your CA may mix them up."}
    if counter > following["counter"]:
        first = following["counter"]
        span = f"Number {first} would" if counter - 1 == first else f"Numbers {first} to {counter - 1} would"
        return {**out, "note": f"{span} be skipped. GSTR-1 lists skipped numbers, so only do this on purpose."}
    return out


def unchecked(typed, problem):
    """check-number's answer when there's no firm or readable date to check against: still a 200, since it
    only checks (contract 2.12; Ruling 1A-5). `problem` is next-number's 400 words for what's missing."""
    final = (typed or "").strip()
    return {"invoice_number": final, "counter": counter_of(final), "code": "unchecked", "problem": problem,
            "bill": None, "binned": None, "note": "", "same_counter": None, "next": None}


def _in_series(row):
    """Whether the paper book counts a bill's number: a shape next-number reads, with a counter (Ruling 1A-1)."""
    return bool(_SERIES_SHAPE.match(row.invoice_number or "")) and counter_of(row.invoice_number) > 0


def paper_book(business, year, month):
    """GET sales/paper-book/'s answer: a firm's month as the paper book sees it (PROTO paperBook).

    Which numbers are in the app, what explains the missing ones (deleted, cancelled), which
    aren't entered yet, and the number and date to enter next. A number another month used
    isn't missing from this one. Only the numbers next-number reads count, and the missing ones
    are counted, not listed past the first LISTED: one stray "P20000" or "1778291284" would
    otherwise make thousands of rows, or a billion (Rulings 1A-1, 1D-3).
    """
    first, last = date(year, month, 1), date(year, month, monthrange(year, month)[1])
    fy = fy_of(first)
    bills = [b for b in series_bills(business.pk, fy).select_related("customer") if _in_series(b)]
    binned = [b for b in series_bin(business.pk, fy) if _in_series(b)]
    month_bills = sorted((b for b in bills if first <= b.invoice_date <= last),
                         key=lambda b: (counter_of(b.invoice_number), b.invoice_date, b.pk))
    month_bin = [b for b in binned if first <= b.invoice_date <= last]
    counters = [counter_of(x.invoice_number) for x in (*month_bills, *month_bin)]
    before = [counter_of(x.invoice_number) for x in (*bills, *binned) if x.invoice_date < first]
    used = {counter_of(x.invoice_number) for x in (*bills, *binned)}
    prev_max = max(before, default=0)
    lo, hi = min([prev_max + 1, *counters]), max(counters, default=0)
    missing_count = max(hi - lo + 1, 0) - sum(lo <= n <= hi for n in used)
    missing = list(islice((n for n in count(lo) if n not in used), min(missing_count, LISTED)))
    runs = []
    for n in sorted(set(counters)):
        if runs and n == runs[-1][1] + 1:
            runs[-1][1] = n
        else:
            runs.append([n, n])
    nxt = missing[0] if missing else max(hi, prev_max) + 1
    while not missing and nxt in used:
        nxt += 1
    after = list(range(max(hi, prev_max) + 1, nxt))
    later = set(after)
    lower = [b for b in month_bills if b.status == BILL_ACTIVE and counter_of(b.invoice_number) < nxt]
    today = timezone.localdate()
    next_day = lower[-1].invoice_date if lower else (today if (today.year, today.month) == (year, month) else first)
    twice = Counter(counter_of(b.invoice_number) for b in month_bills)
    explained = [
        *({"counter": counter_of(b.invoice_number), "kind": "deleted", "bin_id": b.pk, "invoice_number": b.invoice_number,
           "reason": b.reason, "deleted_at": stamp(b.deleted_at)} for b in month_bin),
        *({"counter": counter_of(b.invoice_number), "kind": "cancelled", "id": b.pk, "invoice_number": b.invoice_number,
           "reason": b.cancel_reason} for b in month_bills if b.status == BILL_CANCELLED),
    ]
    return {
        "business": business.pk, "month": f"{year}-{month:02d}", "fy": fy_label(fy),
        "bills": [{"id": b.pk, "invoice_number": b.invoice_number, "counter": counter_of(b.invoice_number),
                   "invoice_date": b.invoice_date.isoformat(), "customer_name": b.customer.name,
                   "total_amount": money(b.total_amount), "status": b.status, "paper": b.paper,
                   "sent": b.sent_at is not None} for b in month_bills],
        "entered": len(month_bills),
        "runs": runs,
        "missing": missing,
        "missing_count": missing_count,
        "explained": sorted(explained, key=lambda e: e["counter"]),
        "twice": sorted(n for n, times in twice.items() if times > 1),
        "after": after,
        "after_months": sorted({x.invoice_date.strftime("%Y-%m") for x in (*bills, *binned)
                                if counter_of(x.invoice_number) in later}),
        "next": {"counter": nxt, "invoice_number": format_number(business, next_day, str(nxt)),
                 "invoice_date": next_day.isoformat()},
        "locked": locked_period_or_none(business.pk, first) is not None,
        "gstr1_due": date(year + month // 12, month % 12 + 1, 11).isoformat(),
    }
