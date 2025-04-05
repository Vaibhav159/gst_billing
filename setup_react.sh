#!/bin/bash

# Install Python dependencies
pip install djangorestframework==3.14.0

# Install Node.js dependencies
npm install

# Create static directory if it doesn't exist
mkdir -p static/frontend

# Build React app
npm run build

# Run migrations
python manage.py migrate

# Start the development server
python manage.py runserver
