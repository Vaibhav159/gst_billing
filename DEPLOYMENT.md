# GST Billing Application Deployment Guide

This guide explains how to deploy the GST Billing application using Docker on your own server.

## Prerequisites

- A server with Docker and Docker Compose installed
- Domain name (optional but recommended)
- PostgreSQL database (can be hosted externally)

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
- `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`: Your PostgreSQL database details
- `ALLOWED_HOSTS`: Your domain name(s)

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

Since you're using an external database, follow the backup procedures for your database provider.

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
2. Check if the database is accessible from your server
3. Check the application logs for specific error messages:
   ```bash
   docker-compose logs web
   ```

## Security Considerations

1. **Environment Variables**: Never commit the `.env` file to version control
2. **Database Security**: Use strong passwords and restrict database access
3. **Regular Updates**: Keep your Docker images and application dependencies updated
4. **Firewall**: Configure a firewall to only allow necessary ports (80, 443)
5. **Monitoring**: Set up monitoring for your containers and server
