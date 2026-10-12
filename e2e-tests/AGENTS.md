# E2E (Playwright) — agent guide

A separate npm package from the app, with its own `package.json` and
lockfile. It drives a **running** stack — it starts nothing itself.
Root conventions: [`../AGENTS.md`](../AGENTS.md).

## Writing specs

- Prefer role/label selectors over CSS class chains; the UI uses Tailwind
  utility classes that change freely.
- Don't assume ids or invoice numbers — read them from the page or create the
  record in the spec (`tests-v3/sales-data.js`).

## The suite

Its config, `v3.config.js`, and specs in `tests-v3/`, run against v3's Vite
(`web/`, with `/api` proxied to the server by `VITE_API_TARGET`). `setup` signs in
through the real sign-in page, puts Easy back if a stopped run left Expert saved,
and writes `.auth-v3.json` (git-ignored) without the app's kept copy of the
preferences; `desktop` (1440×900) and `phone` (390×844, touch) start signed in.
`tests-v3/session.js` has the session's path, the sign-in, `opened(page)` and the
API calls the specs make beside the app's. `tests-v3/sales-data.js` makes and
removes the bills a spec needs through the API, as the signed-in user:
`client(request)`, `newBill(api, { firm?, customer?, rate?, lines?, paper? })`,
`noteBill(id, number)` (a bill saved another way), `removeBill(api, id)`,
`makesBills(test)`. `tests-v3/bill-form-data.js` has what the bill form's specs
share, and `tests-v3/axe.js` the WCAG 2.2 AA pass, `measure(page)`. Also `workers: 1`,
`retries: 0`: one user for every spec, and the phone spec saves Easy or Expert on
the server. CI runs it as the `web-e2e` job.

- `BASE_URL_V3`: v3's Vite (default `http://127.0.0.1:5180`, the sandbox's).
- `E2E_USER` + `E2E_PASS`: who signs in (CI: `testuser`). Without them,
  `LOGINS_FILE` (role, username, password, tab-separated) and `E2E_ROLE` (default
  `owner`); the specs never print the password.
- `E2E_OTHER_ROLE`: who finishes the bill form's unfinished bill on a second
  device, a LOGINS_FILE role (default `staff`). Without LOGINS_FILE (CI) it's the
  suite's own user.
- `E2E_SEARCH` + `E2E_SEARCH_HIT`: a word to type in Ctrl K, and a row only the
  server's search returns for it (CI `TEST` and `TEST CUSTOMER`, the sandbox
  `Sharma` and `Priya Sharma`). The app lists its own pages, actions and firms,
  so one of those proves nothing about the server.
- `CHROMIUM_PATH`: a browser to launch instead of Playwright's own download.
- `E2E_PDF_DIR`: where `print.spec.js` keeps the PDFs it downloads and prints,
  for a person to look at (default: each test's own output folder).

On the sandbox VM:

```bash
BASE_URL_V3=http://127.0.0.1:5180 LOGINS_FILE=/home/ubuntu/gst-billing-sandbox/env/logins.txt E2E_ROLE=owner \
E2E_SEARCH=Sharma E2E_SEARCH_HIT="Priya Sharma" \
CHROMIUM_PATH=~/.cache/ms-playwright/chromium_headless_shell-1228/chrome-linux/headless_shell npx playwright test -c v3.config.js
```

Pitfalls:

- A menu choice acts a tick after the click: wait for its result with a web-first assertion before the next step.
- A spec file whose tests type a password calls `typesPassword(test)` from
  `session.js` at its top level: no trace, and a test that fails goes to
  `about:blank` first, so the page snapshot Playwright writes to
  `error-context.md` can't show the password field. `trace` is a worker option,
  which a `describe` can't set, so such a test gets a file of its own. While the
  password is in its field, wait with `page.waitForURL`, never with
  `expect(page)` or `expect(locator)`: a failed one snapshots the page into
  `error-context.md` there and then, password included. Type a password only
  through `signIn`: a `fill` that fails logs `fill("<the value>")` in its
  error, and `signIn` passes the error on without the value.
- Signed out: `test.use({ storageState: SIGNED_OUT })` in a `describe`.
  `browser.newContext()` would take the project's signed-in session too.
- The first click inside a page must come at least 300 ms after the page
  opened, or the page frame drops it as a double click's second click
  (Ruling 59). Playwright's auto-wait doesn't cover this. Once the test has
  seen the new page open (its address, its tab or its title), call
  `await opened(page)` from `session.js` before the first click inside it,
  however the page opened: a link, a tab, Back or `page.goto`. Clicks in the
  shell around the page (the top bar, the phone's tabs) aren't held back.
- The bill form keeps an unfinished bill on the shop's list 1.2 s after the
  last change, and saving the bill deletes it. A spec that types in the form and
  stops half-way leaves one, so a file whose tests type in the form calls
  `startsDrafts(test)` (`tests-v3/bill-form-data.js`): after each test, the
  unfinished bills its user started during it are deleted, in a
  `test.afterEach` as `makesBills` is. Leaving the form is itself what fires a
  keep (a change not kept yet goes on pagehide), and `page.on("request")` never
  sees that request, so the cleanup (`leaveForm`) first stops the page's writes to
  the shop's list with a route that aborts them, lets the ones already on their
  way land, and only then leaves the page. Declare `startsDrafts(test)` before
  `makesBills` and `typesPassword`: afterEach hooks run in the order they're
  declared, and it has to leave the page before `typesPassword`'s hook moves a
  failed test's page. A bill the form saves isn't `newBill`'s:
  `notesSavedBills(page)` notes each one as the server answers (`noteBill`), and
  `startsDrafts`' hook waits for any note still being read before `makesBills`
  empties its list, so a bill saved just before a failure goes to the bin too.
  A second person signs in with `signIn(page, role)`: LOGINS_FILE's line for
  `E2E_OTHER_ROLE` on the sandbox. CI has one user, so `hasLogin(role)` is false
  there and the handover runs as the same person on a second device.
- A new WCAG check measures with `measure(page)` (`tests-v3/axe.js`) rather than
  after a fixed wait: it waits for the heading and for nothing `aria-busy`, then
  fails if the page reloaded while axe ran (the sandbox's Vite reloads it when v3
  moves).
- A spec that needs a bill makes it: `tests-v3/sales-data.js` reads the firms,
  customers and next number at runtime and makes the bill through the API with
  the saved session (`client(request)`, `newBill`, `walkIn`). CI's database has
  no bills, so a spec never assumes a seed id. A file whose tests make bills
  calls `makesBills(test)` at its top level: after each test, every bill
  `newBill` made goes to the bin, a renumbered one getting its number back
  first. It's a `test.afterEach`, not each test's `finally`: a test that times
  out has its request disposed before a `finally` could use it, which would
  leave a live bill or a gap in the numbers. A dialog also drops a click within
  350 ms of opening: `afterDialog(page)` waits it out. WhatsApp never opens:
  replace `window.open` with `page.addInitScript` before the page loads, with a
  stand-in that returns an object, since the app takes `null` for a tab the
  browser stopped and records nothing.
- A PDF's text is read back with `tests-v3/pdf-text.js` (`pdfPages`,
  `pdfSubject`, `pdfPageCount`, `pdfFonts`): react-pdf stores Times text as hex
  WinAnsi codes in compressed streams, and the ₹, drawn in its own one-glyph
  font, reads back through that font's ToUnicode map, so a page reads
  "₹ 6,707.88" as printed (a "¹" is a ₹ that fell into Times). A page makes its
  PDF ahead: wait for the button to be enabled before the click that downloads
  it. The page itself (`<html>`) is a `document` to `getByRole`, so count papers
  by name.
- `print.spec.js` needs a firm with a bank account and a second firm. It uses
  the server's, a firm with a prefix first (the sandbox's KIRAN prints its full
  numbers, KGH/2026-27/N). Where no firm has an account (CI) it makes
  `TEST PRINT FIRM (e2e)` once, by name, and keeps it; its name sorts after
  CI's TEST JEWELLERS, so every other spec's first firm stays CI's own. It
  sets the copies and bank details it needs on the page, which saves nothing:
  the shop's print defaults can be anything, and stay as they were.
- What the specs leave behind, on the sandbox as on CI: the bills they make stay
  in the bin, which nothing empties. A full run uses about 51 of the first
  firm's numbers (55 on the sandbox, whose first firm, AARAV, also has the filed
  month `a11y.spec.js` measures), 3 of them on last month's paper bills (on a
  fresh database the earlier specs use up its one-digit numbers before search
  needs a number of two digits), and 4 of the firm `print.spec.js` prints from
  (the sandbox's KIRAN, CI's `TEST PRINT FIRM (e2e)`). They show in those firms'
  bins, and in the first firm's paper book, as deleted test bills. `walkIn` makes
  "Walk-in Customer (e2e)" where there's no walk-in record (the sandbox had none)
  and keeps it for every later run: don't delete it. Its bills in the bin protect
  it anyway, and each run would make a new one.
- Your own Vite in a worktree: start it with `--force` when its dependency
  cache (`web/node_modules/.vite`) may be older than an import such as the PDF's
  `qrcode`. Otherwise Vite optimizes that dependency the first time a page
  needs it and reloads the page mid-test.

### CI and sandbox acceptance (X-87)

`CI=true` selects nine self-contained v3 spec files in `v3.config.js`: shell,
signed-out, sales, bill-form, purchases, purchases-a11y, gst-returns, easy-bill
and easy-send-core. Both desktop and phone run, with one worker and no retries.
Playwright has a 20-minute global limit inside GitHub's 25-minute step.

Tests tagged `@sandbox` need seeded scenarios, multiple real roles, fake services,
or the release stack; the review's sales-search and CA workbook cases also stay
in sandbox acceptance. `@acceptance` marks long idle/large-restore checks.
Keep metadata tags separate from titles: the Easy evidence checker matches titles.
The other files remain part of broader acceptance coverage. With `CI` unset,
the full suite collects every file and tag; run it on the assigned sandbox with
its lock, seed and role logins. That full acceptance remains a release gate.

CI also runs `node --test tests-node/*.test.js scripts/*.test.mjs` after `npm ci`.
These test helpers, CI selection and acceptance evidence without a live stack.
