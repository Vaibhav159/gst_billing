"""cacheops and v3: v3 reads around the cache, and every write invalidates it.

Reads (Ruling 1A-34): cacheops ties a cached query only to conditions it can read on
its own tables. It can't see a subquery, an Exists or a select_related table change,
so a cached v3 read could show a cancelled bill's tax or a customer's old PAN for up
to half an hour. v3's server code reads Business, Customer, Product, Invoice and
LineItem through uncached() (or Invoice.objects.sales(), which does the same), and
the cache saves Neon nothing there: every authenticated request reads the database
for its user anyway.

Writes: v2 still reads through the cache, so every write must invalidate it.
save() and delete() do by their signals, and cacheops' own bulk_create invalidates
each new row; QuerySet.update() and _raw_delete send nothing, so cacheops keeps
serving the old rows until something else invalidates them: call invalidate()
after them.
"""

import logging

from django.conf import settings

logger = logging.getLogger(__name__)


def uncached(model):
    """`model`'s rows, read around cacheops: how v3's server code reads a cached model (Ruling 1A-34)."""
    return model.objects.nocache()


def invalidate(*models):
    """Drop cacheops' cached queries for `models`.

    A no-op where cacheops is off (tests) or faked (CI): there the call would
    only book a Redis connection failure for later.
    """
    if not getattr(settings, "CACHEOPS_ENABLED", True) or getattr(settings, "CACHEOPS_FAKE", False):
        return
    try:
        from cacheops import invalidate_model

        for model in models:
            invalidate_model(model)
    except Exception:
        logger.warning("cacheops invalidation failed", exc_info=True)
