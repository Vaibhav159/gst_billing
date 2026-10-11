const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { SIGNED_OUT, opened } = require("./session");
const { afterDialog, client, newBill, removeBill, today } = require("./sales-data");

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
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// What needs a bill: one is made through the API for each check, and goes to the bin after it (sales-data.js).
const BILL_STATES = [
  {
    name: "the bills list with a bill previewed", on: ["desktop"], path: (b) => `/sales?firm=${b.business}&month=today&bill=${b.id}`, landing: "/sales",
    async show(page, b) { await expect(page.getByRole("complementary", { name: `Preview of bill ${b.number}`, exact: true })).toBeVisible(); },
  },
  {
    name: "a bill's page", on: ["desktop", "phone"], path: (b) => `/sales/${b.id}`,
    async show(page) { await expect(page.getByText("Parties", { exact: true })).toBeVisible(); },
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
    name: "a deleted bill's page", on: ["desktop", "phone"], path: (b) => `/sales/${b.id}`, deleted: true,
    async show(page) { await expect(page.getByText("This bill was deleted")).toBeVisible(); },
  },
  {
    // a cancelled bill's card among the month's bills, its muted words included (1B Task 8)
    name: "the phone's bills with a cancelled one", on: ["phone"], path: (b) => `/sales?firm=${b.business}&month=${today().slice(0, 7)}`, landing: "/sales", cancelled: true,
    async show(page, b) { await expect(page.getByRole("link", { name: new RegExp(`^${esc(b.customerName)}, ${esc(b.number)}, .*, cancelled$`) })).toBeVisible(); },
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
  for (const { name, on, path, landing, deleted, cancelled, show } of BILL_STATES) {
    test(`no WCAG 2.2 AA problems: ${name} in ${theme}`, async ({ page, request }, info) => {
      test.skip(!on.includes(info.project.name), `${name} isn't measured on the ${info.project.name}`);
      const api = client(request);
      const b = await newBill(api);
      try {
        if (cancelled) await api.post(`sales/${b.id}/cancel/`, { reason: "Test bill" });
        if (deleted) await removeBill(api, b.id);
        const at = path(b);
        await openIn(page, theme, at, landing ?? at);
        await show(page, b);
        await settle(page);
        expect(await problems(page)).toEqual([]);
      } finally {
        await removeBill(api, b.id);
      }
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
