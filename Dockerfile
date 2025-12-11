# Stage 1: Build React Frontend
FROM node:18-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy package.json and package-lock.json
COPY package.json package-lock.json ./
# Copy frontend directory
COPY frontend ./frontend
# Copy webpack config
COPY webpack.config.js ./
# Copy babel config
COPY .babelrc ./

# Install dependencies and build
RUN npm ci
RUN npm run build

# Stage 2: Python/Django Backend
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy

# Create a mock local.py file to avoid import errors
# This will be overridden by environment variables in production
RUN mkdir -p /app/gst_billing
RUN echo 'SECRET_KEY = "placeholder-replaced-by-env-var"\nDATABASES = {}' > /app/gst_billing/local.py

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

# Install production server dependencies
RUN uv pip install gunicorn django-redis

# Add .venv to PATH
ENV PATH="/app/.venv/bin:$PATH"

# Copy project files
COPY . /app/

# Copy built frontend assets from Stage 1
COPY --from=frontend-builder /app/frontend/static/frontend /app/static/frontend

# Verify crispy_forms is installed
RUN python -c "import crispy_forms; print('crispy_forms is installed')"

# Run gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "gst_billing.wsgi:application"]
