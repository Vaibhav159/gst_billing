#!/usr/bin/env python
"""
Script to create a Django superuser if one doesn't already exist.
This script is meant to be run inside the Docker container.
"""

import os
import sys

import django

# Set up Django
os.environ.setdefault(
    "DJANGO_SETTINGS_MODULE",
    os.environ.get("DJANGO_SETTINGS_MODULE", "gst_billing.production_settings"),
)
django.setup()

from django.contrib.auth.models import User


def create_superuser():
    """Create a superuser if one doesn't already exist with the provided username."""
    username = os.environ.get("DJANGO_SUPERUSER_USERNAME", "admin")
    email = os.environ.get("DJANGO_SUPERUSER_EMAIL", "admin@example.com")
    password = os.environ.get("DJANGO_SUPERUSER_PASSWORD", "admin")

    print(f"Attempting to create superuser with username: {username}")

    # Check if the superuser already exists
    if User.objects.filter(username=username).exists():
        print(f"Superuser '{username}' already exists. Skipping creation.")
        return

    # Create the superuser
    try:
        User.objects.create_superuser(username=username, email=email, password=password)
        print(f"Superuser '{username}' created successfully.")
    except Exception as e:
        print(f"Error creating superuser: {e}")
        sys.exit(1)


if __name__ == "__main__":
    create_superuser()
