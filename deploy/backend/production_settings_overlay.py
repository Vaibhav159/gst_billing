"""
Production settings overlay for split deployment.

HOW TO APPLY:
  Merge these changes into gst_billing/production_settings.py

Changes from current production_settings.py:
1. ALLOWED_HOSTS read from env var (was partially hardcoded)
2. CORS_ALLOWED_ORIGINS read from env var (was hardcoded to localhost only)
3. CORS_ALLOW_CREDENTIALS enabled (needed for cross-origin JWT)
4. WhiteNoise middleware added (serves Django admin static files without Nginx)
5. "frontend" removed from INSTALLED_APPS (frontend deployed separately)
"""

import os

# --- CHANGE 1: Dynamic ALLOWED_HOSTS ---
# Replace the hardcoded list with:
ALLOWED_HOSTS = [
    h.strip()
    for h in os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if h.strip()
]

# --- CHANGE 2: Remove "frontend" from INSTALLED_APPS ---
# Remove this line from INSTALLED_APPS:
#   "frontend",
# The React frontend is no longer served by Django.

# --- CHANGE 3: Add WhiteNoise to MIDDLEWARE ---
# Add after SecurityMiddleware:
#   "whitenoise.middleware.WhiteNoiseMiddleware",
# Full middleware list becomes:
MIDDLEWARE_ADDITIONS = """
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",  # <-- ADD THIS
    "django.contrib.sessions.middleware.SessionMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    ...rest stays the same...
]
"""

# --- CHANGE 4: CORS from environment ---
# Replace the CORS block (lines ~173-181) with:
CORS_ALLOW_ALL_ORIGINS = os.environ.get("DEBUG", "False") == "True"
CORS_ALLOW_CREDENTIALS = True

_cors_origins = os.environ.get("CORS_ALLOWED_ORIGINS", "")
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in _cors_origins.split(",")
    if origin.strip()
] if _cors_origins else [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:8080",
]

# --- CHANGE 5: WhiteNoise static file config ---
# Add after STATIC_ROOT:
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"
