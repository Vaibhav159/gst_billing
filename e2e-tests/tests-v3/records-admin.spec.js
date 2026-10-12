// Copy to e2e-tests/tests-v3/records-admin.spec.js after plans 4A and 4B land.
// Real API only. No seeded ids, registry stubs, production credentials, or password entry.
const fs = require("fs");
const { test, expect } = require("@playwright/test");
const { measure } = require("./axe");
const { opened } = require("./session");
const { client, newBill, removeBill, makesBills, afterDialog, esc, today } = require("./sales-data");

// Successful runs retain the four requested owner demonstrations as well as failure evidence.
test.use({ video: "on" });

const main = (page) => page.locator("#app-main");
const names = new Set();
let sequence = 0;
const unique = (what) => `E2E ${what} ${Date.now()} ${sequence++}`;
const mobile = () => `98${String(Date.now() + sequence++).slice(-8)}`;
const bodyFor = (name, phone = mobile()) => ({
  name, mobile_number: phone, email: "", customer_type: "person", gst_number: "", pan_number: "",
  address: "1 Test Road", city: "Udaipur", state_name: "RAJASTHAN",
});

async function newCustomer(api, what, phone) {
  const name = unique(what);
  names.add(name); // before the request: a lost answer can still be cleaned up by name
  return api.post("customers/", bodyFor(name, phone));
}

async function auditFor(api, customer, action) {
  const entries = await api.get("audit/", { entity: "customer", entity_id: customer.id, page_size: 100 });
  const row = entries.results.find((entry) => entry.action === action);
  expect(row, `${action} audit entry for the test customer`).toBeTruthy();
  return row;
}

async function openAudit(page, q) {
  await page.goto(`/audit?q=${encodeURIComponent(q)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
  await expect(main(page).getByRole("searchbox", { name: /^Search the audit log/ })).toHaveValue(q);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await opened(page);
}

async function openBackup(page) {
  await page.goto("/backup");
  await expect(page.getByRole("heading", { level: 1, name: "Backup and restore" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download full backup", exact: true })).toBeEnabled();
  await opened(page);
}

function backupFile(version, name) {
  const current = version === "5.0";
  const customer = version === "3.0"
    ? { id: "c-test", name, mobile: mobile(), gst: "", pan: "", state: "RAJASTHAN", address: "1 Test Road" }
    : { id: 912345, ...bodyFor(name) };
  const data = {
    version, exportedAt: `${today()}T12:00:00+05:30`, businesses: [], customers: [customer], products: [], invoices: [],
    ...(current ? {
      app: "gst-billing", made: `${today()}T12:00:00+05:30`, by: "Synthetic E2E fixture",
      counts: { firms: 0, customers: 1, suppliers: 0, products: 0, sales: 0, cancelled: 0, purchases: 0, people: 0, audit: 0, bin: 0 },
      v3: { bin: [], shop_settings: {}, people: [], filed_periods: [], filing: { filing_records: [], filing_months: [], opening_credits: [] }, audit_log: [] },
    } : {}),
  };
  return { name: `gst-backup-${today()}.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) };
}

async function previewFile(page, file) {
  const answer = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/backup/restore/preview/" && response.request().method() === "POST");
  await page.getByLabel("Backup file to restore").setInputFiles(file);
  const response = await answer;
  expect(response.ok()).toBe(true);
  return response.json();
}

async function openRestoreConfirmation(page, words) {
  await main(page).getByRole("button", { name: `Add ${words}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Restore from this backup?" });
  await expect(dialog).toBeVisible();
  await afterDialog(page);
  await expect(dialog.getByRole("button", { name: `Add ${words}`, exact: true })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: `I understand this adds ${words} to what's on file now.` }).check();
  return dialog;
}

makesBills(test);
test.afterEach(async ({ request }) => {
  const api = client(request);
  const failures = [];
  for (const name of [...names]) {
    names.delete(name);
    try {
      const rows = await api.get("customers/", { search: name, page_size: 100 });
      for (const row of rows.results.filter((customer) => customer.name === name)) await api.del(`customers/${row.id}/`);
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  expect(failures, "Test customers still live or unchecked").toEqual([]);
});

test("revert a phone change, undo an unused customer, and restore it under its original id", async ({ page, request }) => {
  const api = client(request);
  const customer = await newCustomer(api, "Audit");
  const changedPhone = mobile();
  await api.patch(`customers/${customer.id}/`, { mobile_number: changedPhone });
  const change = await auditFor(api, customer, "updated");
  await openAudit(page, customer.name);
  await main(page).getByRole("button", { name: `Revert ${customer.name}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Put back ${customer.name} as it was?` });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Only these fields go back.");
  await expect(dialog).toContainText(change.changes.find((field) => field.key === "mobile_number").from);
  await afterDialog(page);
  await dialog.getByRole("button", { name: "Revert", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await api.get(`customers/${customer.id}/`)).mobile_number).toBe(customer.mobile_number);

  await main(page).getByRole("button", { name: `Undo ${customer.name}`, exact: true }).click();
  const undo = page.getByRole("dialog", { name: `Undo adding ${customer.name}?` });
  await expect(undo).toBeVisible();
  await afterDialog(page);
  await undo.getByRole("button", { name: `Remove ${customer.name}`, exact: true }).click();
  await expect(undo).toBeHidden();
  expect((await api.get("customers/", { search: customer.name })).results.map((row) => row.id)).not.toContain(customer.id);
  const deletion = await auditFor(api, customer, "deleted");
  const restored = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/audit/${deletion.id}/restore/` && response.request().method() === "POST");
  await main(page).getByRole("button", { name: `Restore ${customer.name}`, exact: true }).click();
  expect((await restored).ok()).toBe(true);
  expect((await api.get(`customers/${customer.id}/`)).name).toBe(customer.name);
});

test("a phone changed on another device after the dialog opens is not overwritten by revert", async ({ page, request }) => {
  const api = client(request);
  const customer = await newCustomer(api, "Audit race");
  await api.patch(`customers/${customer.id}/`, { mobile_number: mobile() });
  const change = await auditFor(api, customer, "updated");
  await openAudit(page, customer.name);
  await main(page).getByRole("button", { name: `Revert ${customer.name}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Put back ${customer.name} as it was?` });
  await expect(dialog).toBeVisible();
  const latest = mobile();
  await api.patch(`customers/${customer.id}/`, { mobile_number: latest });
  await afterDialog(page);
  const refused = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/audit/${change.id}/revert/` && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Revert", exact: true }).click();
  expect((await refused).status()).toBe(409);
  await expect(dialog).toContainText("Phone changed again since. Revert the later change first.");
  expect((await api.get(`customers/${customer.id}/`)).mobile_number).toBe(latest);
});

test("restore a deleted bill through the bin-id link after seeing its effect", async ({ page, request }) => {
  const api = client(request);
  const bill = await newBill(api);
  const binned = await api.del(`sales/${bill.id}/`, { reason: "Test bill" });
  const log = await api.get("audit/", { entity: "invoice", entity_id: bill.id });
  const deletion = log.results.find((entry) => entry.action === "deleted");
  expect(deletion.can.kind).toBe("restore");
  expect(deletion.can.disabled).toBe("");
  expect(deletion.can.effect.length).toBeGreaterThan(0);
  await page.goto(`/audit?restore=${binned.id}`);
  const dialog = page.getByRole("dialog", { name: `Restore ${bill.number}?` });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(deletion.can.effect);
  await afterDialog(page);
  await dialog.getByRole("button", { name: "Restore the bill", exact: true }).click();
  await expect(dialog).toBeHidden();
  const restored = await api.get(`sales/${bill.id}/`);
  expect(restored.id).toBe(bill.id);
  expect(restored.invoice_number).toBe(bill.number);
});

test("download a complete version 5 backup and record the finished download", async ({ page, request }, info) => {
  await openBackup(page);
  const downloaded = page.waitForEvent("download");
  await main(page).getByRole("button", { name: "Download full backup", exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/^gst-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const saved = info.outputPath(download.suggestedFilename());
  await download.saveAs(saved);
  const data = JSON.parse(fs.readFileSync(saved, "utf8"));
  expect(data.app).toBe("gst-billing");
  expect(data.version).toBe("5.0");
  for (const field of ["businesses", "customers", "products", "invoices"]) expect(Array.isArray(data[field])).toBe(true);
  expect(data.businesses.length).toBe(data.counts.firms);
  expect(Object.keys(data.v3)).toEqual(expect.arrayContaining(["bin", "shop_settings", "people", "filed_periods", "filing", "audit_log"]));
  for (const person of data.v3.people) expect(Object.keys(person).sort()).toEqual(["active", "email", "first_name", "last_name", "role", "username"]);
  for (const firm of data.businesses) expect(Object.keys(firm)).not.toContain("signature_image_base64");
  const summary = await client(request).get("backup/summary/");
  expect(summary.recent[0].file).toBe(download.suggestedFilename());
});

for (const version of ["4.0", "3.0", "5.0"]) {
  test(`preview and restore a synthetic version ${version} backup, then skip it on a second preview`, async ({ page, request }) => {
    const api = client(request);
    const name = unique(`Restore v${version}`);
    names.add(name);
    const file = backupFile(version, name);
    await openBackup(page);
    const preview = await previewFile(page, file);
    expect(preview.file.kind).toBe(version === "5.0" ? "this_app" : version === "4.0" ? "old_v4" : "old_v3");
    expect(preview.plan.adds).toBe(1);
    expect(preview.plan.words).toBe("1 customer");
    const dialog = await openRestoreConfirmation(page, preview.plan.words);
    const applied = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/backup/restore/" && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Add 1 customer", exact: true }).click();
    const response = await applied;
    expect(response.ok()).toBe(true);
    const result = await response.json();
    expect(result.added.customers).toHaveLength(1);
    await expect(main(page).getByText("Added 1 customer", { exact: true })).toBeVisible();
    expect((await api.get(`customers/${result.added.customers[0]}/`)).name).toBe(name);
    await openBackup(page);
    const again = await previewFile(page, file);
    expect(again.plan.adds).toBe(0);
    expect(again.plan.customers.skip_count).toBe(1);
    await expect(main(page).getByText("Nothing to add", { exact: true })).toBeVisible();
  });
}

test("restore notices that the books changed after preview and leaves the newer customer untouched", async ({ page, request }) => {
  const api = client(request);
  const name = unique("Restore race");
  names.add(name);
  await openBackup(page);
  const preview = await previewFile(page, backupFile("4.0", name));
  const dialog = await openRestoreConfirmation(page, preview.plan.words);
  const addedElsewhere = await api.post("customers/", bodyFor(name));
  const apply = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/backup/restore/" && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Add 1 customer", exact: true }).click();
  const response = await apply;
  expect(response.status()).toBe(409);
  expect((await response.json()).code).toBe("plan_changed");
  await expect(main(page)).toContainText("The books changed since the preview. Check the new plan, then restore.");
  const rows = (await api.get("customers/", { search: name })).results.filter((row) => row.name === name);
  expect(rows.map((row) => row.id)).toEqual([addedElsewhere.id]);
});

test("merge a duplicate only after choosing the customer and acknowledging removal", async ({ page, request }) => {
  const api = client(request);
  const source = await newCustomer(api, "Merge source");
  const target = await newCustomer(api, "Merge kept", source.mobile_number);
  const duplicates = await api.get("customers/duplicates/");
  expect(duplicates.groups.some((group) => group.customers.some((row) => row.id === source.id)
    && group.customers.some((row) => row.id === target.id))).toBe(true);
  await page.goto(`/customers/${source.id}?merge=${target.id}`);
  const dialog = page.getByRole("dialog", { name: `Merge ${source.name} into another customer` });
  await expect(dialog).toBeVisible();
  await afterDialog(page);
  await expect(dialog.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Merge", exact: true })).toBeDisabled();
  await dialog.getByRole("searchbox", { name: "Find the customer to keep" }).fill(target.name);
  await dialog.getByRole("radio", { name: new RegExp(esc(target.name)) }).click();
  const commit = dialog.getByRole("button", { name: `Merge into ${target.name}`, exact: true });
  await expect(commit).toBeDisabled();
  await expect(dialog).toContainText(`${target.name} keeps its name, phone, GSTIN and address.`);
  await dialog.getByRole("checkbox", { name: `I understand ${source.name} will be removed, and this can't be undone from the Audit log.` }).check();
  await commit.click();
  await expect(page).toHaveURL(new RegExp(`/customers/${target.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: target.name, exact: true })).toBeVisible();
  expect((await api.get("customers/", { search: source.name })).results.map((row) => row.id)).not.toContain(source.id);
  expect((await auditFor(api, target, "merged")).can).toBeNull();
});

test("a merge refused after its preview (the kept customer removed elsewhere) sends one request and merges nothing", async ({ page, request }) => {
  const api = client(request);
  const source = await newCustomer(api, "Race source");
  const target = await newCustomer(api, "Race kept", source.mobile_number);
  await page.goto(`/customers/${source.id}?merge=${target.id}`);
  const dialog = page.getByRole("dialog", { name: `Merge ${source.name} into another customer` });
  await expect(dialog).toBeVisible();
  await afterDialog(page);
  await dialog.getByRole("searchbox", { name: "Find the customer to keep" }).fill(target.name);
  await dialog.getByRole("radio", { name: new RegExp(esc(target.name)) }).click();
  await expect(dialog).toContainText(`${target.name} keeps its name, phone, GSTIN and address.`);
  const tick = dialog.getByRole("checkbox", { name: `I understand ${source.name} will be removed, and this can't be undone from the Audit log.` });
  await tick.check();
  // Another device removes the kept customer between the preview and the click.
  await api.del(`customers/${target.id}/`);
  const posts = [];
  page.on("request", (req) => { if (req.method() === "POST" && new URL(req.url()).pathname.endsWith("/merge-into/")) posts.push(req.url()); });
  const answer = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/customers/${source.id}/merge-into/`);
  await dialog.getByRole("button", { name: `Merge into ${target.name}`, exact: true }).click();
  expect((await answer).ok()).toBe(false);
  await expect(dialog.getByRole("alert")).toContainText("Not merged");
  await expect(tick).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: `Merge into ${target.name}`, exact: true })).toBeDisabled();
  await page.waitForTimeout(1_000);
  expect(posts).toHaveLength(1);
  expect((await api.get("customers/", { search: source.name })).results.map((row) => row.id)).toContain(source.id);
});

test("a backup of more than 3,000 bills is restored one financial year at a time, each with its own confirmation", async ({ page, request }) => {
  test.setTimeout(600_000);
  const api = client(request);
  const stamp = `${Date.now()}`;
  const firmName = `E2E YEARS FIRM ${stamp}`;
  const buyer = unique("Years buyer");
  names.add(buyer);
  const line = { product_name: "Silver", hsn_code: "711311", gst_tax_rate: "0.03", quantity: "1", rate: "100", unit: "gms" };
  const invoices = Array.from({ length: 3002 }, (_, n) => ({
    business: 901, customer: 902, invoice_number: `Y${stamp}/${n + 1}`, invoice_date: n < 1501 ? "2024-10-15" : "2025-10-15",
    type_of_invoice: "outward", total_amount: "103", line_items: [line],
  }));
  const data = { version: "4.0", exportedAt: `${today()}T12:00:00+05:30`, businesses: [{ id: 901, name: firmName, gst_number: "", state_name: "RAJASTHAN" }],
    customers: [{ id: 902, name: buyer, state_name: "RAJASTHAN" }], products: [], invoices };
  const file = { name: `gst-backup-${today()}.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) };
  const previews = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/backup/restore/preview/" && response.request().method() === "POST") previews.push(response);
  });
  try {
    await openBackup(page);
    const overview = await previewFile(page, file);
    test.skip(!overview.years, "X-40: 4B's per-year restore (P4-8) has not landed");
    expect(overview.years.map((year) => [year.fy, year.bills])).toEqual([["2024-25", 1501], ["2025-26", 1501]]);
    for (const [index, fy] of ["2024-25", "2025-26"].entries()) {
      await expect(main(page).getByText(`Financial year ${fy}`, { exact: true })).toBeVisible();
      await expect.poll(() => previews.length, { timeout: 120_000 }).toBeGreaterThanOrEqual(index + 2);
      const checked = await previews[index + 1].json();
      expect(checked.fy).toBe(fy);
      const dialog = await openRestoreConfirmation(page, checked.plan.words);
      await expect(dialog).toContainText(fy);
      const apply = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/backup/restore/" && response.request().method() === "POST", { timeout: 300_000 });
      await dialog.getByRole("button", { name: `Add ${checked.plan.words}`, exact: true }).click();
      const applied = await apply;
      expect(applied.ok()).toBe(true);
      expect(applied.request().postData()).toContain(checked.fingerprint);
    }
    await expect(main(page).getByText("Finished checking 2 financial years")).toBeVisible({ timeout: 120_000 });
    await expect(main(page)).toContainText("Added 3,002 bills across these years.");
  } finally {
    // The restored bills go to the bin so the firm and buyer leave nothing live behind.
    const firms = await api.get("businesses/");
    const firm = (firms.results ?? firms).find((row) => row.name === firmName);
    if (firm) {
      const tried = new Set();
      for (const fy of ["2024-25", "2025-26"]) {
        for (;;) {
          const bills = (await api.get("sales/", { business_id: firm.id, fy, page_size: 100 })).results.filter((bill) => !tried.has(bill.id));
          if (!bills.length) break;
          for (const bill of bills) { tried.add(bill.id); await removeBill(api, bill.id); }
        }
      }
    }
  }
});

test("the customer form uses the real GSTIN registry endpoint and keeps the name already typed", async ({ page }) => {
  await page.goto("/customers/new");
  await expect(page.getByRole("heading", { level: 1, name: "Add customer" })).toBeVisible();
  await opened(page);
  const name = unique("Lookup only");
  await page.getByLabel("Name", { exact: true }).fill(name);
  const gstin = "08AAMFR5567K1ZG";
  const answer = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/registry/${gstin}/`);
  await page.getByLabel("GSTIN", { exact: true }).fill(gstin);
  const response = await answer;
  expect(response.ok()).toBe(true);
  const found = await response.json();
  expect(["found", "unknown"]).toContain(found.status);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(name);
  await expect(page.getByLabel("PAN", { exact: true })).toHaveValue("AAMFR5567K");
  if (found.status === "found" && found.registry.active) {
    if (found.registry.address) await expect(page.getByRole("textbox", { name: "Address", exact: true })).toHaveValue(found.registry.address);
    if (found.registry.city) await expect(page.getByRole("textbox", { name: "City", exact: true })).toHaveValue(found.registry.city);
  } else if (found.lookup === "unreachable") {
    await expect(main(page)).toContainText("The GST registry didn't answer. The state and PAN come from the number itself.");
  }
  // This deliberately does not save a customer or demand availability of an external provider.
});

test("the loaded audit page makes no API reads during three idle minutes", async ({ page }) => {
  test.setTimeout(240_000);
  const loaded = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/audit/"
    && response.request().method() === "GET");
  await openAudit(page, "");
  expect((await loaded).ok()).toBe(true);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.waitForTimeout(1_000); // finish ordinary mount effects before observing an idle page
  const reads = [];
  const record = (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname.startsWith("/api/")) reads.push(`${url.pathname}${url.search}`);
  };
  page.on("request", record);
  try {
    await page.waitForTimeout(180_000);
  } finally {
    page.off("request", record);
  }
  expect(reads, "API GET requests made while the audit page was idle").toEqual([]);
});

for (const theme of ["obsidian", "pearl"]) {
  test(`WCAG 2.2 AA: audit, revert, backup, restore confirmation and merge in ${theme}`, async ({ page, request }, info) => {
    const api = client(request);
    const source = await newCustomer(api, "Accessible source");
    const target = await newCustomer(api, "Accessible kept", source.mobile_number);
    await api.patch(`customers/${source.id}/`, { mobile_number: mobile() });
    await page.addInitScript((value) => localStorage.setItem("gst3.theme", value), theme);
    await openAudit(page, source.name);
    expect(await measure(page), "audit page").toEqual([]);
    const auditPicture = info.outputPath(`records-audit-${theme}.png`);
    await page.screenshot({ path: auditPicture, fullPage: true });
    await info.attach(`Audit in ${theme}`, { path: auditPicture, contentType: "image/png" });
    await main(page).getByRole("button", { name: `Revert ${source.name}`, exact: true }).click();
    await expect(page.getByRole("dialog", { name: `Put back ${source.name} as it was?` })).toBeVisible();
    expect(await measure(page), "revert confirmation").toEqual([]);

    await openBackup(page);
    expect(await measure(page), "backup page").toEqual([]);
    const backupPicture = info.outputPath(`records-backup-${theme}.png`);
    await page.screenshot({ path: backupPicture, fullPage: true });
    await info.attach(`Backup in ${theme}`, { path: backupPicture, contentType: "image/png" });
    const restoredName = unique("Accessible restore");
    const preview = await previewFile(page, backupFile("4.0", restoredName));
    expect(await measure(page), "restore preview").toEqual([]);
    await openRestoreConfirmation(page, preview.plan.words);
    expect(await measure(page), "restore confirmation").toEqual([]);

    await page.goto(`/customers/${source.id}?merge=${target.id}`);
    const merge = page.getByRole("dialog", { name: `Merge ${source.name} into another customer` });
    await expect(merge).toBeVisible();
    await afterDialog(page);
    await merge.getByRole("searchbox", { name: "Find the customer to keep" }).fill(target.name);
    await merge.getByRole("radio", { name: new RegExp(esc(target.name)) }).click();
    await expect(merge).toContainText(`${target.name} keeps its name, phone, GSTIN and address.`);
    expect(await measure(page), "merge preview").toEqual([]);
  });
}
