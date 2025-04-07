# Docker Setup for GST Billing Application

This document explains how to run the GST Billing application using Docker.

## Prerequisites

- Docker and Docker Compose installed on your system
- A Docker Hub account (if you want to push the image)

## Files

The Docker setup consists of the following files:

1. **Dockerfile**: The main Dockerfile for building the application image
2. **docker-compose.yml**: The main Docker Compose file for running the application
3. **run_docker.sh**: Script for running the application
4. **build_docker.sh**: Script for building and pushing the image to Docker Hub

## Running the Application

To run the application, simply execute:

```bash
./run_docker.sh
```

This script will:
- Check if you're on the main branch
- Create a .env file if it doesn't exist
- Prompt for superuser credentials
- Create necessary directories
- Create a default Nginx configuration if needed
- Start the application using Docker Compose

The application will be available at http://localhost:80

## Building and Pushing the Image

To build and push the image to Docker Hub, execute:

```bash
./build_docker.sh
```

This script will:
- Check if you're on the main branch
- Prompt for your Docker Hub username
- Build the Docker image
- Log in to Docker Hub
- Push the image to Docker Hub

## Environment Variables

The following environment variables can be set in the .env file:

### Django Settings
- `DJANGO_SECRET_KEY`: Secret key for Django
- `DJANGO_SETTINGS_MODULE`: Django settings module
- `DEBUG`: Debug mode (True/False)
- `ALLOWED_HOSTS`: Comma-separated list of allowed hosts

### Database Settings
- `DB_NAME`: Database name
- `DB_USER`: Database user
- `DB_PASSWORD`: Database password
- `DB_HOST`: Database host
- `DB_PORT`: Database port

### Redis Settings
- `REDIS_HOST`: Redis host
- `REDIS_PORT`: Redis port

### Superuser Settings
- `DJANGO_SUPERUSER_USERNAME`: Superuser username
- `DJANGO_SUPERUSER_EMAIL`: Superuser email
- `DJANGO_SUPERUSER_PASSWORD`: Superuser password

### Docker Hub Settings
- `DOCKER_USERNAME`: Docker Hub username
