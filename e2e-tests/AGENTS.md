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
