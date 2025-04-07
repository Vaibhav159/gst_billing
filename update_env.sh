#!/bin/bash

# Exit on error
set -e

# Determine Docker Compose command
if command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE="docker-compose"
else
    DOCKER_COMPOSE="docker compose"
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ .env file not found. Please run run_docker.sh first."
    exit 1
fi

# Prompt for confirmation
echo "⚠️ This will restart the web container to apply environment variable changes."
read -p "Continue? (y/n): " CONTINUE
if [ "$CONTINUE" != "y" ]; then
    echo "Operation cancelled."
    exit 0
fi

# Restart the web container
echo "🔄 Restarting the web container to apply environment variable changes..."
$DOCKER_COMPOSE restart web

echo "✅ Environment variables updated and web container restarted."
echo "📝 To view logs, run:"
echo "./view_logs.sh"
