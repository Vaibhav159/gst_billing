const { test, expect } = require("@playwright/test");
const { opened } = require("./session");
const { client, newBill, someCustomer, makesBills, afterDialog, today, esc } = require("./sales-data");
const { measure } = require("./axe");

const FIRM_NAME = "TEST EASY FIRM (e2e)";
let modeBefore;
let customersMade = [];
let customerNameOnSave = null;

async function easyFirm(api) {
  const firms = (await api.get("businesses/", { page_size: 100 })).results;
  return firms.find((firm) => firm.name === FIRM_NAME) || api.post("firms/", {
    name: FIRM_NAME, short_name: "Test Easy", address: "1 Synthetic Test Road, Jaipur, Rajasthan",
    city: "Jaipur", pin_code: "302001", gst_number: "08AAACE7777A1ZO", mobile_number: "9999999996",
    email: "", invoice_prefix: "TE", paper_full_number_from: null,
    bank_name: "", bank_account_number: "", bank_ifsc_code: "", bank_branch_name: "",
    jurisdiction: "Jaipur", declaration: "", signature_on_bills: false,
  });
}

async function chooseInitially(page, api, firm, welcome = true) {
  const me = await api.get("me/");
  await page.addInitScript(({ id, firmId, hideWelcome }) => {
    if (sessionStorage.getItem("easy-everyday-init")) return;
    sessionStorage.setItem("easy-everyday-init", "1");
    localStorage.setItem(`gst3.easy.firm.${id}`, JSON.stringify(firmId));
    localStorage.removeItem(`gst3.prefs.${id}`);
    if (hideWelcome) localStorage.setItem(`gst3.easy.welcomed.${id}`, "true");
    else localStorage.removeItem(`gst3.easy.welcomed.${id}`);
  }, { id: me.id, firmId: firm.id, hideWelcome: welcome });
}

const tabs = (page) => page.getByRole("navigation", { name: "Tabs" });
const tab = (page, name) => tabs(page).getByRole("link", { name: new RegExp(`^${name}(,|$)`) });
const apiRequest = (request) => new URL(request.url()).pathname.startsWith("/api/");
const newMobile = (offset = 0) => `98${String((Date.now() + offset) % 100000000).padStart(8, "0")}`;
async function loaded(page, path, title) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  await opened(page);
}

test.beforeEach(async ({ request }, info) => {
  test.skip(info.project.name !== "phone", "Everyday phone pages");
  const api = client(request);
  modeBefore = (await api.get("preferences/")).data.phoneMode;
  await api.patch("preferences/", { phoneMode: "easy" });
  customersMade = [];
  customerNameOnSave = null;
});

// Remove bills before attempting to delete any customer. Keep cleanup in hooks, including a timeout.
makesBills(test);
test.afterEach(async ({ request, context }, info) => {
  if (info.project.name !== "phone") return;
  await context.setOffline(false);
  const api = client(request);
  const failures = [];
  if (customerNameOnSave) {
    try {
      const rows = (await api.get("customers/", { search: customerNameOnSave })).results;
      customersMade.push(...rows.filter((c) => c.name === customerNameOnSave).map((c) => c.id));
    } catch (error) { failures.push(`customer lookup: ${String(error)}`); }
  }
  for (const id of new Set(customersMade)) {
    try { await api.del(`customers/${id}/`); } catch (error) { failures.push(`customer ${id}: ${String(error)}`); }
  }
  try { await api.patch("preferences/", { phoneMode: modeBefore ?? null }); }
  catch (error) { failures.push(`phone mode restore: ${String(error)}`); }
  expect(failures, "temporary customer cleanup").toEqual([]);
});

test("a fresh Easy-only visit populates scoped badges and stays idle for one minute", async ({ page, request }) => {
  const api = client(request), firm = await easyFirm(api);
  await newBill(api, { firm });
  await chooseInitially(page, api, firm, false);
  await page.clock.install({ time: new Date(`${today()}T18:30:00+05:30`) });
  const requests = [];
  page.on("request", (r) => { if (apiRequest(r)) requests.push({ method: r.method(), url: new URL(r.url()) }); });
  const dueReply = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/due-next/");
  await page.goto("/e");
  const due = await (await dueReply).json();
  const count = due.items.find((item) => item.kind === "unsent")?.count ?? 0;
  expect(count).toBeGreaterThanOrEqual(1);
  await expect(page.getByRole("heading", { name: "Welcome to Easy mode" })).toBeVisible();
  await opened(page);
  await page.getByRole("button", { name: "Got it", exact: true }).click();
  await expect(tab(page, "Bills")).toHaveAccessibleName(new RegExp(`Bills.*${count}`));
  await expect(page.locator('section[aria-label="End of the day"]')).toContainText(`${count} not sent`);
  expect(requests.filter((r) => r.url.pathname === "/api/due-next/").map((r) => r.url.searchParams.get("business_id"))).toEqual([String(firm.id)]);
  expect(requests.some((r) => r.url.pathname === "/api/dashboard/")).toBe(false);
  await page.waitForLoadState("networkidle");
  const before = requests.length;
  await page.clock.fastForward(60_000);
  expect(requests).toHaveLength(before);
  await tab(page, "More").click();
  await expect(page.getByRole("heading", { name: "More", exact: true })).toBeVisible();
  await tab(page, "Home").click();
  await expect(page.getByRole("heading", { name: "Welcome to Easy mode" })).toHaveCount(0);
});

test("121 unsent bills are gathered before first send; rows 1, 51 and 121 remain sendable", async ({ page, request }) => {
  test.setTimeout(180_000);
  const api = client(request), firm = await easyFirm(api), customer = await someCustomer(api);
  const before = await api.get("sales/", { business_id: firm.id, start_date: today(), end_date: today(), unsent: 1, page_size: 1 });
  expect(before.count, "the test firm has no uncleaned unsent bills from an earlier run").toBe(0);
  const made = [];
  for (let i = 0; i < 121; i++) made.push(await newBill(api, { firm, customer }));
  await chooseInitially(page, api, firm);
  await page.clock.install({ time: new Date(`${today()}T18:30:00+05:30`) });
  await page.addInitScript(() => {
    window.__easyActivation = false;
    Object.defineProperty(navigator, "userActivation", { configurable: true, value: { get isActive() { return window.__easyActivation; } } });
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", { configurable: true, value: async () => { window.__easyShares = (window.__easyShares || 0) + 1; } });
    window.open = () => { throw new Error("No external chat should open in this test"); };
  });
  const events = [];
  page.on("request", (r) => { if (apiRequest(r)) events.push({ method: r.method(), url: new URL(r.url()) }); });
  await loaded(page, "/e", FIRM_NAME);
  await expect(page.locator('section[aria-label="End of the day"]')).toContainText("121 not sent");
  await page.getByRole("button", { name: "Send the bills" }).click();
  const sheet = page.getByRole("dialog", { name: "Send today's bills" });
  await expect(sheet.getByRole("button", { name: /^Send bill / })).toHaveCount(121, { timeout: 30_000 });
  await afterDialog(page);
  const labels = await sheet.getByRole("button", { name: /^Send bill / }).evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
  const gathered = events.filter((event) => event.url.pathname === "/api/sales/" && event.url.searchParams.get("unsent") === "1");
  expect(gathered.map((event) => Number(event.url.searchParams.get("page") || "1"))).toEqual([1, 2, 3]);
  for (const event of gathered) {
    expect(event.url.searchParams.get("business_id")).toBe(String(firm.id));
    expect(event.url.searchParams.get("page_size")).toBe("50");
  }
  expect(events.filter((event) => event.method === "POST" && /\/sent\/$/.test(event.url.pathname))).toHaveLength(0);
  for (const index of [0, 50, 120]) {
    const recorded = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/sales\/\d+\/sent\/$/.test(new URL(r.url()).pathname));
    await page.evaluate(() => { window.__easyActivation = false; });
    await sheet.getByRole("button", { name: labels[index], exact: true }).click();
    const ready = page.getByRole("dialog", { name: "Your PDF is ready" });
    await expect(ready).toBeVisible({ timeout: 30_000 });
    await afterDialog(page);
    await page.evaluate(() => { window.__easyActivation = true; });
    await ready.getByRole("button", { name: "Share", exact: true }).click();
    expect((await recorded).ok()).toBe(true);
    await expect(sheet.getByRole("button", { name: labels[index], exact: true })).toHaveCount(0);
  }
  expect(await page.evaluate(() => window.__easyShares)).toBe(3);
  const sentEvents = events.filter((event) => event.method === "POST" && /\/sent\/$/.test(event.url.pathname));
  expect(sentEvents).toHaveLength(3);
  expect(events.indexOf(sentEvents[0])).toBeGreaterThan(events.indexOf(gathered[2]));
  const still = await api.get("sales/", { business_id: firm.id, start_date: today(), end_date: today(), unsent: 1, page_size: 1 });
  expect(still.count).toBe(118);
  expect(made).toHaveLength(121);
});

test("Bills changes periods, ranks the number search, prints, then cancels with the chosen reason", async ({ page, request }) => {
  const api = client(request), firm = await easyFirm(api), bill = await newBill(api, { firm });
  await chooseInitially(page, api, firm);
  await loaded(page, "/e/bills", "Bills");
  for (const [label, key, value] of [["This month", "month", today().slice(0, 7)], ["This year", "fy", (await api.get(`sales/${bill.id}/`)).fy]]) {
    const reply = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/sales/" && new URL(r.url()).searchParams.get(key) === value);
    await page.getByRole("radio", { name: label, exact: true }).click();
    expect((await reply).ok()).toBe(true);
  }
  await page.getByRole("searchbox", { name: "Find a bill by name, phone or number" }).fill(String(bill.counter).padStart(3, "0"));
  await expect(page.locator('[data-row]').first()).toHaveAttribute("href", `/e/bill/${bill.id}`);
  await page.locator(`[data-row="${bill.id}"]`).click();
  await expect(page.getByRole("heading", { name: `Bill ${bill.counter}`, exact: true })).toBeVisible();
  await opened(page);
  await page.getByRole("button", { name: "Print", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/e/bill/${bill.id}/print$`));
  await expect(page.getByRole("document", { name: new RegExp(`^Bill ${esc(bill.number)} on paper`) }).first()).toBeVisible({ timeout: 30_000 });
  await page.goBack();
  await expect(page.getByRole("heading", { name: `Bill ${bill.counter}`, exact: true })).toBeVisible();
  await opened(page);
  await page.getByRole("button", { name: "Made a mistake? Cancel this bill" }).click();
  const dialog = page.getByRole("dialog", { name: `Cancel bill ${bill.counter}?` });
  await expect(dialog).toContainText(bill.customerName);
  await afterDialog(page);
  await dialog.getByRole("button", { name: "Wrong weight or rate" }).click();
  await dialog.getByRole("button", { name: "Cancel this bill", exact: true }).click();
  await expect(page.getByText("This bill is cancelled", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Make it again" })).toBeVisible();
  const cancelled = await api.get(`sales/${bill.id}/`);
  expect(cancelled.status).toBe("cancelled");
  expect(cancelled.cancel_reason).toBe("Wrong weight or rate");
  expect(cancelled.invoice_number).toBe(bill.number);
});

test("a customer is added, opened in the sheet and changed without losing the return route", async ({ page, request }) => {
  const api = client(request), firm = await easyFirm(api);
  await chooseInitially(page, api, firm);
  await loaded(page, "/e/customers", "Customers");
  await page.getByRole("button", { name: "Add a customer" }).click();
  await expect(page.getByRole("heading", { name: "New customer" })).toBeVisible();
  await opened(page);
  const name = `E2E Easy Customer ${Date.now()}`;
  customerNameOnSave = name;
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Mobile number", { exact: true }).fill(newMobile());
  await expect(page.getByLabel("Town or city")).toHaveValue("Jaipur");
  const created = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/customers/");
  await page.getByRole("button", { name: "Save customer", exact: true }).click();
  const createdResponse = await created;
  expect(createdResponse.ok()).toBe(true);
  const customer = await createdResponse.json();
  customersMade.push(customer.id);
  customerNameOnSave = null;
  await expect(page).toHaveURL(/\/e\/customers$/);
  await expect(page.locator(`[data-row="${customer.id}"]`)).toContainText("Just added");
  await opened(page);
  await page.locator(`[data-row="${customer.id}"]`).click();
  const sheet = page.getByRole("dialog", { name });
  await expect(sheet.getByRole("link", { name: /^Call / })).toHaveAttribute("href", /^tel:\+91\d{10}$/);
  await afterDialog(page);
  await sheet.getByRole("link", { name: "Change details" }).click();
  await expect(page).toHaveURL(new RegExp(`/e/customers/${customer.id}/edit$`));
  await opened(page);
  await page.getByLabel("Town or city").fill("Udaipur");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page).toHaveURL(/\/e\/customers$/);
  expect((await api.get(`customers/${customer.id}/`)).city).toBe("Udaipur");
});

test("Show 40 more appends customers and focuses the first added row without returning to the top", async ({ page, request }) => {
  test.setTimeout(120_000);
  const api = client(request), firm = await easyFirm(api), tag = `E2E Easy Page ${Date.now()}`;
  for (let i = 0; i < 45; i++) {
    const customer = await api.post("customers/", { name: `${tag} ${String(i).padStart(2, "0")}`, mobile_number: newMobile(i), city: "Jaipur", address: "", state_name: "RAJASTHAN", gst_number: "", customer_type: "", businesses: [firm.id] });
    customersMade.push(customer.id);
  }
  await chooseInitially(page, api, firm);
  await loaded(page, "/e/customers", "Customers");
  const searched = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/customers/" && new URL(r.url()).searchParams.get("search") === tag);
  await page.getByRole("searchbox", { name: "Find a customer by name or phone" }).fill(tag);
  expect((await searched).ok()).toBe(true);
  await expect(page.locator('[data-row]').first()).toContainText(tag);
  await expect(page.locator('[data-row]')).toHaveCount(40);
  const more = page.getByRole("button", { name: "Show 40 more" });
  await more.scrollIntoViewIfNeeded();
  const scroll = await page.locator("#app-main").evaluate((element) => element.scrollTop);
  // The helper moves focus only when the disappearing Show more button held it.
  await more.focus();
  await more.click();
  await expect(page.locator('[data-row]')).toHaveCount(45);
  await expect(page.locator('[data-row]').nth(40)).toBeFocused();
  expect(await page.locator("#app-main").evaluate((element) => element.scrollTop)).toBeGreaterThanOrEqual(Math.max(1, scroll - 100));
});

test("More keeps this phone's firm after reload; only its explicit switch saves the full view", async ({ page, request }) => {
  const api = client(request), firm = await easyFirm(api), all = (await api.get("businesses/", { page_size: 100 })).results;
  const other = all.find((f) => f.id !== firm.id);
  expect(other, "another firm for the phone-only choice").toBeTruthy();
  await chooseInitially(page, api, firm);
  await loaded(page, "/e/more", "More");
  await page.getByRole("button", { name: /^Firm on this phone/ }).click();
  const firms = page.getByRole("dialog", { name: "Which firm are you billing for?" });
  await afterDialog(page);
  await firms.getByRole("radio", { name: new RegExp(`^${esc(other.name)}`) }).click();
  await expect(page.getByRole("button", { name: /^Firm on this phone/ })).toContainText(other.name);
  await page.reload();
  await expect(page.getByRole("button", { name: /^Firm on this phone/ })).toContainText(other.name);
  expect((await api.get("preferences/")).data.phoneMode).toBe("easy");
  await opened(page);
  await page.getByRole("button", { name: /^Switch to the full view/ }).click();
  await expect(page).toHaveURL(/\/$/);
  expect((await api.get("preferences/")).data.phoneMode).toBe("expert");
});

test("Profile identity and empty password fields stay readable offline", async ({ page, request, context }) => {
  const api = client(request), firm = await easyFirm(api), account = await api.get("account/");
  await chooseInitially(page, api, firm);
  await loaded(page, "/e/profile", "Profile and password");
  await expect(page.getByText(`@${account.username}`, { exact: true })).toBeVisible();
  for (const label of ["Current password", "New password", "New password again"]) await expect(page.getByLabel(label, { exact: true })).toHaveValue("");
  await context.setOffline(true);
  await expect(page.getByText(/You're offline/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Change password" })).toBeVisible();
  await expect(page.getByText(/Forgot your password\?/)).toBeVisible();
});

test("Everyday pages and the offline bill-list frame pass axe at 320 and 390 in both themes", async ({ page, request, context }, info) => {
  test.setTimeout(180_000);
  const api = client(request), firm = await easyFirm(api);
  await chooseInitially(page, api, firm);
  for (const theme of ["obsidian", "pearl"]) for (const width of [320, 390]) {
    await context.setOffline(false);
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript((value) => localStorage.setItem("gst3.theme", value), theme);
    for (const [path, title] of [["/e/bills", "Bills"], ["/e/customers", "Customers"], ["/e/more", "More"], ["/e/profile", "Profile and password"]]) {
      await loaded(page, path, title);
      expect(await measure(page), `${theme} ${width} ${path}`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await loaded(page, "/e/bills", "Bills");
    await context.setOffline(true);
    await page.getByRole("radio", { name: "This month", exact: true }).click();
    await expect(page.getByText("You're offline", { exact: true }).last()).toBeVisible();
    await expect(page.getByRole("button", { name: "New bill", exact: true })).toBeVisible();
    expect(await measure(page), `${theme} ${width} offline Bills`).toEqual([]);
    await page.screenshot({ path: info.outputPath(`easy-bills-offline-${theme}-${width}.png`), fullPage: true });
    await context.setOffline(false);
  }
});
