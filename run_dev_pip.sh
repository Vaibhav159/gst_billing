#!/bin/bash

echo "========================================"
echo "🚀 Starting GST Billing Development Setup (with pip)"
echo "========================================"

# Check which docker-compose command is available
echo "🔍 Checking for Docker Compose..."
if command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker-compose"
    echo "✅ Found docker-compose command"
elif command -v docker &> /dev/null && docker compose version &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker compose"
    echo "✅ Found docker compose command (Docker CLI plugin)"
else
    echo "❌ Error: Neither docker-compose nor docker compose is available"
    echo "Please install Docker Compose using one of these methods:"
    echo "1. Install Docker Desktop (includes Docker Compose)"
    echo "2. Install Docker Compose separately: https://docs.docker.com/compose/install/"
    exit 1
fi

# Create necessary directories
echo "📂 Creating necessary directories..."
mkdir -p staticfiles media nginx/conf.d nginx/ssl

# Build and start the containers using the development setup
echo "🔨 Building and starting Docker containers..."
$DOCKER_COMPOSE_CMD -f docker-compose.dev.yml up --build

echo "✅ Development server is running!"
echo "========================================"
