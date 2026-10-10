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
through the real sign-in page, puts Easy back if a stopped run left Expert saved,
and writes `.auth-v3.json` (git-ignored); `desktop` (1440×900) and `phone`
(390×844, touch) start signed in. `tests-v3/session.js` has the session's path,
the sign-in and the API calls the specs make beside the app's. Also `workers: 1`,
`retries: 0`: one user for every spec, and the phone spec saves Easy or Expert on
the server. CI runs it as the `web-e2e` job.

- `BASE_URL_V3`: v3's Vite (default `http://127.0.0.1:5180`, the sandbox's).
- `E2E_USER` + `E2E_PASS`: who signs in (CI: `testuser`). Without them,
  `LOGINS_FILE` (role, username, password, tab-separated) and `E2E_ROLE` (default
  `owner`); the specs never print the password.
- `E2E_SEARCH` + `E2E_SEARCH_HIT`: a word to type in Ctrl K, and a row only the
  server's search returns for it (CI `TEST` and `TEST CUSTOMER`, the sandbox
  `Sharma` and `Priya Sharma`). The app lists its own pages, actions and firms,
  so one of those proves nothing about the server.
- `CHROMIUM_PATH`: a browser to launch instead of Playwright's own download.

On the sandbox VM:

```bash
BASE_URL_V3=http://127.0.0.1:5180 LOGINS_FILE=/home/ubuntu/gst-billing-sandbox/env/logins.txt E2E_ROLE=owner \
E2E_SEARCH=Sharma E2E_SEARCH_HIT="Priya Sharma" \
CHROMIUM_PATH=~/.cache/ms-playwright/chromium_headless_shell-1228/chrome-linux/headless_shell npx playwright test -c v3.config.js
```

Pitfalls:

- A spec file whose tests type a password calls `typesPassword(test)` from
  `session.js` at its top level: no trace, and a test that fails goes to
  `about:blank` first, so the page snapshot Playwright writes to
  `error-context.md` can't show the password field. `trace` is a worker option,
  which a `describe` can't set, so such a test gets a file of its own.
- Signed out: `test.use({ storageState: SIGNED_OUT })` in a `describe`.
  `browser.newContext()` would take the project's signed-in session too.
- The first click inside a page must come at least 300 ms after the page
  opened, or the page frame drops it as a double click's second click.
  Playwright's auto-wait doesn't cover this. A page that slides in happens to
  take about that long to settle, but one opened with `page.goto` can be
  clicked at once: wait 300 ms there before the first click inside it.
