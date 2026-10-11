const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { measure } = require("./axe");
const { cleanDrafts, draftWrites, leaveForm, monthBefore } = require("./bill-form-data");
const { SIGNED_OUT, opened } = require("./session");
const { afterDialog, client, esc, makesBills, newBill, today } = require("./sales-data");

// every bill a check makes goes to the bin after it (sales-data.js)
makesBills(test);

/** What axe finds against WCAG 2.2 AA: each rule broken, with the elements that break it. */
async function problems(page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

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
      await expect(page.getByRole("button", { name: /^Switch to Expert/ })).toBeVisible();
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
        async show(page, b) { await expect(page.getByRole("complementary", { name: `Preview of bill ${b.number}`, exact: true })).toBeVisible(); },
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
];

for (const theme of ["obsidian", "pearl"]) {
  for (const { path, ...lands } of PAGES) {
    test(`no WCAG 2.2 AA problems: ${path} in ${theme}`, async ({ page }, info) => {
      const landing = lands[info.project.name];
      test.skip(!landing, `${path} isn't measured on the ${info.project.name}`);
      await openIn(page, theme, path, landing);
      await settle(page);
      expect(await problems(page)).toEqual([]);
    });
  }
  for (const { name, on, path, show } of STATES) {
    test(`no WCAG 2.2 AA problems: ${name} in ${theme}`, async ({ page }, info) => {
      test.skip(!on.includes(info.project.name), `${name} isn't measured on the ${info.project.name}`);
      await openIn(page, theme, path);
      await show(page);
      await settle(page);
      expect(await problems(page)).toEqual([]);
    });
  }
  for (const { name, on, paper, steps } of BILL_STATES) {
    test(`no WCAG 2.2 AA problems: ${name} in ${theme}`, async ({ page, request }, info) => {
      test.skip(!on.includes(info.project.name), `${name} isn't measured on the ${info.project.name}`);
      test.slow(); // several pages, each measured
      const api = client(request);
      const b = await newBill(api, { paper });
      for (const step of steps.filter((x) => !x.on || x.on.includes(info.project.name))) {
        await test.step(step.name, async () => {
          if (step.sent) await api.post(`sales/${b.id}/sent/`, { via: "whatsapp" });
          if (step.cancelled) await api.post(`sales/${b.id}/cancel/`, { reason: "Test bill" });
          if (step.deleted) await api.del(`sales/${b.id}/`, { reason: "Test bill" });
          const at = step.path(b);
          await openIn(page, theme, at, step.landing ?? at);
          await step.show(page, b);
          await settle(page);
          expect(await problems(page), step.name).toEqual([]);
        });
      }
    });
  }
}

// The bill form (part 1D), in both themes: a new bill; the paper book (last month's, of the firm that has numbers in it
// missing or explained, the most it can show: the sandbox's KIRAN, else the first firm); Check and save on a copy of a
// bill made for it; the date's calendar (F14); the customer box while it searches and with no match (Ruling 1C-20a: web
// has no axe of its own); and the review once how it was paid is picked, with nothing left in its body to focus, so the
// body itself takes the keyboard (Ruling 1D-18), measured where it scrolls: a 1280×720 desktop and a phone. A copy keeps
// no unfinished bill until something on it changes; picking how it was paid does, so that one is deleted after the test.
let draftsSince = null;
let drafted = null;
test.afterEach(async ({ page, request }) => {
  const since = draftsSince;
  draftsSince = null;
  if (!since) return;
  await leaveForm(page, drafted);
  await cleanDrafts(client(request), since);
});
/** The form itself, not its placeholders: the desktop's customer box has the cursor; a phone's offers to choose one. */
async function formDrawn(page, project) {
  if (project === "phone") await expect(page.getByRole("button", { name: /^Choose customer/ })).toBeVisible();
  else await expect(page.getByRole("combobox", { name: /^Customer/ })).toBeFocused();
}
/** Check and save (Ctrl S on a desktop, the action bar's button on a phone): the review, past its guard. */
async function openReview(page, project) {
  const title = project === "phone" ? "Check the bill" : "Check the bill before saving";
  await opened(page);
  if (project === "phone") await page.getByRole("button", { name: "Check and save" }).click();
  else await page.keyboard.press("Control+s");
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  await afterDialog(page);
  return { dialog, title };
}
let book = null;
/** Last month's paper book with the most in it: the first firm's that has numbers missing or explained, else the first firm's. */
async function bookToMeasure(api) {
  if (book) return book;
  const month = monthBefore(today());
  const { results: firms } = await api.get("businesses/", { page_size: 100 });
  for (const f of firms) {
    const pb = await api.get("sales/paper-book/", { business_id: f.id, month });
    if (pb.missing.length || pb.explained.length) return (book = { firm: f.id, month });
  }
  return (book = { firm: firms[0].id, month });
}
const FORM_STATES = [
  {
    name: "a new bill's form", on: ["desktop", "phone"], path: () => "/sales/new",
    async show(page, c, project) { await formDrawn(page, project); },
  },
  {
    name: "the paper book", on: ["desktop", "phone"], prepare: bookToMeasure, path: (c) => `/sales/paper?firm=${c.firm}&month=${c.month}`, landing: "/sales/paper",
    async show(page) { await expect(page.getByRole("button", { name: /^Enter bill \d+$/ })).toBeVisible(); },
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
    name: "the review once paid", on: ["desktop", "phone"], desktopSize: { width: 1280, height: 720 }, prepare: (api) => newBill(api), keepsDraft: true,
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
];
for (const theme of ["obsidian", "pearl"]) {
  for (const { name, on, prepare, path, landing, desktopSize, keepsDraft, show } of FORM_STATES) {
    test(`no WCAG 2.2 AA problems: ${name} in ${theme}`, async ({ page, request }, info) => {
      test.skip(!on.includes(info.project.name), `${name} isn't measured on the ${info.project.name}`);
      test.slow(); // the form's data, then axe, once or more
      const c = prepare ? await prepare(client(request)) : null;
      if (desktopSize && info.project.name === "desktop") await page.setViewportSize(desktopSize);
      if (keepsDraft) { draftsSince = new Date(); drafted = draftWrites(page); }
      const at = path(c);
      await openIn(page, theme, at, landing ?? at);
      await show(page, c, info.project.name);
      expect(await measure(page)).toEqual([]);
    });
  }
}

test.describe("signed out", () => {
  test.use({ storageState: SIGNED_OUT });

  test("the sign-in page has no WCAG 2.2 AA problems", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    expect(await problems(page)).toEqual([]);
  });
});
