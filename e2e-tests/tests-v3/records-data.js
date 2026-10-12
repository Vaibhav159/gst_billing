// Only synthetic records made by these tests are removed. Restore every saved field before cleanup,
// including when a test times out: Playwright runs afterEach while request is still available.
const { expect } = require("@playwright/test");
const { client, afterDialog } = require("./sales-data");
const { opened } = require("./session");

const FIRM_FIELDS = ["name", "short_name", "gst_number", "address", "city", "pin_code", "mobile_number", "email",
  "bank_name", "bank_account_number", "bank_ifsc_code", "bank_branch_name", "invoice_prefix",
  "paper_full_number_from", "signature_on_bills", "jurisdiction", "declaration"];
const firmBody = (f) => Object.fromEntries(FIRM_FIELDS.map((key) => [key, f[key]]));
const made = [];
const restoreFirms = new Map();
const restorePrefs = [];
const GSTINS = ["08PQRST1234A1ZB", "08PQRST1235A1ZA", "08PQRST1236A1Z9", "08PQRST1237A1Z8"];
const freshName = (kind) => `ZZ E2E ${kind} ${Date.now()} ${Math.random().toString(36).slice(2, 7)}`;
const noteProduct = (name) => { made.push({ kind: "product", name }); return name; };
const rememberFirm = (firm) => restoreFirms.set(firm.id, firmBody(firm));

async function makeProduct(api) {
  const name = noteProduct(freshName("Product"));
  return api.post("catalog/", { name, hsn_code: "7102", gst_percent: "0.25", unit: "ct",
    kind: "diamond", purity: "VVS", usual_rate: "12500.125", purchase_only: false, description: "Synthetic test product" });
}

async function makeFirm(api) {
  const existing = (await api.get("firms/")).results;
  const gst_number = GSTINS.find((gstin) => !existing.some((f) => f.gst_number === gstin));
  expect(gst_number, "an unused synthetic GSTIN for this test's own firm").toBeTruthy();
  const name = freshName("Firm");
  made.push({ kind: "firm", name });
  return api.post("firms/", { name, short_name: `R${Date.now().toString(36)}`,
    gst_number, address: "1 Synthetic Test Road", city: "Udaipur", pin_code: "313001", mobile_number: "9999999998", email: "",
    bank_name: "Test Bank", bank_account_number: "000111222333", bank_ifsc_code: "TEST0000123", bank_branch_name: "Udaipur",
    invoice_prefix: "", paper_full_number_from: null, signature_on_bills: true, jurisdiction: "", declaration: "" });
}

async function usePersonalFirm(api, id) {
  const before = (await api.get("preferences/")).data;
  restorePrefs.push({ defaultBusinessId: before.defaultBusinessId ?? null });
  await api.patch("preferences/", { defaultBusinessId: String(id) });
}

function cleanRecordsAfter(test) {
  test.afterEach(async ({ page, request }) => {
    const failures = [];
    for (const tab of page.context().pages()) {
      try { tab.once("dialog", (dialog) => { void dialog.accept(); }); await tab.goto("about:blank", { timeout: 10_000 }); } catch (error) { failures.push(`could not leave test page: ${error.message}`); }
    }
    const api = client(request);
    const attempt = async (label, run) => {
      try { await run(); } catch (error) { failures.push(`${label}: ${error.message}`); }
    };
    for (const patch of restorePrefs.splice(0).reverse()) {
      await attempt("restore personal firm", async () => {
        await api.patch("preferences/", patch);
        expect((await api.get("preferences/")).data.defaultBusinessId ?? null).toEqual(patch.defaultBusinessId);
      });
    }
    for (const [id, body] of restoreFirms) {
      await attempt(`restore firm ${id}`, async () => {
        await api.put(`firms/${id}/`, body);
        expect(firmBody(await api.get(`firms/${id}/`))).toEqual(body);
      });
    }
    restoreFirms.clear();
    for (const record of made.splice(0).reverse()) {
      await attempt(`delete synthetic ${record.kind} ${record.name}`, async () => {
        const path = record.kind === "product" ? "catalog/" : "firms/";
        const answer = await api.get(path, record.kind === "product" ? { q: record.name, page_size: 200 } : undefined);
        const matches = answer.results.filter((r) => r.name === record.name);
        for (const match of matches) await api.del(`${path}${match.id}/`);
      });
    }
    expect(failures, `Records cleanup failed:\n${failures.join("\n")}`).toEqual([]);
  });
}

async function openRecord(page, path, title) {
  await page.goto(path);
  await expect(page).toHaveURL((url) => url.pathname === path.split("?")[0]);
  await expect(page.getByRole("heading", { level: 1, ...(title ? { name: title, exact: true } : {}) })).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page.getByText(/^Couldn\'t load /)).toHaveCount(0);
  if (/^\/products\/(new|\d+\/edit)(\?|$)/.test(path)) await expect(page.locator("#pr-name")).toBeVisible();
  if (/^\/firms\/(new|\d+\/edit)(\?|$)/.test(path)) await expect(page.locator("#fm-name")).toBeVisible();
  await opened(page);
}

async function recordMenu(page, name, project) {
  await page.locator("#app-main").getByRole("button", { name: project === "phone" ? `More for ${name}` : "More", exact: true }).click();
  if (project === "phone") await afterDialog(page);
}

module.exports = { FIRM_FIELDS, firmBody, freshName, noteProduct, rememberFirm, makeProduct, makeFirm,
  usePersonalFirm, cleanRecordsAfter, openRecord, recordMenu };
