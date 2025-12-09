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

        # Generate a random secret key
        RANDOM_SECRET_KEY=$(python -c "import secrets; print(secrets.token_urlsafe(50))")
        sed -i.bak "s/DJANGO_SECRET_KEY=.*/DJANGO_SECRET_KEY=$RANDOM_SECRET_KEY/" .env
        rm -f .env.bak

        # Prompt for Docker Hub username
        read -p "Enter your Docker Hub username (or leave blank for local only): " DOCKER_USERNAME
        if [ -n "$DOCKER_USERNAME" ]; then
            sed -i.bak "s/DOCKER_USERNAME=.*/DOCKER_USERNAME=$DOCKER_USERNAME/" .env
            rm -f .env.bak
        fi

        # Prompt for superuser credentials
        read -p "Enter Django superuser username [admin]: " SUPERUSER_USERNAME
        SUPERUSER_USERNAME=${SUPERUSER_USERNAME:-admin}
        read -p "Enter Django superuser email [admin@example.com]: " SUPERUSER_EMAIL
        SUPERUSER_EMAIL=${SUPERUSER_EMAIL:-admin@example.com}
        read -s -p "Enter Django superuser password: " SUPERUSER_PASSWORD
        echo ""

        # Update the .env file with the superuser credentials
        sed -i.bak "s/DJANGO_SUPERUSER_USERNAME=.*/DJANGO_SUPERUSER_USERNAME=$SUPERUSER_USERNAME/" .env
        sed -i.bak "s/DJANGO_SUPERUSER_EMAIL=.*/DJANGO_SUPERUSER_EMAIL=$SUPERUSER_EMAIL/" .env
        sed -i.bak "s/DJANGO_SUPERUSER_PASSWORD=.*/DJANGO_SUPERUSER_PASSWORD=$SUPERUSER_PASSWORD/" .env
        rm -f .env.bak

        echo "✅ Created .env file with your settings."
    else
        echo "❌ .env.template not found. Please create a .env file manually."
        exit 1
    fi
fi

# Create necessary directories
mkdir -p staticfiles media nginx/conf.d nginx/ssl logs

# Check if nginx configuration exists
if [ ! -f nginx/conf.d/app.conf ]; then
    echo "⚠️ Nginx configuration not found. Creating a default one..."
    cat > nginx/conf.d/app.conf << 'EOF'
server {
    listen 80;
    server_name localhost;

    location /static/ {
        alias /var/www/static/;
        expires 30d;
        add_header Cache-Control "public, max-age=2592000";
    }

    location /media/ {
        alias /var/www/media/;
        expires 30d;
        add_header Cache-Control "public, max-age=2592000";
    }

    location / {
        proxy_pass http://web:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
fi

# Run Docker Compose
echo "🚀 Starting the application with Docker Compose..."
$DOCKER_COMPOSE up -d

echo "✅ Application is running!"
echo "Access it at http://billing.cheq.dpdns.org"
echo ""
echo "📝 To view logs, run:"
echo "$DOCKER_COMPOSE logs -f web"  # Docker logs
echo ""
echo "📋 Django logs are available at:"
echo "- Container logs: $DOCKER_COMPOSE logs -f web"
echo "- Django log file: ./logs/django.log"
echo "- Gunicorn access log: ./logs/gunicorn-access.log"
echo "- Gunicorn error log: ./logs/gunicorn-error.log"
echo ""
echo "⚠️ IMPORTANT: If you update the .env file, you need to restart the container:"
echo "$DOCKER_COMPOSE restart web"
