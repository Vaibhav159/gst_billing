#!/usr/bin/env bash
# Drive the sandbox stack on the VM. Secrets live in $ENV_DIR (outside the
# repo, mode 0700) — never in the checkout, so they can't be committed or
# synced back. See README.md in this directory.
#
#   ./sandbox.sh init     generate secrets once (DB password, Django key)
#   ./sandbox.sh up       build + start db, redis, web, nginx (127.0.0.1:8060)
#   ./sandbox.sh dev      also start Vite with hot reload   (127.0.0.1:5174)
#   ./sandbox.sh seed     load synthetic data; logins -> $ENV_DIR/logins.txt
#   ./sandbox.sh reseed   wipe the sandbox data and seed again
#   ./sandbox.sh build    rebuild images (after dependency changes)
#   ./sandbox.sh ps|logs|down|manage <args>|compose <args>
#   ./sandbox.sh destroy  stop and delete every sandbox volume (asks first)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_DIR="${GST_SANDBOX_ENV_DIR:-$(dirname "$ROOT")/env}"
ENV_FILE="$ENV_DIR/sandbox.env"

# Image builds run in their own BuildKit container capped at one CPU and
# 3 GB, so a rebuild can't starve whatever else this VM serves.
BUILDER=gst-sandbox-builder
if docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
    export BUILDX_BUILDER="$BUILDER"
fi

dc() {
    docker compose -p gst-sandbox -f "$ROOT/deploy/sandbox/compose.yaml" --env-file "$ENV_FILE" "$@"
}

need_env() {
    [ -f "$ENV_FILE" ] || { echo "No $ENV_FILE yet — run: $0 init" >&2; exit 1; }
}

cmd="${1:-help}"
[ $# -gt 0 ] && shift

case "$cmd" in
    init)
        umask 077
        mkdir -p "$ENV_DIR"
        chmod 700 "$ENV_DIR"
        if [ -f "$ENV_FILE" ]; then
            echo "$ENV_FILE already exists; leaving it alone."
        else
            gen() { python3 -c 'import secrets; print(secrets.token_urlsafe(48))'; }
            {
                echo "# GST sandbox secrets (generated $(date -u +%FT%TZ)). Never commit."
                echo "DJANGO_SECRET_KEY=$(gen)"
                echo "SANDBOX_DB_PASSWORD=$(gen)"
            } > "$ENV_FILE"
            echo "Wrote $ENV_FILE (0600). Add GEMINI_API_KEYS / GEMINI_API_KEY there to enable AI import."
        fi
        if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
            docker buildx create --name "$BUILDER" --driver docker-container \
                --driver-opt cpu-period=100000 --driver-opt cpu-quota=100000 \
                --driver-opt memory=3g --driver-opt default-load=true
        fi
        ;;
    up)
        need_env
        dc up -d --build db redis web nginx
        dc ps
        ;;
    dev)
        need_env
        dc --profile dev up -d vite
        dc --profile dev ps
        ;;
    build)
        need_env
        dc --profile dev build "$@"
        ;;
    seed|reseed)
        need_env
        umask 077
        flag=()
        [ "$cmd" = reseed ] && flag=(--reset)
        # Into a temp file first: the seed is atomic, so when it fails the
        # existing users keep their passwords, and logins.txt is the only copy.
        tmp="$(mktemp "$ENV_DIR/logins.XXXXXX")"
        if dc exec -T web python manage.py seed_sandbox "${flag[@]}" --print-credentials > "$tmp"; then
            mv "$tmp" "$ENV_DIR/logins.txt"
            echo "Sandbox logins written to $ENV_DIR/logins.txt (0600)."
        else
            rm -f "$tmp"
            echo "Seeding failed; $ENV_DIR/logins.txt is unchanged." >&2
            exit 1
        fi
        ;;
    manage)
        need_env
        dc exec web python manage.py "$@"
        ;;
    ps)      need_env; dc --profile dev ps ;;
    logs)    need_env; dc --profile dev logs --tail=200 "$@" ;;
    down)    need_env; dc --profile dev down ;;
    compose) need_env; dc "$@" ;;
    destroy)
        need_env
        read -r -p "Delete the sandbox containers AND all its volumes (database, media)? [y/N] " ok
        [ "$ok" = y ] && dc --profile dev down -v
        ;;
    *)
        sed -n '2,15p' "$0"
        ;;
esac
