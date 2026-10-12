// Part 2D, live API checks. Run only after 2A and the 2B/2C adapters land.
// Photo tests require E2E_FAKE_READER=1 AND the assigned sandbox's AI_READER=fake.
// No test sets a real Gemini key or calls a production reader.
const { test, expect } = require("@playwright/test");
const { measure } = require("./axe");
const { opened, savedToken } = require("./session");
const { afterDialog, client, firstFirm, today, noteBill, makesBills } = require("./sales-data");

const SUPPLIER_NAME = "TEST IMPORT SUPPLIER (e2e)";
const PHOTO_NAMES = ["IMG_2041.jpg", "WhatsApp Image 2026-10-07 at 18.22.jpeg", "IMG_2046.jpg", "IMG_2047.jpg", "IMG_2049.png", "IMG_2050.jpg", "IMG_2052.jpg", "IMG_2053.jpg", "IMG_2055.jpg", "IMG_2056.jpg", "IMG_2058.jpg", "IMG_2060.heic"];
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4tCUFAARGAes42ZwhAAAAAElFTkSuQmCC", "base64");
const livePurchases = new Set(), pendingResponses = new Set();
let importedResponses = [];
const csvCell = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
const csvRow = values => values.map(csvCell).join(",");
const HEADER = ["Bill No.", "Date", "Party Name", "GSTIN", "Item", "HSN", "GST rate", "Quantity", "Unit", "Rate", "Taxable Value", "CGST", "SGST", "IGST", "Total", "Payment"];
const csvFile = (name, rows) => ({ name, mimeType: "text/csv", buffer: Buffer.from(rows.map(csvRow).join("\r\n")) });
// Name each synthetic fixture inside a valid PNG text chunk, so distinct fake bills have distinct bytes.
const syntheticPhoto = name => {
  const data = Buffer.from(`Fixture\0${name}`), chunk = Buffer.concat([Buffer.from("tEXt"), data]);
  let crc = 0xffffffff;
  for (const byte of chunk) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return { name, mimeType: "image/png", buffer: Buffer.concat([PIXEL.subarray(0, -12), size, chunk, checksum, PIXEL.subarray(-12)]) };
};

/** One reusable, unregistered supplier, kept like sales-data's Walk-in Customer fixture. */
async function supplier(api) {
  const found = (await api.get("suppliers/", { q: SUPPLIER_NAME, page_size: 100 })).results.find(row => row.name === SUPPLIER_NAME);
  return found ?? api.post("suppliers/", { name: SUPPLIER_NAME, gst_number: "", state_name: "RAJASTHAN", city: "Jaipur", address: "Synthetic e2e supplier", mobile_number: "", pan_number: "", email: "" });
}
async function go(page, path, heading) {
  await page.goto(path);
  await expect(page).toHaveURL(url => url.pathname === path.split("?")[0]);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  await opened(page);
}
async function chooseRegister(page, file, firmId) {
  await page.locator('input[type="file"][accept*=".csv"]').setInputFiles(file);
  await page.getByRole("button", { name: "Next: check the layout" }).click();
  await expect(page.getByLabel("Whose bills", { exact: true })).toBeVisible();
  await page.getByLabel("Whose bills", { exact: true }).selectOption(String(firmId));
  await page.getByRole("button", { name: "Next: check the bills" }).click();
}

test.beforeEach(async ({ page }) => {
  importedResponses = [];
  page.on("response", response => {
    const match = /\/api\/(purchases|sales)\/import\/$/.exec(new URL(response.url()).pathname);
    if (!match || response.request().method() !== "POST" || !response.ok()) return;
    const pending = (async () => {
      const answer = await response.json();
      importedResponses.push({ kind: match[1], request: response.request().postDataJSON(), answer });
      if (answer.dry_run || !answer.ok) return;
      const input = response.request().postDataJSON();
      for (const row of answer.bills) {
        if (!row.id) continue;
        if (match[1] === "purchases") livePurchases.add(row.id);
        else noteBill(row.id, input.bills.find(bill => bill.ref === row.ref).invoice_number);
      }
    })();
    pendingResponses.add(pending);
    void pending.finally(() => pendingResponses.delete(pending));
  });
});
// AfterEach survives a test timeout. It removes only ids made by this file, never seed rows.
test.afterEach(async ({ page, request }) => {
  await page.unrouteAll({ behavior: "wait" });
  await Promise.all([...pendingResponses]);
  const api = client(request), headers = { Authorization: `Bearer ${savedToken()}` }, errors = [];
  for (const id of [...livePurchases]) {
    try {
      const detail = await api.get(`purchases/${id}/`);
      if (detail.linked_sale) noteBill(detail.linked_sale.id, detail.linked_sale.invoice_number);
      const response = await request.delete(`/api/purchases/${id}/`, { headers, data: { reason: "Synthetic import test" } });
      expect(response.ok() || response.status() === 404, `test purchase ${id} cleanup`).toBe(true);
      livePurchases.delete(id);
    } catch (error) { errors.push(`purchase ${id}: ${error.message}`); }
  }
  expect(errors, "Only test purchases still live or unchecked").toEqual([]);
});
makesBills(test);

test("suppliers search and detail agree with the live endpoint", async ({ page, request }) => {
  const api = client(request), person = await supplier(api);
  await go(page, "/suppliers", "Suppliers");
  await page.getByRole("searchbox", { name: "Search suppliers" }).fill(SUPPLIER_NAME);
  const link = page.getByRole("link", { name: SUPPLIER_NAME });
  await expect(link).toHaveAttribute("href", `/suppliers/${person.id}`);
  await link.click(); await expect(page.getByRole("heading", { level: 1, name: SUPPLIER_NAME })).toBeVisible(); await opened(page);
  await expect(page.getByText("None: no GSTIN, so no GST and no credit", { exact: true })).toBeVisible();
  const detail = await api.get(`suppliers/${person.id}/`);
  expect(detail.supplier.id).toBe(person.id);
  await expect(page.getByRole("link", { name: /Add (a )?purchase/ }).last()).toHaveAttribute("href", new RegExp(`supplier=${person.id}(?:&|$)`));
});

test("mixed CSV checks both batches before writes and imports only selected bills", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop", "Imports are done on the computer; phone guidance is checked below.");
  const api = client(request), firm = await firstFirm(api), person = await supplier(api), day = today();
  const next = await api.get("sales/next-number/", { business_id: firm.id, invoice_date: day });
  const buyNumber = `E2E-P2D-${Date.now()}`;
  const file = csvFile("Synthetic sale and purchase.csv", [
    [firm.name], [`GSTIN: ${firm.gst_number}`], ["Outward Supply"], HEADER,
    [next.invoice_number, day, person.name, "", "Synthetic gold item", "7113", "0", "1", "gms", "12.34", "12.34", "0", "0", "0", "12.34", "cash"],
    ["Inward Supply"], HEADER,
    [buyNumber, day, person.name, "", "Synthetic scrap", "7112", "0", "2", "gms", "12.34", "24.68", "0", "0", "0", "24.68", "bank"],
  ]);
  await go(page, "/import?type=purchases", /Import .*Excel or Tally/);
  await chooseRegister(page, file, firm.id);
  await expect(page.getByRole("checkbox", { name: `Import ${buyNumber}`, exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: `Import ${next.invoice_number}`, exact: true })).toBeChecked();
  await page.getByRole("checkbox", { name: `Import ${next.invoice_number}`, exact: true }).uncheck();
  await expect(page.getByRole("button", { name: "Next: import 1 bill" })).toBeVisible();
  await page.getByRole("checkbox", { name: `Import ${next.invoice_number}`, exact: true }).check();
  await page.getByRole("button", { name: "Next: import 2 bills" }).click();
  await expect(page.getByRole("button", { name: "Import 2 bills", exact: true })).toBeVisible();
  await expect.poll(() => importedResponses.filter(row => row.request.dry_run).map(row => row.kind).sort()).toEqual(["purchases", "sales"]);
  expect(importedResponses.filter(row => !row.request.dry_run)).toEqual([]);
  await page.getByRole("button", { name: "Import 2 bills", exact: true }).click();
  await expect(page.getByRole("link", { name: `Open ${buyNumber}`, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: `Open ${next.invoice_number}`, exact: true })).toBeVisible();
  // The two batches finish separately, and their response listeners parse JSON asynchronously.
  await expect.poll(() => importedResponses.filter(row => !row.request.dry_run).map(row => row.kind).sort()).toEqual(["purchases", "sales"]);
  const written = importedResponses.filter(row => !row.request.dry_run);
  expect(written).toHaveLength(2); expect(written.every(row => row.answer.ok && row.answer.bills.every(bill => bill.id))).toBe(true);
  const purchase = written.find(row => row.kind === "purchases").answer.bills[0];
  const stored = await api.get(`purchases/${purchase.id}/`);
  expect(stored.invoice_number).toBe(buyNumber); expect(stored.source).toBe("excel"); expect(stored.needs_review).toBe(false); expect(stored.credit.eligible).toBe(true);
  expect(stored.history.activity.some(row => row.details.includes(file.name))).toBe(true);
});

test("a duplicate dry run refuses the batch without writing its otherwise valid bill", async ({ request }) => {
  const api = client(request), firm = await firstFirm(api), person = await supplier(api), stamp = Date.now();
  const input = { business: firm.id, supplier: person.id, invoice_number: `E2E-DUP-${stamp}`, invoice_date: today(), payment_mode: "", itc_eligible: true, itc_month: null, buyer_gstin: "", buyer_ack: false, lines: [{ product_name: "Synthetic scrap", hsn_code: "7112", gst_percent: "0", quantity: "1", unit: "gms", rate: "1.00", note: "" }] };
  const existing = await api.post("purchases/", input); livePurchases.add(existing.id);
  const newNumber = `E2E-NEW-${stamp}`;
  const body = { file_name: "Duplicate check.csv", dry_run: false, suppliers: [], bills: [{ ...input, ref: "Existing" }, { ...input, invoice_number: newNumber, ref: "New" }] };
  const result = await api.post("purchases/import/", body);
  const lookup = await api.get("purchases/", { business_id: firm.id, q: newNumber, page_size: 100 });
  for (const row of lookup.results.filter(row => row.invoice_number === newNumber)) livePurchases.add(row.id);
  expect(result.ok).toBe(false); expect(result.bills.every(row => row.id === null)).toBe(true);
  expect(result.bills.find(row => row.ref === "Existing").duplicate.id).toBe(existing.id);
  expect(lookup.results.some(row => row.invoice_number === newNumber)).toBe(false);
});

test("an old Excel file gives the exact save-as guidance", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Imports are done on the computer; phone guidance is checked below.");
  await go(page, "/import?type=purchases", /Import .*Excel or Tally/);
  await page.locator('input[type="file"][accept*=".csv"]').setInputFiles({ name: "Old register.xls", mimeType: "application/vnd.ms-excel", buffer: Buffer.from("Synthetic old Excel input") });
  await expect(page.getByText("Old register.xls is in the old Excel format (.xls). In Excel, use File › Save as › Excel Workbook (.xlsx), or CSV, and choose that file.", { exact: true })).toBeVisible();
});

test("pre-April-2025 import previews remain outside the credit ledger", async ({ request }) => {
  const api = client(request), firm = await firstFirm(api), person = await supplier(api);
  const result = await api.post("purchases/import/", {
    file_name: "Synthetic opening-ledger check.csv", dry_run: true, suppliers: [],
    bills: [{ ref: "Before ledger", business: firm.id, supplier: person.id, invoice_number: `E2E-PRELEDGER-${Date.now()}`, invoice_date: "2025-03-31", payment_mode: "", itc_eligible: true, itc_month: null, buyer_gstin: "", buyer_ack: false,
      lines: [{ product_name: "Synthetic old scrap", hsn_code: "7112", gst_percent: "0", quantity: "1", unit: "gms", rate: "1.00", note: "" }] }],
  });
  expect(result).toMatchObject({ dry_run: true, ok: true });
  expect(result.bills).toHaveLength(1);
  expect(result.bills[0]).toMatchObject({ ref: "Before ledger", ok: true, id: null, credit: { month: null, chosen: null, late: false, eligible: true, lapsed: false, claimed: "0.00", state: "outside", filed_on: null } });
  const months = await api.get("purchases/credit-months/", { business_id: firm.id, invoice_date: "2025-03-31" });
  expect(months).toMatchObject({ bill_month: "2025-03", bill_month_closed: false, default: null, options: [], lapsed: false });
});

test("twelve synthetic photos are read once, retain rows, and show both directions and a firm pair", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Batch photo reading is a computer flow; the phone guidance has its own assertion.");
  test.skip(process.env.E2E_FAKE_READER !== "1", "Enable only against the assigned sandbox configured with AI_READER=fake.");
  test.setTimeout(90_000);
  let reads = 0;
  page.on("request", request => { if (/\/api\/purchases\/read\/$/.test(new URL(request.url()).pathname)) reads++; });
  await go(page, "/purchases/ai-import", "Import bill photos");
  expect(reads, "opening the importer does not ask AI to read").toBe(0);
  const firstReading = page.waitForResponse(async response => /\/api\/purchases\/read\/$/.test(new URL(response.url()).pathname)
    && response.ok() && (await response.json()).invoice_number === "UBS/26-27/0866");
  await page.getByLabel("Choose files", { exact: true }).setInputFiles(PHOTO_NAMES.map(syntheticPhoto));
  await expect(page.getByText("All 12 bills read", { exact: true })).toBeVisible({ timeout: 45_000 });
  const firstRead = await (await firstReading).json();
  for (const name of PHOTO_NAMES) await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
  expect(reads).toBe(12);
  await expect(page.getByText("Sale + purchase between your firms", { exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Sale", exact: true }).first()).toBeVisible();
  await expect(page.getByText("AI reads this month:", { exact: false })).toBeVisible();
  await expect(page.getByText(/of 1,500|used up|reads left/)).toHaveCount(0);
  const row = page.getByRole("region", { name: "IMG_2041.jpg", exact: true });
  await expect(row.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
  const checkbox = row.getByRole("checkbox");
  await expect(checkbox).toBeVisible(); await checkbox.uncheck(); await checkbox.check();
  expect(reads, "selection changes never re-read a successful photo").toBe(12);
  await expect(row.getByRole("group", { name: "Input tax credit for IMG_2041.jpg" })).toContainText("net credit, 4(C)");
  await row.getByRole("button", { name: "Check and edit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Check purchase bill · IMG_2041.jpg", exact: true });
  await expect(dialog).toBeVisible(); await afterDialog(page);
  const photo = dialog.getByRole("group", { name: "Photo IMG_2041.jpg. Use + and − to zoom, drag or scroll to move around.", exact: true });
  await expect(photo.getByRole("img", { name: "Photo IMG_2041.jpg, page 1", exact: true })).toHaveAttribute("src", /^blob:/);
  await expect(photo.locator("[data-focused], [data-field], [data-box]")).toHaveCount(0);
  for (const [key, label] of [["supplier", "supplier"], ["gstin", "GSTIN"], ["bill_no", "bill number"], ["date", "date"], ["amounts", "quantities and rates"]]) {
    const field = dialog.getByRole("group", { name: label, exact: true });
    await expect(field).toBeVisible();
    await expect(field.getByText("Needs a check", { exact: true })).toHaveCount(firstRead.confidence[key] === "medium" ? 1 : 0);
  }
  await expect(dialog.getByRole("group", { name: "date", exact: true })).toContainText(firstRead.invoice_date);
  await dialog.getByRole("button", { name: "Zoom in", exact: true }).click(); await expect(dialog.getByText("150%", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
  expect(reads, "reviewing and refocusing the stored reading never sends it to AI again").toBe(12);
  await page.screenshot({ path: info.outputPath("twelve-synthetic-photos.png"), fullPage: true });
});

test("a blurred synthetic photo retries only when asked", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Photo reading needs the computer layout.");
  test.skip(process.env.E2E_FAKE_READER !== "1", "Enable only against AI_READER=fake; names containing blur fail by contract.");
  let reads = 0;
  page.on("request", request => { if (/\/api\/purchases\/read\/$/.test(new URL(request.url()).pathname)) reads++; });
  await go(page, "/purchases/ai-import", "Import bill photos");
  await page.getByLabel("Choose files", { exact: true }).setInputFiles(syntheticPhoto("blur-synthetic.png"));
  const row = page.getByRole("region", { name: "blur-synthetic.png", exact: true });
  await expect(row.getByRole("button", { name: "Try again", exact: true })).toBeVisible({ timeout: 15_000 });
  expect(reads).toBe(1);
  await row.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(row.getByRole("button", { name: "Try again", exact: true })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => reads).toBe(2);
});

for (const theme of ["obsidian", "pearl"]) {
  test(`suppliers and import pages meet WCAG 2.2 AA in ${theme}`, async ({ page, request }, info) => {
    test.slow();
    const person = await supplier(client(request));
    await page.addInitScript(value => localStorage.setItem("gst3.theme", value), theme);
    for (const path of ["/suppliers", `/suppliers/${person.id}`, "/import?type=purchases", "/purchases/ai-import"]) {
      await page.goto(path); await expect(page).toHaveURL(url => url.pathname === path.split("?")[0]);
      await expect(page.locator("html")).toHaveClass(theme === "obsidian" ? "" : `theme-${theme}`);
      await opened(page);
      if ((path === "/purchases/ai-import" || path.startsWith("/import")) && info.project.name === "phone") {
        await expect(page.getByText("Imports are done on the computer", { exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: "Capture a bill", exact: true })).toHaveAttribute("href", "/capture");
        await expect(page.getByLabel("Choose files", { exact: true })).toHaveCount(0);
      }
      expect(await measure(page), `${path} ${info.project.name} ${theme}`).toEqual([]);
    }
  });
}
