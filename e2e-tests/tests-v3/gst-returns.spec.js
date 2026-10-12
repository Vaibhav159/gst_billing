// Real-server acceptance for 3C. Run only under the sandbox lock assigned by the builder's dispatch.
// Required seed: a positive-tax month and a blocked month. Lifecycle writes use only
// this suite's disposable TEST GST RETURNS firm; every owned filing and bill is cleaned up.
const fs = require("fs");
const { test, expect } = require("@playwright/test");
const { opened, savedToken } = require("./session");
const { afterDialog, client, makesBills, newBill, removeBill, today, walkIn } = require("./sales-data");
const { measure } = require("./axe");

const fyOf = (day) => { const [year, month] = day.split("-").map(Number); const y = year - (month < 4 ? 1 : 0); return `${y}-${String(y + 1).slice(-2)}`; };
const monthBefore = (day) => { const [year, month] = day.split("-").map(Number); return `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, "0")}`; };
const monthName = (month) => new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
const fullMonth = (month) => `${monthName(month)} ${month.slice(0, 4)}`;
const money = (value) => { const [whole, fraction = "00"] = String(value).split("."); const negative = whole.startsWith("-"); const digits = whole.replace("-", ""); const last = digits.slice(-3); const first = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ","); return `${negative ? "−" : ""}₹${first ? `${first},` : ""}${last}.${fraction.padEnd(2, "0")}`; };
const paise = (value) => { const [a, b = ""] = String(value).split("."); return BigInt(a) * 100n + BigInt(b.padEnd(2, "0")); };
const params = (firm, month) => ({ business_id: firm, month });
const url = (m, extra = {}) => `/gst?${new URLSearchParams({ firm: String(m.business), month: m.month, fy: m.fy, ...extra })}`;

async function firms(api) {
  const data = await api.get("businesses/", { page_size: 100 });
  expect(data.next, "GST test discovery must read every firm; add pagination before using >100 firms").toBeFalsy();
  expect(data.results.length, "3A integration prerequisite: seed GST firms").toBeGreaterThan(0);
  return data.results;
}
async function findMonth(api, stages, predicate, prerequisite) {
  const current = fyOf(today()), previous = `${Number(current.slice(0, 4)) - 1}-${current.slice(2, 4)}`;
  for (const firm of await firms(api)) {
    if (firm.name.startsWith("TEST GST RETURNS")) continue;
    for (const fy of [current, previous]) {
      const year = await api.get("gst/year/", { business_id: firm.id, fy });
      for (const entry of [...year.months].reverse().filter((entry) => stages.includes(entry.stage))) {
        const m = await api.get("gst/month/", params(firm.id, entry.month));
        if (await predicate(m)) return m;
      }
    }
  }
  throw new Error(`3A integration fixture prerequisite missing: ${prerequisite}. Seed it on the assigned disposable sandbox; this test does not skip or alter a real firm's records.`);
}
async function openMonth(page, m, extra) {
  await page.goto(url(m, extra));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("#gst-ledger")).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await opened(page);
}
async function section(page, name, phone) {
  if (phone) {
    await page.locator("#gst-gstr1").getByRole("button", { name: new RegExp(`^${name}`) }).click();
    const sheet = page.getByRole("dialog", { name });
    await expect(sheet).toBeVisible();
    await afterDialog(page);
    return sheet;
  }
  const tabName = { "B2CL bills": "B2CL", "HSN summary": "HSN", "Documents issued": "Documents" }[name];
  await page.getByRole("tab", { name: new RegExp(`^${tabName}(?:\\s|$)`) }).click();
  return page.locator("#g1-panel");
}
async function closeSheet(page, phone) { if (phone) { await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0); await opened(page); } }
function line(page, label, phone) {
  const ledger = page.locator("#gst-ledger");
  return phone ? ledger.getByRole("heading", { name: new RegExp(`^${label}`) }).locator("..") : ledger.getByRole("row").filter({ hasText: new RegExp(`^${label}`) });
}

let owned = null;
let created = new Set();
let pending = [];
let ownedBills = [];
test.beforeEach(async ({ request, page }) => {
  owned = null; created = new Set(); pending = []; ownedBills = [];
  expect((await client(request).get("me/")).role, "Run gst-returns.spec.js as owner; gst-access.spec.js separately signs in all four roles").toBe("owner");
  page.on("response", (response) => {
    if (response.request().method() !== "POST" || new URL(response.url()).pathname !== "/api/gst/filings/" || response.status() !== 201) return;
    pending.push(response.json().then((body) => {
      for (const record of body.filings) if (owned && record.business === owned.business && record.month === owned.month) created.add(record.id);
    }));
  });
});
test.afterEach(async ({ page, request }) => {
  await page.context().setOffline(false);
  await Promise.all(pending);
  if (!owned) return;
  const api = client(request);
  const m = await api.get("gst/month/", params(owned.business, owned.month));
  // Only IDs observed from this test's successful POSTs; an unexpected record is never removed.
  const errors = [];
  for (const kind of ["gstr3b", "gstr1a", "gstr1"]) {
    const record = m.record[kind];
    if (!record || !created.has(record.id)) continue;
    const response = await request.delete(`/api/gst/filings/${record.id}/`, { headers: { Authorization: `Bearer ${savedToken()}` }, data: { reason: "Remove this test's synthetic filing record" } });
    if (!response.ok()) errors.push(`${kind} record ${record.id}: HTTP ${response.status()}`);
  }
  // Sales stay closed until the filing records are removed. Only now send this test's bills to the bin.
  for (const id of ownedBills) {
    await removeBill(api, id);
    const response = await request.get(`/api/sales/${id}/`, { headers: { Authorization: `Bearer ${savedToken()}` } });
    if (response.status() !== 404) errors.push(`owned bill ${id} remains live or unchecked: HTTP ${response.status()}`);
  }
  expect(errors, "Synthetic GST fixture cleanup failed; stop before another run").toEqual([]);
});
// Drain newBill's registry after the GST-specific hook has removed filing locks and binned its exact owned IDs.
makesBills(test);

async function emptyFixture(api) {
  const name = process.env.E2E_GST_FIRM || "TEST GST RETURNS (e2e)";
  expect(name, "Set E2E_GST_FIRM to the assigned empty synthetic firm's exact name, starting TEST GST RETURNS").toMatch(/^TEST GST RETURNS/);
  const firm = (await firms(api)).find((candidate) => candidate.name === name) || await api.post("firms/", {
    name, short_name: "GST Test", address: "1 Synthetic Test Road, Jaipur, Rajasthan",
    city: "Jaipur", pin_code: "302001", gst_number: "08PQRST1234A1ZB", mobile_number: "9999999995",
    email: "", invoice_prefix: "TGR", paper_full_number_from: null,
    bank_name: "", bank_account_number: "", bank_ifsc_code: "", bank_branch_name: "",
    jurisdiction: "Jaipur", declaration: "", signature_on_bills: false,
  });
  const month = monthBefore(today());
  const m = await api.get("gst/month/", params(firm.id, month));
  expect(m.stage, "The disposable firm's previous month must be ready and contain no filing history").toBe("ready");
  expect(m.record).toMatchObject({ gstr1: null, gstr1a: null, gstr3b: null, legacy: false });
  expect(m.gstr1.bills).toBe(0);
  expect(m.gstr3b.output.total).toBe("0.00");
  expect(m.gstr3b.credit.total).toBe("0.00");
  expect(m.gstr3b.carry_in.total).toBe("0.00");
  expect(m.gstr1.file.made, "The synthetic firm needs a valid GSTIN and an unblocked nil return").toBe(true);
  const current = await api.get("gst/month/", params(firm.id, today().slice(0, 7)));
  expect(current.stage, "The owned bill's temporary creation month and amendment carrying month must be open").toBe("open");
  expect(current.gstr1.bills, "The disposable firm's current month must also contain no live sales").toBe(0);
  expect(current.gstr3b.output.total).toBe("0.00");
  expect(current.gstr3b.credit.total).toBe("0.00");
  expect(current.gstr3b.carry_in.total).toBe("0.00");
  return m;
}

// The unit vectors own the arithmetic oracle. This checks the server's exact decimal answers reach every surface.
test("GST figures, portal sections and WCAG 2.2 AA in both themes", { tag: "@sandbox" }, async ({ page, request }, info) => {
  test.slow();
  const api = client(request), phone = info.project.name === "phone";
  const m = await findMonth(api, ["ready", "blocked", "gstr1", "filed", "open"], (m) => paise(m.gstr3b.output.total) > 0n && m.gstr1.file.b2cl > 0 && m.gstr1.file.hsn > 0, "a month with positive sales tax, a B2CL bill and HSN rows");
  const g3 = await api.get("gst/month/gstr3b/", params(m.business, m.month));
  const g1 = await api.get("gst/month/gstr1/", { ...params(m.business, m.month), ...(m.record.gstr1 ? { as_filed: "1" } : {}) });
  expect(paise(g3.t31a.igst) + paise(g3.t31a.cgst) + paise(g3.t31a.sgst) - paise(g3.used.total)).toBe(paise(g3.cash.total));
  for (const theme of ["obsidian", "pearl"]) {
    await page.goto(url(m));
    await page.evaluate((value) => localStorage.setItem("gst3.theme", value), theme);
    await openMonth(page, m);
    await expect(line(page, g3.filed ? "Tax paid in cash" : "Tax to pay in cash", phone)).toContainText(money(g3.cash.total));
    await expect(line(page, "Net credit", phone)).toContainText(money(g3.t4c.total));
    await expect(line(page, "Credit not allowed", phone)).toContainText("4(B)(1)");
    await expect(line(page, "Credit too late to claim", phone)).toContainText("4(D)(2)");
    const interest = page.locator("#gst-ledger").getByText("Interest in the GSTR-3B JSON: worked out to today; check on the portal.", { exact: true });
    if (!g3.filed && paise(g3.late?.interest ?? "0") > 0n) await expect(interest).toBeVisible();
    else await expect(interest).toHaveCount(0);
    await expect(page.locator("html")).toHaveClass(theme === "obsidian" ? "" : "theme-pearl");
    expect(await measure(page)).toEqual([]);
    const b2cl = await section(page, "B2CL bills", phone);
    expect(g1.b2cl.length, "B2CL fixture must reach the section endpoint").toBeGreaterThan(0);
    await expect(b2cl).toContainText(g1.b2cl[0].bill.invoice_number);
    await expect(b2cl).toContainText(money(g1.b2cl[0].total));
    await closeSheet(page, phone);
    const hsn = await section(page, "HSN summary", phone);
    const hsnRows = g1.hsn.data ?? [...g1.hsn.b2b, ...g1.hsn.b2c];
    expect(hsnRows.length, "positive-sales fixture must exercise HSN rows").toBeGreaterThan(0);
    for (const row of hsnRows) {
      expect(row.quantity, "P3-15: the server sends the portal quantity with two decimals").toMatch(/^-?\d+\.\d{2}$/);
      await expect(hsn).toContainText(phone ? `${row.uqc} · ${row.quantity}` : row.quantity);
    }
    if (g1.hsn.data !== undefined) {
      await expect(hsn.getByRole("heading", { name: "All buyers" })).toBeVisible();
      await expect(hsn.getByRole("heading", { name: /B2B · bills/ })).toHaveCount(0);
    }
    await expect(hsn).toContainText("From May 2025, B2B and B2C are listed apart");
    await expect(hsn).toContainText("PCS for pieces, NOS for numbers, CTM for carats");
    await expect(hsn).not.toContainText("CTM, which is centimetres");
    expect(await measure(page)).toEqual([]);
    await closeSheet(page, phone);
  }
  await page.locator("#gst-ledger").getByRole("button", { name: /^How this is worked out/ }).click();
  await expect(page.locator("#gst-ledger")).toContainText("It can never pay SGST.");
  await expect(page.locator("#gst-ledger")).toContainText("It can never pay CGST.");
});

test("a blocker prevents a portal file and requires the explicit filing acknowledgement", { tag: "@sandbox" }, async ({ page, request }) => {
  const m = await findMonth(client(request), ["blocked"], () => true, "an unfiled month with a GSTR-1 blocker");
  await openMonth(page, m);
  const check = m.checks.blockers[0];
  await expect(page.locator("#gst-checks")).toContainText(check.text);
  await expect(page.getByRole("button", { name: /^(Download GSTR-1 file for the portal|Download the GSTR-1 file again|Send GSTR-1 file to the CA)$/ })).toBeDisabled();
  await page.getByRole("button", { name: "Mark GSTR-1 filed…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Mark ${monthName(m.month)}'s GSTR-1 filed?` });
  await expect(dialog).toContainText(check.text);
  await afterDialog(page);
  await expect(dialog.getByRole("button", { name: "Mark GSTR-1 filed", exact: true })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: "GSTR-1 is on the GST portal, even though a check fails here" }).check();
  await expect(dialog.getByRole("button", { name: "Mark GSTR-1 filed", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await client(request).get("gst/month/", params(m.business, m.month))).record.gstr1).toBeNull();
});

test("nil return files in stages, keeps portal carry, unlocks, relocks and removes only its own records", async ({ page, request }, info) => {
  test.slow();
  const api = client(request), m = await emptyFixture(api), name = monthName(m.month);
  owned = m;
  await openMonth(page, m);
  if (info.project.name === "phone") await expect(page.locator("[data-actionbar]").getByRole("button", { name: m.download && !m.download.stale ? "Mark GSTR-1 filed" : "Send to the CA", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mark GSTR-1 filed…", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: `Mark ${name}'s GSTR-1 filed?` });
  await expect(dialog).toBeVisible(); await afterDialog(page);
  await dialog.getByRole("textbox", { name: "GSTR-1 ARN", exact: true }).fill("AA081026034590Z");
  await dialog.getByRole("checkbox", { name: "GSTR-1 is filed on the GST portal" }).check();
  const marked1 = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/gst/filings/");
  await dialog.getByRole("button", { name: "Mark GSTR-1 filed", exact: true }).click();
  expect((await marked1).status()).toBe(201);
  await expect(page.getByRole("region", { name: "GSTR-1 filing record" })).toContainText("AA081026034590Z");
  await expect(page.getByRole("button", { name: "Mark GSTR-3B filed…", exact: true })).toBeVisible();
  if (info.project.name === "phone") await expect(page.locator("[data-actionbar]").getByRole("button", { name: "Mark GSTR-3B filed", exact: true })).toBeVisible();
  await opened(page);
  await page.getByRole("button", { name: "Mark GSTR-3B filed…", exact: true }).click();
  dialog = page.getByRole("dialog", { name: `Mark ${name}'s GSTR-3B filed?` });
  await expect(dialog).toBeVisible(); await afterDialog(page);
  await dialog.getByLabel("Cash paid with GSTR-3B", { exact: true }).fill("1.23");
  await expect(dialog.getByRole("button", { name: /^Credit left on the portal after this return/ })).toBeVisible();
  await dialog.getByLabel("IGST credit", { exact: true }).fill("2.34");
  await dialog.getByLabel("CGST credit", { exact: true }).fill("3.45");
  await dialog.getByLabel("SGST credit", { exact: true }).fill("4.56");
  await dialog.getByRole("checkbox", { name: "GSTR-3B is filed and the tax is paid on the GST portal" }).check();
  const marked3 = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/gst/filings/");
  await dialog.getByRole("button", { name: "Mark filed and lock", exact: true }).click();
  expect((await marked3).status()).toBe(201);
  await expect(page.getByRole("region", { name: "GSTR-3B filing record" })).toContainText("₹1.23 paid in cash");
  let stored = await api.get("gst/month/", params(m.business, m.month));
  expect(stored.stage).toBe("filed");
  expect(stored.record.gstr3b.cash.total).toBe("1.23");
  expect(stored.record.gstr3b.cash_worked_out.total).toBe("0.00");
  expect(stored.record.gstr3b.credit_left).toMatchObject({ igst: "2.34", cgst: "3.45", sgst: "4.56", total: "10.35" });
  const next = await api.get("gst/month/", params(m.business, today().slice(0, 7)));
  expect(next.gstr3b.carry_in).toMatchObject({ igst: "2.34", cgst: "3.45", sgst: "4.56", total: "10.35" });
  // Download the frozen return, then inspect the actual artifact received by the browser.
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download GSTR-1 as filed", exact: true }).first().click();
  const download = await downloadEvent, path = info.outputPath("gstr1-as-filed.json");
  await download.saveAs(path);
  const portal = JSON.parse(fs.readFileSync(path, "utf8"));
  expect(portal.gstin).toBe(m.firm.gst_number);
  expect(portal.fp).toBe(`${m.month.slice(5, 7)}${m.month.slice(0, 4)}`);
  await page.getByRole("button", { name: `Unlock ${name}…`, exact: true }).click();
  dialog = page.getByRole("dialog", { name: `Unlock ${fullMonth(m.month)}?` });
  await expect(dialog).toBeVisible(); await afterDialog(page);
  await dialog.getByLabel("Reason for unlocking").fill("Synthetic GST acceptance correction");
  await dialog.getByRole("button", { name: `Unlock ${name}`, exact: true }).click();
  await expect(page.getByRole("heading", { name: `Correcting ${name}`, exact: true })).toBeVisible(); await opened(page);
  await page.getByRole("button", { name: `Lock ${name} again…`, exact: true }).click();
  dialog = page.getByRole("dialog", { name: `Lock ${name} again?` });
  await expect(dialog).toBeVisible(); await afterDialog(page);
  await dialog.getByRole("button", { name: `Lock ${name}`, exact: true }).click();
  await expect(page.getByRole("button", { name: `Unlock ${name}…`, exact: true })).toBeVisible();
  for (const kind of ["GSTR-3B", "GSTR-1"]) {
    await opened(page);
    await page.getByRole("region", { name: `${kind} filing record` }).getByRole("button", { name: "Remove this record", exact: true }).click();
    dialog = page.getByRole("dialog", { name: `Remove ${kind} filing record?` });
    await expect(dialog).toBeVisible(); await afterDialog(page);
    await dialog.getByLabel("Reason for removing").fill("Remove this test's synthetic filing record");
    await dialog.getByRole("button", { name: "Remove this record", exact: true }).click();
    await expect(page.getByRole("region", { name: `${kind} filing record` })).toHaveCount(0);
  }
  stored = await api.get("gst/month/", params(m.business, m.month));
  expect(stored.record).toMatchObject({ gstr1: null, gstr1a: null, gstr3b: null });
  expect(stored.stage).toBe("ready");
});

test("corrections name GSTR-1A before 3B and the carrying return after 3B", async ({ page, request }, info) => {
  test.slow();
  const api = client(request), fixture = await emptyFixture(api);
  owned = fixture;
  const { made, body, lines } = await ownedAmendmentBill(api, fixture);
  await openMonth(page, await api.get("gst/month/", params(fixture.business, fixture.month)));
  await markReturn(page, fixture, "gstr1");
  for (const before of [true, false]) {
    await unlockOwned(page, fixture, before);
    await api.put(`sales/${made.id}/`, { ...body, lines: lines(before ? "1100.000" : "1200.000") });
    const m = await api.get("gst/month/", params(fixture.business, fixture.month));
    expect(m.amendments.before_gstr3b).toBe(before);
    expect(m.since_filing.rows.some(row => !row.too_late)).toBe(true);
    await openMonth(page, m);
    const changes = page.getByRole("region", { name: "Changes since filing" });
    for (const row of m.since_filing.rows) {
      await expect(changes).toContainText(row.invoice_number);
      if (!row.too_late) await expect(changes).toContainText(`Goes in ${row.goes_in}`);
    }
    await expect(page.locator("#gst-changes")).toContainText(before ? "corrections go in GSTR-1A" : `corrections go in ${monthName(m.amendments.carried_by)}'s GSTR-1`);
    if (before && !m.record.gstr1a) await expect(page.getByRole("button", { name: "Mark GSTR-1A filed…", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: info.project.name === "phone" ? "Send the amendments to the CA" : "Download the amendments", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Download GSTR-1 file for the portal", exact: true })).toHaveCount(0);
    if (before) {
      await markReturn(page, fixture, "gstr1a");
      await relockOwned(page, fixture);
      await markReturn(page, fixture, "gstr3b");
    }
  }
});

test("month end shows phone firm badges or desktop keyboard rows and a filing sheet", { tag: "@sandbox" }, async ({ page, request }, info) => {
  const data = await client(request).get("gst/month-end/", { month: monthBefore(today()) });
  expect(data.firms.length, "month-end keyboard acceptance needs at least two firms").toBeGreaterThan(1);
  if (info.project.name === "phone") {
    const m = await client(request).get("gst/month/", params(data.firms[0].firm.id, data.month));
    await openMonth(page, m);
    const firmPicker = page.getByRole("radiogroup", { name: "Firm", exact: true });
    const words = { filed: "Filed", gstr1: "GSTR-1 filed", blocked: "Blocked", ready: "Ready", open: "Open", unlocked: "Unlocked", future: "–" };
    for (const row of data.firms) await expect(firmPicker.getByRole("radio", { name: `${row.firm.short} · ${words[row.stage]}`, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Print filing sheet", exact: true })).toHaveCount(0);
    // Current-month badges are local stage words: month-end rejects a running month with 409.
    const runningMonthEnd = [];
    page.on("request", (request) => {
      const target = new URL(request.url());
      if (target.pathname === "/api/gst/month-end/" && target.searchParams.get("month") === today().slice(0, 7)) runningMonthEnd.push(target.pathname);
    });
    const current = await client(request).get("gst/month/", params(m.business, today().slice(0, 7)));
    await openMonth(page, current);
    for (const row of data.firms) await expect(firmPicker.getByRole("radio", { name: `${row.firm.short} · Open`, exact: true })).toBeVisible();
    expect(runningMonthEnd, "Current-month badges must not call month-end for a running month").toEqual([]);
    return;
  }
  await page.addInitScript(() => { window.__gstPrints = 0; window.print = () => { window.__gstPrints += 1; }; });
  await page.goto(`/gst?tab=all&month=${data.month}&fy=${fyOf(`${data.month}-01`)}`);
  const table = page.getByRole("table", { name: `Returns for ${fullMonth(data.month)}, by firm` });
  await expect(table).toBeVisible(); await opened(page);
  const rows = table.locator("tbody tr");
  await rows.nth(0).focus(); await page.keyboard.press("j"); await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("k"); await expect(rows.nth(0)).toBeFocused();
  await page.getByRole("button", { name: "Print filing sheet", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: `Filing sheet · ${fullMonth(data.month)}` });
  await expect(sheet).toContainText("Checked by"); await afterDialog(page);
  for (const row of data.firms) { await expect(sheet).toContainText(row.firm.name); await expect(sheet).toContainText(money(row.cash.amount)); }
  await sheet.getByRole("button", { name: "Print", exact: true }).click();
  expect(await page.evaluate(() => window.__gstPrints)).toBe(1);
});

test("financial-year navigation keeps exact months and handles years before April 2025", async ({ page, request }, info) => {
  const api = client(request), firm = (await firms(api))[0], fy = fyOf(today());
  const year = await api.get("gst/year/", { business_id: firm.id, fy });
  expect(year.months).toHaveLength(12);
  const available = year.months.filter((m) => m.stage !== "future");
  expect(available.length).toBeGreaterThan(0);
  const m = await api.get("gst/month/", params(firm.id, available[0].month));
  await openMonth(page, m);
  if (info.project.name === "phone") {
    const select = page.getByRole("combobox", { name: "Month", exact: true });
    await expect(select.locator("option")).toHaveCount(available.length);
    await select.selectOption(available[available.length - 1].month);
  } else {
    const group = page.getByRole("radiogroup", { name: `Months of FY ${fy}` });
    await group.getByRole("radio").first().focus(); await page.keyboard.press("End");
    await expect(group.locator(`[data-ym="${available[available.length - 1].month}"]`)).toHaveAttribute("aria-checked", "true");
    for (const future of year.months.filter((r) => r.stage === "future")) await expect(group.locator(`[data-ym="${future.month}"]`)).toBeDisabled();
  }
  await expect(page).toHaveURL(new RegExp(`[?&]month=${available[available.length - 1].month}`));
  await page.goto(`/gst?firm=${firm.id}&fy=2024-25`);
  await expect(page.getByText("No returns for FY 2024-25 in the app", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show FY 2025-26", exact: true })).toBeVisible(); await opened(page);
  await page.getByRole("button", { name: "Show FY 2025-26", exact: true }).click();
  await expect(page).toHaveURL(/[?&]fy=2025-26/);
  if (info.project.name === "phone") {
    await expect(page.getByRole("radio", { name: "Reconcile", exact: true })).toBeVisible();
    return;
  }
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "Search", exact: true });
  await expect(search).toBeVisible();
  await search.getByRole("combobox").fill("Reconciliation");
  await expect(search.getByRole("option", { name: /Reconciliation/ })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("offline download and filing failures keep the form and never queue a save", async ({ page, request }) => {
  const api = client(request), m = await emptyFixture(api);
  owned = m;
  await openMonth(page, m);
  await page.context().setOffline(true);
  await page.getByRole("button", { name: "GSTR-3B file", exact: true }).click();
  await expect(page.getByText(/You're offline, so the file wasn't made/)).toBeVisible();
  await page.getByRole("button", { name: "Mark GSTR-1 filed…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Mark ${monthName(m.month)}'s GSTR-1 filed?` });
  await expect(dialog).toBeVisible(); await afterDialog(page);
  await dialog.getByRole("textbox", { name: "GSTR-1 ARN", exact: true }).fill("AA081026034590Z");
  await dialog.getByRole("checkbox", { name: "GSTR-1 is filed on the GST portal" }).check();
  await dialog.getByRole("button", { name: "Mark GSTR-1 filed", exact: true }).click();
  await expect(dialog).toContainText("You're offline, so this wasn't saved");
  await expect(dialog.getByRole("textbox", { name: "GSTR-1 ARN", exact: true })).toHaveValue("AA081026034590Z");
  await expect(dialog.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  await page.context().setOffline(false);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  // A real request after reconnect proves the app can read again; no retry action was pressed.
  expect((await api.get("gst/month/", params(m.business, m.month))).record.gstr1).toBeNull();
});

async function markReturn(page, m, kind) {
  const label = { gstr1: "GSTR-1", gstr1a: "GSTR-1A", gstr3b: "GSTR-3B" }[kind];
  await page.getByRole("button", { name: `Mark ${label} filed…`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Mark ${monthName(m.month)}'s ${label} filed?` });
  await expect(dialog).toBeVisible(); await afterDialog(page);
  await dialog.getByRole("checkbox", { name: kind === "gstr3b" ? "GSTR-3B is filed and the tax is paid on the GST portal" : `${label} is filed on the GST portal`, exact: true }).check();
  const response = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/gst/filings/");
  await dialog.getByRole("button", { name: kind === "gstr3b" ? "Mark filed and lock" : `Mark ${label} filed`, exact: true }).click();
  expect((await response).status()).toBe(201);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("region", { name: `${label} filing record`, exact: true })).toBeVisible();
  await opened(page);
}
async function unlockOwned(page, m, before3b) {
  const name = monthName(m.month);
  await page.getByRole("button", { name: before3b ? `Unlock ${name}'s sales bills…` : `Unlock ${name}…`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: before3b ? `Unlock ${name}'s sales bills?` : `Unlock ${fullMonth(m.month)}?`, exact: true });
  await expect(dialog).toBeVisible(); await afterDialog(page);
  await dialog.getByLabel("Reason for unlocking · required", { exact: true }).fill("Correct this test's owned synthetic bill");
  await dialog.getByRole("button", { name: `Unlock ${name}`, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: `Correcting ${name}`, exact: true })).toBeVisible();
  await opened(page);
}
async function relockOwned(page, m) {
  const name = monthName(m.month);
  await page.getByRole("button", { name: `Lock ${name} again…`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Lock ${name} again?`, exact: true });
  await expect(dialog).toBeVisible(); await afterDialog(page);
  await dialog.getByRole("button", { name: `Lock ${name}`, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await opened(page);
}
async function amendmentsArtifact(page, info, file) {
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: info.project.name === "phone" ? "Send the amendments to the CA" : "Download the amendments", exact: true }).click();
  const downloaded = await event;
  expect(downloaded.suggestedFilename()).toBe(file);
  const path = info.outputPath(file);
  await downloaded.saveAs(path);
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

async function ownedAmendmentBill(api, m) {
  const firm = (await firms(api)).find((f) => f.id === m.business);
  const customer = await walkIn(api);
  const lines = (rate) => [{ product_name: "GST amendment test gold", hsn_code: "711319", gst_percent: "3", quantity: "1.000", unit: "gms", rate, note: "" }];
  const made = await newBill(api, { firm, customer, lines: lines("1000.000") });
  ownedBills.push(made.id);
  // newBill always uses today; obtain the exact target month's free number before moving this one owned bill.
  // This also handles an April run moving March's bill into the preceding FY without assuming a prefix.
  const invoiceDate = `${m.month}-15`;
  const number = fyOf(invoiceDate) === fyOf(today()) ? made.number
    : (await api.get("sales/next-number/", { business_id: firm.id, invoice_date: invoiceDate })).invoice_number;
  const body = { business: firm.id, customer: customer.id, invoice_number: number, invoice_date: invoiceDate,
    payment_mode: "cash", place_of_supply: m.firm.state_code, notes: "Synthetic GST amendment acceptance", lines: lines("1000.000") };
  const bill = await api.put(`sales/${made.id}/`, body);
  expect(bill.invoice_date).toBe(invoiceDate);
  expect(bill.total_amount).toBe("1030.00");
  return { made, body, lines };
}

test("an owned changed bill persists GSTR-1A, then carries a post-3B amendment with exact file figures", async ({ page, request }, info) => {
  test.slow();
  const api = client(request), m = await emptyFixture(api);
  owned = m;
  await page.addInitScript(() => { Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false }); });
  const { made, body, lines } = await ownedAmendmentBill(api, m);
  const first = await api.get("gst/month/", params(m.business, m.month));
  expect(first.gstr1.bills).toBe(1);
  expect(first.gstr3b.output).toMatchObject({ igst: "0.00", cgst: "15.00", sgst: "15.00", total: "30.00" });
  expect(first.checks.blockers).toEqual([]);
  await openMonth(page, first);
  await markReturn(page, m, "gstr1");
  await unlockOwned(page, m, true);
  // ₹1,100 × 3% = ₹33.00: CGST/SGST ₹16.50 each; prior snapshot was ₹15.00 each.
  await api.put(`sales/${made.id}/`, { ...body, lines: lines("1100.000") });
  let corrected = await api.get("gst/month/", params(m.business, m.month));
  expect(corrected.amendments.before_gstr3b).toBe(true);
  expect(corrected.since_filing.rows).toEqual(expect.arrayContaining([expect.objectContaining({ id: made.id, kind: "changed", tax_diff: "3.00", goes_in: expect.stringContaining("GSTR-1A") })]));
  await openMonth(page, corrected);
  // Even while showing Books now, the original download remains the frozen GSTR-1.
  await expect(page.getByRole("radiogroup", { name: "GSTR-1 figures", exact: true }).getByRole("radio", { name: "Books now", exact: true })).toHaveAttribute("aria-checked", "true");
  const originalEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download GSTR-1 as filed", exact: true }).click();
  const original = await originalEvent, originalPath = info.outputPath("original-gstr1-after-correction.json");
  await original.saveAs(originalPath);
  const frozen = JSON.parse(fs.readFileSync(originalPath, "utf8"));
  expect(frozen.b2cs).toEqual(expect.arrayContaining([expect.objectContaining({ txval: 1000, camt: 15, samt: 15 })]));
  const oneA = await amendmentsArtifact(page, info, corrected.amendments.file);
  expect(oneA.gstin).toBe(m.firm.gst_number);
  expect(oneA.fp).toBe(`${m.month.slice(5)}${m.month.slice(0, 4)}`);
  expect(oneA.b2cs, "GSTR-1A must restate this changed B2CS row, not produce an empty file").toEqual(expect.arrayContaining([
    expect.objectContaining({ sply_ty: "INTRA", pos: m.firm.state_code, rt: 3, txval: 1100, camt: 16.5, samt: 16.5 }),
  ]));
  await markReturn(page, m, "gstr1a");
  const marked1a = await api.get("gst/month/", params(m.business, m.month));
  expect(marked1a.record.gstr1a).toMatchObject({ business: m.business, month: m.month, kind: "gstr1a", filed_on: today() });
  expect(marked1a.record.gstr1a.id).toBeGreaterThan(0);
  await relockOwned(page, m);
  await expect(page.getByRole("button", { name: "Mark GSTR-3B filed…", exact: true })).toBeVisible();
  await markReturn(page, m, "gstr3b");
  const marked3 = await api.get("gst/month/", params(m.business, m.month));
  expect(marked3.record.gstr3b.cash.total).toBe("33.00");
  expect(marked3.stage).toBe("filed");
  await unlockOwned(page, m, false);
  // A second correction after 3B: ₹1,200 × 3% = ₹36.00, so ₹3.00 belongs in the next return.
  await api.put(`sales/${made.id}/`, { ...body, lines: lines("1200.000") });
  corrected = await api.get("gst/month/", params(m.business, m.month));
  expect(corrected.amendments.before_gstr3b).toBe(false);
  expect(corrected.amendments.carried_by).toBe(today().slice(0, 7));
  expect(corrected.since_filing.rows).toEqual(expect.arrayContaining([expect.objectContaining({ id: made.id, tax_diff: "3.00", goes_in: expect.stringContaining("B2CSA") })]));
  await openMonth(page, corrected);
  const amendment = await amendmentsArtifact(page, info, corrected.amendments.file);
  expect(amendment.gstin).toBe(m.firm.gst_number);
  const carrying = corrected.amendments.carried_by;
  expect(amendment.fp).toBe(`${carrying.slice(5)}${carrying.slice(0, 4)}`);
  const row = amendment.b2csa?.find((r) => r.omon === `${m.month.slice(5)}${m.month.slice(0, 4)}` && r.pos === m.firm.state_code);
  expect(row, "The amendments JSON must contain the original month's B2CSA row").toBeTruthy();
  expect(row.itms).toEqual(expect.arrayContaining([expect.objectContaining({ rt: 3, txval: 1200, camt: 18, samt: 18 })]));
  await relockOwned(page, m);
  const carried = await api.get("gst/month/", params(m.business, carrying));
  expect(carried.gstr3b.amendments_in).toContain(m.month);
  expect(carried.gstr3b.output).toMatchObject({ igst: "0.00", cgst: "1.50", sgst: "1.50", total: "3.00" });
  expect(carried.gstr3b.cash.total).toBe("3.00");
  // afterEach removes only our filing IDs before removeBill; bin rows intentionally retain their used numbers.
});
