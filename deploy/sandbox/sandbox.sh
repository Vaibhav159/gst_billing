#!/usr/bin/env bash
# Drive the sandbox stack on the VM. Secrets live in $ENV_DIR (outside the
# repo, mode 0700) — never in the checkout, so they can't be committed or
# synced back. See README.md in this directory.
#
#   ./sandbox.sh init     generate secrets once (DB password, Django key)
#   ./sandbox.sh up       build + start db, redis, web, nginx (127.0.0.1:8060)
#   ./sandbox.sh dev      also start Vite: v2 on 127.0.0.1:5174, v3 on 127.0.0.1:5180
#   ./sandbox.sh seed     load synthetic data; logins -> $ENV_DIR/logins.txt
#   ./sandbox.sh reseed   wipe the sandbox data and seed again
#   ./sandbox.sh build    rebuild images (after dependency changes)
#   ./sandbox.sh ps|logs|down|manage <args>|compose <args>
#   ./sandbox.sh destroy  stop and delete every sandbox volume (asks first)
#
# A second sandbox: GST_SANDBOX_PROJECT=gst-sandbox-2 ./sandbox.sh up|dev|seed
# runs its own compose project (database, Redis, volumes, image tags) on
# 127.0.0.1:8160 (nginx), 5274 (v2 Vite) and 5280 (v3 Vite), and its seed
# writes $ENV_DIR/logins-2.txt. gst-sandbox-N takes 8060/5174/5180 + 100*(N-1).
# GST_SANDBOX_NGINX_PORT, GST_SANDBOX_VITE_PORT, GST_SANDBOX_VITE3_PORT and
# GST_SANDBOX_LOGINS (a file name in $ENV_DIR) override them.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_DIR="${GST_SANDBOX_ENV_DIR:-$(dirname "$ROOT")/env}"
ENV_FILE="$ENV_DIR/sandbox.env"

# Which sandbox: gst-sandbox (the default) or gst-sandbox-N. Nothing else, so
# this script only ever drives its own compose projects.
PROJECT="${GST_SANDBOX_PROJECT:-gst-sandbox}"
case "$PROJECT" in
    gst-sandbox)
        offset=0; logins=logins.txt ;;
    gst-sandbox-[2-9])
        n="${PROJECT#gst-sandbox-}"; offset=$(( (n - 1) * 100 )); logins="logins-$n.txt" ;;
    *)
        echo "GST_SANDBOX_PROJECT must be gst-sandbox or gst-sandbox-N (N 2-9), not $PROJECT" >&2; exit 1 ;;
esac
# compose.yaml reads these (its defaults are the first sandbox's).
export GST_SANDBOX_PROJECT="$PROJECT"
export GST_SANDBOX_NGINX_PORT="${GST_SANDBOX_NGINX_PORT:-$(( 8060 + offset ))}"
export GST_SANDBOX_VITE_PORT="${GST_SANDBOX_VITE_PORT:-$(( 5174 + offset ))}"
export GST_SANDBOX_VITE3_PORT="${GST_SANDBOX_VITE3_PORT:-$(( 5180 + offset ))}"
LOGINS_FILE="$ENV_DIR/${GST_SANDBOX_LOGINS:-$logins}"
for port in "$GST_SANDBOX_NGINX_PORT" "$GST_SANDBOX_VITE_PORT" "$GST_SANDBOX_VITE3_PORT"; do
    case "$port" in
        80|8000|5432) echo "Port $port belongs to Bahikhata production; pick another." >&2; exit 1 ;;
    esac
done

# Image builds run in their own BuildKit container capped at one CPU and
# 3 GB, so a rebuild can't starve whatever else this VM serves.
BUILDER=gst-sandbox-builder
if docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
    export BUILDX_BUILDER="$BUILDER"
fi

dc() {
    docker compose -p "$PROJECT" -f "$ROOT/deploy/sandbox/compose.yaml" --env-file "$ENV_FILE" "$@"
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
        dc --profile dev up -d vite vite-v3
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
        # existing users keep their passwords, and the logins file is the only copy.
        # Every part's sample data (pre-flight P2-6/P6-8): add each new part flag here.
        tmp="$(mktemp "$ENV_DIR/logins.XXXXXX")"
        if dc exec -T --user app web python manage.py seed_sandbox "${flag[@]}" --purchases-v3 --gst --easy --print-credentials > "$tmp"; then
            mv "$tmp" "$LOGINS_FILE"
            echo "Sandbox logins written to $LOGINS_FILE (0600)."
        else
            rm -f "$tmp"
            echo "Seeding failed; $LOGINS_FILE is unchanged." >&2
            exit 1
        fi
        ;;
    manage)
        need_env
        dc exec --user app web python manage.py "$@"
        ;;
    ps)      need_env; dc --profile dev ps ;;
    logs)    need_env; dc --profile dev logs --tail=200 "$@" ;;
    down)    need_env; dc --profile dev down ;;
    compose) need_env; dc "$@" ;;
    destroy)
        need_env
        read -r -p "Delete the $PROJECT containers AND all its volumes (database, media)? [y/N] " ok
        [ "$ok" = y ] && dc --profile dev down -v
        ;;
    *)
        sed -n '2,21p' "$0"
        ;;
esac
