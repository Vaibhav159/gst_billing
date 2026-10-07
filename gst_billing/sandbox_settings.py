"""The live production settings, pointed at the throwaway sandbox stack.

Used only by deploy/sandbox/compose.yaml: the same module the live site runs,
plus the few things a private, SSH-tunnelled copy needs. It refuses to start
against anything but the sandbox's own Postgres container, so a wrong DB_HOST
can never reach the real books.
"""

import os

from .production_settings import *

_db = DATABASES["default"]
if (
    os.environ.get("GST_SANDBOX") != "1"
    or _db["HOST"] not in {"db", "localhost", "127.0.0.1"}
    or not str(_db["NAME"]).startswith("gst_sandbox")
):
    raise RuntimeError(
        "sandbox_settings runs only against the sandbox database "
        "(GST_SANDBOX=1, DB_HOST=db, DB_NAME=gst_sandbox*) — see deploy/sandbox/."
    )

# Reached on localhost ports through an SSH tunnel, and by service name from
# the Vite container's proxy (which rewrites Host to "nginx").
ALLOWED_HOSTS = [*ALLOWED_HOSTS, "nginx", "web"]
CSRF_TRUSTED_ORIGINS = [
    *CSRF_TRUSTED_ORIGINS,
    *(o.strip() for o in os.environ.get("SANDBOX_TRUSTED_ORIGINS", "").split(",") if o.strip()),
]

# production_settings never defines these, and AIInvoiceProcessor reads them
# from settings, not the environment — so on the live site AI extraction finds
# no key whatever .env holds. Read here so the sandbox can exercise the flow.
GEMINI_API_KEYS = os.environ.get("GEMINI_API_KEYS", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
if os.environ.get("GEMINI_VISION_MODEL"):
    GEMINI_VISION_MODEL = os.environ["GEMINI_VISION_MODEL"]
