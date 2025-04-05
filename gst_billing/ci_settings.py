"""
Django settings for CircleCI environment.

This file imports from the main settings.py but overrides specific settings for CI.
"""

import sys


# First, create a mock local module to prevent import errors
# This is needed because settings.py imports from gst_billing.local
class MockLocal:
    SECRET_KEY = "django-insecure-ci-test-key-not-for-production"
    DATABASES = {}


DEBUG = True

# Add the mock to sys.modules
sys.modules["gst_billing.local"] = MockLocal

# Now we can safely import from the main settings
from gst_billing.settings import *

# Override settings for CI environment

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = "django-insecure-ci-test-key-not-for-production"

# Database settings for CircleCI
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": "circle_test",
        "USER": "circleci",
        "PASSWORD": "circleci",
        "HOST": "localhost",
        "PORT": "5432",
    }
}

# CORS settings
CORS_ALLOW_ALL_ORIGINS = True

# Cache settings
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "unique-snowflake",
    }
}
