"""
Production settings for GST Billing project.
This file contains all settings needed for production without importing from settings.py
"""

import os
from datetime import timedelta
from pathlib import Path

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    # This used to fall back to a string that is committed to a public repo —
    # which also signs every JWT. A missing env var must stop the boot, not
    # silently run with a known key.
    raise RuntimeError(
        "DJANGO_SECRET_KEY is not set. Refusing to start production with a "
        "known default key."
    )

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = os.environ.get("DEBUG", "False") == "True"

ALLOWED_HOSTS = ["billing.cheq.dpdns.org", "localhost", "127.0.0.1"]

CSRF_TRUSTED_ORIGINS = [
    "https://billing.cheq.dpdns.org",
    "http://billing.cheq.dpdns.org",
]


# Application definition
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "billing",
    "crispy_forms",
    "django_htmx",
    "explorer",
    "simple_history",
    "rest_framework",
    # Stores rotated-out refresh tokens so they die on rotation.
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "frontend",
    # Was missing while CACHEOPS below was fully configured, so none of the
    # query caching this file describes was actually running in production.
    "cacheops",
]

MIDDLEWARE = [
    # First so it compresses everything below. gst_summary is ~80 KB raw and
    # ~12 KB gzipped; production was serving all of it uncompressed because
    # this middleware only existed in the dev settings.
    "django.middleware.gzip.GZipMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "django_htmx.middleware.HtmxMiddleware",
    "simple_history.middleware.HistoryRequestMiddleware",
]

ROOT_URLCONF = "gst_billing.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [os.path.join(BASE_DIR, "templates")],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "gst_billing.wsgi.application"

# Database
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("DB_NAME", "gst_billing"),
        "USER": os.environ.get("DB_USER", "postgres"),
        "PASSWORD": os.environ.get("DB_PASSWORD", "postgres"),
        "HOST": os.environ.get("DB_HOST", "db"),
        "PORT": os.environ.get("DB_PORT", "5432"),
        "CONN_MAX_AGE": 60,  # Keep database connections alive for 60 seconds
    }
}

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

# Internationalization
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# Static files (CSS, JavaScript, Images)
STATIC_URL = "/static/"
STATIC_ROOT = os.path.join(BASE_DIR, "staticfiles")
STATICFILES_DIRS = [
    os.path.join(BASE_DIR, "static"),
]

# Media files
MEDIA_URL = "/media/"
MEDIA_ROOT = os.path.join(BASE_DIR, "media")

# Default primary key field type
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
CRISPY_TEMPLATE_PACK = "bootstrap4"

# Explorer settings
EXPLORER_CONNECTIONS = {"Default": "default"}
EXPLORER_DEFAULT_CONNECTION = "default"

# REST Framework settings
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    # Production previously had NO throttling — the login endpoint accepted
    # unlimited password attempts (verified live 19 Aug 2026). With REDIS_HOST
    # set (prod compose), throttle state is shared across all gunicorn workers.
    "DEFAULT_THROTTLE_RATES": {
        "login": "10/min",
        "token_refresh": "60/min",
    },
}

# JWT settings
SIMPLE_JWT = {
    # 12h access / 30d refresh with rotation + blacklist — was 30d/180d static,
    # which meant a leaked localStorage token worked for a month and a stolen
    # refresh for six. The SPA refreshes transparently on 401 (api.ts), so
    # shorter lifetimes cost the user nothing.
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=12),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": False,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": SECRET_KEY,
    "VERIFYING_KEY": None,
    "AUDIENCE": None,
    "ISSUER": None,
    "JWK_URL": None,
    "LEEWAY": 0,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "AUTH_HEADER_NAME": "HTTP_AUTHORIZATION",
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
    "USER_AUTHENTICATION_RULE": "rest_framework_simplejwt.authentication.default_user_authentication_rule",
    "AUTH_TOKEN_CLASSES": ("rest_framework_simplejwt.tokens.AccessToken",),
    "TOKEN_TYPE_CLAIM": "token_type",
    "TOKEN_USER_CLASS": "rest_framework_simplejwt.models.TokenUser",
    "JTI_CLAIM": "jti",
}

# Security settings
# nginx terminates in front of Django and forwards over plain http, so without
# this any absolute URL Django builds comes back as http:// on an https:// page.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
# SAMEORIGIN, not DENY: the Inward Bills detail page frames the stored bill
# from /media/ on the same origin. Cross-origin framing stays blocked.
X_FRAME_OPTIONS = "SAMEORIGIN"

# CORS settings
CORS_ALLOW_ALL_ORIGINS = DEBUG  # Allow all origins in development
CORS_ALLOWED_ORIGINS = (
    [
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]
    if not DEBUG
    else []
)

# Cache settings
if os.environ.get("REDIS_HOST"):
    CACHES = {
        "default": {
            "BACKEND": "django_redis.cache.RedisCache",
            "LOCATION": f"redis://{os.environ.get('REDIS_HOST', 'redis')}:{os.environ.get('REDIS_PORT', '6379')}/1",
            "OPTIONS": {
                "CLIENT_CLASS": "django_redis.client.DefaultClient",
            },
        }
    }

    # Cacheops configuration with environment variables
    CACHEOPS_REDIS = {
        "host": os.environ.get("REDIS_HOST", "redis"),
        "port": int(os.environ.get("REDIS_PORT", 6379)),
        "db": 2,  # Use a different DB than the default cache
        "socket_timeout": 3,
    }
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "unique-snowflake",
        }
    }

    # Fallback to local Redis for cacheops
    CACHEOPS_REDIS = {
        "host": "localhost",
        "port": 6379,
        "db": 2,
        "socket_timeout": 3,
    }

# Cacheops only runs when a Redis host is actually configured. The app is in
# INSTALLED_APPS unconditionally (so models register), but with no REDIS_HOST —
# CI's E2E job, a bare local run — every cached query/invalidation would try
# localhost:6379 and crash the first save. CACHEOPS_ENABLED=False makes cacheops
# a no-op instead.
CACHEOPS_ENABLED = bool(os.environ.get("REDIS_HOST"))

# Cacheops configuration
CACHEOPS_DEFAULTS = {
    "timeout": 60 * 15,  # 15 minutes default cache timeout
    "cache_on_save": True,
    "invalidate_on_save": True,
}

# Register models for caching with longer timeouts for production
CACHEOPS = {
    # Cache all Business models queries for 2 hours
    "billing.Business": {"ops": "all", "timeout": 60 * 60 * 2},
    # Cache all Customer models queries for 1 hour
    "billing.Customer": {"ops": "all", "timeout": 60 * 60},
    # Cache all Product models queries for 2 hours
    "billing.Product": {"ops": "all", "timeout": 60 * 60 * 2},
    # Cache all Invoice models queries for 30 minutes
    "billing.Invoice": {"ops": "all", "timeout": 60 * 30},
    # Cache all LineItem models queries for 30 minutes
    "billing.LineItem": {"ops": "all", "timeout": 60 * 30},
}

# Logging configuration
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "{levelname} {asctime} {module} {process:d} {thread:d} {message}",
            "style": "{",
        },
        "simple": {
            "format": "{levelname} {message}",
            "style": "{",
        },
    },
    "filters": {
        "require_debug_true": {
            "()": "django.utils.log.RequireDebugTrue",
        },
    },
    "handlers": {
        "console": {
            "level": "INFO",
            "class": "logging.StreamHandler",
            "formatter": "verbose",
        },
        "file": {
            "level": "INFO",
            "class": "logging.FileHandler",
            "filename": os.path.join(BASE_DIR, "logs/django.log"),
            "formatter": "verbose",
        },
    },
    "loggers": {
        "django": {
            "handlers": ["console", "file"],
            "level": "INFO",
            "propagate": True,
        },
        "django.request": {
            "handlers": ["console", "file"],
            "level": "DEBUG",
            "propagate": False,
        },
        "django.db.backends": {
            "handlers": ["console", "file"],
            "level": "INFO",
            "propagate": False,
        },
        "billing": {
            "handlers": ["console", "file"],
            "level": "INFO",
            "propagate": False,
        },
    },
}

# GSTIN taxpayer lookup (billing/gstin.py). Without a key the endpoint still
# validates the checksum and derives state + PAN from the number itself;
# a key adds legal/trade name, address and status. Free key: gstincheck.co.in
GSTIN_API_KEY = os.getenv("GSTIN_API_KEY", "")
GSTIN_API_URL = os.getenv("GSTIN_API_URL", "https://sheet.gstincheck.co.in/check")
# Provider selection: "gstincheck" (default; free keyed lookups) or "cleartax"
# (unmetered within a ClearTax subscription — use when the firm/CA already
# files through ClearTax; token from the ClearTax account).
GSTIN_PROVIDER = os.getenv("GSTIN_PROVIDER", "gstincheck")
CLEARTAX_HOST = os.getenv("CLEARTAX_HOST", "")
CLEARTAX_AUTH_TOKEN = os.getenv("CLEARTAX_AUTH_TOKEN", "")
CLEARTAX_ENTITY_ID = os.getenv("CLEARTAX_ENTITY_ID", "")
# KnowYourGST: flat-fee plan with unlimited lookups (no per-call metering).
KNOWYOURGST_API_KEY = os.getenv("KNOWYOURGST_API_KEY", "")
KNOWYOURGST_API_URL = os.getenv(
    "KNOWYOURGST_API_URL", "https://www.knowyourgst.com/developers/gstincall/"
)

# AppyFlow: 50 free lookups on signup — the largest free tier available.
APPYFLOW_KEY_SECRET = os.getenv("APPYFLOW_KEY_SECRET", "")
APPYFLOW_API_URL = os.getenv("APPYFLOW_API_URL", "https://appyflow.in/api/verifyGST")

# How long a taxpayer lookup stays cached (default 180 days). Longer = fewer
# metered requests; names/addresses rarely change.
GSTIN_CACHE_SECONDS = int(os.getenv("GSTIN_CACHE_SECONDS", 60 * 60 * 24 * 180))
