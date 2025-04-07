#!/bin/bash

# Exit on error
set -e

# Determine Docker Compose command
if command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE="docker-compose"
else
    DOCKER_COMPOSE="docker compose"
fi

# Check if logs directory exists
if [ ! -d logs ]; then
    echo "❌ Logs directory not found. Make sure the application is running."
    exit 1
fi

# Function to display menu
show_menu() {
    echo "📋 Select a log to view:"
    echo "1) Container logs (live)"
    echo "2) Django log file"
    echo "3) Gunicorn access log"
    echo "4) Gunicorn error log"
    echo "5) All logs (tail)"
    echo "q) Quit"
    echo ""
    read -p "Enter your choice: " choice
    
    case $choice in
        1)
            echo "Viewing container logs (press Ctrl+C to exit)..."
            $DOCKER_COMPOSE logs -f web
            ;;
        2)
            if [ -f logs/django.log ]; then
                less logs/django.log
            else
                echo "❌ Django log file not found."
            fi
            ;;
        3)
            if [ -f logs/gunicorn-access.log ]; then
                less logs/gunicorn-access.log
            else
                echo "❌ Gunicorn access log file not found."
            fi
            ;;
        4)
            if [ -f logs/gunicorn-error.log ]; then
                less logs/gunicorn-error.log
            else
                echo "❌ Gunicorn error log file not found."
            fi
            ;;
        5)
            echo "Viewing all logs (press Ctrl+C to exit)..."
            tail -f logs/*.log
            ;;
        q|Q)
            exit 0
            ;;
        *)
            echo "❌ Invalid choice. Please try again."
            ;;
    esac
    
    # Return to menu after viewing logs
    echo ""
    show_menu
}

# Show the menu
show_menu
