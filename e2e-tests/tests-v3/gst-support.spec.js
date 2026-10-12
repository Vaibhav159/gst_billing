// Part 3D acceptance. Real reads/exports use the assigned sandbox. The one live write makes its own purchase and
// restores then bins it in afterEach. The explicitly named mocked test never sends its synthetic id to the server.
const fs = require("fs");
const { test, expect } = require("@playwright/test");
const { opened, savedToken } = require("./session");
const { afterDialog, client, today } = require("./sales-data");
const { measure, problems } = require("./axe");
const { perms } = require("../../web/src/core/auth/perms.json");

const REPORTS = [
  ["sales", "Sales register"], ["purchases", "Purchase register"], ["tax", "Tax summary"],
  ["hsn", "HSN summary"], ["customers", "Top customers"], ["products", "Top products"], ["months", "Month by month"],
];
const can = (me, action) => me.permissions === "*" || me.permissions.includes(action);
const rows = (answer) => Array.isArray(answer) ? answer : answer.results;
function financialYear(day = today()) {
  const [year, month] = day.split("-").map(Number), start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
function responseFor(page, path, predicate = () => true) {
  return page.waitForResponse(r => {
    const url = new URL(r.url());
    return url.pathname === `/api/${path}` && r.request().method() === "GET" && predicate(url);
  });
}
async function checked(response) {
  expect(response.ok(), `${new URL(response.url()).pathname} answered ${response.status()}`).toBe(true);
  return response.json();
}
async function context(request) {
  const api = client(request);
  const [me, businesses] = await Promise.all([api.get("me/"), api.get("businesses/", { page_size: 100 })]);
  if (process.env.E2E_ROLE) expect(me.role, "the saved session must belong to E2E_ROLE").toBe(process.env.E2E_ROLE);
  for (const action of ["reports.export", "gst.download", "settings.edit", "purchase.edit"]) {
    const expected = perms[me.role] === "*" || perms[me.role].includes(action);
    expect(can(me, action), `${me.role}'s ${action} must match the shared permission matrix`).toBe(expected);
  }
  const firms = rows(businesses);
  expect(firms.length, "the sandbox needs a firm; no seed id is assumed").toBeGreaterThan(0);
  return { api, me, firms, fy: financialYear() };
}
async function prepare(page, me, theme, fy, firm = "all") {
  await page.addInitScript(({ id, theme, fy, firm, to }) => {
    localStorage.setItem("gst3.theme", theme);
    localStorage.setItem("gst3.fy", fy);
    localStorage.setItem(`gst3.scope.${id}`, String(firm));
    localStorage.setItem(`gst3.reports.period.${id}`, JSON.stringify({ p: "custom", from: "2022-04-01", to }));
    localStorage.setItem("gst3.report.split", "0");
  }, { id: me.id, theme, fy, firm, to: today() });
}
async function pageReady(page, path, theme) {
  await expect(page).toHaveURL(url => url.pathname === path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("html")).toHaveClass(theme === "obsidian" ? "" : `theme-${theme}`);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await opened(page);
}
async function openReport(page, kind, theme) {
  const response = responseFor(page, `reports/${kind}/`, u => u.searchParams.get("from") === "2022-04-01");
  await page.goto(`/reports/${kind}`);
  const data = await checked(await response);
  await pageReady(page, `/reports/${kind}`, theme);
  await expect(page.getByRole("region", { name: "Download this report" })).toBeVisible();
  return data;
}
function reportCount(kind, data) {
  if (kind === "sales" || kind === "purchases") return data.totals.bills;
  if (kind === "tax") return data.firms.reduce((n, f) => n + f.rows.length, 0);
  return data.rows.length;
}
async function downloadExcel(page, dialog, filename, info) {
  const button = dialog.getByRole("button", { name: "Download Excel", exact: true });
  await expect(button).toBeEnabled();
  const event = page.waitForEvent("download");
  await button.click();
  const downloaded = await event;
  expect(downloaded.suggestedFilename()).toBe(filename);
  const target = info.outputPath(filename);
  await downloaded.saveAs(target);
  expect(await downloaded.failure()).toBeNull();
  expect(fs.readFileSync(target).subarray(0, 2).toString("ascii")).toBe("PK");
}

// A timeout still enters afterEach with its request fixture. Only rows returned by this file's POST are recorded.
const madePurchases = [];
test.afterEach(async ({ request }) => {
  if (!madePurchases.length) return;
  const failures = [];
  const headers = { Authorization: `Bearer ${savedToken()}` };
  for (const purchase of madePurchases.splice(0)) {
    try {
      const current = await request.get(`/api/purchases/${purchase.id}/`, { headers });
      if (current.status() === 404) continue;
      expect(current.ok(), `checking synthetic purchase ${purchase.id}`).toBe(true);
      const restored = await request.put(`/api/purchases/${purchase.id}/credit-month/`, { headers, data: { itc_month: purchase.originalMonth } });
      if (!restored.ok()) failures.push(`Synthetic purchase ${purchase.id}: restoring its original credit month answered ${restored.status()}.`);
      const removed = await request.delete(`/api/purchases/${purchase.id}/`, { headers, data: { reason: "GST support acceptance test" } });
      expect(removed.ok() || removed.status() === 404, `binning synthetic purchase ${purchase.id}`).toBe(true);
    } catch (error) { failures.push(`Synthetic purchase ${purchase.id}: ${error.message}`); }
  }
  expect(failures, "Synthetic purchase cleanup must succeed; never unlock a preexisting month to clean up").toEqual([]);
});

for (const theme of ["obsidian", "pearl"]) {
  test(`${theme}: all seven live reports, their empty states and WCAG 2.2 AA`, async ({ page, request }, info) => {
    test.setTimeout(180_000);
    const { me, fy } = await context(request);
    await prepare(page, me, theme, fy);
    for (const [kind, name] of REPORTS) await test.step(name, async () => {
      const data = await openReport(page, kind, theme);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(info.project.name === "phone" ? name : "Reports");
      await expect(page.getByLabel("From", { exact: true })).toHaveValue("2022-04-01");
      await expect(page.getByLabel("To", { exact: true })).toHaveValue(today());
      const exports = page.getByRole("region", { name: "Download this report" });
      const buttons = [exports.getByRole("button", { name: /^Excel ·/ }), exports.getByRole("button", { name: /^CSV ·/ })];
      for (const button of buttons) {
        if (can(me, "reports.export") && reportCount(kind, data) > 0) await expect(button).toBeEnabled();
        else await expect(button).toBeDisabled();
      }
      if (kind === "hsn") {
        await expect(page.getByText(/CTM for carats/)).toBeVisible();
        const response = responseFor(page, "reports/hsn/", u => u.searchParams.get("side") === "purchases");
        await page.getByRole("radiogroup", { name: "Bills", exact: true }).getByRole("radio", { name: "Purchases", exact: true }).click();
        await checked(await response);
        await expect(page.getByRole("radio", { name: "Purchases", exact: true })).toBeChecked();
      }
      if (kind === "months") {
        await page.getByRole("radiogroup", { name: "Chart shows" }).getByRole("radio", { name: "Bills", exact: true }).click();
        await expect(page.getByRole("radiogroup", { name: "Chart shows" }).getByRole("radio", { name: "Bills", exact: true })).toBeChecked();
      }
      expect(await measure(page), `${theme} ${name}`).toEqual([]);
    });
  });

  test(`${theme}: live reconciliation, comparison controls and download permission`, async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const { api, me, firms, fy } = await context(request);
    await prepare(page, me, theme, fy, firms[0].id);
    // Prefer a firm with sales, but a fresh CI database is allowed to show the explicit empty state.
    let firm = firms[0], data;
    for (const candidate of firms) {
      const value = await api.get("gst/reconciliation/", { business_id: candidate.id, fy });
      firm = candidate; data = value;
      if (value.filed.some(m => m.books.bills > 0 || (m.gstr1?.bills ?? 0) > 0)) break;
    }
    const response = responseFor(page, "gst/reconciliation/", u => u.searchParams.get("business_id") === String(firm.id));
    await page.goto(`/gst?tab=recon&firm=${firm.id}&fy=${fy}`);
    await checked(await response);
    await pageReady(page, "/gst", theme);
    const hasSales = data.filed.some(m => m.books.bills > 0 || (m.gstr1?.bills ?? 0) > 0);
    if (!hasSales) {
      await expect(page.getByText(`No sales for ${firm.name} in FY ${fy}`)).toBeVisible();
      expect(await measure(page)).toEqual([]);
      return;
    }
    await expect(page.getByText(/GSTR-2B.*isn't matched here yet/)).toBeVisible();
    await page.getByRole("radiogroup", { name: "Figure to compare" }).getByRole("radio", { name: "CGST", exact: true }).click();
    if (info.project.name === "desktop") await expect(page.getByRole("table", { name: "CGST, books against the returns as filed" }).getByRole("columnheader", { name: "GSTR-3B as filed" })).toBeVisible();
    else await expect(page.getByRole("heading", { name: "CGST: books against the returns as filed", exact: true })).toBeVisible();
    const split = responseFor(page, "gst/reconciliation/", u => u.searchParams.get("split") === "1");
    await page.getByLabel("Cash/bank split in downloads").check();
    await checked(await split);
    const excel = page.getByRole("button", { name: "Excel with the working", exact: true });
    if (can(me, "gst.download")) {
      await expect(excel).toBeEnabled();
      await excel.click();
      const dialog = page.getByRole("dialog", { name: /^Reconciliation_FY/ });
      await expect(dialog).toBeVisible();
      await afterDialog(page);
      expect(await problems(page), "reconciliation workbook dialog").toEqual([]);
      await downloadExcel(page, dialog, await dialog.getByRole("heading").innerText(), info);
      await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
    } else if (me.role === "viewer") await expect(excel).toHaveCount(0);
    else await expect(excel).toBeDisabled();
    expect(await measure(page)).toEqual([]);
  });

  test(`${theme}: live credit, opening permissions and read-only preview`, async ({ page, request }) => {
    const { api, me, firms, fy } = await context(request), firm = firms[0];
    await prepare(page, me, theme, fy, firm.id);
    // A mistake in this read-only preview test must never save a preexisting opening balance.
    let prohibitedSaves = 0;
    await page.route("**/api/gst/opening-credit/**", route => {
      if (route.request().method() === "PUT" && new URL(route.request().url()).searchParams.get("preview") !== "1") {
        prohibitedSaves += 1; return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    const response = responseFor(page, "gst/credit/", u => u.searchParams.get("business_id") === String(firm.id));
    await page.goto(`/gst?tab=credit&firm=${firm.id}&fy=${fy}#opening`);
    const data = await checked(await response);
    await pageReady(page, "/gst", theme);
    const opening = page.getByRole("region", { name: "Credit carried into FY 2025-26", exact: true });
    await expect(opening).toHaveAttribute("id", "opening");
    await expect(opening.locator("..")).toBeFocused();
    const edit = opening.getByRole("button", { name: /^(Edit opening credit|Type it)$/ });
    if (can(me, "settings.edit")) {
      const before = await api.get("gst/opening-credit/", { business_id: firm.id });
      await edit.click();
      const dialog = page.getByRole("dialog", { name: "Credit carried into FY 2025-26", exact: true });
      await expect(dialog).toBeVisible(); await afterDialog(page);
      const input = dialog.getByLabel("IGST credit", { exact: true });
      await input.fill("-1");
      await expect(dialog.getByText("A credit balance can't be below zero.")).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Preview the change", exact: true })).toBeDisabled();
      await input.fill(before.igst === "1.23" ? "2.34" : "1.23");
      await expect(dialog.getByRole("button", { name: "Save opening credit", exact: true })).toBeDisabled();
      const preview = page.waitForResponse(r => new URL(r.url()).pathname === "/api/gst/opening-credit/" && r.request().method() === "PUT" && new URL(r.url()).searchParams.get("preview") === "1");
      await dialog.getByRole("button", { name: "Preview the change", exact: true }).click();
      await checked(await preview);
      await expect(dialog.getByText("What this changes", { exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Save opening credit", exact: true })).toBeEnabled();
      expect(await problems(page), "opening preview dialog").toEqual([]);
      await input.fill("3.45");
      await expect(dialog.getByText("What this changes", { exact: true })).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "Save opening credit", exact: true })).toBeDisabled();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      const after = await api.get("gst/opening-credit/", { business_id: firm.id });
      expect([after.igst, after.cgst, after.sgst, after.typed]).toEqual([before.igst, before.cgst, before.sgst, before.typed]);
    } else await expect(edit).toHaveCount(0);
    for (const bill of data.at_risk.bills) {
      const select = page.getByLabel(`Claim ${bill.bill_no}'s credit in`, { exact: true });
      if (me.role === "viewer" || bill.claim_months.length < 2) await expect(select).toHaveCount(0);
      else if (can(me, "purchase.edit")) await expect(select).toBeEnabled();
      else await expect(select).toBeDisabled();
    }
    expect(prohibitedSaves).toBe(0);
    expect(await measure(page)).toEqual([]);
  });

  test(`${theme}: live CA workbook preview and XLSX download for this role`, async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const { me, fy } = await context(request);
    await prepare(page, me, theme, fy);
    await openReport(page, "sales", theme);
    const button = page.getByRole("button", { name: "Excel for the CA…", exact: true });
    if (!can(me, "reports.export")) { await expect(button).toBeDisabled(); return; }
    const response = responseFor(page, "reports/ca-workbook/");
    await button.click();
    const workbook = await checked(await response);
    const dialog = page.getByRole("dialog", { name: workbook.file, exact: true });
    await expect(dialog).toBeVisible(); await afterDialog(page);
    for (const name of ["Summary", "GSTR-1", "GSTR-3B"]) await expect(dialog.getByRole("tab", { name, exact: true })).toBeVisible();
    await expect(dialog.getByText("Sales and purchases sit side by side and are never added together.", { exact: true })).toBeVisible();
    // Firm names are sanitized/deduplicated by the writer, so derive the actual tab names from the UI.
    const fixed = new Set(["Summary", "GSTR-1", "GSTR-3B", "Amendments"]);
    const firmTabs = (await dialog.getByRole("tab").allTextContents()).filter(name => !fixed.has(name));
    expect(firmTabs).toHaveLength(workbook.firms.length);
    const withMonths = workbook.firms.findIndex(firm => firm.months.length > 0);
    if (withMonths >= 0) {
      await dialog.getByRole("tab", { name: firmTabs[withMonths], exact: true }).click();
      const sheet = dialog.getByRole("table", { name: `Sheet ${firmTabs[withMonths]}`, exact: true });
      for (const label of ["Qty", "Unit", "Rate per unit"]) await expect(sheet.getByRole("cell", { name: label, exact: true }).first()).toBeVisible();
      await expect(sheet.getByRole("cell", { name: /making charges/i })).toHaveCount(0);
    }
    expect(await problems(page), "CA workbook preview").toEqual([]);
    await downloadExcel(page, dialog, workbook.file, info);
  });
}

// Permission/offline controls need an at-risk bill even on fresh CI data or after the legal deadline. This is a
// browser fixture, not a live server acceptance check. The fixture's id is intercepted for every HTTP method.
test("[mocked] credit-month permissions, disabled late choice and one offline failure", async ({ page, request }) => {
  const { me, firms, fy } = await context(request), firm = firms[0];
  await prepare(page, me, "obsidian", fy, firm.id);
  const id = 900000001, invoice = "E2E/MOCK/CREDIT";
  const opening = { business: firm.id, as_of: "2025-04-01", igst: "0.00", cgst: "0.00", sgst: "0.00", total: "0.00", typed: false, updated_by: null, updated_at: null, first_filed_3b: null, carried_out_of_first_month: { month: "2025-04", heads: { igst: "0.00", cgst: "0.00", sgst: "0.00" } } };
  const fixture = { business: firm.id, fy,
    at_risk: { deadline: "2026-11-30", days_left: 53, tax: "902.40", count: 1, bills: [{ id, bill_no: invoice, bill_date: "2026-02-18", entered_on: "2026-10-05", supplier: { id: 900000002, name: "Synthetic Gem Supplier", gst_number: "08ABCDE1234F1Z5" }, tax: "902.40", credit_month: "2026-10", credit_month_due: "2026-11-20", deadline: "2026-11-30", days_left: 53,
      claim_months: [{ month: "2026-09", state: "not_filed", gstr3b_due: "2026-10-20", too_late: false }, { month: "2026-10", state: "running", gstr3b_due: "2026-11-20", too_late: false }, { month: "2026-11", state: "running", gstr3b_due: "2026-12-20", too_late: true }] }] },
    others_at_risk: [], buckets: { fy, deadline: "2027-11-30", days_left: 418, claimed: { bills: 0, tax: "0.00" }, open: { bills: 0, tax: "0.00" }, lapsed: { bills: 0, tax: "0.00" }, before_ledger: { count: 0, tax: "0.00" }, none: [] }, opening };
  await page.route("**/api/gst/credit/**", route => route.fulfill({ json: fixture }));
  let attempts = 0;
  await page.route(`**/api/purchases/${id}/**`, route => { attempts += 1; return route.abort("internetdisconnected"); });
  await page.goto(`/gst?tab=credit&firm=${firm.id}&fy=${fy}`);
  await pageReady(page, "/gst", "obsidian");
  await expect(page.getByText(invoice, { exact: true })).toBeVisible();
  const select = page.getByLabel(`Claim ${invoice}'s credit in`, { exact: true });
  if (me.role === "viewer") { await expect(select).toHaveCount(0); return; }
  await expect(select.locator('option[value="2026-11"]')).toBeDisabled();
  if (!can(me, "purchase.edit")) { await expect(select).toBeDisabled(); return; }
  // Set the browser's network state without disabling Playwright's fixture interception.
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }); window.dispatchEvent(new Event("offline")); });
  await select.selectOption("2026-09");
  await expect(page.getByText("You're offline, so this wasn't saved", { exact: true })).toBeVisible();
  await expect(select).toHaveValue("2026-10");
  expect(attempts).toBe(1);
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true }); window.dispatchEvent(new Event("online")); });
  await opened(page);
  expect(attempts, "coming online must never replay a failed save").toBe(1);
});

test("live credit move on one new synthetic purchase; afterEach restores and bins it", async ({ page, request }, info) => {
  const { api, me, firms, fy } = await context(request);
  test.skip(!["purchase.create", "purchase.edit", "purchase.delete"].every(action => can(me, action)), "This role cannot both create and clean up a purchase; its edit gate is checked without writes above.");
  const start = Number(fy.slice(0, 4)), invoiceDate = `${start}-03-15`;
  test.skip(today() > `${start}-11-30`, "Last FY's credit deadline has passed; never backdate the server or unlock a filed month for this check.");
  const suppliers = rows(await api.get("suppliers/", { page_size: 100 }));
  const supplier = suppliers.find(s => s.gst_number);
  test.skip(!supplier, "A registered supplier fixture is needed; the test does not alter a supplier.");
  let selection;
  for (const firm of firms) {
    const choice = await api.get("purchases/credit-months/", { business_id: firm.id, invoice_date: invoiceDate });
    const usable = choice.options.filter(option => option.in_time);
    if (!choice.lapsed && usable.length > 1) { selection = { firm, original: usable[usable.length - 1].month }; break; }
  }
  test.skip(!selection, "Two open in-time months are needed; the test never unlocks existing returns.");
  const { firm, original } = selection;
  const purchase = await api.post("purchases/", { business: firm.id, supplier: supplier.id,
    invoice_number: `E2E-GST-${Date.now().toString(36)}-${info.project.name}`, invoice_date: invoiceDate,
    payment_mode: "bank", itc_eligible: true, itc_month: original, buyer_gstin: firm.gst_number || "", buyer_ack: false,
    duplicate_ok: false, needs_review: false, capture: null, source: "typed",
    lines: [{ product_name: "Synthetic GST credit acceptance item", hsn_code: "711319", gst_percent: "3", quantity: "1.000", unit: "gms", rate: "100.000", note: "Synthetic acceptance test" }],
  });
  madePurchases.push({ id: purchase.id, originalMonth: purchase.credit.month });
  await prepare(page, me, "obsidian", fy, firm.id);
  const response = responseFor(page, "gst/credit/", u => u.searchParams.get("business_id") === String(firm.id));
  await page.goto(`/gst?tab=credit&firm=${firm.id}&fy=${fy}`);
  const credit = await checked(await response);
  const bill = credit.at_risk.bills.find(b => b.id === purchase.id);
  expect(bill, "the synthetic prior-FY purchase must appear at risk").toBeTruthy();
  // Part 2's write choices include unlocked recorded returns; this screen's claim_months excludes them.
  const target = bill.claim_months.find(choice => !choice.too_late && choice.month !== original)?.month;
  test.skip(!target, "Two in-time claim months without GSTR-3B on record are needed; never unlock a return for this check.");
  await pageReady(page, "/gst", "obsidian");
  const select = page.getByLabel(`Claim ${purchase.invoice_number}'s credit in`, { exact: true });
  await expect(select).toHaveValue(original);
  const saved = page.waitForResponse(r => new URL(r.url()).pathname === `/api/purchases/${purchase.id}/credit-month/` && r.request().method() === "PUT");
  await select.selectOption(target);
  const result = await checked(await saved);
  expect(result.credit.month).toBe(target);
  await expect(select).toHaveValue(target);
  expect((await api.get(`purchases/${purchase.id}/`)).credit.month).toBe(target);
});
