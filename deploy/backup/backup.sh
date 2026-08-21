#!/bin/sh
# Nightly backup loop. Runs inside postgres:16-alpine with the app's .env:
# DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD (Neon needs PGSSLMODE=require,
# set by compose). Writes to /backups (host ./backups), keeps 30 days.
#
# Restore (drill this once — an untested backup is a hope, not a backup):
#   docker compose exec backup sh
#   pg_restore --list /backups/db-<stamp>.dump | head          # sanity
#   createdb -h "$DB_HOST" -U "$DB_USER" restore_drill
#   pg_restore -h "$DB_HOST" -U "$DB_USER" -d restore_drill --no-owner \
#       /backups/db-<stamp>.dump
#   psql -h "$DB_HOST" -U "$DB_USER" -d restore_drill \
#       -c 'SELECT COUNT(*) FROM billing_invoice;'
#   dropdb  -h "$DB_HOST" -U "$DB_USER" restore_drill
# Media: tar -tzf /backups/media-<stamp>.tar.gz | head

set -u
mkdir -p /backups

while true; do
    ts=$(date +%Y%m%d-%H%M)
    echo "[backup] $ts starting"

    export PGPASSWORD="$DB_PASSWORD"
    if pg_dump -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" \
        --no-owner --format=custom -f "/backups/db-$ts.dump"; then
        # A dump that pg_restore cannot even list is not a backup.
        entries=$(pg_restore --list "/backups/db-$ts.dump" | wc -l)
        echo "[backup] db-$ts.dump ok ($entries archive entries)"
    else
        echo "[backup] ERROR: pg_dump failed" >&2
        rm -f "/backups/db-$ts.dump"
    fi

    if tar -czf "/backups/media-$ts.tar.gz" -C /media .; then
        echo "[backup] media-$ts.tar.gz ok ($(du -h "/backups/media-$ts.tar.gz" | cut -f1))"
    else
        echo "[backup] ERROR: media tar failed" >&2
    fi

    find /backups -type f -mtime +30 -delete
    echo "[backup] done; sleeping 24h"
    sleep 86400
done
