.PHONY: help up down restart logs pull deploy update shell migrate createsuperuser collectstatic

# Show this help message
help:
	@echo "Usage: make [command]"
	@echo ""
	@echo "Commands:"
	@echo "  up              Start all containers in the background"
	@echo "  down            Stop and remove all containers"
	@echo "  restart         Restart all containers"
	@echo "  logs            Follow logs for all containers"
	@echo "  pull            Pull the latest images from Docker Hub"
	@echo "  deploy          Pull latest images and recreate containers"
	@echo "  update          Fetch latest images, recreate containers, and explicitly run migrations"
	@echo "  shell           Open a bash shell inside the Django 'web' container"
	@echo "  migrate         Run Django database migrations"
	@echo "  createsuperuser Create a Django superuser"
	@echo "  collectstatic   Collect static files manually"

# Bring up all containers in the background
up:
	docker compose up -d

# Stop and remove all containers
down:
	docker compose down

# Restart all containers
restart:
	docker compose restart

# View logs for all containers
logs:
	docker compose logs -f

# Pull the latest versions of the images from Docker Hub
pull:
	docker compose pull

# Pull latest images and restart containers (best for deploying updates)
deploy:
	docker compose pull
	docker compose up -d

# Open a bash shell inside the Django web container
shell:
	docker compose exec web bash

# Run Django database migrations
migrate:
	docker compose exec web python manage.py migrate

# Create a Django superuser
createsuperuser:
	docker compose exec web python manage.py createsuperuser

# Collect static files manually (although this is run automatically on startup)
collectstatic:
	docker compose exec web python manage.py collectstatic --noinput

# Fetch latest images, recreate containers, and explicitly run migrations
update:
	docker compose pull
	docker compose up -d
	@echo "Applying any pending migrations explicitly..."
	docker compose exec web python manage.py migrate
