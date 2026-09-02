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
    verified=0
    if pg_dump -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" \
        --no-owner --format=custom -f "/backups/db-$ts.dump"; then
        # A dump that pg_restore cannot even list is not a backup.
        entries=$(pg_restore --list "/backups/db-$ts.dump" 2>/dev/null | wc -l)
        if [ "$entries" -gt 0 ]; then
            echo "[backup] db-$ts.dump ok ($entries archive entries)"
            verified=1
        else
            echo "[backup] ERROR: db-$ts.dump is not a readable archive" >&2
            rm -f "/backups/db-$ts.dump"
        fi
    else
        echo "[backup] ERROR: pg_dump failed (client $(pg_dump --version | awk '{print $3}') — is Neon on a newer major?)" >&2
        rm -f "/backups/db-$ts.dump"
    fi

    if tar -czf "/backups/media-$ts.tar.gz" -C /media .; then
        echo "[backup] media-$ts.tar.gz ok ($(du -h "/backups/media-$ts.tar.gz" | cut -f1))"
    else
        echo "[backup] ERROR: media tar failed" >&2
    fi

    if [ "$verified" = 1 ]; then
        # Prune ONLY behind a verified dump. Unconditional pruning meant 31
        # unnoticed bad nights ended at zero backups; now a broken pipeline
        # keeps the last good ones forever and the ping stays silent.
        find /backups -type f -mtime +30 -delete
        [ -n "${BACKUP_PING_URL:-}" ] && { wget -qO- --timeout=15 "$BACKUP_PING_URL" >/dev/null 2>&1 || curl -fsS -m 15 "$BACKUP_PING_URL" >/dev/null 2>&1 || echo "[backup] WARN: ping failed" >&2; }
        if [ -n "${BACKUP_SYNC_CMD:-}" ]; then
            ( cd /backups && sh -c "$BACKUP_SYNC_CMD" ) && echo "[backup] off-site sync ok" || echo "[backup] ERROR: off-site sync failed" >&2
        fi
    else
        echo "[backup] no verified dump tonight — nothing pruned, no ping sent" >&2
    fi
    echo "[backup] done; sleeping 24h"
    sleep 86400
done
