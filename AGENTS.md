# GST Billing — agent guide

Invoicing and GST-return software for Indian jewellery businesses. Two surfaces
over one money domain: a **Django + DRF API** (`billing/`, `gst_billing/`) and a
**Vite + React SPA** (`web/`, v3). They are separate builds and
separate production images.

Each directory below has its own AGENTS.md with the detail. **Read the nearest one
to the file you are editing** — this file only carries what is true on both sides.

## Run it

| What | Where | Command |
|---|---|---|
| Backend | repo root | `source .venv/bin/activate && python manage.py runserver` |
| Frontend | `web/` | `npm run dev` (5180) |
| Backend tests | repo root | `.venv/bin/python -m pytest billing/` |
| Frontend tests | `web/` | `npm test -- --run` |

The frontend **must** run through the Vite dev server: `/api` and `/media` are
proxied to Django there (`web/vite.config.ts`, `VITE_API_TARGET`). Serving a
static build of `dist/` will send API calls to the frontend host and every
request will 404.

Ports: CI runs Django on `8000` and the app's Vite on `8081` (`VITE_DEV_PORT`, `VITE_API_TARGET`). The sandbox (`deploy/sandbox/`) serves Vite on `5180` and nginx on `8060`; `.claude/launch.json` names both.

## Contracts that span both sides

Change one without the other and the bug is silent: totals still look right on
screen while the stored row or the filed return is wrong.

- **Tax placement** — `billing/tax_rules.py` decides; `web/src/core/sales/pos.ts` (with the state table in `web/src/core/ids.ts`) mirrors it for the form's preview. Change both, or the preview disagrees with what gets written.
- **API shapes** — `billing/api/` produces what each area's `web/src/core/*/wire.ts` and `types.ts` read. v2's serializers are mostly `fields = "__all__"`, so a model field rename silently changes the wire format.
- **Routes** — `billing/api/urls.py` defines every path the axios instance in `web/src/core/api/client.ts` calls under `/api/`.
- **Auth** — JWT from `/api/token/`, refresh at `/api/token/refresh/` with
  **rotation on** server-side, so the client must store each new refresh token.


## Conventions everywhere

- **Money is `Decimal` on the server.** Never `float` for tax or totals.
- **Rates are stored as decimals** (`0.03` = 3%). Convert only through
  `billing/tax_rules.py` `normalize_rate()` / `rate_as_percent()` — an explicit GST slab
  allowlist, mirrored as slabs in `web/src/core/sales/slabs.ts`. Never a magnitude test like
  `value > 1 ? value / 100 : value`: that stored the 0.25% diamond slab as 25%.
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
cd web && npm run typecheck && npm test -- --run
```

Both must pass — `.github/workflows/test.yml` runs them as `backend` and `web` (typecheck, unit tests and build), plus `web-e2e` (the Playwright and WCAG 2.2 AA suite in `e2e-tests/`, `-c v3.config.js`); the commands are in [`web/AGENTS.md`](web/AGENTS.md). `vite build` does **not** typecheck, so the `tsc` step is the only thing checking types.

## Where things live

- `billing/` — Django app: models, DRF API, services, tests → [`billing/AGENTS.md`](billing/AGENTS.md)
- `gst_billing/` — Django project settings, URLs, WSGI
- `web/` — the React app (v3) → [`web/AGENTS.md`](web/AGENTS.md)
- `e2e-tests/` — Playwright suite, its own package → [`e2e-tests/AGENTS.md`](e2e-tests/AGENTS.md)
- `deploy/`, `nginx/`, `docker-compose.yml` — serving and release → [`deploy/AGENTS.md`](deploy/AGENTS.md)

## Finding things fast

- An API route: `rg -n "path\(|router.register" billing/api/urls.py`
- A React page: `ls web/src/pages/`
- Every copy of a money rule: `rg -n "cgst|igst" billing/ web/src/`
- Where a serializer field is consumed: `rg -n "<field_name>" web/src/`

## Ponytail, lazy senior dev mode (Repo Edition)

You are a lazy senior developer on **GST Billing**. Lazy means efficient, not careless. The best code is the code never written.

Before writing any code, stop at the first rung that holds:

1. **YAGNI** — Does this need to be built at all?
2. **Reuse existing helpers** — Don't re-invent what's already here:
   - *Tax logic*: `billing/tax_rules.py`, or `@/core/sales/pos` in the browser. Never hand-roll tax placement or GSTIN prefix guessing.
   - *UI*: use the kit, `@/core/ui`: see [`web/AGENTS.md`](web/AGENTS.md).
   - *API calls*: Use `@/core/api/client` with TanStack Query; don't call raw `axios`.
   - *Data fetching*: TanStack Query is the only data layer, through `web/src/core/api/`.
   - *Audit/Undo*: Use `AuditLogMixin` with `audit_entity`.
3. **Standard library / Native** — Python `decimal.Decimal`, modern JS/TS built-ins.
4. **Installed dependencies** — Django/DRF built-ins, `django-cacheops`, SimpleJWT, TanStack Query, `lucide-react`.
5. **One-liner** — Can this be one clean line? Make it one line.
6. **Only then**: write the minimum code that works.

The ladder runs after you understand the problem, not instead of it: trace the flow across the Django + React boundary before touching code.

### Root cause & twin paths (No half-fixes)
- **Fix the shared helper, not just the ticket's caller**: Grep callers across both backend and frontend.
- **Check secondary paths**: Invoicing logic is mirrored across **inward bills, bulk/CSV import, AI import, Excel export, and print views**. A fix to the main invoice path without checking twins is an incomplete fix.
- **Keep mirrors in sync**: `billing/tax_rules.py` ↔ `web/src/core/sales/pos.ts`, and `billing/api/` ↔ `web/src/core/*/wire.ts`.

### Rules
- **No unrequested abstractions or dependencies**: No new npm/pip packages unless unavoidable.
- **Deletion over addition**: Fewer lines, fewer files, minimal diff.
- **Shortest working diff wins**: But only after root cause is identified. A lazy diff in the wrong place is a second bug.
- **Mark intentional simplifications**: Use `ponytail: <known limit & upgrade path>` comments when taking an explicit shortcut.

### Not lazy about (Zero tolerance)
- **Money calculations**: Always `Decimal` on backend; never `float` for tax or totals.
- **Tax rates**: Always decimals (`0.03` = 3%). Convert through `tax_rules.normalize_rate` / `rate_as_percent` only; never a magnitude test (`> 1`), which broke the 0.25% and 1% slabs.
- **Dates & Timezones**: Always IST. Never construct FY/month boundaries with `toISOString()` (drops March 31).
- **Security & Permissions**: Explicit permission classes on every new endpoint (default is viewer). Never touch prod DB.
- **Verification check**: Every non-trivial change must verify against:
  - Backend: `.venv/bin/python -m pytest billing/ -x --tb=short`
  - Frontend: `cd web && npm run typecheck && npm test -- --run` (`vite build` does not typecheck!)
