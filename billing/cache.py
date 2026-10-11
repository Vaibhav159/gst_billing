"""cacheops and v3: v3 reads around the cache, and every write invalidates it.

Reads (Ruling 1A-34): cacheops ties a cached query only to conditions it can read on
its own tables. It can't see a subquery, an Exists or a select_related table change,
so a cached v3 read could show a cancelled bill's tax or a customer's old PAN for up
to half an hour. v3's server code reads Business, Customer, Product, Invoice and
LineItem through uncached() (or Invoice.objects.sales(), which does the same), and
the cache saves Neon nothing there: every authenticated request reads the database
for its user anyway. Two reads go through the cache unless written otherwise: a lazy
foreign key (bill.customer without select_related) and a related manager
(invoice.lineitem_set).

tests/test_v3_cacheops.py holds v3's reads to this, on the paths it runs and only
those. It turns cacheops on after the code is imported, so v3 builds its querysets
per request: one built at import, while the tests' cacheops is off, keeps no cache
profile, and nocache() on it does nothing once the test turns cacheops on. That is the
test's need, not production's, which imports with cacheops on.

Writes: v2 still reads through the cache, so every write must invalidate it.
save() and delete() do by their signals, and cacheops' own bulk_create invalidates
each new row; QuerySet.update() and _raw_delete send nothing, so cacheops keeps
serving the old rows until something else invalidates them: call invalidate()
after them.
"""

import logging

from django.conf import settings
from django.db import DEFAULT_DB_ALIAS

logger = logging.getLogger(__name__)


def uncached(model):
    """`model`'s rows, read around cacheops: how v3's server code reads a cached model (Ruling 1A-34)."""
    return model.objects.nocache()


class _Waiting:
    """Put in cacheops' commit queue beside a clear it queued: `model` is cleared at the commit already. It does
    nothing when the queue runs; it goes where the clear goes (into the outer block when a savepoint is released,
    away with it when one is rolled back)."""

    def __init__(self, model):
        self.model = model

    def __call__(self):
        pass


def _queued():
    """cacheops' commit queue, one list of waiting calls per open atomic block, and the models already waiting in
    it; ([], set()) outside a transaction. (None, set()) when the queue can't be read (another cacheops)."""
    try:
        from cacheops.transaction import transaction_states

        queue = transaction_states[DEFAULT_DB_ALIAS]
        return queue, {func.model for block in queue for func, _args, _kwargs in block["cbs"] if isinstance(func, _Waiting)}
    except Exception:
        return None, set()


def invalidate(*models):
    """Drop cacheops' cached queries for `models`.

    Each clear is a Redis KEYS scan over the whole cache, which cacheops runs when the transaction commits. A
    model is queued once per transaction, however often it is asked for (a bill's lines saved one by one each
    ask); outside one, it is cleared at once.

    A no-op where cacheops is off (tests) or faked (CI): there the call would only book a Redis
    connection failure for later.
    """
    if not getattr(settings, "CACHEOPS_ENABLED", True) or getattr(settings, "CACHEOPS_FAKE", False):
        return
    queue, waiting = _queued()
    try:
        from cacheops import invalidate_model

        for model in models:
            if model in waiting:
                continue
            asked = len(queue[-1]["cbs"]) if queue else None
            invalidate_model(model)
            if queue and len(queue[-1]["cbs"]) > asked:  # queued for the commit, not run now
                queue.push((_Waiting(model), (), {}))
                waiting.add(model)
    except Exception:
        logger.warning("cacheops invalidation failed", exc_info=True)
