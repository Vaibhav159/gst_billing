// Printing (part 1E) against the real server. A real PDF made in the browser is read back: each copy's mark, the bill's
// full number, the bank details, the total to the paisa with its ₹ in its own one-glyph font (nothing is rounded:
// Ruling 1B-12), the amount in words and what the QR code carries. Then a two-page bill, a batch of three bills from two
// firms, Send from the print page, the browser's own print, the phone's options sheet and Share, and WCAG 2.2 AA on the
// print page in both themes. Every PDF made is kept in E2E_PDF_DIR (else the test's output folder), for the owner to see.
const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { measure } = require("./axe");
const { opened } = require("./session");
const { afterDialog, client, makesBills, newBill, someCustomer } = require("./sales-data");
const { pdfFonts, pdfPageCount, pdfPages, pdfSubject } = require("./pdf-text");

// every bill a test makes goes to the bin after it (sales-data.js)
makesBills(test);

const hasBank = (f) => Boolean(String(f.bank_account_number || "").trim());
/**
 * CI's one firm has no bank account: this one is made there once, by name, and kept, as sales-data's walkIn does. Its
 * name sorts after CI's TEST JEWELLERS (firms are listed by name), so every other spec's first firm stays CI's own.
 */
const PRINT_FIRM = "TEST PRINT FIRM (e2e)";
/**
 * Two firms to bill from, read at run time: one with a bank account for the PDF to print, one with a prefix first (the
 * sandbox's KIRAN prints its full numbers, KGH/2026-27/N), and another firm, or none where there's only the one (a spec
 * then skips). Where no firm has an account (CI), PRINT_FIRM, found by name or made; the sandbox's firms all have one.
 */
async function twoFirms(api) {
  const { results } = await api.get("businesses/", { page_size: 100 });
  const banked = results.filter(hasBank);
  const firm = banked.find((f) => f.invoice_prefix) ?? banked[0] ?? results.find((f) => f.name === PRINT_FIRM) ?? await api.post("businesses/", {
    name: PRINT_FIRM, address: "1 Test Road, Udaipur, Rajasthan", gst_number: "08AAKFS4821M1ZQ", state_name: "RAJASTHAN", pan_number: "AAKFS4821M",
    mobile_number: "9999999998", invoice_prefix: "TPF", bank_name: "Test Bank", bank_account_number: "000111222333", bank_ifsc_code: "TEST0000123", bank_branch_name: "Udaipur",
  });
  return [firm, results.find((f) => f.id !== firm.id)];
}
/** The file kept for the owner: E2E_PDF_DIR, or this test's output folder. */
function keep(info, name) {
  const dir = process.env.E2E_PDF_DIR || info.outputDir;
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}
/** Presses `button` once the PDF behind it is made (react-pdf loads on the first one), and keeps what downloads. */
async function download(page, button, file) {
  await expect(button).toBeEnabled({ timeout: 30_000 });
  const [d] = await Promise.all([page.waitForEvent("download"), button.click()]);
  await d.saveAs(file);
  return { name: d.suggestedFilename(), buf: fs.readFileSync(file) };
}
/** The print page, open on its paper (in the shop's default copies, whichever they are) and past the page frame's guard. */
async function openPrint(page, bill) {
  await page.goto(`/sales/${bill.id}/print`);
  await expect(page.getByRole("document", { name: `Bill ${bill.number} on paper, ` }).first()).toBeVisible({ timeout: 20_000 });
  await opened(page);
}
const squash = (s) => s.replace(/\s+/g, "");
/** An amount as the bill prints it: Indian grouping, two decimals ("6707.88" prints "6,707.88"). */
const asPrinted = (amount) => Number(amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Each page's copy mark, in page order. */
const marks = (pages) => pages.map((p) => p.match(/\((ORIGINAL|DUPLICATE|TRIPLICATE) FOR (RECIPIENT|TRANSPORTER|SUPPLIER)\)/)?.[0]);
const ORIGINAL = "(ORIGINAL FOR RECIPIENT)";
const DUPLICATE = "(DUPLICATE FOR TRANSPORTER)";
const TRIPLICATE = "(TRIPLICATE FOR SUPPLIER)";

test("desktop: a bill's PDF, all three copies, read back: each page's mark, its full number, bank details, the exact total with its own ₹, the amount in words, the QR's text", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop", "the desktop's print page");
  const api = client(request);
  const [firm] = await twoFirms(api);
  // ₹6,512.50 at 3% comes to paise (₹6,707.88): the PDF prints them, with no rupee rounding and no Rounded Off line
  const bill = await newBill(api, { firm, rate: "6512.500" });
  const d = await api.get(`sales/${bill.id}/`);
  expect(d.total_amount).not.toMatch(/\.00$/);
  await openPrint(page, bill);
  // bank details on and all three copies, whatever the shop's defaults are
  await page.getByRole("switch", { name: "Bank details on the bill" }).check();
  await page.getByRole("radio", { name: "All three" }).click();
  await expect(page.getByRole("document", { name: `Bill ${bill.number} on paper, triplicate copy` })).toBeVisible();
  const { name, buf } = await download(page, page.getByRole("button", { name: "PDF", exact: true }), keep(info, "all-three-copies.pdf"));
  expect(name).toMatch(/\.pdf$/);
  const pages = pdfPages(buf);
  expect(pages).toHaveLength(3);
  expect(marks(pages)).toEqual([ORIGINAL, DUPLICATE, TRIPLICATE]);
  for (const p of pages) {
    // the number in full, up to the next box ("Dated"): a firm with a prefix prints KGH/2026-27/N from the day its paper
    // bills carry it (the sandbox's KIRAN)
    expect(p).toContain(`Invoice No.${bill.number}Dated`);
    expect(p).toContain(d.firm.bank_name);
    expect(p).toContain(d.firm.bank_account_number);
    // the Total row's figure to the paisa, its ₹ in its own font: in Times, which has none, a ₹ prints as "¹"
    expect(p).toContain(`₹ ${asPrinted(d.total_amount)}`);
    expect(p).not.toContain("¹");
    expect(p).not.toContain("Rounded Off");
    expect(squash(p)).toContain(squash(`INR ${d.total_in_words}`));
  }
  // the one font of its own is the ₹'s, and it holds that one glyph: the rest is the PDF's built-in Times
  expect(pdfFonts(buf).filter((f) => f.chars !== null)).toEqual([{ name: expect.any(String), chars: "₹" }]);
  expect(pdfSubject(buf)).toBe(`${d.invoice_number}|${d.firm.gst_number}|${d.invoice_date}|${d.total_amount}`);
  // bank details off: the PDF has none
  await page.getByRole("switch", { name: "Bank details on the bill" }).uncheck();
  await page.getByRole("radio", { name: "Original", exact: true }).click();
  const off = pdfPages((await download(page, page.getByRole("button", { name: "PDF", exact: true }), keep(info, "original-no-bank.pdf"))).buf);
  expect(marks(off)).toEqual([ORIGINAL]);
  expect(off[0]).not.toContain("Company's Bank Details");
  expect(off[0]).not.toContain(d.firm.bank_account_number);
});

test("desktop: a long bill runs onto a second page under the short header, in each copy", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop", "the desktop's print page");
  const api = client(request);
  const [firm] = await twoFirms(api);
  const lines = Array.from({ length: 30 }, (_, i) => ({ product_name: `Gold Ring 22K (e2e) ${i + 1}`, hsn_code: "711319", gst_percent: "3", quantity: "1.000", unit: "gms", rate: "6500.000", note: i % 7 === 3 ? "Temple design" : "" }));
  const bill = await newBill(api, { firm, lines });
  await openPrint(page, bill);
  await page.getByRole("radio", { name: "Original", exact: true }).click();
  await expect(page.getByRole("document", { name: `Bill ${bill.number} on paper, original copy, page 2 of 2`, exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "All three" }).click();
  const { buf } = await download(page, page.getByRole("button", { name: "PDF", exact: true }), keep(info, "two-page-bill.pdf"));
  expect(pdfPageCount(buf)).toBe(6);
  const pages = pdfPages(buf);
  expect(marks(pages)).toEqual([ORIGINAL, ORIGINAL, DUPLICATE, DUPLICATE, TRIPLICATE, TRIPLICATE]);
  for (const i of [0, 2, 4]) expect(pages[i]).toContain("continued on page 2");
  for (const i of [1, 3, 5]) {
    expect(pages[i]).toContain("Tax Invoice (continued, page 2)");
    expect(pages[i]).toContain("Page 2 of 2");
    expect(pages[i]).toContain("Gold Ring 22K (e2e) 30");
  }
});

test("desktop: a batch of three bills from two firms is one PDF, each bill's page in the order picked", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop", "the desktop's batch print");
  const api = client(request);
  const [a, b] = await twoFirms(api);
  test.skip(!b, "a batch from two firms needs a second firm");
  const customer = await someCustomer(api);
  const made = [await newBill(api, { firm: a, customer }), await newBill(api, { firm: a, customer }), await newBill(api, { firm: b, customer })];
  // picked in an order that is neither the bills' numbers nor their firms: a, b, then a again
  const bills = [made[0], made[2], made[1]];
  await page.goto(`/sales/batch?ids=${bills.map((x) => x.id).join(",")}`);
  await expect(page.getByRole("heading", { level: 1, name: "Batch print · 3 bills" })).toBeVisible({ timeout: 20_000 });
  await opened(page);
  await expect(page.getByText(/^3 bills from 2 firms: /).first()).toBeVisible();
  await page.getByRole("radio", { name: "Original only" }).click();
  // each bill's paper (the page itself, <html>, is a document too)
  await expect(page.getByRole("document", { name: / on paper, / })).toHaveCount(3);
  const { buf } = await download(page, page.getByRole("button", { name: "One combined PDF" }), keep(info, "batch-two-firms.pdf"));
  const pages = pdfPages(buf);
  expect(marks(pages)).toEqual([ORIGINAL, ORIGINAL, ORIGINAL]);
  pages.forEach((p, i) => {
    expect(p).toContain(`Invoice No.${bills[i].number}Dated`);
    expect(p).toContain(bills[i].firmName);
  });
});

test("desktop: Send from the print page opens the customer's chat and downloads the Original beside it, and the send is recorded", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop", "the desktop's print page");
  const api = client(request);
  const bill = await newBill(api);
  // WhatsApp would open in a new tab: here window.open notes the address it was asked for and answers a stand-in tab
  // (the app takes a null answer for a tab the browser stopped, and records nothing)
  await page.addInitScript(() => { window.__opened = []; window.open = (url) => { window.__opened.push(String(url)); return { opener: null, closed: false }; }; });
  await openPrint(page, bill);
  await expect(page.getByRole("button", { name: "PDF", exact: true })).toBeEnabled({ timeout: 30_000 });
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Send on WhatsApp", exact: true }).click()]);
  const file = keep(info, "sent-on-whatsapp.pdf");
  await d.saveAs(file);
  // a send carries the recipient's copy (CGST Rule 48), whatever copies the page shows
  expect(marks(pdfPages(fs.readFileSync(file)))).toEqual([ORIGINAL]);
  await expect(page.getByText(`${bill.number} sent`, { exact: true })).toBeVisible();
  await expect(page.getByText(`${d.suggestedFilename()} downloads and WhatsApp opens a chat with ${bill.customerName}`)).toBeVisible();
  expect(await page.evaluate(() => window.__opened)).toEqual([expect.stringMatching(/^https:\/\/wa\.me\/91\d{10}\?text=/)]);
  expect((await api.get(`sales/${bill.id}/`)).sent).toMatchObject({ via: "whatsapp" });
});

test("desktop: the browser's own print shows only the paper, full size, whatever the text size; /media goes to the server", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop", "the desktop's print page");
  const api = client(request);
  const bill = await newBill(api);
  await page.addInitScript(() => localStorage.setItem("gst3.textSize", "1.2"));
  await openPrint(page, bill);
  await page.getByRole("radio", { name: "Original", exact: true }).click();
  await expect(page.getByRole("document", { name: `Bill ${bill.number} on paper, ` })).toHaveCount(1);
  expect(await page.evaluate(() => document.getElementById("root").style.zoom)).toBe("1.2");
  await page.emulateMedia({ media: "print" });
  expect(await page.evaluate(() => [getComputedStyle(document.getElementById("root")).zoom, getComputedStyle(document.getElementById("root")).display, getComputedStyle(document.querySelector("[data-print-copy]")).display]))
    .toEqual(["1", "none", "block"]);
  const printed = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  fs.writeFileSync(keep(info, "browser-print.pdf"), printed);
  expect(pdfPageCount(printed)).toBe(1);
  // the dev server sends /media to the server, as v2's does (part 0's carry), not to the app's own page
  const media = await request.get("/media/e2e-nothing-here", { headers: { accept: "text/html" } });
  expect(await media.text()).not.toContain('<div id="root">');
});

test("phone: the options sheet picks the copies; Share hands over the PDF (a download where there's no share sheet)", async ({ page, request }, info) => {
  test.skip(info.project.name !== "phone", "the phone's print page");
  const api = client(request);
  const bill = await newBill(api);
  await openPrint(page, bill);
  await page.getByRole("button", { name: "Options", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Print options" });
  await expect(dialog).toBeVisible();
  await afterDialog(page); // the dialog's guard against the tap that opened it
  await dialog.getByLabel("Copies").selectOption("all");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("document", { name: `Bill ${bill.number} on paper, triplicate copy` })).toBeAttached();
  const { buf } = await download(page, page.getByRole("button", { name: "Share", exact: true }), keep(info, "phone-share.pdf"));
  expect(pdfPageCount(buf)).toBe(3);
  expect(marks(pdfPages(buf))).toEqual([ORIGINAL, DUPLICATE, TRIPLICATE]);
});

for (const theme of ["obsidian", "pearl"]) {
  test(`desktop and phone: no WCAG 2.2 AA problems on the print page in ${theme}`, async ({ page, request }, info) => {
    const api = client(request);
    const bill = await newBill(api);
    await page.addInitScript((t) => localStorage.setItem("gst3.theme", t), theme);
    await openPrint(page, bill);
    await expect(page.locator("html")).toHaveClass(theme === "obsidian" ? "" : `theme-${theme}`);
    // with its PDF made, as it's used: PDF, Print and Share on, the phone's Share no longer busy
    await expect(page.getByRole("button", { name: info.project.name === "phone" ? "Share" : "PDF", exact: true })).toBeEnabled({ timeout: 30_000 });
    expect(await measure(page)).toEqual([]);
  });
}
