// Plan 6C's producer integration (X-40); browser, axe and screenshots run at acceptance only (X-76).
// Uses the authenticated sandbox and existing records. UI/API-created bills go to the bin; all test drafts are removed.
const { test, expect } = require("@playwright/test");
const { opened } = require("./session");
const { afterDialog, client, esc, firstFirm, makesBills, newBill, someCustomer, today } = require("./sales-data");
const { aProduct, notesSavedBills, startsDrafts } = require("./bill-form-data");
const { measure } = require("./axe");

// Restore the browser's network before draft cleanup stops writes and leaves the page.
test.afterEach(async ({ context }) => { await context.setOffline(false); });
startsDrafts(test);
makesBills(test);
test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "Easy's bill flow is for phones");
  notesSavedBills(page);
});

async function records(page, request) {
  const api = client(request);
  const [firm, customer, me] = await Promise.all([firstFirm(api), someCustomer(api), api.get("me/")]);
  await page.addInitScript(({ id, firmId }) => { localStorage.setItem(`gst3.easy.firm.${id}`, String(firmId)); }, { id: me.id, firmId: firm.id });
  return { api, firm, customer, me };
}

async function chooseCustomer(page, customer) {
  await expect(page.getByRole("heading", { name: "Who is buying?" })).toBeVisible();
  await opened(page);
  await page.getByLabel("Search by name or phone").fill(customer.name);
  await page.getByRole("button", { name: new RegExp(`^${esc(customer.name)}`) }).first().click();
  await expect(page).toHaveURL((url) => url.pathname === "/e/new/items");
  await opened(page);
}

async function begin(page, customer) {
  await page.goto("/e/new");
  await chooseCustomer(page, customer);
}

async function pickProduct(page, api) {
  const product = await aProduct(api);
  expect(Number(product.gst_tax_rate), "the seeded jewellery product uses GST 3%").toBe(0.03);
  expect(product.default_unit || "gms", "the seeded jewellery product is weighed in grams").toMatch(/^(gms|g)$/);
  // Opening the rest also works when the required item is one of the six main chips.
  await page.getByRole("button", { name: "Something else", exact: true }).click();
  await page.getByRole("button", { name: product.name, exact: true }).click();
  await expect(page.getByLabel("Weight in grams")).toBeFocused();
  return product;
}

async function fillGrams(page, weight = "12.345", rate = "6512.50") {
  const rateBox = page.getByLabel("Rate per gram, as on the paper bill");
  await expect(rateBox).toHaveValue("");
  await expect(page.getByText("Making is included in this rate.", { exact: true })).toBeVisible();
  await page.getByLabel("Weight in grams").fill(weight);
  await page.getByLabel("Weight in grams").press("Enter");
  await expect(rateBox).toBeFocused();
  await rateBox.fill(rate);
}

async function review(page) {
  await page.getByRole("button", { name: "Check and save", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Check the bill", exact: true });
  await expect(sheet).toBeVisible();
  await afterDialog(page);
  return sheet;
}

async function acknowledge(sheet, except = "") {
  for (const checkbox of await sheet.getByRole("checkbox").all()) {
    if (except && (await checkbox.evaluate((el) => el.labels?.[0]?.textContent || "")).includes(except)) continue;
    await checkbox.check();
  }
}

async function save(page, sheet, api) {
  await acknowledge(sheet);
  const answer = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/sales/");
  await sheet.getByRole("button", { name: /^Save bill / }).click();
  const response = await answer;
  expect(response.status(), await response.text()).toBe(201);
  const made = await response.json();
  // notesSavedBills calls noteBill and protects a save that completes immediately before a test fails.
  await expect(page).toHaveURL(new RegExp(`/e/saved/${made.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: /^Bill .+ saved$/ })).toBeVisible();
  return api.get(`sales/${made.id}/`);
}

test("Easy: the paper rate stays blank until typed and saves the server's exact total", async ({ page, request }) => {
  const { api, customer, firm } = await records(page, request);
  await begin(page, customer);
  await expect(page.getByRole("button", { name: "Pick what they're buying" })).toBeVisible();
  const product = await pickProduct(page, api);
  await fillGrams(page);
  await expect(page.getByLabel("Making charges", { exact: false })).toHaveCount(0);
  await page.getByRole("radio", { name: /^UPI/ }).click();
  const sheet = await review(page);
  await expect(sheet.getByText("₹82,808.71", { exact: true }).first()).toBeVisible();
  await expect(sheet).toContainText("as on the paper bill.");
  const bill = await save(page, sheet, api);
  expect(bill).toMatchObject({ business: firm.id, customer: expect.objectContaining({ id: customer.id }), invoice_date: today(), paper: false,
    payment_mode: "bank", total_amount: "82808.71", lines: [expect.objectContaining({ product_name: product.name, quantity: "12.345" })] });
  await expect(page.getByRole("button", { name: "Make another bill" })).toBeVisible();
});

test("Easy: exactly two lakh in cash is stopped and Part cash needs its confirmation", async ({ page, request }) => {
  const { api, customer } = await records(page, request);
  await begin(page, customer); await pickProduct(page, api);
  // Taxable 194174.76 + 3% split tax 5825.24 = 200000.00, using the shared server rounding.
  await fillGrams(page, "1.000", "194174.757");
  await page.getByRole("radio", { name: "Cash", exact: true }).click();
  await expect(page.getByText("Cash can't be ₹2 lakh or more on one bill. Take at least ₹0.01 by UPI and choose Part cash.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check and save", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Choose Part cash", exact: true }).click();
  const sheet = await review(page);
  await acknowledge(sheet, "The cash taken is under ₹2,00,000");
  const submit = sheet.getByRole("button", { name: /^Save bill / });
  await expect(submit).toBeDisabled();
  await sheet.getByRole("checkbox", { name: "The cash taken is under ₹2,00,000" }).check();
  await expect(submit).toBeEnabled();
  const bill = await save(page, sheet, api);
  expect(bill).toMatchObject({ total_amount: "200000.00", payment_mode: "mixed" });
});

test("Easy: an earlier paper day drives the number, historical board, draft resume and save", async ({ page, request }) => {
  const { api, firm, customer } = await records(page, request);
  const [y, m, d] = today().split("-").map(Number);
  const prior = new Date(Date.UTC(y, m - 1, d - 1));
  const day = `${prior.getUTCFullYear()}-${String(prior.getUTCMonth() + 1).padStart(2, "0")}-${String(prior.getUTCDate()).padStart(2, "0")}`;
  const book = await api.get("sales/paper-book/", { business_id: firm.id, month: day.slice(0, 7) });
  test.skip(book.locked, "the sandbox's previous day belongs to a filed month");
  const asked = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) asked.push({ path: u.pathname, query: Object.fromEntries(u.searchParams) }); });
  await begin(page, customer); await pickProduct(page, api);
  await page.getByRole("button", { name: /^Bill number/ }).click();
  const number = page.getByRole("dialog", { name: "Bill number", exact: true });
  await afterDialog(page);
  await number.getByRole("switch", { name: "A bill from an earlier day" }).click();
  await number.getByLabel("Date on the paper bill", { exact: true }).fill(`${day.slice(8)}/${day.slice(5, 7)}/${day.slice(0, 4)}`);
  await number.getByLabel("Date on the paper bill", { exact: true }).press("Tab");
  await expect(number.getByLabel("Number on the paper bill", { exact: true })).not.toHaveValue("");
  // Ruling P6-7: a paper (earlier-day) bill's suggested number is the paper book's next counter for month(D).
  await expect(number.getByLabel("Number on the paper bill", { exact: true })).toHaveValue(String(book.next.counter));
  await number.getByRole("button", { name: "Done", exact: true }).click();
  const kept = page.waitForResponse((r) => {
    if (r.request().method() !== "PUT" || !new URL(r.url()).pathname.startsWith("/api/drafts/")) return false;
    const data = r.request().postDataJSON()?.data;
    return data?.date === day && data?.paper === true && data?.lines?.some((line) => line.qty === 12.345 && line.rate === "6512.50");
  });
  await fillGrams(page);
  const draftResponse = await kept;
  expect(draftResponse.ok()).toBe(true);
  const draft = await draftResponse.json();
  expect(draft.data).toMatchObject({ date: day, paper: true });
  await expect(page).toHaveURL((url) => url.searchParams.get("draft") === draft.id);
  expect(asked.some((r) => r.path === "/api/rates/" && r.query.date === day)).toBe(true);
  expect(asked.some((r) => r.path === "/api/sales/next-number/" && r.query.invoice_date === day)).toBe(true);
  expect(asked.some((r) => r.path === "/api/sales/paper-book/" && r.query.month === day.slice(0, 7))).toBe(true);
  await page.goto(`/e/new/items?draft=${draft.id}`);
  await expect(page.getByLabel("Weight in grams")).toHaveValue("12.345");
  await expect(page.getByLabel("Rate per gram, as on the paper bill")).toHaveValue("6,512.50");
  await opened(page); await page.getByRole("radio", { name: /^UPI/ }).click();
  const bill = await save(page, await review(page), api);
  expect(bill).toMatchObject({ invoice_date: day, paper: true, total_amount: "82808.71" });
  // Ruling P6-4: the saved paper bill is never asked to be sent; Print and Make another bill lead.
  await expect(page.getByRole("button", { name: "Print", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Make another bill" })).toHaveAttribute("data-variant", "primary");
  await expect(page.getByRole("button", { name: "Send the bill" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Send the bill" })).toHaveAttribute("data-variant", "ghost");
});

test("Easy: Wrong customer remake keeps the lines and records replaces after choosing the buyer", async ({ page, request }) => {
  const { api, firm, customer } = await records(page, request);
  const { results } = await api.get("customers/", { page_size: 50 });
  const wrong = results.find((c) => c.id !== customer.id && c.type === "walkin");
  test.skip(!wrong, "this fixture needs an existing walk-in and a named customer; it creates no customer");
  const original = await newBill(api, { firm, customer: wrong, rate: "6512.50" });
  await api.post(`sales/${original.id}/cancel/`, { reason: "Wrong customer" });
  await page.goto(`/e/bill/${original.id}`);
  await expect(page.getByRole("button", { name: "Make it again", exact: true })).toBeVisible();
  await opened(page); await page.getByRole("button", { name: "Make it again", exact: true }).click();
  await chooseCustomer(page, customer);
  await expect(page.getByLabel("Weight in grams")).toHaveValue("1.000");
  await expect(page.getByLabel("Rate per gram, as on the paper bill")).toHaveValue("6,512.50");
  const posted = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/sales/");
  const bill = await save(page, await review(page), api);
  expect((await posted).postDataJSON().replaces).toBe(original.id);
  expect(bill).toMatchObject({ replaces: expect.objectContaining({ id: original.id }), customer: expect.objectContaining({ id: customer.id }) });
});

test("Easy: a loose diamond stays on this bill only and saves carats at 0.25 percent", async ({ page, request }) => {
  const { api, customer } = await records(page, request);
  await begin(page, customer);
  await page.getByRole("button", { name: "Not in the list? Add it", exact: true }).click();
  const item = page.getByRole("dialog", { name: "Add an item that isn't in the list" });
  await afterDialog(page);
  await item.getByLabel("What is it called?").fill(`Loose diamond E2E ${Date.now()}`);
  await item.getByRole("button", { name: "Diamond", exact: true }).click();
  await item.getByRole("radio", { name: /^Loose diamonds/ }).click();
  await expect(item.getByRole("checkbox", { name: /^Also keep it in the item list/ })).not.toBeChecked();
  await item.getByRole("button", { name: "Add to the bill", exact: true }).click();
  await expect(item).toBeHidden();
  await expect(page.getByLabel("Rate per carat, as on the paper bill")).toHaveValue("");
  await page.getByLabel("Weight in carats").fill("2.000");
  await page.getByLabel("Rate per carat, as on the paper bill").fill("1000");
  await page.getByRole("radio", { name: /^UPI/ }).click();
  const bill = await save(page, await review(page), api);
  expect(bill).toMatchObject({ total_amount: "2005.00", lines: [expect.objectContaining({ hsn_code: "7102", unit: "ct", quantity: "2.000" })] });
  expect(Number(bill.lines[0].gst_percent)).toBe(0.25);
});

test("Easy: offline Save is disabled while the unfinished bill and values stay on the phone", async ({ page, context, request }) => {
  const { api, customer } = await records(page, request);
  await begin(page, customer); await pickProduct(page, api); await fillGrams(page);
  await page.getByRole("radio", { name: /^UPI/ }).click();
  const sheet = await review(page); await acknowledge(sheet);
  await context.setOffline(true);
  await expect(sheet.getByText("You're offline. Your bill is kept on this phone; save it when the internet is back.")).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Save bill / })).toBeDisabled();
  await sheet.getByRole("button", { name: "Change something", exact: true }).click();
  await expect(page.getByLabel("Weight in grams")).toHaveValue("12.345");
  await expect(page.getByLabel("Rate per gram, as on the paper bill")).toHaveValue("6,512.50");
});

test("Easy: a synthetic viewer cannot pick a customer or start a write", async ({ page, request }) => {
  const { me } = await records(page, request);
  const writes = [];
  await page.route("**/api/me/", (route) => route.fulfill({ json: { ...me, role: "viewer", role_label: "View only", permissions: ["view"], needs_role_choice: false } }));
  await page.addInitScript(() => localStorage.removeItem("gst3.me"));
  page.on("request", (r) => { const path = new URL(r.url()).pathname; if (r.method() !== "GET" && (/^\/api\/(sales|drafts|customers|products)\//).test(path)) writes.push(path); });
  await page.goto("/e/new");
  await expect(page.getByRole("heading", { name: "Who is buying?" })).toBeVisible();
  await opened(page);
  await expect(page.getByRole("button", { name: /^Walk-in customer/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "New customer", exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("Easy: both themes at 320 and 390 px keep Step 1, items and review accessible", async ({ page, request }, info) => {
  test.setTimeout(240_000);
  const { api, customer } = await records(page, request);
  for (const theme of ["obsidian", "pearl"]) for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    // Set the theme in the current origin; the next full navigation reads it before paint.
    await page.goto("/e");
    await page.evaluate((value) => localStorage.setItem("gst3.theme", value), theme);
    await page.goto("/e/new");
    await expect(page.getByRole("heading", { name: "Who is buying?" })).toBeVisible();
    await expect(page.locator("html")).toHaveClass(theme === "obsidian" ? "" : `theme-${theme}`);
    expect(await measure(page)).toEqual([]);
    await chooseCustomer(page, customer); await pickProduct(page, api); await fillGrams(page);
    expect(await measure(page)).toEqual([]);
    await page.screenshot({ path: info.outputPath(`easy-items-${theme}-${width}.png`), fullPage: true });
    await page.getByRole("radio", { name: /^UPI/ }).click();
    const sheet = await review(page);
    expect(await measure(page)).toEqual([]);
    await page.screenshot({ path: info.outputPath(`easy-review-${theme}-${width}.png`), fullPage: true });
    await sheet.getByRole("button", { name: "Change something", exact: true }).click();
  }
});
