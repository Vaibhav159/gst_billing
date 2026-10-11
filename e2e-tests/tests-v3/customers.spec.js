// Customers (part 1C) against the real server: add, find, change and delete a customer; a big bill's "PAN needed", Add
// PAN and the statement with its PDF; the phone's list and contact tiles; and WCAG 2.2 AA on the list, the form, a
// customer's page and their statement, in Obsidian and Pearl on a desktop and a phone. Records come from the API at run
// time, never from the seed's ids; what a test changes it puts back, or deletes, in an afterEach: a test that times out
// has its request disposed before a finally could use it.
const fs = require("fs");
const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { opened, savedToken } = require("./session");
const { client, firstFirm, newBill, removeBill, today } = require("./sales-data");

/** A number no one has: 98 and the clock's last eight digits. */
const freshMobile = () => `98${String(Date.now()).slice(-8)}`;
const main = (page) => page.locator("#app-main");
/** The answer to a customer's income-tax checks (sales/?customer_id=&itax=1), which show nothing while they load. */
const itaxAnswer = (page, customerId) => page.waitForResponse((r) => {
  const q = new URL(r.url()).searchParams;
  return r.url().includes("/api/sales/?") && q.get("itax") === "1" && q.get("customer_id") === String(customerId);
});
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A period that ends on `iso`'s day, as the statement names it: "5 to 5 Oct 2026" (format.ts rangeLabel), or "5 Oct 2026". */
function endsOn(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new RegExp(`(, |\\d to )${d} ${MONTHS[m - 1]} ${y}$`);
}
/** What the customer form saves (CustomerForm.tsx), so a test that saved it can put each one back as it was. */
const FORM_FIELDS = ["name", "mobile_number", "email", "customer_type", "gst_number", "pan_number", "address", "city", "state_name", "businesses"];
const saved = (c) => Object.fromEntries(FORM_FIELDS.map((k) => [k, k === "businesses" ? [...c.businesses].sort((x, y) => x - y) : c[k]]));

/**
 * A bill over ₹2,00,000 to a customer with no PAN: part 1A's sandbox seed has some; CI's seed has none, so it's made
 * here (a customer of its own and a 40 g bill at ₹6,500 a gram). made: the test made both, and removes them as far as
 * the server lets it (deleteMadeCustomer).
 */
async function bigBillWithoutPan(a) {
  const found = (await a.get("sales/", { itax: 1, page_size: 50 })).results.find((b) => b.itax.some((f) => f.kind === "pan"));
  if (found) return { id: found.id, invoice_number: found.invoice_number, invoice_date: found.invoice_date, customerId: found.customer.id, made: false };
  const firm = await firstFirm(a);
  const customer = await a.post("customers/", { name: `E2E Big Buyer ${Date.now()}`, state_name: firm.state_name || "RAJASTHAN", businesses: [firm.id] });
  const bill = await newBill(a, {
    firm, customer, lines: [{ product_name: "Gold Necklace 22K (e2e)", hsn_code: "711319", gst_percent: "3", quantity: "40.000", unit: "gms", rate: "6500.000", note: "" }],
  });
  return { id: bill.id, invoice_number: bill.number, invoice_date: today(), customerId: customer.id, made: true };
}

/**
 * Deletes a customer a test made. While a bill of theirs is in the bin the server keeps them, as a restore needs them
 * (409, "… in the bin still reference this record": billing/api/mixins.py); such a customer stays, on a database that
 * is thrown away after the run (CI's), and the test says so in its annotations.
 */
async function deleteMadeCustomer(request, id) {
  const r = await request.delete(`/api/customers/${id}/`, { headers: { Authorization: `Bearer ${savedToken()}` } });
  if (r.status() === 409 && /in the bin/.test((await r.json()).error ?? "")) {
    test.info().annotations.push({ type: "kept", description: `customer ${id}: the server keeps a customer while their bill is in the bin` });
    return;
  }
  expect([204, 404], `DELETE customers/${id}/ answered ${r.status()}`).toContain(r.status());
}

test.describe(() => {
  // the customer the add test made, deleted here when the test stopped before deleting it itself
  let added = null;
  test.afterEach(async ({ request }) => {
    if (!added) return;
    const name = added;
    added = null;
    const left = (await client(request).get("customers/", { search: name })).results.find((c) => c.name === name);
    if (left) await deleteMadeCustomer(request, left.id);
  });

  test("desktop: add a customer, find them first in the list, change their phone with Ctrl S, then delete them", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop");
    const name = `E2E Customer ${Date.now()}`;
    await page.goto("/customers");
    await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
    await expect(main(page).getByRole("searchbox", { name: "Search customers" })).toBeVisible(); // the list has loaded
    await opened(page);
    await main(page).getByRole("link", { name: "Add customer" }).click();
    await expect(page).toHaveURL(/\/customers\/new/);
    await opened(page);
    await page.locator("#cu-name").fill(name);
    await page.locator("#cu-phone").fill(freshMobile());
    added = name;
    await main(page).getByRole("button", { name: "Save customer" }).last().click();
    // back on the list, the new customer first and flashing: that's the confirmation
    await expect(page).toHaveURL(/\/customers$/);
    await expect(page.locator("tr.anim-flash")).toContainText(name);
    await opened(page);
    await page.locator("tr.anim-flash").getByRole("link", { name }).click();
    // exact: the form's title, "Edit <name>", has the name in it too
    await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
    await opened(page);
    await main(page).getByRole("link", { name: "Edit" }).click();
    await expect(page).toHaveURL(/\/edit$/);
    await opened(page);
    const phone = freshMobile();
    await page.locator("#cu-phone").fill(phone);
    await page.keyboard.press("Control+s");
    await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
    await expect(main(page).getByText(`${phone.slice(0, 5)} ${phone.slice(5)}`)).toBeVisible();
    await opened(page);
    // and away again (the owner may delete a customer with no bills), so a run leaves nothing behind
    await main(page).getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: /Delete customer/ }).click();
    const dialog = page.getByRole("dialog", { name: `Delete ${name}?` });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(400); // the dialog drops a click within 350 ms of opening (a double tap's second tap)
    await dialog.getByRole("button", { name: "Delete customer" }).click();
    await expect(page).toHaveURL(/\/customers$/);
    await expect(page.getByText(`${name} deleted`)).toBeVisible();
    added = null;
  });
});

test.describe(() => {
  // what the PAN test puts back: every field the form saved, as it was, and what it made, removed
  let undo = null;
  test.afterEach(async ({ request }) => {
    if (!undo) return;
    const { bill, before } = undo;
    undo = null;
    const a = client(request);
    await a.patch(`customers/${bill.customerId}/`, saved(before));
    if (bill.made) {
      await removeBill(a, bill.id);
      await deleteMadeCustomer(request, bill.customerId);
    } else {
      // the seed's PAN-less customer stays as it was for the next run
      expect(saved(await a.get(`customers/${bill.customerId}/`))).toEqual(saved(before));
    }
  });

  test("desktop: a big bill without the buyer's PAN says PAN needed; Add PAN clears it; the statement lists the bill as a PDF", async ({ page, request }, info) => {
    test.skip(info.project.name !== "desktop");
    const a = client(request);
    const bill = await bigBillWithoutPan(a);
    const before = await a.get(`customers/${bill.customerId}/`);
    undo = { bill, before };
    await page.goto(`/customers/${bill.customerId}`);
    await expect(page.getByRole("heading", { level: 1, name: before.name })).toBeVisible();
    const note = main(page).getByText(/^PAN needed: \d+ bills? over ₹2,00,000$/);
    await expect(note).toBeVisible();
    // the note names the bill first, the newest it counts (both lists are newest first)
    const named = new RegExp(`^${bill.invoice_number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[.,]`);
    await expect(main(page).getByText(/A bill over ₹2,00,000 needs the buyer's PAN/)).toHaveText(named);
    await opened(page);
    await main(page).getByRole("link", { name: "Add PAN" }).click();
    await expect(page).toHaveURL(new RegExp(`/customers/${bill.customerId}/edit\\?focus=pan$`));
    await opened(page);
    await expect(page.locator("#cu-pan")).toBeFocused();
    await page.locator("#cu-pan").fill("ABCDE1234F");
    // the save asks for the checks again: the note goes once they answer, not merely before the page has drawn it
    const rechecked = itaxAnswer(page, bill.customerId);
    await main(page).getByRole("button", { name: "Save changes" }).last().click();
    await expect(page).toHaveURL(new RegExp(`/customers/${bill.customerId}$`));
    await rechecked;
    await expect(note).toBeHidden();
    await opened(page);
    // every firm's bills, whichever firm this browser's picker starts on
    const allFirms = main(page).getByRole("button", { name: "Show all firms" });
    if (await allFirms.isVisible()) { await allFirms.click(); await expect(allFirms).toBeHidden(); }
    await main(page).getByRole("link", { name: "Statement" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Statement" })).toBeVisible();
    await opened(page);
    await page.getByRole("radio", { name: "Choose dates" }).click();
    await page.locator("#st-from").fill(bill.invoice_date);
    await page.locator("#st-to").fill(bill.invoice_date);
    // the bills of that day: the year shown first lists the bill too, and the PDF of a period on the way to that day
    // (the boxes settle one at a time) could be the one downloaded
    const day = main(page).getByRole("table", { name: endsOn(bill.invoice_date) });
    await expect(day.getByRole("link", { name: bill.invoice_number, exact: true })).toBeVisible();
    const pdfButton = main(page).getByRole("button", { name: "Download PDF" });
    await expect(pdfButton).toBeEnabled({ timeout: 15_000 }); // once the PDF is made (react-pdf loads on first use)
    const download = page.waitForEvent("download");
    await pdfButton.click();
    const slug = before.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const file = await download;
    expect(file.suggestedFilename()).toBe(`${slug}_statement_${bill.invoice_date}_to_${bill.invoice_date}.pdf`);
    // a PDF, not only a PDF's name
    expect(fs.readFileSync(await file.path()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});

test("desktop: the walk-in record says what it is, with no Edit or Delete", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop");
  const walkin = (await client(request).get("customers/", { type: "walkin", page_size: 1 })).results.find((c) => c.type === "walkin");
  test.skip(!walkin, "no walk-in record on file (part 1A's sandbox seed has one; CI's seed doesn't)");
  await page.goto(`/customers/${walkin.id}`);
  await expect(page.getByText("This record collects cash sales made without a name")).toBeVisible();
  await expect(main(page).getByRole("link", { name: "Edit" })).toHaveCount(0);
  await opened(page);
  await main(page).getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /All walk-in bills in Sales/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Delete customer/ })).toHaveCount(0);
});

test("phone: the list's Filters sheet and Add customer bar; a customer's Call, WhatsApp and Statement tiles", async ({ page, request }, info) => {
  test.skip(info.project.name !== "phone");
  await page.goto("/customers");
  await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add customer" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search customers" })).toBeVisible();
  await opened(page);
  await page.getByRole("button", { name: /^Filters/ }).click();
  const sheet = page.getByRole("dialog", { name: "Filter customers" });
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(400); // the sheet drops a tap within 350 ms of opening
  await sheet.getByRole("radio", { name: "Has GSTIN" }).click();
  await sheet.getByRole("button", { name: /^Show / }).click();
  await expect(page.getByRole("button", { name: "Remove filter: Has GSTIN" })).toBeVisible();
  const someone = (await client(request).get("customers/", { page_size: 50 })).results.find((c) => /^[6-9]\d{9}$/.test(c.mobile_number || "") && c.type !== "walkin");
  test.skip(!someone, "no customer with a mobile number on file");
  await page.goto(`/customers/${someone.id}`);
  const tiles = page.getByRole("group", { name: `Contact ${someone.name}` });
  await expect(tiles.getByRole("link", { name: "Call" })).toHaveAttribute("href", `tel:+91${someone.mobile_number}`);
  await expect(tiles.getByRole("button", { name: "WhatsApp" })).toBeVisible();
  await expect(tiles.getByRole("link", { name: "Statement" })).toHaveAttribute("href", `/customers/${someone.id}/statement`);
});

/** What axe finds against WCAG 2.2 AA: each rule broken, with the elements that break it (as a11y.spec.js). */
async function problems(page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

for (const theme of ["obsidian", "pearl"]) {
  test(`no WCAG 2.2 AA problems on the customer list, form, page and statement in ${theme}`, async ({ page, request }) => {
    const someone = (await client(request).get("customers/", { page_size: 1 })).results[0];
    await page.addInitScript((t) => localStorage.setItem("gst3.theme", t), theme);
    for (const path of ["/customers", "/customers/new", `/customers/${someone.id}`, `/customers/${someone.id}/statement`]) {
      // the customer's page: its income-tax notes too, which show no skeleton while they load
      const notes = path === `/customers/${someone.id}` ? itaxAnswer(page, someone.id) : null;
      await page.goto(path);
      await expect(page).toHaveURL((url) => url.pathname === path);
      // device.ts: Obsidian is the stylesheet's bare :root, every other theme a class on <html>
      await expect(page.locator("html")).toHaveClass(theme === "obsidian" ? "" : `theme-${theme}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // the data, not its skeleton, and the statement's PDF made (react-pdf loads on first use): nothing busy left
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
      await notes;
      await page.waitForTimeout(500); // the page's rise finishes before contrast is measured
      expect(await problems(page), path).toEqual([]);
    }
  });
}
