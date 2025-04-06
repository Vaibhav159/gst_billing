#!/bin/bash

echo "========================================"
echo "🚀 Deploying GST Billing Application"
echo "========================================"

# Create necessary directories
echo "📂 Creating necessary directories..."
mkdir -p nginx/conf.d nginx/ssl backups

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

# Build and start the containers
echo "🔨 Building and starting Docker containers..."
docker-compose up -d --build

echo "✅ Deployment completed!"
echo "Your application should be running at http://your-domain.com"
echo "========================================"
echo "📝 Next steps:"
echo "1. Update the domain name in nginx/conf.d/app.conf"
echo "2. Set up SSL certificates in nginx/ssl directory"
echo "3. Uncomment SSL configuration in nginx/conf.d/app.conf when ready"
echo ""
echo "📊 Database and Redis:"
echo "- PostgreSQL is running in a Docker container"
echo "- Database data is persisted in the postgres_data volume"
echo "- Redis is running in a Docker container for caching"
echo "- Redis data is persisted in the redis_data volume"
echo ""
echo "🔍 Useful commands:"
echo "- View logs: docker-compose logs"
echo "- Restart services: docker-compose restart"
echo "- Stop all services: docker-compose down"
echo "- Backup database: docker-compose exec db pg_dump -U postgres gst_billing > backups/gst_billing_\$(date +%Y-%m-%d_%H-%M-%S).sql"
echo "========================================"
