#!/bin/bash

echo "========================================"
echo "🔒 Renewing SSL Certificates"
echo "========================================"

# Stop Nginx to free up port 80
echo "📥 Stopping Nginx container..."
docker-compose stop nginx

# Renew certificates
echo "🔄 Renewing Let's Encrypt certificates..."
certbot renew

# Copy new certificates to Nginx SSL directory
echo "📋 Copying new certificates to Nginx SSL directory..."
cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/ssl/cert.pem
cp /etc/letsencrypt/live/yourdomain.com/privkey.pem nginx/ssl/key.pem

# Start Nginx again
echo "📤 Starting Nginx container..."
docker-compose start nginx

echo "✅ Certificate renewal process completed!"
echo "========================================"
