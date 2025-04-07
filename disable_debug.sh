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
$DOCKER_COMPOSE restart web

echo "✅ DEBUG mode disabled. The application is now running in production mode."
