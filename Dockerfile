# Python/Django backend. The old Stage-1 node build compiled the V1 webpack
# app that nothing has routed to since nginx took over the SPA — deleting it
# shaves node_modules and ~1 minute off every image build.
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy

# The image IS production: select the production settings here, not in a
# line of .env that one missing entry could drop. wsgi.py otherwise defaults
# to the dev module, which used to mean DEBUG=True, ALLOWED_HOSTS=["*"], an
# empty in-container SQLite that looked "up" with all real data invisible,
# and a signing key anyone could read from this public repo.
ENV DJANGO_SETTINGS_MODULE=gst_billing.production_settings

# No baked local.py. The one this used to write carried a placeholder
# SECRET_KEY, so the "refuse to start without DJANGO_SECRET_KEY" guard never
# fired: the placeholder satisfied it. Without the file, settings.py's own
# guard raises unless DJANGO_SECRET_KEY is set — which is the point.

# Set work directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies using uv
COPY pyproject.toml uv.lock ./
# Sync dependencies from lockfile
RUN uv sync --frozen --no-cache --no-install-project

# gunicorn and django-redis are project dependencies now (pyproject + uv.lock),
# so they are pinned by the lockfile like everything else instead of floating.

# Add .venv to PATH
ENV PATH="/app/.venv/bin:$PATH"

# Copy project files
COPY . /app/

# Run as an unprivileged user. The writable paths (media, staticfiles, logs)
# are created and owned here so the named volumes mounted over them inherit
# that ownership on first use.
RUN groupadd --system app && useradd --system --gid app --home /app app \
    && mkdir -p /app/media /app/staticfiles /app/logs \
    && chown -R app:app /app
USER app

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/healthz || exit 1

# --timeout: a request budget. Without one a wedged upstream (a Gemini
# brownout during month-end) held a worker forever; with 16 threads that
# was the whole server.
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--timeout", "90", "--graceful-timeout", "30", "gst_billing.wsgi:application"]
