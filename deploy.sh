#!/bin/bash

echo "========================================"
echo "🚀 Deploying GST Billing Application"
echo "========================================"

# Create necessary directories
echo "📂 Creating necessary directories..."
mkdir -p nginx/conf.d nginx/ssl

# Build and start the containers
echo "🔨 Building and starting Docker containers..."
docker-compose up -d --build

echo "✅ Deployment completed!"
echo "Your application should be running at http://your-domain.com"
echo "========================================"
echo "📝 Next steps:"
echo "1. Update the domain name in nginx/conf.d/app.conf"
echo "2. Set up SSL certificates in nginx/ssl directory"
echo "3. Update environment variables for database connection"
echo "4. Uncomment SSL configuration in nginx/conf.d/app.conf when ready"
echo "========================================"
