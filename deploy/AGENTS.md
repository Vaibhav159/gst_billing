# Deploy & serving — agent guide

**Two images.** The one that serves the UI is not the one that runs Django —
this is the single most commonly mistaken thing here.
Root conventions: [`../AGENTS.md`](../AGENTS.md).

## Images

- `vaibhav198/gst-billing-nginx` — built from `../nginx/Dockerfile`. Stage 1 runs
  `npm ci && npm run build` **inside `sweet-rebuild-suite-main/`**; stage 2 serves
  that `dist/` and reverse-proxies `/api/`, `/admin/`, `/explorer/` to `web:8000`.
  **A frontend change ships only when this image is rebuilt.**
- `vaibhav198/gst-billing` — Django/gunicorn, API only. Its SPA route is a
  plain-text fallback (`gst_billing/urls.py`), not the app.

## Config

- `../nginx/conf.d/app.conf` — routing, security headers, upload limits.
  nginx's `add_header` does **not** inherit: a `location` that sets any header
  of its own loses the block-level ones, so repeat them.
- `../docker-compose.yml` — `web`, `redis`, `nginx`. Watchtower auto-deploys.
- `../.env.template` — the checked-in shape of production env vars.

## Release

`../.github/workflows/test.yml` gates on backend pytest, frontend `tsc` + vitest,
Playwright E2E, and `nginx -t` against the shipped `conf.d`. Publishing lives in
`../.github/workflows/docker-publish.yml` and `../.circleci/config.yml`.

## Rules

- Changing the frontend **or** the nginx conf means rebuilding the nginx image.
  Pushing only the Django image ships backend-only skew.
- Validate any conf edit the way CI does before pushing — a broken conf bricks
  the container on the next auto-deploy:
  `docker run --rm -v "$PWD/nginx/conf.d":/etc/nginx/conf.d:ro nginx:alpine sh -c "mkdir -p /var/www/static /var/www/media /usr/share/nginx/html && nginx -t"`
- Upload-size limits differ between the Vite dev server and nginx. A file that
  uploads locally can still 413 in production — check `client_max_body_size`
  before shipping anything that posts an image or spreadsheet.
