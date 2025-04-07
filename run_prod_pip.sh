#!/bin/bash

echo "========================================"
echo "🚀 Starting GST Billing Production Setup (with pip)"
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

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📄 Creating .env file from template..."
    cp .env.template .env
    echo "✅ Created .env file. Please update it with your settings."
    echo "   You can edit it by running: nano .env"
    echo ""
    echo "⚠️  Please update the DJANGO_SECRET_KEY in the .env file before continuing!"
    read -p "Press Enter to continue after updating the .env file..." </dev/tty
fi

# Create Nginx configuration if it doesn't exist
if [ ! -f nginx/conf.d/app.conf ]; then
    echo "📄 Creating Nginx configuration..."
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
    echo "✅ Created Nginx configuration"
fi

# Build and start the containers
echo "🔨 Building and starting Docker containers..."
$DOCKER_COMPOSE_CMD -f docker-compose.pip.yml up -d --build

echo "✅ Deployment completed!"
echo "Your application should be running at http://localhost"
echo "========================================"
echo "📝 Next steps:"
echo "1. Update the domain name in nginx/conf.d/app.conf if needed"
echo "2. Set up SSL certificates in nginx/ssl directory for HTTPS"
echo ""
echo "📊 Database and Redis:"
echo "- PostgreSQL is running in a Docker container"
echo "- Database data is persisted in the postgres_data volume"
echo "- Redis is running in a Docker container for caching"
echo "- Redis data is persisted in the redis_data volume"
echo ""
echo "🔍 Useful commands:"
echo "- View logs: $DOCKER_COMPOSE_CMD -f docker-compose.pip.yml logs"
echo "- Restart services: $DOCKER_COMPOSE_CMD -f docker-compose.pip.yml restart"
echo "- Stop all services: $DOCKER_COMPOSE_CMD -f docker-compose.pip.yml down"
echo "- Backup database: $DOCKER_COMPOSE_CMD -f docker-compose.pip.yml exec db pg_dump -U postgres gst_billing > backups/gst_billing_\$(date +%Y-%m-%d_%H-%M-%S).sql"
echo "========================================"
