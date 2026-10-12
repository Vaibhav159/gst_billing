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
| 5180 | v3's Vite in Docker (`sandbox.sh dev`, service `vite-v3`), hot reload |
| 8000, 80, 5432 | **Bahikhata production** — never point anything at these |

## Running it

```bash
deploy/sandbox/sandbox.sh up      # db, redis, web, nginx (rebuilds if needed)
deploy/sandbox/sandbox.sh dev     # + the app's Vite on 5180
deploy/sandbox/sandbox.sh seed    # first time only; reseed wipes and reloads
deploy/sandbox/sandbox.sh logs web
deploy/sandbox/sandbox.sh manage migrate
```

- **Python edits** reload gunicorn by themselves: the backend source is mounted
  into the web container.
- **Frontend edits** hot-reload in Vite (5180). To see the built app
  exactly as nginx serves it: `sandbox.sh build nginx && sandbox.sh up`.
- **Dependency changes** (`pyproject.toml`/`uv.lock`) need `sandbox.sh build web`.
  Image builds run in a BuildKit container capped at 1 CPU / 3 GB.
- **New migrations**: write them with `.venv/bin/python manage.py makemigrations`
  (SQLite, nothing real), then `sandbox.sh manage migrate`.

## Checks (the repo's definition of done)

```bash
.venv/bin/python -m pytest billing/ -x --tb=short
cd web && npm run typecheck && npm test -- --run
```

## Opening it from the laptop

```bash
ssh -N -L 8060:127.0.0.1:8060 -L 5180:127.0.0.1:5180 nf-trial
```

Then http://localhost:8060 or http://localhost:5180. Logins are in
`../env/logins.txt`: one each for owner (superuser), admin, editor, viewer,
a user with no group, and v3's accountant and counter staff (`sandbox_staff`
opens on KIRAN, its default firm).

## v3 (branch `v3`)

- `./sandbox.sh dev` starts the app (`web/`) on 127.0.0.1:5180, forwarded by
  the tunnel above. Its `/api` goes through the sandbox nginx to Django.
- Run `sandbox.sh` from the `gst_billing_v3` worktree, so the server runs
  v3's code: the images build from, and the web container mounts `billing/`
  and `gst_billing/` from, the checkout whose `sandbox.sh` you run.

## A second sandbox (`gst-sandbox-2`)

A second, independent copy for a second e2e lane or another branch: its own
compose project, database, Redis, volumes (`gst-sandbox-2_*`, including the
Vite `node_modules`), image tags (`gst-sandbox-2-web:dev`, `-nginx:dev`) and
seed. Run it from its own worktree (on this VM `v3wt/sbx2`, branch `v3-sbx2`),
since the images build from, and the containers mount, the checkout whose
`sandbox.sh` you run.

| | `gst-sandbox` | `gst-sandbox-2` |
|---|---|---|
| nginx | 8060 | 8160 |
| v3 Vite | 5180 | 5280 |
| logins | `env/logins.txt` | `env/logins-2.txt` |
| e2e lock | `locks/e2e-gst-sandbox.lock` | `locks/e2e-gst-sandbox-2.lock` |

```bash
export GST_SANDBOX_PROJECT=gst-sandbox-2
export GST_SANDBOX_ENV_DIR=/home/ubuntu/projects/gst-billing-sandbox/env  # the worktree's parent isn't the workspace
deploy/sandbox/sandbox.sh up && deploy/sandbox/sandbox.sh dev && deploy/sandbox/sandbox.sh seed
```

- With no variables set, `sandbox.sh` and `compose.yaml` drive `gst-sandbox`
  exactly as before. `GST_SANDBOX_PROJECT` takes only `gst-sandbox` or
  `gst-sandbox-N` (N 2–9); `gst-sandbox-N` gets 8060/5180 + 100×(N−1) and
  `logins-N.txt`. `GST_SANDBOX_NGINX_PORT`,
  `GST_SANDBOX_VITE3_PORT` and `GST_SANDBOX_LOGINS` override them; 80, 8000
  and 5432 are refused.
- Both share `sandbox.env` (DB password, Django key) and the capped builder.
- e2e against it: `BASE_URL_V3=http://127.0.0.1:5280`,
  `LOGINS_FILE=<env>/logins-2.txt`, under
  `flock <workspace>/locks/e2e-gst-sandbox-2.lock`. Running both lanes from
  one checkout? Give each its own `E2E_AUTH_FILE` and `--output` directory.

## Differences from production, on purpose

| | Production | Sandbox |
|---|---|---|
| Database | Neon (external) | `postgres:17-alpine` container, synthetic data |
| Settings | `production_settings` | `sandbox_settings` = production + DB guard, localhost origins |
| gunicorn | 4 workers × 4 threads | 2 × 4, `--reload`, backend source mounted read-only |
| Edge | Cosmos TLS → nginx | SSH tunnel → nginx |
| Watchtower, backup sidecar | yes | no |
| Resources | whole box | capped: web 1 CPU / 1.5 GB, db 0.5 / 768 MB, Vite 1 CPU / 1 GB, redis, nginx small |

## Tear down

`sandbox.sh down` stops it; `sandbox.sh destroy` also deletes its volumes
(database, media). Removing `/home/ubuntu/gst-billing-sandbox` removes the rest.
