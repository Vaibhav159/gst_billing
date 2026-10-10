# E2E (Playwright) — agent guide

A separate npm package from the frontend, with its own `package.json` and
lockfile. It drives a **running** stack — it starts nothing itself.
Root conventions: [`../AGENTS.md`](../AGENTS.md).

## Prerequisites

Django and the Vite dev server must both be up, and `BASE_URL` must point at
**Vite** (not Django) so `/api` is proxied. CI uses `http://localhost:8080`.
The suite expects seeded data — a user, a business, a customer, a product; see
the "Migrate + seed" step in `../.github/workflows/test.yml` for the exact fixture.

## Commands

```bash
npm ci
npx playwright install chromium          # no --with-deps; the runner already has the libs
BASE_URL=http://localhost:8080 npx playwright test --reporter=list
npx playwright test tests/money-paths.spec.js   # one spec
npx playwright test --headed --debug            # watch it run
```

## Structure

Config in `playwright.config.js`. Two projects: `setup` runs
`tests/_auth.setup.js` and writes `auth-state.json`; `main` runs `*.spec.js`
with that storage state, so specs start logged in. Shared helpers in
`tests/utils.js`. `workers: 1`, `retries: 0` — a flaky spec is a failing spec.

## Writing specs

- Prefer role/label selectors over CSS class chains; the UI uses Tailwind
  utility classes that change freely.
- Don't assume ids or invoice numbers — read them from the page or create the
  record in the spec.
- Money assertions belong in `money-paths.spec.js`; keep totals and tax-head
  checks there rather than scattering them.

## v3 (`web/`)

Its own config, `v3.config.js`, and specs in `tests-v3/`, run against v3's Vite
(`web/`, with `/api` proxied to the server by `VITE_API_TARGET`). `setup` signs in
through the real sign-in page and writes `.auth-v3.json` (git-ignored); `desktop`
(1440×900) and `phone` (390×844, touch) start signed in. Also `workers: 1`,
`retries: 0`: one user for every spec, and the phone spec saves Easy or Expert on
the server. CI runs it as the `web-e2e` job.

- `BASE_URL_V3`: v3's Vite (default `http://127.0.0.1:5180`, the sandbox's).
- `E2E_USER` + `E2E_PASS`: who signs in (CI: `testuser`). Without them,
  `LOGINS_FILE` (role, username, password, tab-separated) and `E2E_ROLE` (default
  `owner`); the setup never prints the password.
- `E2E_SEARCH`: a word Ctrl K finds in the seeded data (CI `TEST`, sandbox `Sharma`).
- `CHROMIUM_PATH`: a browser to launch instead of Playwright's own download.

On the sandbox VM:

```bash
BASE_URL_V3=http://127.0.0.1:5180 LOGINS_FILE=/home/ubuntu/gst-billing-sandbox/env/logins.txt E2E_ROLE=owner E2E_SEARCH=Sharma \
CHROMIUM_PATH=~/.cache/ms-playwright/chromium_headless_shell-1228/chrome-linux/headless_shell npx playwright test -c v3.config.js
```

Pitfalls:

- `browser.newContext()` takes the project's `storageState` too: pass
  `{ storageState: { cookies: [], origins: [] } }` for a signed-out page.
- A failed setup's `test-results/` (its trace and `error-context.md`) holds the
  password it typed: don't print or share them.
- A click inside the page within 300 ms of it opening is dropped (the page
  frame's double-click guard): after `page.goto`, wait for the page before
  clicking in it.
