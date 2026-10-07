"""What the report-only repair commands share (not a command itself).

Each one reads by default and writes only with --apply, scoped like
fix_gst_rates (--business, --from, --to), and says when a row sits in a filed
month: the lock stops the app, not a deliberate repair, so the owner has to be
told which filed returns a fix would move.
"""

from django.db.models import Prefetch

from billing.cache import invalidate  # noqa: F401  (the commands import it from here)
from billing.models import FiledPeriod, LineItem


def add_scope_arguments(parser, what="the fix"):
    parser.add_argument("--apply", action="store_true", help=f"Write {what}. Without this, reports only.")
    parser.add_argument("--business", type=int, default=None, help="Limit to one business id.")
    parser.add_argument("--from", dest="date_from", default=None, help="Invoice date >= YYYY-MM-DD.")
    parser.add_argument("--to", dest="date_to", default=None, help="Invoice date <= YYYY-MM-DD.")


def scope(qs, opts, prefix=""):
    """Filter a queryset by --business/--from/--to; `prefix` reaches the invoice ("invoice__").

    Read past cacheops: a report has to show the database, and --apply writes
    from what it read. A cached read could be 30 minutes old.
    """
    qs = qs.nocache()
    if opts["business"]:
        qs = qs.filter(**{f"{prefix}business_id": opts["business"]})
    if opts["date_from"]:
        qs = qs.filter(**{f"{prefix}invoice_date__gte": opts["date_from"]})
    if opts["date_to"]:
        qs = qs.filter(**{f"{prefix}invoice_date__lte": opts["date_to"]})
    return qs


def fresh_lines():
    """An invoice's lines to prefetch, read past cacheops like the invoices."""
    return Prefetch("lineitem_set", queryset=LineItem.objects.nocache())


def filed_months():
    """{(business_id, year, month)} of every filed (locked) period."""
    return set(FiledPeriod.objects.values_list("business_id", "year", "month"))

