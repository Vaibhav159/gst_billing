const { test, expect } = require("@playwright/test");
const { measure, problems } = require("./axe");
const { aProduct, monthBefore, notesSavedBills, possessive, startsDrafts } = require("./bill-form-data");
const { SIGNED_OUT, opened } = require("./session");
const { TEST_ITEM, afterDialog, client, esc, makesBills, newBill, today, walkIn } = require("./sales-data");

// After each check: the bill form left with its writes to the shop's list stopped, a bill it saved noted, and the
// unfinished bills started during the check deleted (startsDrafts); then every bill the check made goes to the bin
// (makesBills). In that order: afterEach hooks run in the order they're declared
startsDrafts(test);
makesBills(test);

/** Where a check runs, as its title says: "desktop", "phone" or "desktop and phone". */
const where = (on) => on.join(" and ");

/** Opens `path` in `theme` and waits for the page it lands on (`landing`): the page itself, not the app still loading. */
async function openIn(page, theme, path, landing = path) {
  await page.addInitScript((t) => localStorage.setItem("gst3.theme", t), theme);
  await page.goto(path);
  await expect(page).toHaveURL((url) => url.pathname === landing);
  // device.ts: Obsidian is the stylesheet's bare :root, every other theme a class on <html>
  await expect(page.locator("html")).toHaveClass(theme === "obsidian" ? "" : `theme-${theme}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}
/** Lets the page's rise, or an overlay's pop, finish before measuring contrast. */
const settle = (page) => page.waitForTimeout(500);

// Each page by the address opened, and where it lands on a desktop and on a phone (null: not measured there).
// A phone opens Easy's home at /. A desktop sends the phone's /more home, so it measures a page under its More instead.
const PAGES = [
  { path: "/", desktop: "/", phone: "/e" },
  { path: "/sales", desktop: "/sales", phone: "/sales" },
  { path: "/products", desktop: "/products", phone: null },
  { path: "/more", desktop: null, phone: "/more" },
];
// What the pages alone don't show: search, the account menu and the shortcuts open (the desktop's), the page that isn't
// there, Easy's More, and the banner while the device is offline.
const STATES = [
  {
    name: "search open, with the server's results", on: ["desktop"], path: "/sales",
    async show(page) {
      await page.keyboard.press("Control+k");
      await page.getByRole("dialog", { name: "Search" }).getByRole("combobox").fill(process.env.E2E_SEARCH || "TEST");
      await expect(page.getByRole("option", { name: process.env.E2E_SEARCH_HIT || "TEST CUSTOMER" }).first()).toBeVisible();
    },
  },
  {
    name: "the account menu open", on: ["desktop"], path: "/sales",
    async show(page) {
      await page.getByRole("button", { name: /^Account/ }).click();
      await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
    },
  },
  {
    name: "the keyboard shortcuts open", on: ["desktop"], path: "/sales",
    async show(page) {
      await page.keyboard.press("?");
      await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    },
  },
  {
    name: "the page that isn't there", on: ["desktop", "phone"], path: "/no/such/page",
    async show(page) {
      await expect(page.getByRole("heading", { level: 1, name: "This page isn't here" })).toBeVisible();
    },
  },
  {
    name: "Easy's More (/e/more)", on: ["phone"], path: "/e/more",
    async show(page) {
      await expect(page.getByRole("button", { name: /^Switch to the full view/ })).toBeVisible();
    },
  },
  {
    name: "the offline banner", on: ["desktop", "phone"], path: "/sales",
    async show(page) {
      await page.context().setOffline(true); // the browser says so (navigator.onLine and its "offline" event)
      await expect(page.locator("[data-offline]")).toContainText("You're offline.");
    },
  },
];
/** A saved bill's edit form itself, not its placeholders: its Check and save changes (the summary's, the action bar's). */
const editDrawn = (page) => expect(page.getByRole("button", { name: "Check and save changes" })).toBeVisible();
/** A bill's preview in the list (desktop), once it has the bill's own answer: its item, never the skeletons before it. */
const previewed = (page, b) => expect(page.getByRole("complementary", { name: `Preview of bill ${b.number}`, exact: true }).getByText(TEST_ITEM)).toBeVisible();
// What needs a bill: one is made through the API for each test and measured in each state it's put in on the way (sent,
// cancelled or deleted through the API between pages), so few bills go to the bin; each goes there after its test.
const BILL_STATES = [
  {
    // a new bill's Not sent yet, the green Sent once sent, then a cancelled bill's red banner and badge and its muted
    // total, and on a phone its card among the month's bills (1B Task 8)
    name: "a bill from new to cancelled", on: ["desktop", "phone"],
    steps: [
      {
        name: "the bills list with a bill previewed", on: ["desktop"], path: (b) => `/sales?firm=${b.business}&month=today&bill=${b.id}`, landing: "/sales",
        async show(page, b) { await previewed(page, b); },
      },
      {
        name: "a bill's page", path: (b) => `/sales/${b.id}`,
        async show(page) { await expect(page.getByText("Not sent yet", { exact: true })).toBeVisible(); },
      },
      {
        name: "the cancel dialog", on: ["desktop"], path: (b) => `/sales/${b.id}`,
        async show(page, b) {
          await opened(page);
          await page.getByRole("button", { name: `More actions for ${b.number}`, exact: true }).click();
          await page.getByRole("menuitem", { name: /^Cancel bill…/ }).click();
          await expect(page.getByRole("dialog", { name: `Cancel bill ${b.number}?`, exact: true })).toBeVisible();
          await afterDialog(page);
        },
      },
      {
        name: "a sent bill's page", sent: true, path: (b) => `/sales/${b.id}`,
        async show(page) { await expect(page.getByText(/^Sent at \d{2}:\d{2}$/)).toBeVisible(); },
      },
      {
        name: "a cancelled bill's page", cancelled: true, path: (b) => `/sales/${b.id}`,
        async show(page) { await expect(page.getByText("This bill is cancelled")).toBeVisible(); },
      },
      {
        name: "the phone's bills with a cancelled one", on: ["phone"], path: (b) => `/sales?firm=${b.business}&month=${today().slice(0, 7)}`, landing: "/sales",
        async show(page, b) { await expect(page.getByRole("link", { name: new RegExp(`^${esc(b.customerName)}, ${esc(b.number)}, .*, cancelled$`) })).toBeVisible(); },
      },
    ],
  },
  {
    // a paper bill's muted On paper, then the page a deleted bill has
    name: "a paper bill, then deleted", on: ["desktop", "phone"], paper: true,
    steps: [
      { name: "a paper bill's page", path: (b) => `/sales/${b.id}`, async show(page) { await expect(page.getByText("On paper", { exact: true })).toBeVisible(); } },
      { name: "a deleted bill's page", deleted: true, path: (b) => `/sales/${b.id}`, async show(page) { await expect(page.getByText("This bill was deleted")).toBeVisible(); } },
    ],
  },
  {
    // a walk-in's bill, which has no number to send to: its e-way dialog (from its menu) and the WhatsApp dialog Send
    // opens to ask for one, on a desktop and a phone; then, cancelled, the desktop's list with its row and with that row
    // previewed (1B's final review, Minor 13). The phone's cancelled card is the first bill's
    name: "a walk-in's bill: its dialogs, then cancelled in the list", on: ["desktop", "phone"], walkin: true,
    steps: [
      {
        name: "the e-way dialog", path: (b) => `/sales/${b.id}`,
        async show(page, b, project) {
          await opened(page);
          // a phone's menu is a dialog of its own, with a dialog's guard
          if (project === "phone") {
            await page.getByRole("button", { name: `More for ${b.number}`, exact: true }).click();
            await expect(page.getByRole("dialog", { name: `Bill ${b.number}`, exact: true })).toBeVisible();
            await afterDialog(page);
          } else await page.getByRole("button", { name: `More actions for ${b.number}`, exact: true }).click();
          await page.getByRole("menuitem", { name: /^E-way bill…/ }).click();
          await expect(page.getByRole("dialog", { name: `E-way bill for ${b.number}`, exact: true })).toBeVisible();
        },
      },
      {
        name: "the WhatsApp dialog", path: (b) => `/sales/${b.id}`,
        async show(page, b) {
          await opened(page);
          await page.getByRole("button", { name: "Send to a number" }).click();
          await expect(page.getByRole("dialog", { name: `Send ${b.number} on WhatsApp`, exact: true })).toBeVisible();
        },
      },
      {
        name: "the desktop's list with a cancelled row", on: ["desktop"], cancelled: true, path: (b) => `/sales?firm=${b.business}&month=today`, landing: "/sales",
        async show(page, b) { await expect(page.locator(`tr[data-row="${b.id}"]`)).toContainText("Cancelled"); },
      },
      {
        name: "a cancelled bill in the list's preview", on: ["desktop"], path: (b) => `/sales?firm=${b.business}&month=today&bill=${b.id}`, landing: "/sales",
        async show(page, b) {
          await expect(page.getByRole("complementary", { name: `Preview of bill ${b.number}`, exact: true })).toContainText("Total when issued");
          await previewed(page, b);
        },
      },
    ],
  },
  {
    // a bill's edit page (1D): the form; its review once one thing has changed, with what changes; then, cancelled, what's
    // on it and why it can't change (ReadOnlyBill; a filed month's is in FORM_STATES); then, deleted, what its edit
    // address shows. A change to a saved bill keeps no draft, and the page left with it unsaved asks the browser first
    // (beforeunload), which Playwright accepts
    name: "a bill's edit page, then cancelled, then deleted", on: ["desktop", "phone"],
    steps: [
      { name: "a bill's edit form", path: (b) => `/sales/${b.id}/edit`, async show(page) { await editDrawn(page); } },
      {
        name: "the edit's review, with what changes", path: (b) => `/sales/${b.id}/edit`,
        async show(page, b, project) {
          await editDrawn(page);
          await opened(page);
          await page.getByRole("textbox", { name: "Note on the bill", exact: true }).fill("Changed in a test");
          const { dialog } = await openReview(page, project, `Check the changes to ${b.number}`);
          await expect(dialog.getByRole("list", { name: "What changes" })).toContainText("Note");
        },
      },
      {
        name: "a cancelled bill's edit page", cancelled: true, path: (b) => `/sales/${b.id}/edit`,
        async show(page) { await expect(page.getByText(/^Cancelled bills can't be changed\./)).toBeVisible(); },
      },
      {
        name: "a deleted bill's edit page", deleted: true, path: (b) => `/sales/${b.id}/edit`,
        async show(page, b) { await expect(page.getByText(`${b.number} was deleted`, { exact: true })).toBeVisible(); },
      },
    ],
  },
];

for (const theme of ["obsidian", "pearl"]) {
  for (const { path, ...lands } of PAGES) {
    test(`no WCAG 2.2 AA problems: ${path} in ${theme} (${where(["desktop", "phone"].filter((p) => lands[p]))})`, async ({ page }, info) => {
      const landing = lands[info.project.name];
      test.skip(!landing, `${path} isn't measured on the ${info.project.name}`);
      await openIn(page, theme, path, landing);
      await settle(page);
      expect(await problems(page)).toEqual([]);
    });
  }
  for (const { name, on, path, show } of STATES) {
    test(`no WCAG 2.2 AA problems: ${name} in ${theme} (${where(on)})`, async ({ page }, info) => {
      test.skip(!on.includes(info.project.name), `${name} isn't measured on the ${info.project.name}`);
      await openIn(page, theme, path);
      await show(page);
      await settle(page);
      expect(await problems(page)).toEqual([]);
    });
  }
  for (const { name, on, paper, walkin, steps } of BILL_STATES) {
    test(`no WCAG 2.2 AA problems: ${name} in ${theme} (${where(on)})`, async ({ page, request }, info) => {
      test.skip(!on.includes(info.project.name), `${name} isn't measured on the ${info.project.name}`);
      test.slow(); // several pages, each measured
      const api = client(request);
      const b = await newBill(api, { paper, customer: walkin ? await walkIn(api) : undefined });
      for (const step of steps.filter((x) => !x.on || x.on.includes(info.project.name))) {
        await test.step(step.name, async () => {
          if (step.sent) await api.post(`sales/${b.id}/sent/`, { via: "whatsapp" });
          if (step.cancelled) await api.post(`sales/${b.id}/cancel/`, { reason: "Test bill" });
          if (step.deleted) await api.del(`sales/${b.id}/`, { reason: "Test bill" });
          const at = step.path(b);
          await openIn(page, theme, at, step.landing ?? at);
          await step.show(page, b, info.project.name);
          expect(await measure(page), step.name).toEqual([]);
        });
      }
    });
  }
}

// The bill form (part 1D), in both themes: a new bill; the paper book (last month's, the first firm's with numbers not
// entered yet and a cancelled bill, as the sandbox's KIRAN has, else the fullest there is: bookToMeasure, and the test
// notes which) and the form its Enter bill opens; Check and save on a copy of a bill made for it; the date's calendar
// (F14); the customer box while it searches and with no match (Ruling 1C-20a: web has no axe of its own); the review once
// how it was paid is picked, with nothing left in its body to focus, so the body itself takes the keyboard (Ruling
// 1D-18), measured where it scrolls: a 1280×720 desktop and a phone; the desktop's sheet for an item that isn't in
// Products; the phone's item sheet, step by step; a filed month's bill on its edit page; and the review refusing a save
// (1D-20): a number just taken, and a filed month. An unfinished bill a check leaves is deleted after it (startsDrafts).
/** The form itself, not its placeholders: the desktop's customer box has the cursor; a phone's offers to choose one. */
async function formDrawn(page, project) {
  if (project === "phone") await expect(page.getByRole("button", { name: /^Choose customer/ })).toBeVisible();
  else await expect(page.getByRole("combobox", { name: /^Customer/ })).toBeFocused();
}
/**
 * Check and save (Ctrl S on a desktop, the action bar's button on a phone): the review, past its guard. Its title: a new
 * bill's, unless `title` (a change to a saved bill's).
 */
async function openReview(page, project, title = project === "phone" ? "Check the bill" : "Check the bill before saving") {
  await opened(page);
  if (project === "phone") await page.getByRole("button", { name: /^Check and save/ }).click();
  else await page.keyboard.press("Control+s");
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  await afterDialog(page);
  return { dialog, title };
}
let book = null;
/**
 * Last month's paper book to measure, with what it shows: the first firm's with numbers not entered yet and a cancelled
 * bill (the sandbox's KIRAN: 23 and 26 not entered, 22 cancelled), the page's fullest. The specs never make such a book
 * (their paper bills go to the bin: deleted, not missing), so where none has both, as on CI, it falls back to the first
 * firm's with any number missing or explained, else the first firm's, and `why` says so.
 */
async function bookToMeasure(api) {
  if (book) return book;
  const month = monthBefore(today());
  const { results: firms } = await api.get("businesses/", { page_size: 100 });
  const books = [];
  for (const f of firms) books.push({ f, pb: await api.get("sales/paper-book/", { business_id: f.id, month }) });
  const full = books.find(({ pb }) => pb.missing.length && pb.explained.some((x) => x.kind === "cancelled"));
  const { f, pb } = full ?? books.find((b) => b.pb.missing.length || b.pb.explained.length) ?? books[0];
  const holds = `${pb.missing.length} not entered yet, ${pb.explained.length} cancelled or deleted`;
  const why = full ? `${f.name}, ${month}: ${holds}` : `fallback: no firm's ${month} has numbers not entered yet and a cancelled bill; measured ${possessive(f.name)} (${holds})`;
  return (book = { firm: f.id, month, why });
}
/** Entering a paper bill needs an open month; the fullest seeded book can already be filed. */
async function openBookToMeasure(api) {
  const { results: firms } = await api.get("businesses/", { page_size: 100 });
  let month = today().slice(0, 7);
  for (let back = 0; back < 6; back++, month = monthBefore(`${month}-01`)) {
    for (const firm of firms) {
      const pb = await api.get("sales/paper-book/", { business_id: firm.id, month });
      if (!pb.locked) return { firm: firm.id, month, why: `${firm.name}, ${month}: open for paper entry` };
    }
  }
  throw new Error("The paper-mode form needs an open month in the paper book's six-month range");
}
/** "2026-27": the financial year (April to March) of the ISO date `iso`, or the one `back` years before it. */
function fyOf(iso, back = 0) {
  const [y, m] = iso.split("-").map(Number);
  const from = (m >= 4 ? y : y - 1) - back;
  return `${from}-${String((from + 1) % 100).padStart(2, "0")}`;
}
let filed;
/**
 * A month a firm has filed, as the sandbox's AARAV and MEERA have (CI has none): the first firm's, as the app lists them,
 * whose month now is open (a bill for today can still be made in it), and its latest filed month this year or last (the
 * bill form takes no older date) with a bill in it that isn't cancelled: { firm, month, monthName, day (its first), bill },
 * else null.
 */
async function filedMonth(api) {
  if (filed !== undefined) return filed;
  const now = today();
  const { results: firms } = await api.get("businesses/", { page_size: 100 });
  for (const firm of firms) {
    const months = [];
    for (const fy of [fyOf(now, 1), fyOf(now)]) months.push(...(await api.get("sales/", { business_id: firm.id, fy, facets: "months", summary: 0, page_size: 1 })).facets.months);
    if (months.some((m) => m.month === now.slice(0, 7) && m.locked)) continue;
    for (const { month } of months.filter((m) => m.locked && m.bills).reverse()) {
      const { results: [bill] } = await api.get("sales/", { business_id: firm.id, month, status: "active", summary: 0, page_size: 1 });
      if (!bill) continue;
      const [y, m] = month.split("-").map(Number);
      const monthName = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(Date.UTC(y, m - 1, 1));
      return (filed = { firm, month, monthName, day: `${month}-01`, bill });
    }
  }
  return (filed = null);
}
/** A filed month (filedMonth), or the check skipped: CI has none. */
async function aFiledMonth(api) {
  const f = await filedMonth(api);
  test.skip(!f, "no firm has a filed month this year or last (CI has none)");
  return f;
}
/** The page's asks for which of a firm's months are filed (the sales list's facets=months). */
const asksMonths = (url) => url.pathname === "/api/sales/" && url.searchParams.get("facets") === "months";
/**
 * Holds back the page's asks for which months are filed until the returned release() is called, as if a month were filed
 * after the form asked: a bill dated in one then goes to the server, which refuses it in its own words. Called before the
 * page opens.
 */
async function holdMonths(page) {
  let release;
  const held = new Promise((done) => { release = done; });
  // an ask the form gave up meanwhile (it asked again) has nothing left to go on
  await page.route(asksMonths, async (route) => { await held; await route.continue().catch(() => {}); });
  return release;
}
// the GST rates the bill form takes (web/src/pages/sales/form/model.ts SLABS), as a product stores them: fractions
const SLAB_RATES = [0.03, 0.0025, 0, 0.001, 0.01, 0.015, 0.05, 0.12, 0.18, 0.28, 0.4];
/**
 * What the phone's item sheet is measured with: a product to search for (aProduct), and one missing its HSN code or GST
 * rate where the shop has one, for the boxes the sheet then shows. Neither the sandbox nor CI has one: their boxes are an
 * item typed in by hand's.
 */
async function itemsToMeasure(api) {
  const { results } = await api.get("products/", { page_size: 200, ordering: "name" });
  const broken = results.find((p) => !/^\d{4,8}$/.test(String(p.hsn_code ?? "").replace(/\D/g, ""))
    || !SLAB_RATES.some((s) => p.gst_tax_rate != null && p.gst_tax_rate !== "" && Math.abs(s - Number(p.gst_tax_rate)) < 1e-9)) ?? null;
  const why = broken ? `the HSN and GST boxes for ${broken.name}` : "the HSN and GST boxes for an item typed in by hand: no product misses its HSN code or GST rate";
  return { search: await aProduct(api), broken, why };
}
/** An item no product is called, typed in by hand: it goes on no bill and into no list of products. */
const BY_HAND = "Kundan Anklet (e2e)";
const FORM_STATES = [
  {
    name: "a new bill's form", on: ["desktop", "phone"], path: () => "/sales/new",
    async show(page, c, project) { await formDrawn(page, project); },
  },
  {
    name: "the paper book", on: ["desktop", "phone"], prepare: bookToMeasure, note: (c) => c.why, path: (c) => `/sales/paper?firm=${c.firm}&month=${c.month}`, landing: "/sales/paper",
    async show(page) { await expect(page.getByRole("button", { name: /^Enter bill \d+$/ })).toBeVisible(); },
  },
  {
    // the paper-mode form (1D Task 7) as the paper book's Enter bill opens it, with the paper bill's own number and date,
    // from an open book; the fullest seeded book measured above may already be filed
    name: "the paper-mode form, from the paper book's Enter bill", on: ["desktop", "phone"], prepare: openBookToMeasure, note: (c) => c.why,
    path: (c) => `/sales/paper?firm=${c.firm}&month=${c.month}`, landing: "/sales/paper",
    async show(page, c, project) {
      const enter = page.getByRole("button", { name: /^Enter bill \d+$/ });
      await expect(enter).toBeEnabled();
      await opened(page);
      await enter.click();
      await page.waitForURL(/\/sales\/new\?paper=1/);
      await formDrawn(page, project);
      await expect(page.getByText(/ from the paper bill is free in FY /)).toBeVisible();
    },
  },
  {
    name: "the bill form's review", on: ["desktop"], prepare: (api) => newBill(api), path: (b) => `/sales/new?from=${b.id}`, landing: "/sales/new",
    async show(page, b, project) {
      await expect(page.getByText(`Copied from ${b.number}`)).toBeVisible();
      await openReview(page, project);
    },
  },
  {
    // on a phone the date is in the sheet with the firm and number, and its calendar is a dialog of its own
    name: "the date's calendar open", on: ["desktop", "phone"], path: () => "/sales/new",
    async show(page, c, project) {
      await formDrawn(page, project);
      await opened(page);
      if (project === "phone") {
        await page.locator("#bfp-info").click();
        await expect(page.getByRole("dialog", { name: "Firm, number and date" })).toBeVisible();
        await afterDialog(page);
      }
      await page.getByRole("button", { name: "Date: open the calendar" }).click();
      await expect(page.getByRole("grid")).toBeVisible();
      if (project === "phone") await afterDialog(page);
    },
  },
  {
    // one letter (keep typing), then the server's search held while it's measured (searching), then its answer: nobody.
    // A note is said in the box's own panel, and announced, until there are rows to pick: then the list has them
    name: "the customer box searching, then with no match", on: ["desktop"], path: () => "/sales/new",
    async show(page) {
      await formDrawn(page, "desktop");
      await opened(page);
      await page.keyboard.type("Q");
      await expect(page.getByText("Keep typing to search", { exact: true }).first()).toBeVisible();
      expect(await measure(page), "keep typing").toEqual([]);
      let answer;
      const held = new Promise((done) => { answer = done; });
      await page.route((url) => url.pathname === "/api/customers/" && url.searchParams.has("search"), async (route) => { await held; await route.continue(); });
      await page.keyboard.type("xzq");
      await expect(page.getByText("Searching…", { exact: true }).first()).toBeVisible();
      expect(await measure(page), "searching").toEqual([]);
      answer();
      await expect(page.getByRole("listbox", { name: "Customers" }).getByRole("option", { name: /No customer matches/ })).toBeVisible();
    },
  },
  {
    name: "the review once paid", on: ["desktop", "phone"], desktopSize: { width: 1280, height: 720 }, prepare: (api) => newBill(api),
    path: (b) => `/sales/new?from=${b.id}`, landing: "/sales/new",
    async show(page, b, project) {
      await expect(page.getByText(`Copied from ${b.number}`)).toBeVisible();
      const { dialog, title } = await openReview(page, project);
      await dialog.getByRole("radio", { name: "Cash", exact: true }).click();
      // nothing left in its body to focus: at this size it scrolls, so the body itself is a region Tab reaches
      await expect(dialog.getByRole("region", { name: title })).toBeVisible();
      // the payment is a change, so the copy keeps itself as an unfinished bill (deleted after the test): measured once
      // that has landed, so nothing changes under axe and the cleanup finds it
      await expect(page.getByText(/^Kept as a draft at \d\d:\d\d$/)).toBeVisible({ timeout: 15_000 });
    },
  },
  {
    // the desktop's sheet for an item that isn't in Products (1D Task 6), from a line's product box: what was typed is
    // its name. Nothing is saved
    name: "the sheet for an item that isn't in Products", on: ["desktop"], path: () => "/sales/new",
    async show(page) {
      await formDrawn(page, "desktop");
      await opened(page);
      await page.getByRole("combobox", { name: "Line 1 product" }).click();
      await page.keyboard.type(BY_HAND);
      await page.getByRole("option", { name: new RegExp(`^\\+ An item that isn't in Products: “${esc(BY_HAND)}”`) }).click();
      const name = page.getByRole("dialog", { name: "An item that isn't in Products" }).getByRole("textbox", { name: /^Name/ });
      await expect(name).toBeFocused();
      await expect(name).toHaveValue(BY_HAND);
    },
  },
  {
    // the phone's item sheet (1D Task 9), measured at each step: as it opens, on the shop's common products; a search; the
    // boxes for the item's HSN code and GST rate (a product missing either where there is one, else an item typed in by
    // hand and used on this bill only, so nothing goes into Products); then, after Add and next item, the sheet open
    // again for the next item. The item on the form keeps itself as an unfinished bill (deleted after the test): measured
    // once that has landed
    name: "the phone's item sheet: its chips, a search, the HSN and GST boxes, then after Add and next item", on: ["phone"],
    prepare: itemsToMeasure, note: (c) => c.why, path: () => "/sales/new",
    async show(page, c) {
      await formDrawn(page, "phone");
      await opened(page);
      await page.getByRole("button", { name: "Add item", exact: true }).click();
      // one sheet, whose title follows what it shows
      const sheet = page.getByRole("dialog");
      await expect(sheet).toHaveAccessibleName("Add item 1");
      const chips = sheet.getByRole("group", { name: "Common products" }).getByRole("button");
      await expect(chips.first()).toBeVisible();
      expect(await measure(page), "the chips").toEqual([]);
      await afterDialog(page);
      const search = sheet.getByRole("searchbox", { name: "Search products" });
      await search.fill(c.search.name);
      await expect(sheet.getByRole("button", { name: new RegExp(`^${esc(c.search.name)}`) }).first()).toBeVisible();
      expect(await measure(page), "a search").toEqual([]);
      if (c.broken) {
        await search.fill(c.broken.name);
        await sheet.getByRole("button", { name: new RegExp(`^${esc(c.broken.name)}`) }).first().click();
      } else {
        await search.fill(BY_HAND);
        await sheet.getByRole("button", { name: `“${BY_HAND}” isn't in Products`, exact: true }).click();
        await expect(sheet).toHaveAccessibleName("An item that isn't in Products");
        await sheet.getByRole("textbox", { name: /^HSN code/ }).fill("711319");
        await sheet.getByRole("combobox", { name: /^GST rate/ }).selectOption("3");
        // used on this bill only: the owner's Also save to Products, ticked as it opens, is unticked first
        const keep = sheet.getByRole("checkbox", { name: /^Also save to Products/ });
        if (await keep.count()) await keep.uncheck();
        await sheet.getByRole("button", { name: "Use on this bill", exact: true }).click();
        await expect(sheet.getByText("Used on this bill only", { exact: true })).toBeVisible();
      }
      const hsn = sheet.getByRole("textbox", { name: "HSN code", exact: true });
      const gst = sheet.getByRole("combobox", { name: "GST rate", exact: true });
      await expect(hsn).toBeVisible();
      await expect(gst).toBeVisible();
      expect(await measure(page), "the HSN and GST boxes").toEqual([]);
      if (c.broken) { await hsn.fill("711319"); await gst.selectOption("3"); }
      await sheet.getByRole("textbox", { name: /^(Weight in|How many) / }).fill("2");
      await sheet.getByRole("textbox", { name: /^Rate per / }).fill("6500");
      await sheet.getByRole("button", { name: "Add and next item" }).click();
      await expect(sheet).toHaveAccessibleName("Add item 2");
      await expect(chips.first()).toBeVisible();
      await expect(page.getByText(/^Kept as a draft at \d\d:\d\d$/)).toBeVisible({ timeout: 15_000 });
    },
  },
  {
    // a bill in a filed month on its edit page: what's on it, and why it can't change (ReadOnlyBill); the sandbox's
    name: "a filed month's bill on its edit page", on: ["desktop", "phone"], prepare: aFiledMonth,
    note: (c) => `${c.firm.name}, ${c.monthName} (filed): bill ${c.bill.invoice_number}`, path: (c) => `/sales/${c.bill.id}/edit`,
    async show(page) { await expect(page.getByText(/^This bill's month has its GSTR-1 filed, so its bills can't change\./)).toBeVisible(); },
  },
  {
    // a save refused (1D-20): the number a copy shows is taken meanwhile, by a bill another counter saves (made through
    // the API in the same firm, at its next free number), and the server refuses the copy's (409 number_taken), in the
    // review, which offers the next free number. A bill the form saved anyway would go to the bin (notesSavedBills)
    name: "the review refusing a number just taken", on: ["desktop", "phone"], prepare: (api) => newBill(api),
    path: (b) => `/sales/new?from=${b.id}`, landing: "/sales/new",
    async show(page, b, project, api) {
      notesSavedBills(page);
      await expect(page.getByText(`Copied from ${b.number}`)).toBeVisible();
      const { dialog } = await openReview(page, project);
      await dialog.getByRole("radio", { name: "Cash", exact: true }).click();
      // kept as an unfinished bill (deleted after the test) first, so its status doesn't change under axe
      await expect(page.getByText(/^Kept as a draft at \d\d:\d\d$/)).toBeVisible({ timeout: 15_000 });
      const taken = await newBill(api, { firm: { id: b.business, name: b.firmName } });
      await dialog.getByRole("button", { name: "Save bill" }).click();
      await expect(dialog.getByText(`${taken.number} was just used`, { exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: /^Save as / })).toBeEnabled();
    },
  },
  {
    // a save refused (1D-20) as its month is filed: a copy dated in a month its firm has filed (the sandbox's), while the
    // form's ask for which months are filed is held back, as if the month was filed after it asked. Its save goes to the
    // server, which refuses it (409 month_closed), in the review; then the form hears which months are filed. A bill the
    // form saved anyway would go to the bin (notesSavedBills)
    name: "the review refusing a filed month", on: ["desktop", "phone"], note: (c) => `${c.firm.name}, ${c.monthName} (filed): a copy of ${c.b.number} dated ${c.day}`,
    prepare: async (api) => { const f = await aFiledMonth(api); return { ...f, b: await newBill(api, { firm: f.firm }) }; },
    async before(page, c) { c.release = await holdMonths(page); },
    path: (c) => `/sales/new?from=${c.b.id}`, landing: "/sales/new",
    async show(page, c, project) {
      notesSavedBills(page);
      await expect(page.getByText(`Copied from ${c.b.number}`)).toBeVisible();
      await opened(page);
      // on a phone the date is in the sheet with the firm and number
      if (project === "phone") {
        await page.locator("#bfp-info").click();
        await expect(page.getByRole("dialog", { name: "Firm, number and date" })).toBeVisible();
        await afterDialog(page);
      }
      await page.getByRole("textbox", { name: "Date", exact: true }).fill(c.day);
      if (project === "phone") await page.getByRole("button", { name: "Done", exact: true }).click();
      const { dialog } = await openReview(page, project);
      await dialog.getByRole("radio", { name: "Cash", exact: true }).click();
      await dialog.getByRole("button", { name: "Save bill" }).click();
      await expect(dialog.getByText(`${c.monthName} was just filed`, { exact: true })).toBeVisible();
      const heard = page.waitForResponse((r) => asksMonths(new URL(r.url())));
      c.release();
      await heard;
      // what was typed keeps itself as an unfinished bill (deleted after the test) once the save let it: measured after
      await expect(page.getByText(/^Kept as a draft at \d\d:\d\d$/)).toBeVisible({ timeout: 15_000 });
    },
  },
];
for (const theme of ["obsidian", "pearl"]) {
  for (const { name, on, prepare, before, note, path, landing, desktopSize, show } of FORM_STATES) {
    test(`no WCAG 2.2 AA problems: ${name} in ${theme} (${where(on)})`, async ({ page, request }, info) => {
      test.skip(!on.includes(info.project.name), `${name} isn't measured on the ${info.project.name}`);
      test.slow(); // the form's data, then axe, once or more
      const api = client(request);
      const c = prepare ? await prepare(api) : null;
      // what was measured, in the report: the paper book's choice, or that it fell back
      if (note) info.annotations.push({ type: "measured", description: note(c) });
      if (desktopSize && info.project.name === "desktop") await page.setViewportSize(desktopSize);
      if (before) await before(page, c);
      const at = path(c);
      await openIn(page, theme, at, landing ?? at);
      await show(page, c, info.project.name, api);
      expect(await measure(page)).toEqual([]);
    });
  }
}

test.describe("signed out", () => {
  test.use({ storageState: SIGNED_OUT });

  test("the sign-in page has no WCAG 2.2 AA problems (desktop and phone)", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    expect(await problems(page)).toEqual([]);
  });
});


for (const theme of ["obsidian", "pearl"]) {
  for (const screen of ["reports", "credit", "reconciliation"]) {
    test(`no WCAG 2.2 AA problems: GST support ${screen} in ${theme} (desktop and phone)`, async ({ page, request }) => {
      test.slow();
      const api = client(request);
      const businesses = await api.get("businesses/", { page_size: 100 });
      const firm = (Array.isArray(businesses) ? businesses : businesses.results)[0];
      expect(firm, "GST support needs a seeded firm").toBeTruthy();
      const [year, month] = today().split("-").map(Number), start = year - (month < 4 ? 1 : 0);
      const fy = `${start}-${String(start + 1).slice(-2)}`;
      const path = screen === "reports" ? "/reports/sales" : `/gst?tab=${screen === "credit" ? "credit" : "recon"}&firm=${firm.id}&fy=${fy}`;
      const endpoint = screen === "reports" ? "/api/reports/sales/" : `/api/gst/${screen}/`;
      const response = page.waitForResponse(r => new URL(r.url()).pathname === endpoint && r.request().method() === "GET");
      await openIn(page, theme, path, screen === "reports" ? "/reports/sales" : "/gst");
      const reply = await response;
      expect(reply.status()).toBe(200);
      if (screen === "reports") await expect(page.getByRole("region", { name: "Download this report" })).toBeVisible();
      else if (screen === "credit") await expect(page.getByRole("region", { name: "Credit carried into FY 2025-26", exact: true })).toBeVisible();
      else {
        const data = await reply.json();
        if (data.filed.some(m => m.books.bills > 0 || (m.gstr1?.bills ?? 0) > 0)) {
          await expect(page.getByRole("radiogroup", { name: "Figure to compare" })).toBeVisible();
        } else await expect(page.getByText(`No sales for ${firm.name} in FY ${fy}`)).toBeVisible();
      }
      expect(await measure(page)).toEqual([]);
    });
  }
}
