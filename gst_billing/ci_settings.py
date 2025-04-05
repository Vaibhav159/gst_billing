"""
Django settings for CircleCI environment.
"""

from gst_billing.settings import *

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = "django-insecure-ci-test-key-not-for-production"

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = True

# Database
# https://docs.djangoproject.com/en/4.0/ref/settings/#databases
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
