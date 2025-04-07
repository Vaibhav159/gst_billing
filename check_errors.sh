#!/bin/bash

# Exit on error
set -e

# Check if logs directory exists
if [ ! -d logs ]; then
    echo "❌ Logs directory not found. Make sure the application is running."
    exit 1
fi

# Check Django log for errors
echo "🔍 Checking Django log for errors..."
if [ -f logs/django.log ]; then
    grep -i "error\|exception\|warning" logs/django.log || echo "✅ No errors found in Django log."
else
    echo "❌ Django log file not found."
fi

# Check Gunicorn error log
echo ""
echo "🔍 Checking Gunicorn error log..."
if [ -f logs/gunicorn-error.log ]; then
    if [ -s logs/gunicorn-error.log ]; then
        cat logs/gunicorn-error.log
    else
        echo "✅ No errors found in Gunicorn error log."
    fi
else
    echo "❌ Gunicorn error log file not found."
fi

# Check for 400 and 500 status codes in Gunicorn access log
echo ""
echo "🔍 Checking for 400/500 status codes in Gunicorn access log..."
if [ -f logs/gunicorn-access.log ]; then
    grep -E ' (4[0-9]{2}|5[0-9]{2}) ' logs/gunicorn-access.log || echo "✅ No 400/500 status codes found in Gunicorn access log."
else
    echo "❌ Gunicorn access log file not found."
fi
