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

/** Saves whose answer is still being read: each note is taken here as the answer comes, and settles once read. */
const noting = new Set();

/**
 * Notes each bill `page` saves (POST sales/ answered 201), so makesBills sends it to the bin after the test. The note is
 * taken the moment the answer comes (its id is in the body, still to be read), and startsDrafts waits for every note
 * still being read before makesBills empties its list, so a bill saved just before a failure or a timeout goes to the bin
 * too. A page closed meanwhile can't throw inside the listener.
 */
function notesSavedBills(page) {
  page.on("response", (r) => {
    if (r.request().method() !== "POST" || new URL(r.url()).pathname !== "/api/sales/" || r.status() !== 201) return;
    const note = r.json().then((bill) => noteBill(bill.id, bill.invoice_number)).catch(() => {}).finally(() => noting.delete(note));
    noting.add(note);
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
 * Leaves the bill form on `page` so that nothing it does afterwards can make an unfinished bill: the bills it saved are
 * noted first; then its writes to the shop's list are stopped (a route aborts them, reads go through); the writes already
 * on their way (`writes`, from draftWrites) land; and it goes to about:blank. Stopped, because leaving is itself what fires
 * a keep: the form keeps a change it hadn't kept yet on pagehide, and page.on("request") never sees that request.
 */
async function leaveForm(page, writes) {
  await Promise.all([...noting]);
  if (page.isClosed()) return;
  await page.route("**/api/drafts/**", (r) => (r.request().method() === "GET" ? r.fallback() : r.abort()));
  await expect.poll(() => writes.size, { message: "the page's writes of its unfinished bill already on their way" }).toBe(0);
  await page.goto("about:blank");
}

/**
 * For a file whose tests type in the bill form, called at its top level before makesBills and typesPassword (afterEach
 * hooks run in the order they're declared): after each test, the bills its page saved are noted before makesBills empties
 * its list, the page leaves the form (leaveForm) before typesPassword would move it, and the unfinished bills its user
 * started during the test are deleted (a bill saved took its own with it). A test.afterEach, as makesBills: a test that
 * times out has its request disposed before a finally could use it.
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
