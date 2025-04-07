# GST Billing Application Deployment Guide

This guide explains how to deploy the GST Billing application using Docker on your own server.

## Prerequisites

- A server with Docker and Docker Compose installed
- Domain name (optional but recommended)

## Deployment Steps

### 1. Prepare Your Server

Install Docker and Docker Compose:

```bash
# Update system packages
sudo apt update
sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.18.1/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### 2. Clone the Repository

```bash
git clone https://github.com/yourusername/gst_billing.git
cd gst_billing
```

### 3. Configure Environment Variables

```bash
# Copy the template file
cp .env.template .env

# Edit the .env file with your settings
nano .env
```

Update the following variables in the `.env` file:
- `DJANGO_SECRET_KEY`: A secure random string
- `ALLOWED_HOSTS`: Your domain name(s)

The default configuration includes:
- PostgreSQL database running in a Docker container
- Redis for caching running in a Docker container

### 4. Configure Nginx

Edit the Nginx configuration file:

```bash
nano nginx/conf.d/app.conf
```

Replace `your-domain.com` and `www.your-domain.com` with your actual domain name.

### 5. Deploy the Application

Make the deployment script executable and run it:

```bash
chmod +x deploy.sh
./deploy.sh
```

### 6. Set Up SSL (Optional but Recommended)

#### Using Let's Encrypt:

1. Install Certbot on your host machine:
   ```bash
   sudo apt install -y certbot
   ```

2. Obtain SSL certificates:
   ```bash
   sudo certbot certonly --standalone -d your-domain.com -d www.your-domain.com
   ```

3. Copy the certificates to the Nginx SSL directory:
   ```bash
   sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem nginx/ssl/cert.pem
   sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem nginx/ssl/key.pem
   ```

4. Edit the Nginx configuration to enable HTTPS:
   ```bash
   nano nginx/conf.d/app.conf
   ```

   Uncomment the HTTPS server block and the HTTP to HTTPS redirect.

5. Restart the Nginx container:
   ```bash
   docker-compose restart nginx
   ```

### 7. Maintenance

#### Updating the Application

```bash
# Pull the latest changes
git pull

# Rebuild and restart the containers
docker-compose up -d --build
```

#### Viewing Logs

```bash
# View logs from all containers
docker-compose logs

# View logs from a specific container
docker-compose logs web
docker-compose logs nginx
```

#### Backing Up the Database

To back up the PostgreSQL database:

```bash
# Create a backup directory
mkdir -p backups

# Backup the database
docker-compose exec db pg_dump -U postgres gst_billing > backups/gst_billing_$(date +%Y-%m-%d_%H-%M-%S).sql
```

#### Restoring the Database

To restore from a backup:

```bash
# Restore the database
cat backups/your-backup-file.sql | docker-compose exec -T db psql -U postgres gst_billing
```

## Troubleshooting

### Container Issues

If containers are not starting properly:

```bash
# Check container status
docker-compose ps

# View detailed logs
docker-compose logs web
```

### Nginx Issues

If Nginx is not serving the application:

```bash
# Check Nginx configuration
docker-compose exec nginx nginx -t

# Restart Nginx
docker-compose restart nginx
```

### Database Connection Issues

If the application cannot connect to the database:

1. Verify your database credentials in the `.env` file
2. Check if the database container is running:
   ```bash
   docker-compose ps db
   ```
3. Check the database logs:
   ```bash
   docker-compose logs db
   ```
4. Check the application logs for specific error messages:
   ```bash
   docker-compose logs web
   ```

### Redis Connection Issues

If the application cannot connect to Redis:

1. Check if the Redis container is running:
   ```bash
   docker-compose ps redis
   ```
2. Check the Redis logs:
   ```bash
   docker-compose logs redis
   ```
3. You can also connect to the Redis CLI for debugging:
   ```bash
   docker-compose exec redis redis-cli
   ```

## Security Considerations

1. **Environment Variables**: Never commit the `.env` file to version control
2. **Database Security**: Use strong passwords for the PostgreSQL container
3. **Redis Security**: Consider enabling Redis authentication in production
4. **Regular Updates**: Keep your Docker images and application dependencies updated
5. **Firewall**: Configure a firewall to only allow necessary ports (80, 443)
6. **Volume Backups**: Regularly back up your Docker volumes (postgres_data, redis_data)
7. **Monitoring**: Set up monitoring for your containers and server

## Making Your Application Accessible Over the Internet

After deploying your application using Docker, follow these steps to make it accessible over the internet:

### 1. Domain Name Setup

#### A. Register a Domain Name
If you don't already have a domain name:
1. Register a domain through a registrar like Namecheap, GoDaddy, or Google Domains
2. Once registered, access your domain's DNS settings

#### B. Configure DNS Records
Set up DNS records to point to your server:

1. Add an A record:
   - Type: A
   - Name: @ (or your subdomain, e.g., "billing")
   - Value: Your server's public IP address
   - TTL: 3600 (or as recommended by your registrar)

2. Add a www record (optional):
   - Type: A or CNAME
   - Name: www
   - Value: Your server's IP address (for A record) or your domain (for CNAME)
   - TTL: 3600

DNS changes can take 24-48 hours to propagate, but often happen within a few hours.

### 2. Configure Your Server

#### A. Update Nginx Configuration

Edit the Nginx configuration to use your domain name:

```bash
# Edit the Nginx configuration
nano nginx/conf.d/app.conf
```

Replace "your-domain.com" and "www.your-domain.com" with your actual domain name:

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Rest of the configuration...
}
```

#### B. Update Environment Variables

Edit your .env file to include your domain in ALLOWED_HOSTS:

```bash
nano .env
```

Update the ALLOWED_HOSTS line:
```
ALLOWED_HOSTS=yourdomain.com,www.yourdomain.com
```

#### C. Restart the Containers

Apply the changes:

```bash
docker-compose restart
```

### 3. Configure Firewall

Ensure your server's firewall allows traffic on ports 80 (HTTP) and 443 (HTTPS):

```bash
# For UFW (Ubuntu's default firewall)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status
```

### 4. Set Up SSL/HTTPS (Recommended)

Secure your site with HTTPS using Let's Encrypt:

```bash
# Install Certbot
sudo apt update
sudo apt install -y certbot

# Obtain certificates
sudo certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com
```

Copy the certificates to your Nginx SSL directory:

```bash
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/ssl/cert.pem
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem nginx/ssl/key.pem
```

Edit the Nginx configuration to enable HTTPS:

```bash
nano nginx/conf.d/app.conf
```

Uncomment the HTTPS server block and the HTTP to HTTPS redirect:

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Redirect HTTP to HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name yourdomain.com www.yourdomain.com;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    # Rest of the configuration...
}
```

Restart Nginx:

```bash
docker-compose restart nginx
```

### 5. Set Up Auto-Renewal for SSL Certificates

Create a script to renew certificates:

```bash
nano renew_certs.sh
```

Add the following content:

```bash
#!/bin/bash

# Stop Nginx to free up port 80
docker-compose stop nginx

# Renew certificates
certbot renew

# Copy new certificates to Nginx SSL directory
cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/ssl/cert.pem
cp /etc/letsencrypt/live/yourdomain.com/privkey.pem nginx/ssl/key.pem

# Start Nginx again
docker-compose start nginx
```

Make the script executable:

```bash
chmod +x renew_certs.sh
```

Set up a cron job to run this script monthly:

```bash
crontab -e
```

Add this line:

```
0 0 1 * * /path/to/gst_billing/renew_certs.sh >> /path/to/gst_billing/cron.log 2>&1
```

### 6. Testing Your Setup

After completing these steps:

1. Visit your domain in a web browser: `https://yourdomain.com`
2. Verify that the site loads correctly and the connection is secure
3. Test all functionality to ensure everything works as expected

### 7. Performance Optimization

For better performance:

1. Enable Nginx caching for static assets:
   ```bash
   nano nginx/conf.d/app.conf
   ```

   Add to the server block:
   ```nginx
   # Cache settings
   proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=STATIC:10m inactive=24h max_size=1g;
   ```

2. Optimize PostgreSQL:
   Create a custom PostgreSQL configuration:
   ```bash
   mkdir -p postgres/conf
   nano postgres/conf/postgresql.conf
   ```

   Add performance tuning parameters and update docker-compose.yml to mount this configuration.
