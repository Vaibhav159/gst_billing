FROM nginx:alpine
# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our custom configuration
COPY conf.d /etc/nginx/conf.d
