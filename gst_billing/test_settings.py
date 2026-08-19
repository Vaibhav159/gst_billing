"""Test settings — uses SQLite instead of PostgreSQL for fast local testing."""
from .settings import *  # noqa: F401, F403

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}

# Disable cacheops for tests
CACHEOPS_ENABLED = False
CACHEOPS = {}

# Speed up password hashing for tests
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.MD5PasswordHasher",
]

# Disable throttling for tests
REST_FRAMEWORK["DEFAULT_THROTTLE_CLASSES"] = []
# Scoped throttles on the token views instantiate ScopedRateThrottle at the
# view level (bypassing DEFAULT_THROTTLE_CLASSES), and a missing scope rate
# raises ImproperlyConfigured — so give every scope a rate too high to ever
# trip in tests. The throttle test overrides these to a tight rate itself.
REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] = {
    "anon": "10000/min",
    "user": "10000/min",
    "login": "10000/min",
    "token_refresh": "10000/min",
}
