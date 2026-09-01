# Frontend (Vite + React + TS) — agent guide

React 18 + TypeScript SPA built with Vite (SWC), styled with Tailwind + shadcn/ui,
data over axios, packaged for iOS with Capacitor. Talks only to the Django API
at `/api/`, authenticated with JWT in `localStorage`.
Root conventions: [`../AGENTS.md`](../AGENTS.md).

## Setup & commands

```bash
npm ci                                   # lockfile is package-lock.json
npm run dev                              # Vite, proxies /api + /media to Django
npx tsc --noEmit -p tsconfig.app.json    # the ONLY typecheck — build does not typecheck
npm run test                             # vitest
npm run test -- src/utils/taxRules.test.ts
npm run lint                             # eslint
npm run build                            # production bundle into dist/
```

`npm run dev` is required for API calls to work — the proxy lives in
`vite.config.ts`, not in a served build. Override ports with `VITE_DEV_PORT`
and `VITE_API_TARGET` (real env vars beat `.env.local`).

## Layout

- `src/pages/` — one file per route, mounted in `src/App.tsx`.
- `src/components/` — shared app components; `ui/` is shadcn/ui primitives
  (49 of them — check here before hand-rolling), `mobile/` is the mobile shell.
- `src/hooks/` — data and behaviour hooks (`useDataStore`, `usePreferences`, …).
- `src/contexts/` — `AuthContext`, `ThemeContext`, `MobileModeContext`.
- `src/utils/` — `api.ts` (axios instance), `taxRules.ts`, PDF/Excel generators.
- `src/types/api.ts` — TS mirrors of the DRF serializers.
- `src/test/setup.ts` — vitest setup; config in `vitest.config.ts`.

## Patterns

- **Imports** — use the `@/` alias (`@/utils/api`), aliased to `src/` in both
  `vite.config.ts` and `vitest.config.ts`. It is used in 122 files; match it.
- **API calls** — always the shared instance: `import api from "@/utils/api"`.
  It attaches the JWT, drops `Content-Type` for `FormData`, and refreshes on 401.
  DON'T call `axios` directly or hardcode a base URL — you lose all of that.
- **Errors** — surface the real backend message with `formatApiError()` from
  `@/utils/apiError`, not a generic "Something went wrong".
- **UI** — compose shadcn primitives from `@/components/ui/`; `cn()` from
  `@/utils/utils` for class merging. Toasts via `sonner`.
- **Data fetching is hand-rolled in hooks**, not TanStack Query. `QueryClientProvider`
  is mounted in `src/App.tsx` but there is **not one `useQuery`/`useMutation` in
  `src/`** — every hook calls `api` directly (`src/hooks/useDataStore.ts:34`).
  Follow that pattern; introducing a second data layer for one feature makes it
  worse, not better. `src/hooks/usePreferences.ts` shows the server-authoritative
  + localStorage-mirror variant.
- **Types** — anything crossing the wire gets a type from `@/types/api`.

## Talking to the backend

`src/utils/api.ts` uses `baseURL: "/api/"`, so every path is relative
(`api.get("invoices/")`). Auth: `POST token/` on login, refresh at
`token/refresh/`. **Refresh rotation is on server-side** — store the new refresh
token from each response or the second refresh of a session logs the user out.

When a serializer changes in `../billing/api/serializers.py`, update
`src/types/api.ts` in the same change. Most serializers are `fields = "__all__"`,
so nothing will fail loudly if you don't.

## Gotchas

- **`vite build` does not typecheck.** A number-vs-string id comparison that
  `tsc` flags plainly is what booked interstate invoices as CGST+SGST for months.
  Run the `tsc --noEmit` line above before you push.
- **Do not add "percent or fraction?" rate heuristics.** Rates arrive as decimals (`0.03` = 3%). The only conversion is `src/utils/gstRate.ts` — `rateToPercent` for display, `lineItemToStoredRate` / `percentToRate` for the wire — which resolves by an explicit GST slab allowlist and by *which field* a value came in on, never by magnitude. The old `rawRate > 1 ? rawRate / 100 : rawRate` stored the 0.25% diamond slab as 25% and 1% as 100%.
- **Render stored tax heads, not predicted ones.** `src/pages/InvoiceDetail.tsx:41`
  shows the pattern: display the cgst/sgst/igst that were saved, not what
  `is_igst_applicable` implies. Print and export paths are the ones that still
  get this wrong.
- **IST dates.** Building FY/month ranges with `toISOString()` on a local `Date`
  shifts a day and drops 31 March.
- PostCSS config is pinned in `vite.config.ts` because an orphaned
  `postcss.config.js` at the repo root would otherwise win.

## Before you push

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run test -- --run && npm run lint
```
