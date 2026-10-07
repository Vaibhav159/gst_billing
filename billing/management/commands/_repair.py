"""What the report-only repair commands share (not a command itself).

Each one reads by default and writes only with --apply, scoped like
fix_gst_rates (--business, --from, --to), and says when a row sits in a filed
month: the lock stops the app, not a deliberate repair, so the owner has to be
told which filed returns a fix would move.
"""

import logging

from django.conf import settings

from billing.models import FiledPeriod

logger = logging.getLogger(__name__)


def add_scope_arguments(parser, what="the fix"):
    parser.add_argument("--apply", action="store_true", help=f"Write {what}. Without this, reports only.")
    parser.add_argument("--business", type=int, default=None, help="Limit to one business id.")
    parser.add_argument("--from", dest="date_from", default=None, help="Invoice date >= YYYY-MM-DD.")
    parser.add_argument("--to", dest="date_to", default=None, help="Invoice date <= YYYY-MM-DD.")


def scope(qs, opts, prefix=""):
    """Filter a queryset by --business/--from/--to; `prefix` reaches the invoice ("invoice__")."""
    if opts["business"]:
        qs = qs.filter(**{f"{prefix}business_id": opts["business"]})
    if opts["date_from"]:
        qs = qs.filter(**{f"{prefix}invoice_date__gte": opts["date_from"]})
    if opts["date_to"]:
        qs = qs.filter(**{f"{prefix}invoice_date__lte": opts["date_to"]})
    return qs


def filed_months():
    """{(business_id, year, month)} of every filed (locked) period."""
    return set(FiledPeriod.objects.values_list("business_id", "year", "month"))


def invalidate(*models):
    """Drop cacheops' cached queries for `models` after a QuerySet.update().

    update() sends no signals, so without this the app serves the old rows for
    up to 30 minutes after a repair. A no-op where cacheops is off (CI, tests).
    """
    if not getattr(settings, "CACHEOPS_ENABLED", True) or getattr(settings, "CACHEOPS_FAKE", False):
        return
    try:
        from cacheops import invalidate_model

        for model in models:
            invalidate_model(model)
    except Exception:
        logger.warning("cacheops invalidation failed after a repair", exc_info=True)
