# Backend-only Dockerfile for Oracle Cloud deployment
# No frontend build stage - frontend is deployed separately on Cloudflare/GitHub Pages

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy

# Create a mock local.py to avoid import errors (overridden by env vars in production)
RUN mkdir -p /app/gst_billing
RUN echo 'SECRET_KEY = "placeholder-replaced-by-env-var"\nDATABASES = {}' > /app/gst_billing/local.py

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies using uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-cache --no-install-project

# Install production extras
RUN uv pip install gunicorn django-redis whitenoise

# Add .venv to PATH
ENV PATH="/app/.venv/bin:$PATH"

# Copy project files
COPY . /app/

# Verify key packages
RUN python -c "import crispy_forms; print('crispy_forms OK')"
RUN python -c "import whitenoise; print('whitenoise OK')"

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/admin/login/ || exit 1

CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "120", "gst_billing.wsgi:application"]
