import pytest
from django.core.cache import cache


@pytest.fixture(autouse=True)
def fresh_throttles():
    # Throttle counters live in the cache and key on user pks, which SQLite reuses after rollback.
    cache.clear()
    yield
