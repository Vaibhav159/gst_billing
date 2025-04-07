#!/bin/bash

# Exit on error
set -e

# Check if we're on the main branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    read -p "⚠️ You are not on the main branch. Continue anyway? (y/n): " CONTINUE
    if [ "$CONTINUE" != "y" ]; then
        echo "Exiting. Please switch to the main branch first."
        exit 1
    fi
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Determine Docker Compose command
if command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE="docker-compose"
else
    DOCKER_COMPOSE="docker compose"
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️ .env file not found. Creating from template..."
    if [ -f .env.template ]; then
        cp .env.template .env
        echo "✅ Created .env file from template."
    else
        echo "❌ .env.template not found. Please create a .env file manually."
        exit 1
    fi
fi

# Prompt for Docker Hub username if not in .env
DOCKER_USERNAME=$(grep DOCKER_USERNAME .env | cut -d '=' -f2)
if [ -z "$DOCKER_USERNAME" ] || [ "$DOCKER_USERNAME" = "your-dockerhub-username" ]; then
    read -p "Enter your Docker Hub username: " DOCKER_USERNAME
    if [ -z "$DOCKER_USERNAME" ]; then
        echo "❌ Docker Hub username is required for pushing the image."
        exit 1
    fi
    sed -i.bak "s/DOCKER_USERNAME=.*/DOCKER_USERNAME=$DOCKER_USERNAME/" .env
    rm -f .env.bak
fi

# Set image name and tag
IMAGE_NAME="${DOCKER_USERNAME}/gst-billing"
TAG="latest"

# Build the Docker image
echo "🔨 Building Docker image: ${IMAGE_NAME}:${TAG}"
$DOCKER_COMPOSE build

# Log in to Docker Hub
echo "🔑 Logging in to Docker Hub"
docker login

# Push the image to Docker Hub
echo "⬆️ Pushing image to Docker Hub"
docker push ${IMAGE_NAME}:${TAG}

echo "✅ Image successfully pushed to Docker Hub!"
echo "You can now run the application with:"
echo "./run_docker.sh"
