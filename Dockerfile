# Stage 1: Build React Frontend
FROM node:18-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy package.json and package-lock.json
COPY package.json package-lock.json ./
# Copy frontend directory
COPY frontend ./frontend
# Copy webpack config
COPY webpack.config.js ./

# Install dependencies and build
RUN npm ci
RUN npm run build

# Stage 2: Python/Django Backend
FROM python:3.12-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
# DJANGO_SETTINGS_MODULE will be provided by docker-compose

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

# Install dependencies
COPY requirements.txt ./
# Install Python dependencies
RUN pip install --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install gunicorn django-redis

# Copy project files
COPY . /app/

# Copy built frontend assets from Stage 1
COPY --from=frontend-builder /app/static/frontend /app/static/frontend

# Verify crispy_forms is installed
RUN python -c "import crispy_forms; print('crispy_forms is installed')"

# Run gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "gst_billing.wsgi:application"]
