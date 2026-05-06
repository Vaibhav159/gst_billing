# Stage 1: Build the Vite React Frontend
FROM node:20-alpine AS builder

WORKDIR /app
# Copy the new frontend codebase
COPY sweet-rebuild-suite-main/package.json sweet-rebuild-suite-main/package-lock.json* ./
RUN npm ci

COPY sweet-rebuild-suite-main/ ./
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our custom configuration
COPY nginx/conf.d /etc/nginx/conf.d

# Copy the built Vite React app from Stage 1
COPY --from=builder /app/dist /usr/share/nginx/html
