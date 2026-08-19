# GST Billing — web app (V2)

The React/Vite single-page app for the GST billing system. In production it
is built into the nginx image and served at the site root; the Django backend
only serves `/api/`, the admin, and SQL explorer.

See the [repository README](../README.md) for full project setup.

## Develop

```sh
npm install
npm run dev        # Vite dev server; proxies /api to Django on :8000
```

Port and API target are overridable per developer (real environment beats
`.env.local`):

```sh
VITE_DEV_PORT=8180 VITE_API_TARGET=http://127.0.0.1:8000 npm run dev
```

## Test & check

```sh
npm test                                 # vitest unit tests
npx tsc --noEmit -p tsconfig.app.json    # typecheck (also gates CI)
npm run build                            # production build
```

End-to-end Playwright tests live in [`../e2e-tests`](../e2e-tests).

## Stack

Vite · React 18 · TypeScript · Tailwind + shadcn/ui (Radix) · TanStack Query
· Recharts · @react-pdf/renderer (Tally-format invoice PDFs).
