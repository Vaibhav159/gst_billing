# Stage 1: build the app (v3, web/). npm run build typechecks first (tsc), then vite build into dist/.
FROM node:20-alpine AS builder

WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our custom configuration
COPY nginx/conf.d /etc/nginx/conf.d

# Copy the built Vite React app from Stage 1
COPY --from=builder /app/dist /usr/share/nginx/html
