// Proposed tracked destination: e2e-tests/tests-v3/due-next.spec.js
// X-40: run only after 5B Task 1 and 5D Tasks 1–3 land. Dashboard-opening tests also
// need 5B's dashboard UI. All non-fixture due-next/dashboard calls require 5A.
// This file imports only helpers that exist at 7597a321; no app exports are assumed.
// Fixture tests verify browser rendering/cache ownership, NOT backend due counts.
// Real API tests below do not route due-next/, dashboard/, or sales/ responses.
const { test, expect } = require("@playwright/test");
const { measure } = require("./axe");
const { easyIfExpertSaved, opened, savedToken } = require("./session");
const { afterDialog, client, esc, firstFirm, makesBills, newBill } = require("./sales-data");

makesBills(test);
test.beforeEach(async ({ request }, info) => {
  if (info.project.name === "phone") await client(request).patch("preferences/", { phoneMode: "expert" });
});
test.afterEach(async ({ request }, info) => {
  if (info.project.name === "phone") await easyIfExpertSaved(request, savedToken());
});

// Playwright Request and Response both expose url(), so the observers share this reader.
const pathname = (message) => new URL(message.url()).pathname;
const dueResponse = (response) => response.request().method() === "GET" && pathname(response) === "/api/due-next/";
const dashboardResponse = (response) => response.request().method() === "GET" && pathname(response) === "/api/dashboard/";
const unsentCount = (data) => data.items.find((item) => item.kind === "unsent")?.count ?? 0;
const bell = (page) => page.getByRole("button", { name: /^(Needs attention(?:: \d+)?|Nothing needs attention)$/ });
const tabs = (page) => page.getByRole("navigation", { name: "Tabs", exact: true });

/** Observe requests, not elapsed wall time, and do not log auth headers/bodies. */
function apiTraffic(page) {
  const pending = new Set();
  const sent = [];
  page.on("request", (request) => {
    if (!pathname(request).startsWith("/api/")) return;
    pending.add(request);
    sent.push(`${request.method()} ${new URL(request.url()).pathname}${new URL(request.url()).search}`);
  });
  const finish = (request) => pending.delete(request);
  page.on("requestfinished", finish);
  page.on("requestfailed", finish);
  return {
    sent,
    async settled() {
      await expect.poll(() => pending.size).toBe(0);
      await expect(page.getByRole("heading", { level: 1, name: "Today", exact: true })).toBeVisible();
      // Use the suite's page-open guard after rendering, then check requests from that render.
      await opened(page);
      await expect.poll(() => pending.size).toBe(0);
    },
  };
}

async function expertHome(page, firm) {
  await page.goto(`/?firm=${firm.id ?? firm}`);
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(page.getByRole("heading", { level: 1, name: "Today", exact: true })).toBeVisible();
  await opened(page);
}

async function search(page, project) {
  if (project === "phone") await page.getByRole("button", { name: "Search customers and bills", exact: true }).click();
  else await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search", exact: true });
  await expect(dialog.getByRole("combobox")).toBeFocused();
  await afterDialog(page);
  return dialog;
}

/** Four contract-shaped items, in server order; count is intentionally not items.length. */
function fixtureItems(firm) {
  const base = { due: null, firm: null, month: null, draft_id: null, from: null, to: null, badge: null };
  return [
    { ...base, kind: "blocker", due: "2026-10-11", count: 2, firm: firm.id, month: "2026-09", badge: "home_dot",
      title: "2 problems stop Kiran's September GSTR-1", detail: `${firm.name} · September 2026 GSTR-1 can't be filed until they're fixed` },
    { ...base, kind: "captures", count: 4, title: "4 captured bills to fill in", detail: "Photos of supplier bills waiting to become purchases" },
    { ...base, kind: "unsent", count: 2, title: "2 of today's bills haven't been sent", detail: "1 · TEST CUSTOMER, 2 · TEST CUSTOMER" },
    { ...base, kind: "drafts", count: 3, draft_id: "00000000-0000-4000-8000-000000000005", title: "3 unfinished bills", detail: "Saved as you typed; open to finish or discard" },
  ];
}

/** Only due-next is mocked. All auth, preferences, firm and dashboard reads remain real. */
async function fixtureDue(page, items) {
  const calls = [];
  await page.route("**/api/due-next/**", async (route) => {
    expect(route.request().method()).toBe("GET");
    calls.push(route.request().url());
    await route.fulfill({ status: 200, json: { today: "2026-10-08", items, returns: null } });
  });
  return calls;
}

test("fixture / desktop: a quiet bell asks only when opened, reuses fresh data and refreshes stale data", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.clock.install({ time: new Date("2026-10-08T10:00:00+05:30") });
  const firm = await firstFirm(client(request));
  const items = fixtureItems(firm);
  const calls = await fixtureDue(page, items);
  await page.goto(`/sales?firm=${firm.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Sales", exact: true })).toBeVisible();
  await opened(page);
  await expect(bell(page)).toHaveAccessibleName("Needs attention");
  expect(calls).toHaveLength(0);
  await bell(page).click();
  const sheet = page.getByRole("dialog", { name: "Needs attention", exact: true });
  await expect(sheet).toBeVisible();
  await expect(bell(page)).toHaveAccessibleName("Needs attention: 4");
  const links = sheet.getByRole("link");
  await expect(links).toHaveCount(4);
  for (let i = 0; i < items.length; i++) await expect(links.nth(i)).toContainText(items[i].title);
  await expect(links.nth(0)).toHaveAttribute("href", `/gst?firm=${firm.id}&month=2026-09&fix=1`);
  await expect(links.nth(1)).toHaveAttribute("href", "/purchases/inbox");
  await expect(links.nth(2)).toHaveAttribute("href", "/sales?when=today&status=unsent");
  await expect(links.nth(3)).toHaveAttribute("href", "/sales/new?draft=00000000-0000-4000-8000-000000000005");
  expect(calls).toHaveLength(1);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await bell(page).click();
  await expect(sheet).toBeVisible();
  expect(calls).toHaveLength(1);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await page.clock.runFor(61_000);
  expect(calls).toHaveLength(1);
  await bell(page).click();
  await expect.poll(() => calls.length).toBe(2);
  await expect(sheet.getByText(items[0].title, { exact: true })).toBeVisible();
});

test("fixture / desktop: empty search observes cold and stale caches, and offers exactly the first three due items", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.clock.install({ time: new Date("2026-10-08T10:00:00+05:30") });
  const firm = await firstFirm(client(request));
  const items = fixtureItems(firm);
  const calls = await fixtureDue(page, items);
  await page.goto(`/sales?firm=${firm.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Sales", exact: true })).toBeVisible();
  let dialog = await search(page, info.project.name);
  await expect(dialog.getByText("Needs attention", { exact: true })).toHaveCount(0);
  expect(calls).toHaveLength(0);
  await page.keyboard.press("Escape");
  await bell(page).click();
  await expect(page.getByRole("dialog", { name: "Needs attention", exact: true }).getByRole("link")).toHaveCount(4);
  await page.keyboard.press("Escape");
  await page.clock.runFor(61_000);
  dialog = await search(page, info.project.name);
  await expect(dialog.getByText("Needs attention", { exact: true })).toBeVisible();
  for (const item of items.slice(0, 3)) await expect(dialog.getByRole("option", { name: new RegExp(esc(item.title)) })).toBeVisible();
  await expect(dialog.getByRole("option", { name: new RegExp(esc(items[3].title)) })).toHaveCount(0);
  expect(calls).toHaveLength(1);
  await dialog.getByRole("option", { name: new RegExp(esc(items[1].title)) }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/purchases/inbox");
  await expect(dialog).toBeHidden();
  expect(calls).toHaveLength(1);
});

test("fixture / phone: tabs read the active firm's cached counts without making a due request", async ({ page, request }, info) => {
  test.skip(info.project.name !== "phone");
  const firm = await firstFirm(client(request));
  const calls = await fixtureDue(page, fixtureItems(firm));
  await page.goto(`/sales?firm=${firm.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(tabs(page).getByRole("link", { name: "Capture", exact: true })).toBeVisible();
  await expect(tabs(page).getByRole("link", { name: "Bills", exact: true })).toBeVisible();
  await expect(tabs(page).getByRole("link", { name: "Home", exact: true })).toBeVisible();
  expect(calls).toHaveLength(0);
  await tabs(page).getByRole("link", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(tabs(page).getByRole("link", { name: "Capture, 4 waiting", exact: true })).toBeVisible();
  await expect(tabs(page).getByRole("link", { name: "Bills, 2 not sent", exact: true })).toBeVisible();
  await expect(tabs(page).getByRole("link", { name: "Home, a return due soon is blocked", exact: true })).toBeVisible();
  expect(calls).toHaveLength(1);
  await tabs(page).getByRole("link", { name: "Bills, 2 not sent", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/sales");
  await opened(page);
  await expect(tabs(page).getByRole("link", { name: "Capture, 4 waiting", exact: true })).toBeVisible();
  expect(calls).toHaveLength(1);
});

test("real API / desktop and phone: Send updates the visible dashboard row, due-next and the bell or tab immediately", async ({ page, request }, info) => {
  test.slow(); // PDF generation can take more than 60 s on a shared runner.
  const api = client(request);
  const bill = await newBill(api);
  // No external chat/share sheet opens; PDF generation and POST sales/:id/sent/ remain real.
  await page.addInitScript(() => {
    window.__dueOpened = [];
    window.open = (url) => { window.__dueOpened.push(String(url)); return { opener: null, closed: false }; };
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
  });
  const firstDue = page.waitForResponse((r) => dueResponse(r) && new URL(r.url()).searchParams.get("business_id") === String(bill.business));
  await expertHome(page, bill.business);
  const before = await (await firstDue).json();
  expect(unsentCount(before)).toBeGreaterThan(0);
  const send = page.getByRole("button", { name: `Send ${bill.number} on WhatsApp`, exact: true });
  await expect(send).toBeEnabled();
  const refreshed = page.waitForResponse((r) => dueResponse(r) && new URL(r.url()).searchParams.get("business_id") === String(bill.business), { timeout: 90_000 });
  const recorded = page.waitForResponse((r) => r.request().method() === "POST" && pathname(r) === `/api/sales/${bill.id}/sent/`, { timeout: 90_000 });
  await send.click();
  expect((await recorded).ok()).toBe(true);
  const after = await (await refreshed).json();
  expect(unsentCount(after)).toBe(unsentCount(before) - 1);
  await expect(page.getByRole("button", { name: new RegExp(`^Sent .*\\. Options for ${esc(bill.number)}$`) })).toBeVisible();
  await expect(send).toHaveCount(0);
  expect((await api.get(`sales/${bill.id}/`)).sent).toMatchObject({ via: "whatsapp" });
  expect(await page.evaluate(() => window.__dueOpened)).toEqual([expect.stringMatching(/^https:\/\/wa\.me\/91\d{10}\?text=/)]);
  if (info.project.name === "phone") {
    await expect(tabs(page).getByRole("link", { name: unsentCount(after) ? `Bills, ${unsentCount(after)} not sent` : "Bills", exact: true })).toBeVisible();
  } else {
    await expect(bell(page)).toHaveAccessibleName(after.items.length ? `Needs attention: ${after.items.length}` : "Nothing needs attention");
    await bell(page).click();
    const sheet = page.getByRole("dialog", { name: "Needs attention", exact: true });
    const remaining = after.items.find((item) => item.kind === "unsent");
    if (remaining) await expect(sheet.getByText(remaining.title, { exact: true })).toBeVisible();
    else await expect(sheet.getByText(/of today's bills? ha(?:sn't|ven't) been sent/)).toHaveCount(0);
  }
});

test("real API / desktop and phone: ten idle minutes on Today make no API requests", async ({ page, request }) => {
  await page.clock.install({ time: new Date() });
  const traffic = apiTraffic(page);
  const firm = await firstFirm(client(request));
  const initialDue = page.waitForResponse(dueResponse);
  const initialDashboard = page.waitForResponse(dashboardResponse);
  await expertHome(page, firm);
  expect((await initialDue).ok()).toBe(true);
  expect((await initialDashboard).ok()).toBe(true);
  await traffic.settled();
  traffic.sent.length = 0;
  await page.clock.runFor(10 * 60_000);
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
  await traffic.settled();
  expect(traffic.sent).toEqual([]);
  await expect(page.getByRole("heading", { level: 1, name: "Today", exact: true })).toBeVisible();
});

for (const theme of ["obsidian", "pearl"]) {
  test(`fixture / desktop and phone: attention surfaces pass WCAG 2.2 AA in ${theme}`, async ({ page, request }, info) => {
    const firm = await firstFirm(client(request));
    await fixtureDue(page, fixtureItems(firm));
    await page.addInitScript((chosen) => localStorage.setItem("gst3.theme", chosen), theme);
    await expertHome(page, firm);
    await expect(page.locator("html")).toHaveClass(theme === "obsidian" ? "" : `theme-${theme}`);
    // This also measures the phone's three badges in the shell.
    expect(await measure(page)).toEqual([]);
    if (info.project.name === "desktop") {
      await bell(page).click();
      await expect(page.getByRole("dialog", { name: "Needs attention", exact: true })).toBeVisible();
      expect(await measure(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Needs attention", exact: true })).toBeHidden();
    }
    const dialog = await search(page, info.project.name);
    await expect(dialog.getByText("Needs attention", { exact: true })).toBeVisible();
    expect(await measure(page)).toEqual([]);
  });
}

// The real idle test deliberately keeps a dashboard screen mounted. Additional unit
// integration tests in 5D Task 3 must cover every part 1–3 mutation, all stale scopes,
// inactive observers, failures and local sent-row patching while a refetch is delayed.
// These E2E tests do not pretend a single sales send covers purchase/capture/GST writes.
// Easy Home warms this same cache only after 6D (X-22); that integration is 6D's test.
// Unverified integration assumptions until predecessors land:
// - 5B uses the design's Today h1, phoneSearch and /?firm= scope handling.
// - 5B asks scoped due-next on opening and reuses the existing SendCell for today's rows.
// - 5A supplies contract-shaped dashboard/due-next responses and omits unsent at zero.
// - The assigned owner's seeded account has at least one firm and a non-walk-in customer
//   among the first 50 with a valid Indian mobile (newBill/someCustomer check this).
// Existing helpers and their named exports were checked in source at 7597a321.
// No assumption is made that 5B adds a particular loading-state DOM marker.
