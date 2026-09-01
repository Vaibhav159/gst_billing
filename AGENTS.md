# GST Billing — agent guide

Invoicing and GST-return software for Indian jewellery businesses. Two surfaces
over one money domain: a **Django + DRF API** (`billing/`, `gst_billing/`) and a
**Vite + React SPA** (`sweet-rebuild-suite-main/`). They are separate builds and
separate production images.

Each directory below has its own AGENTS.md with the detail. **Read the nearest one
to the file you are editing** — this file only carries what is true on both sides.

## Run it

| What | Where | Command |
|---|---|---|
| Backend | repo root | `source .venv/bin/activate && python manage.py runserver` |
| Frontend | `sweet-rebuild-suite-main/` | `npm run dev` |
| Backend tests | repo root | `.venv/bin/python -m pytest billing/` |
| Frontend tests | `sweet-rebuild-suite-main/` | `npm run test` |

The frontend **must** run through the Vite dev server: `/api` and `/media` are
proxied to Django there (`sweet-rebuild-suite-main/vite.config.ts`). Serving a
static build of `dist/` will send API calls to the frontend host and every
request will 404.

Ports: CI uses Django `8000` / Vite `8080` (the defaults). Locally this repo's
`.claude/launch.json` runs Vite on `5001` against Django on `5002` via
`VITE_DEV_PORT` / `VITE_API_TARGET`. Either is fine — just keep them paired.

## Contracts that span both sides

Change one without the other and the bug is silent: totals still look right on
screen while the stored row or the filed return is wrong.

- **Tax placement** — `billing/tax_rules.py` and
  `sweet-rebuild-suite-main/src/utils/taxRules.ts` are deliberate mirrors
  (interstate → IGST, intra → CGST+SGST, same GSTIN-then-state-name fallback).
  Change both, or the preview disagrees with what gets written.
- **API shapes** — `billing/api/serializers.py` produces what
  `sweet-rebuild-suite-main/src/types/api.ts` declares. Most serializers are
  `fields = "__all__"`, so a model field rename silently changes the wire format.
- **Routes** — `billing/api/urls.py` defines every path the axios client in
  `sweet-rebuild-suite-main/src/utils/api.ts` calls against `baseURL: "/api/"`.
- **Auth** — JWT from `/api/token/`, refresh at `/api/token/refresh/` with
  **rotation on** server-side, so the client must store each new refresh token.

## Conventions everywhere

- **Money is `Decimal` on the server.** Never `float` for tax or totals.
- **Rates are stored as decimals** (`0.03` = 3%). Do not add another
  "is this a percent or a fraction?" heuristic — see the frontend gotchas.
- **Dates are IST.** Do not build financial-year or month boundaries with
  `toISOString()` on a local `Date`; it shifts a day and drops 31 March.
- A fix to a primary write path usually needs the same fix in the **import, AI,
  export, and print** copies. Those secondary paths are where this repo's
  repeat bugs live — grep for other implementations before you call it done.
- Batch related work into one PR rather than one PR per task.

## Security

- Never commit secrets. `.env` is local-only; `.env.template` is the checked-in shape.
- `gst_billing/local.py` holds **both** dev and prod database DSNs. Prod is
  reachable only with `GST_DB=prod GST_ALLOW_PROD=1`. Never point `migrate`,
  `shell`, or a test run at it.
- Permissions are role-based (`billing/api/permissions.py`): admin / editor /
  viewer, and an ungrouped user is a **viewer**. Any new endpoint needs an
  explicit permission class — write access must not default open.

## Definition of done

```bash
.venv/bin/python -m pytest billing/ -x --tb=short
cd sweet-rebuild-suite-main && npx tsc --noEmit -p tsconfig.app.json && npm run test -- --run
```

Both must pass — this is what `.github/workflows/test.yml` runs. `vite build`
does **not** typecheck, so the `tsc` step is the only thing checking types.

## Where things live

- `billing/` — Django app: models, DRF API, services, tests → [`billing/AGENTS.md`](billing/AGENTS.md)
- `gst_billing/` — Django project settings, URLs, WSGI
- `sweet-rebuild-suite-main/` — React SPA → [`sweet-rebuild-suite-main/AGENTS.md`](sweet-rebuild-suite-main/AGENTS.md)
- `e2e-tests/` — Playwright suite, its own package → [`e2e-tests/AGENTS.md`](e2e-tests/AGENTS.md)
- `deploy/`, `nginx/`, `docker-compose.yml` — serving and release → [`deploy/AGENTS.md`](deploy/AGENTS.md)

## Finding things fast

- An API route: `rg -n "path\(|router.register" billing/api/urls.py`
- A React page: `ls sweet-rebuild-suite-main/src/pages/`
- Every copy of a money rule: `rg -n "cgst|igst" billing/ sweet-rebuild-suite-main/src/`
- Where a serializer field is consumed: `rg -n "<field_name>" sweet-rebuild-suite-main/src/`
