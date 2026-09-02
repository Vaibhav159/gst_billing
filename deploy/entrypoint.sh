#!/bin/sh
# Start as root, make the writable volumes belong to the unprivileged user,
# then drop privileges for the real command (gunicorn, migrate, a shell).
#
# Named volumes created by the images that ran as root (through v2.0.4) keep
# root-owned contents when a newer container mounts them; without this step
# the first non-root start died at `collectstatic` (permission denied) and
# the container crash-looped. Ownership is fixed only when something is not
# already app-owned, so steady-state starts cost a few stat calls.
set -e

if [ "$(id -u)" = "0" ]; then
    for d in /app/media /app/staticfiles /app/logs; do
        mkdir -p "$d"
        if [ "$(stat -c %U "$d")" != "app" ] || [ -n "$(find "$d" ! -user app -print -quit)" ]; then
            chown -R app:app "$d"
        fi
    done
    exec gosu app "$@"
fi

exec "$@"
