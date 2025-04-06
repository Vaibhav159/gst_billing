#!/bin/bash

echo "========================================"
echo "🚀 Starting GST Billing Application Setup"
echo "========================================"

echo "\n📂 Navigating to project directory..."
# Navigate to the project directory
cd ~/Personal\ Projects/gst_billing
echo "✅ Now in $(pwd)"

echo "\n🔄 Pulling latest changes from git..."
# Pull the latest changes from git
git pull
echo "✅ Git pull complete"

echo "\n📦 Installing dependencies using uv..."
# Install dependencies using uv (preferred over pip as per user preferences)
uv sync --frozen
echo "✅ Dependencies installed"

echo "\n🔧 Running database migrations..."
# Run migrations
python manage.py migrate
echo "✅ Migrations complete"

echo "\n🌐 Starting server and opening browser..."
# Start the server and open the browser
open http://127.0.0.1:8000/login & python manage.py runserver
