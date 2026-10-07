"""Dropping cacheops' cached queries after a write it can't see.

bulk_create, _raw_delete and QuerySet.update() send no signals, so cacheops
keeps serving the old rows (Invoice and LineItem queries for 30 minutes in
production) until something else invalidates them.
"""

import logging

from django.conf import settings

logger = logging.getLogger(__name__)


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
