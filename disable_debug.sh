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

# Update DEBUG setting in .env file
echo "🔧 Disabling DEBUG mode..."
sed -i.bak "s/DEBUG=.*/DEBUG=False/" .env
rm -f .env.bak

# Restart the web container
echo "🔄 Restarting the web container..."
# `restart` reuses the container's ORIGINAL environment — env_file changes are
# only read on (re)creation — so these scripts printed success while nothing
# changed. `up -d` recreates the container with the new .env.
$DOCKER_COMPOSE up -d --force-recreate --no-deps web
echo "   effective DEBUG in the container: $($DOCKER_COMPOSE exec -T web python -c 'from django.conf import settings; print(settings.DEBUG)' 2>/dev/null || echo '?')"

echo "✅ DEBUG mode disabled. The application is now running in production mode."
