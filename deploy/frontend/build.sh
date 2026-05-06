#!/bin/bash
# Frontend build script for static deployment
# Run from the sweet-rebuild-suite-main/ directory
#
# Usage:
#   ./deploy/frontend/build.sh https://your-api-domain.com/api/
#
# Or set the env var directly:
#   VITE_API_BASE_URL=https://your-api-domain.com/api/ ./deploy/frontend/build.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/../../sweet-rebuild-suite-main" && pwd)"

# API URL from argument or env var
if [ -n "$1" ]; then
    export VITE_API_BASE_URL="$1"
fi

if [ -z "$VITE_API_BASE_URL" ]; then
    echo "ERROR: Set VITE_API_BASE_URL (the backend API URL)"
    echo "Usage: $0 https://your-backend.com/api/"
    exit 1
fi

echo "Building frontend..."
echo "  API URL: $VITE_API_BASE_URL"
echo "  Source:  $FRONTEND_DIR"

cd "$FRONTEND_DIR"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm ci
fi

# Build
npm run build

# Copy SPA routing files for static hosting
cp "$SCRIPT_DIR/_redirects" dist/_redirects 2>/dev/null || true

# GitHub Pages: copy index.html as 404.html for SPA routing
cp dist/index.html dist/404.html

echo ""
echo "Build complete! Output: $FRONTEND_DIR/dist/"
echo ""
echo "Deploy dist/ to:"
echo "  - Cloudflare Pages: connect repo or upload dist/"
echo "  - GitHub Pages: push dist/ to gh-pages branch"
