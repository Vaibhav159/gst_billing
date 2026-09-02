# Deployment

Production is a single self-hosted **Cosmos Cloud** box. This page describes the
stack that actually runs; the previous version of it described one that no longer
existed (a local `db` service, a `deploy.sh`, `--build` where nothing builds), and
during a 1am restore the wrong procedure was the first one found.

## The stack

```
browser ──TLS──> Cosmos (edge proxy, owns the host)
                   └──> nginx image  :8060 (loopback only)   serves the SPA, /static, signed /media,
                          └──> web image  :8000               proxies /api, /admin, /explorer, /healthz
                                 ├──> Neon Postgres (external; nothing on this box holds the books)
                                 └──> redis (cache + throttle state)
             watchtower  — redeploys web+nginx when a new :latest is published
             backup      — nightly pg_dump + media tar into ./backups (+ optional off-site sync)
```

Everything is in `docker-compose.yml`; it is the only compose file. Both app
images are built by the tag-triggered **Release** workflow — never by CI on a
merge — see below.

## Configuration

Runtime configuration lives in `.env` next to the compose file (`.env.template`
is the reference). Two things are deliberately **not** read from `.env`:

- **The settings module.** The image sets `DJANGO_SETTINGS_MODULE=gst_billing.production_settings`
  and compose repeats it. A missing line in `.env` can no longer start production
  in DEBUG with a public signing key.
- **`WATCHTOWER_NOTIFICATION_URL`** is required by compose (`:?`). An unattended
  deploy that can crash-loop a migration has to be able to tell someone.
  Use any shoutrrr URL (Telegram is one line).

`production_settings` refuses to start without `DJANGO_SECRET_KEY`. Neon needs
`DB_*` plus `PGSSLMODE=require` for the backup sidecar (set by compose).

## Day-to-day

```bash
docker compose ps                      # everything "healthy"?
docker compose logs -f web             # gunicorn + Django
docker compose logs -f nginx
curl -fsS http://127.0.0.1:8060/healthz   # what Cosmos sees
```

Env changes need a **recreate**, not a restart (`restart` reuses the original
environment): `docker compose up -d --force-recreate --no-deps web`. The
`enable_debug.sh` / `disable_debug.sh` / `update_env.sh` scripts do this and print
the container's effective `DEBUG` afterwards.

Migrations run on every web container start (`migrate` precedes gunicorn in the
compose command). If one fails, gunicorn never starts, the container crash-loops,
its healthcheck goes red, and Watchtower's notification reports it. Roll back
with the previous version tag (below) and fix forward.

## First deploy of a non-root image (one-time)

From v2.0.5 the backend image runs as the unprivileged `app` user. The two
named volumes it writes to — `gst_media_volume` (uploads, capture photos,
source files) and `gst_static_volume` (`collectstatic` output) — were
created by earlier images that ran as root, so their contents are
root-owned. Docker preserves that ownership when a new container mounts an
existing volume, which means the first non-root start fails at
`collectstatic` (permission denied) and the container crash-loops.

Fix the ownership once, from the compose directory, using the image's own
user so no numeric uid has to be guessed:

```bash
docker compose pull web
docker compose run --rm --no-deps --user root web chown -R app:app /app/media /app/staticfiles
docker compose up -d --force-recreate --no-deps web
```

If Watchtower already swapped the image and `web` is restarting in a loop,
the same three commands repair it. The ownership sticks; later releases need
nothing.

## Releases and automatic deployment

Deploys are **tag-driven**. Merging PRs changes `main` (and runs Tests) but
does not touch production; production changes when you cut a release.

### Cut a release

```bash
git tag -a v2.0.0 -m "everything since the May image"
git push origin v2.0.0
```

(Equivalently: GitHub → Releases → *Draft a new release* → create the tag
there — publishing the release pushes the tag.)

That tag triggers the **Release** workflow:

1. the backend test suite runs as a gate (a bad tag never builds),
2. both images build for amd64+arm64 and push to Docker Hub as
   `:latest` **and** `:v2.0.0`.

### What the server does (nothing, automatically)

`docker compose up -d` runs a **Watchtower** container that polls Docker Hub
every 60 seconds. When a release lands, it pulls the new `:latest`, recreates
`web` and `nginx` (only those two — they're label-scoped), and prunes the old
images. The `web` container's start command runs `migrate`, so database
migrations apply exactly as they did under manual deploys. End to end: a tag
push is live in production about 5–10 minutes later (mostly build time).

Watch it happen:

```bash
docker compose logs -f watchtower
```

### Roll back

Every release keeps its immutable version tag on Docker Hub. To roll back,
pin the compose file to the last good version and restart:

```yaml
# docker-compose.yml (temporarily)
web:
  image: vaibhav198/gst-billing:v1.9.0
nginx:
  image: vaibhav198/gst-billing-nginx:v1.9.0
```

```bash
docker compose up -d web nginx
```

Watchtower only tracks the tag a container was started from, so a container
pinned to `v1.9.0` stays put until you switch it back to `:latest`.
(Remember migrations don't auto-reverse — rolling back past a migration needs
a manual `manage.py migrate billing <previous>` first.)

### Manual escape hatch

The Release workflow also has a **Run workflow** button (`workflow_dispatch`)
— it builds whatever ref you point it at and tags the images
`:latest` + `:<ref-name>`, for the rare "rebuild without a new tag" case.

## Backups

A `backup` sidecar (postgres:16-alpine, **not** watchtower-labeled) runs
`deploy/backup/backup.sh`: on start and every 24h it takes

- `pg_dump --format=custom` of the app database (`db-<stamp>.dump`), verified
  with `pg_restore --list`, and
- a tar of the media volume (`media-<stamp>.tar.gz`)

into `./backups` on the host, deleting files older than 30 days. First run:

```bash
mkdir -p backups && docker compose up -d backup && docker compose logs -f backup
```

**Off-site copy**: `./backups` lives on the same disk as everything else.
Sync it somewhere else (cron + rclone/rsync, or your provider's snapshot
feature) — a backup on the failed disk is not a backup.

### Restore drill (do this once now, not during an outage)

```bash
docker compose exec backup sh
pg_restore --list /backups/db-<stamp>.dump | head    # archive is readable
createdb  -h "$DB_HOST" -U "$DB_USER" restore_drill
pg_restore -h "$DB_HOST" -U "$DB_USER" -d restore_drill --no-owner /backups/db-<stamp>.dump
psql -h "$DB_HOST" -U "$DB_USER" -d restore_drill -c 'SELECT COUNT(*) FROM billing_invoice;'
dropdb    -h "$DB_HOST" -U "$DB_USER" restore_drill
```

Media check: `tar -tzf /backups/media-<stamp>.tar.gz | head`.

## Health checks and alerts

`GET /healthz` (no auth) answers `200 {"ok": true, "db": true}` when Django
can reach the database, `503` otherwise. Point a free uptime monitor
(UptimeRobot, Better Stack, …) at `https://<your-domain>/healthz` and you'll
hear about outages before anyone else does.

Deploy notifications: set `WATCHTOWER_NOTIFICATION_URL` in `.env` using any
[shoutrrr](https://containrrr.dev/shoutrrr/) URL — e.g.
`telegram://<bot-token>@telegram?chats=<chat-id>` — and Watchtower announces
every image update (and failed pull). Leave it unset for silence.
