# Stage 1: Build the Vite React Frontend
# --platform=$BUILDPLATFORM: the build output is plain static files, the same
# for every image, so it is built once on the runner's own architecture.
# Without it the arm64 image ran npm ci and vite under QEMU emulation, and the
# v2.0.9 release's nginx build was still running after 30 minutes (v2.0.8: 7).
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder

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
