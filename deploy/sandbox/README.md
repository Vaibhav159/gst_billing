# Sandbox — a private copy of the production stack

The same images, nginx conf, production settings, Redis 7 and gunicorn as the
live site (`../../docker-compose.yml`), with a Postgres 17 container standing
in for Neon. Its database is new and holds **synthetic data only**. It never
connects to the dev or production databases, and nothing in it is reachable
from the internet.

It lives on **bahikhata-free** (`ssh bk-free`), which also runs Bahikhata
production, the Elnuvi preview and a CI runner. Work happens directly on the VM.

## What keeps it apart from the real books

- No credentials for the real databases exist on this VM. `gst_billing/local.py`
  here holds only a random dev key, so plain `manage.py` falls back to SQLite.
- `gst_billing/sandbox_settings.py` refuses to start unless `GST_SANDBOX=1`,
  `DB_HOST` is the local `db` container and `DB_NAME` starts `gst_sandbox`.
- `seed_sandbox` refuses any other database, and refuses to overwrite data
  without `--reset`.
- Secrets live in `../env/` (mode 0700, outside the checkout).
- Every port binds to `127.0.0.1`; reach it through an SSH tunnel.

## Layout

```
/home/ubuntu/gst-billing-sandbox/
  gst_billing/        the repo (clone of github.com/Vaibhav159/gst_billing)
  env/sandbox.env     DJANGO_SECRET_KEY, SANDBOX_DB_PASSWORD, GEMINI_* (0600)
  env/logins.txt      role, username, password for each sandbox user (0600)
```

## Ports on this VM

| Port (127.0.0.1) | What |
|---|---|
| 8060 | sandbox nginx: the built app, exactly as production serves it |
| 5174 | sandbox Vite in Docker (`sandbox.sh dev`), hot reload |
| 5173 | native `npm run dev` (configured by `sweet-rebuild-suite-main/.env.local`) |
| 8000, 80, 5432 | **Bahikhata production** — never point anything at these |

## Running it

```bash
deploy/sandbox/sandbox.sh up      # db, redis, web, nginx (rebuilds if needed)
deploy/sandbox/sandbox.sh dev     # + Vite on 5174
deploy/sandbox/sandbox.sh seed    # first time only; reseed wipes and reloads
deploy/sandbox/sandbox.sh logs web
deploy/sandbox/sandbox.sh manage migrate
```

- **Python edits** reload gunicorn by themselves: the backend source is mounted
  into the web container.
- **Frontend edits** hot-reload in Vite (5174 or 5173). To see the built app
  exactly as nginx serves it: `sandbox.sh build nginx && sandbox.sh up`.
- **Dependency changes** (`pyproject.toml`/`uv.lock`) need `sandbox.sh build web`.
  Image builds run in a BuildKit container capped at 1 CPU / 3 GB.
- **New migrations**: write them with `.venv/bin/python manage.py makemigrations`
  (SQLite, nothing real), then `sandbox.sh manage migrate`.

## Checks (the repo's definition of done)

```bash
.venv/bin/python -m pytest billing/ -x --tb=short
cd sweet-rebuild-suite-main && npx tsc --noEmit -p tsconfig.app.json && npm run test -- --run
```

## Opening it from the laptop

```bash
ssh -N -L 8060:127.0.0.1:8060 -L 5174:127.0.0.1:5174 bk-free
```

Then http://localhost:8060 or http://localhost:5174. Logins are in
`../env/logins.txt`: one each for owner (superuser), admin, editor, viewer
and a user with no group.

## Differences from production, on purpose

| | Production | Sandbox |
|---|---|---|
| Database | Neon (external) | `postgres:17-alpine` container, synthetic data |
| Settings | `production_settings` | `sandbox_settings` = production + DB guard, localhost origins |
| gunicorn | 4 workers × 4 threads | 2 × 4, `--reload`, backend source mounted read-only |
| Edge | Cosmos TLS → nginx | SSH tunnel → nginx |
| Watchtower, backup sidecar | yes | no |
| Resources | whole box | capped: web 1 CPU / 1.5 GB, db 0.5 / 768 MB, vite 1 / 1 GB, redis, nginx small |

## Tear down

`sandbox.sh down` stops it; `sandbox.sh destroy` also deletes its volumes
(database, media). Removing `/home/ubuntu/gst-billing-sandbox` removes the rest.
