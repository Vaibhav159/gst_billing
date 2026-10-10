# Web v3 (Vite + React + TS) — agent guide

v3, the rebuild of every screen, built on branch `v3` in parts 0–7 beside v2
(`../sweet-rebuild-suite-main/`, untouched until the switch-over). It talks to
the same Django API at `/api/`. The visual spec is the agreed prototype, whose
source is `/home/ubuntu/gst-billing-sandbox/ui-prototype/src/` (PROTO below).
Root conventions: [`../AGENTS.md`](../AGENTS.md).

## Commands

```bash
npm ci
npm run dev                             # Vite on 5180 (VITE_DEV_PORT); /api goes to VITE_API_TARGET (default 127.0.0.1:8060)
npx vitest run                          # every unit test (jsdom); one file: npx vitest run src/core/format.test.ts
npx tsc -p tsconfig.app.json --noEmit   # the typecheck (npm run typecheck); vite build alone doesn't check types
npm run build                           # the typecheck, then vite build into dist/
```

The end-to-end suite (Playwright, with WCAG 2.2 AA checks by axe) lives in
`../e2e-tests/` and drives a running Vite; see its AGENTS.md, section v3. On the
sandbox VM, from `../e2e-tests/`:

```bash
BASE_URL_V3=http://127.0.0.1:5180 LOGINS_FILE=/home/ubuntu/gst-billing-sandbox/env/logins.txt E2E_ROLE=owner \
E2E_SEARCH=Sharma E2E_SEARCH_HIT="Priya Sharma" \
CHROMIUM_PATH=~/.cache/ms-playwright/chromium_headless_shell-1228/chrome-linux/headless_shell npx playwright test -c v3.config.js
```

CI runs the `web` job (typecheck, unit tests, build on Node 20) and `web-e2e`
(that suite against gunicorn and Postgres). On the sandbox VM the sandbox's own
Vite holds 5180, so run yours on another port; never use 8000, 80 or 5432, and
stop only processes you started, by PID.

## Where things are

- `src/core/ui/` — the kit, imported from `@/core/ui`.
- `src/core/api/` — `client.ts` (the axios instance), `query.ts` (TanStack
  Query's defaults), `errors.ts` (`problemOf`, `saveFailure`), `network.ts`.
- `src/core/auth/` — `AuthProvider` (`useAuth`), `RequireAuth`, `permissions.ts`.
- `src/core/router/` — `routes.tsx`, `PageFrame.tsx`, `useUnsavedGuard.tsx`.
- `src/core/shell/` — the desktop and phone shells, search, `nav.ts`.
- `src/core/format.ts`, `device.ts`, `prefs.ts`, `scope.tsx`, `view.ts`.
- `src/pages/<area>/` — the screens. `src/test/` — test setup and helpers.

## The kit and the prototype

- A screen is a port of its PROTO page, built from `@/core/ui`: `Page`,
  `Button`, `Field` and the inputs, `Dialog`, `Sheet`, `ConfirmDialog`, `Menu`,
  `Card`, `List`, `Table`, `Money`, `QueryView`, toasts. Look in the kit before
  writing a component: a missing one comes from the prototype's own kit
  (`PROTO/core/ui.jsx`), ported the same way.
- Port rules: copy the JSX, class names, tokens, spacing and words verbatim, and
  add types. The prototype's `Link` and `navigate` become React Router's. Drop
  anything that reads `window.__PROTO__` or sends `proto:` events. Keep every
  `aria-*` and `role`. Colours come only from the theme tokens: keep today's
  gold-on-black look, refine it, never redesign it.
- `useView()` says desktop, expert or easy. A phone is narrower than 768 px, or
  a touch screen under 500 px tall.

## Data

- All server data goes through the axios instance in `@/core/api/client` and
  TanStack Query. No raw axios, no `fetch`, no second data layer. The instance
  adds the JWT, refreshes it once however many requests and tabs are waiting,
  and gives up on a request after 100 s.
- `problemOf(error)` turns any failure into a kind and words; `saveFailure()`
  words a save that didn't happen; `QueryView` draws loading, failure and
  offline for a query.
- Saves don't retry and don't queue: offline, a save fails at once and says so.
- Lists follow the firm and year in `useScope()`; wait for `firmId !== null`.

## Nothing touches the database on a timer

The database is on Neon's free plan, with a monthly compute budget. No
`refetchInterval`, no polling, no health check that reaches the database;
`refetchOnWindowFocus` stays off. The app learns about the network from real
requests only (`useNetwork()`).

## Money and dates

- Money is integer paise in the client: `toPaise("87083.21")` is 8708321,
  `paiseToDecimal()` goes back for the API, `inr()` and `Money` show it.
- Dates are IST calendar dates as ISO strings ("2026-10-09"): `todayIST()`,
  `date()`, `monthOf()`, `fyOf()`. Never build a day, month or year boundary
  with `toISOString()` on a local `Date`: it shifts a day and drops 31 March.
  Vitest runs in Asia/Kolkata.

## Words on screen

Plain words, active voice, no "please", no exclamation marks. An error says what
happened and what to do: "You're offline, so this wasn't saved. What you typed is
still here. Save again when the internet is back." Take the prototype's words;
new words follow its voice.

## Roles

Owner, accountant, counter staff and viewer. `useAuth().can(action)` decides
what a person sees and may do; `whyNot(action)` says why not, in words. The
matrix in `src/core/auth/perms.json` mirrors the server's `billing/roles.py`:
change both. The server doesn't enforce the v3 matrix yet, so each part adds v3
permission classes to the endpoints it touches.

## The ghost-click guard

The page frame drops a click that lands within 300 ms of its page opening, and
a dialog drops one within 350 ms of opening, so the second click of a double
click can't act on what just opened. Keep both. Tests fake `Date` and the timers
to step past them; in the e2e suite, `opened(page)` waits.

## Tests

- `renderApp(ui, { path, me })` (`src/test/render.tsx`) renders inside the
  app's providers with a MemoryRouter, signed in as the owner (`me: null` is
  signed out; `stubAuth()` for a tree of your own).
- A page that uses `useUnsavedGuard` needs a data router: render it with
  `createMemoryRouter` and `RouterProvider`, not `renderApp`.
- Answer requests with `api.defaults.adapter`; never reach the network. A phone
  is `window.__phone = true` before rendering (`src/test/setup.ts`).
- Fake the clock rather than wait on real time: a busy CI runner is slow.
