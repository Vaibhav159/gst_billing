// What the bill form's specs share (part 1D): a product to bill, a row of an open list picked by keyboard, last month,
// the bills the form saves (to the bin after the test, as newBill's), and the unfinished bills a run that failed half-way
// leaves behind. Records are read at run time, never seed ids.
const { expect } = require("@playwright/test");
const { client, esc, noteBill } = require("./sales-data");

/** A product to put on a bill: one with an HSN code and a GST rate, 3% where there is one (CI's Gold Ornaments). */
async function aProduct(api) {
  const { results } = await api.get("products/", { page_size: 200, ordering: "name" });
  const usable = results.filter((p) => /^\d{4,8}$/.test(p.hsn_code || "") && Number(p.gst_tax_rate) > 0);
  const p = usable.find((x) => Number(x.gst_tax_rate) === 0.03) ?? usable[0];
  expect(p, "a product with an HSN code and a GST rate").toBeTruthy();
  return p;
}

/**
 * Picks the row named `name` in the list of the focused box, by keyboard: Arrow Down to it from the first row, then
 * Enter. The box names its list once it has rows (while it searches, it only says so); only that list's rows count (the
 * form's selects, the firm and the units, have options too); and a row's first line is its name (the line under it says
 * more), so a name that starts another's ("Gold Ornaments 18K") isn't taken for it.
 */
async function pickByKeyboard(page, name) {
  const box = page.locator(":focus");
  await expect(box).toHaveAttribute("aria-expanded", "true");
  const list = page.locator(`[id="${await box.getAttribute("aria-controls")}"]`);
  await expect(list.getByRole("option", { name: new RegExp(`^${esc(name)}`) }).first()).toBeVisible();
  const rows = await list.getByRole("option").allInnerTexts();
  const at = rows.findIndex((t) => t.split("\n")[0].trim() === name);
  expect(at, `a row named ${name} in ${JSON.stringify(rows)}`).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < at; i += 1) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
}

/** The customer, the product and its weight (2) typed in by keyboard, from the focused customer box. */
async function typeBill(page, { customer, product }) {
  await page.keyboard.type(customer.name);
  await pickByKeyboard(page, customer.name);
  await expect(page.getByRole("combobox", { name: "Line 1 product" })).toBeFocused();
  await page.keyboard.type(product.name);
  await pickByKeyboard(page, product.name);
  await expect(page.getByRole("textbox", { name: /^Line 1 (weight|quantity) in / })).toBeFocused();
  await page.keyboard.type("2");
}

/** "YYYY-MM", n months before the month of the ISO date `iso`. */
function monthBefore(iso, n = 1) {
  const [y, m] = iso.split("-").map(Number);
  const t = y * 12 + (m - 1) - n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** "Anil Gupta's", "Kapoor & Sons'": a name's possessive as the app says it (web/src/core/format.ts possessive). */
function possessive(name) {
  const n = name.trimEnd();
  return /['’]s$/i.test(n) ? n : /s$/i.test(n) ? `${n}'` : `${n}'s`;
}

/**
 * Notes each bill `page` saves (POST sales/ answered 201) as the server answers, so makesBills sends it to the bin after
 * the test: one saved just before a failure or a timeout is never left live.
 */
function notesSavedBills(page) {
  page.on("response", async (r) => {
    if (r.request().method() !== "POST" || new URL(r.url()).pathname !== "/api/sales/" || r.status() !== 201) return;
    const bill = await r.json();
    noteBill(bill.id, bill.invoice_number);
  });
}

/** The id in /sales/{id}?saved=new, once the saved bill's page is showing. */
async function savedId(page) {
  await page.waitForURL(/\/sales\/\d+\?saved=new/);
  return Number(new URL(page.url()).pathname.split("/")[2]);
}

/** Deletes the unfinished bills this person started since `since` (a Date): a run that fails half-way leaves one. */
async function cleanDrafts(api, since) {
  const me = await api.get("me/");
  const { results } = await api.get("drafts/");
  for (const d of results) {
    if (d.started_by?.id === me.id && Date.parse(d.created_at) >= since.getTime() - 1000) await api.del(`drafts/${d.id}/`);
  }
}

/** `page`'s writes to the shop's list of unfinished bills still on their way (a Set that empties as each lands or fails). */
function draftWrites(page) {
  const out = new Set();
  page.on("request", (r) => { if (r.method() !== "GET" && new URL(r.url()).pathname.startsWith("/api/drafts/")) out.add(r); });
  for (const settled of ["requestfinished", "requestfailed"]) page.on(settled, (r) => out.delete(r));
  return out;
}

/**
 * Leaves the bill form on `page` and waits for its last writes to the shop's list (`writes`, from draftWrites) to land:
 * a form keeps a change 1.2 s after it, and as it's left, so a keep still waiting could otherwise land after a cleanup.
 */
async function leaveForm(page, writes) {
  if (page.isClosed()) return;
  await page.goto("about:blank");
  await expect.poll(() => writes.size, { message: "the page's last writes of its unfinished bill" }).toBe(0);
}

/**
 * For a file whose tests type in the bill form, called at its top level: after each test, its page leaves the form and
 * the unfinished bills its user started during the test are deleted (a bill saved took its own with it). A test.afterEach,
 * as makesBills: a test that times out has its request disposed before a finally could use it.
 */
function startsDrafts(test) {
  let since = null;
  let writes = null;
  test.beforeEach(({ page }) => { since = new Date(); writes = draftWrites(page); });
  test.afterEach(async ({ page, request }, info) => {
    const from = since;
    since = null;
    if (!from || info.status === "skipped") return;
    await leaveForm(page, writes);
    await cleanDrafts(client(request), from);
  });
}

module.exports = { aProduct, pickByKeyboard, typeBill, monthBefore, possessive, notesSavedBills, savedId, cleanDrafts, draftWrites, leaveForm, startsDrafts };
