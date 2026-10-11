// The bills screens against the real server (part 1B): browse and preview, cancel, delete with Undo and restore,
// renumber, send to a walk-in, Ctrl K and v2's links; and the phone's cards.
const { test, expect } = require("@playwright/test");
const { opened } = require("./session");
const { afterDialog, client, esc, makesBills, newBill, removeBill, today, walkIn } = require("./sales-data");

// every bill a test makes goes to the bin after it, a renumbered one getting its number back first (sales-data.js)
makesBills(test);

/** The bill's own page, open and past the page frame's guard. */
async function openBill(page, bill) {
  await page.goto(`/sales/${bill.id}`);
  await expect(page.getByRole("heading", { level: 1, name: bill.number, exact: true })).toBeVisible();
  await opened(page);
}
/** Picks an item in the bill page's ⋯ menu. */
async function fromMenu(page, bill, item) {
  await page.getByRole("button", { name: `More actions for ${bill.number}`, exact: true }).click();
  await page.getByRole("menuitem", { name: item }).click();
}
/**
 * A bill whose number has two characters or more, for search, which asks from two (Ruling 1B-11). A fresh database's
 * first numbers are 1 to 9 (CI's firm has no prefix): those are used up here, each to the bin, so the series keeps no gap.
 */
async function billToSearch(api) {
  for (;;) {
    const bill = await newBill(api);
    if (bill.number.length >= 2) return bill;
    await removeBill(api, bill.id);
  }
}

test("desktop: a new bill is in today's list; ↓ previews it, Enter opens it, and Back puts focus on its row", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop");
  const api = client(request);
  const bill = await newBill(api);
  await page.goto(`/sales?firm=${bill.business}&month=today`);
  const row = page.locator(`tr[data-row="${bill.id}"]`);
  await expect(row).toBeVisible();
  await opened(page);
  await row.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("complementary", { name: `Preview of bill ${bill.number}`, exact: true })).toBeVisible();
  await expect(row).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/sales/${bill.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: bill.number, exact: true })).toBeVisible();
  // Back at once: the page that closes can't take the focus back from the row that opened it (Ruling 60)
  await page.goBack();
  await expect(row).toBeFocused();
});

test("desktop: cancelling from the bill's menu needs a reason; the bill then says it's cancelled", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop");
  const api = client(request);
  const bill = await newBill(api);
  await openBill(page, bill);
  await fromMenu(page, bill, /^Cancel bill…/);
  const dialog = page.getByRole("dialog", { name: `Cancel bill ${bill.number}?`, exact: true });
  await expect(dialog).toBeVisible();
  await afterDialog(page);
  await dialog.getByRole("button", { name: "Cancel bill", exact: true }).click();
  await expect(dialog.getByText("Say why in a few words. It goes into the audit log.")).toBeVisible();
  await dialog.getByRole("button", { name: "Customer returned it" }).click();
  await dialog.getByRole("button", { name: "Cancel bill", exact: true }).click();
  await expect(page.getByText(`Cancelled ${bill.number}`, { exact: true })).toBeVisible();
  await expect(page.getByText("This bill is cancelled")).toBeVisible();
  expect((await api.get(`sales/${bill.id}/`)).status).toBe("cancelled");
});

test("desktop: delete goes to the list with Undo; deleted again, its own page restores it", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop");
  const api = client(request);
  const bill = await newBill(api);
  await openBill(page, bill);
  await fromMenu(page, bill, /^Delete…/);
  const dialog = page.getByRole("dialog", { name: `Delete bill ${bill.number}?`, exact: true });
  await expect(dialog).toBeVisible();
  await afterDialog(page);
  await dialog.getByRole("button", { name: "Entered twice" }).click();
  await dialog.getByRole("button", { name: "Delete bill", exact: true }).click();
  await expect(page).toHaveURL(/\/sales$/);
  await expect(page.getByText(`Deleted ${bill.number}`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Undo/ }).click();
  await expect(page.getByText(`Restored ${bill.number}`, { exact: true })).toBeVisible();
  expect((await api.get(`sales/${bill.id}/`)).id).toBe(bill.id);
  await api.del(`sales/${bill.id}/`, { reason: "Test bill" });
  await page.goto(`/sales/${bill.id}`);
  await expect(page.getByText("This bill was deleted")).toBeVisible();
  await opened(page);
  await page.getByRole("button", { name: "Restore it" }).click();
  await expect(page.getByText(`Restored ${bill.number}`, { exact: true })).toBeVisible();
  await expect(page.getByText("Payment and sending")).toBeVisible();
});

test("desktop: renumber starts on the next free number and the bill takes it", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop");
  const api = client(request);
  const bill = await newBill(api);
  const next = await api.get("sales/next-number/", { business_id: bill.business, invoice_date: today() });
  await openBill(page, bill);
  await fromMenu(page, bill, /^Renumber…/);
  const dialog = page.getByRole("dialog", { name: `Give ${bill.number} a new number`, exact: true });
  await expect(dialog.getByLabel("New number")).toHaveValue(next.invoice_number);
  await afterDialog(page);
  await dialog.getByRole("button", { name: "Renumber bill" }).click();
  await expect(page.getByText(`${bill.number} is now ${next.invoice_number}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: next.invoice_number, exact: true })).toBeVisible();
});

test("desktop: a walk-in's bill goes to the number typed: that chat opens, and the send is recorded on the bill", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop");
  test.slow(); // the send can wait a minute for its PDF (below), past the suite's 60 s for a test
  const api = client(request);
  const bill = await newBill(api, { customer: await walkIn(api) });
  // WhatsApp would open in a new tab: here window.open notes the address it was asked for and answers a stand-in
  // tab (the app takes a null answer for a tab the browser stopped, and records nothing)
  await page.addInitScript(() => { window.__opened = []; window.open = (url) => { window.__opened.push(String(url)); return { opener: null, closed: false }; }; });
  await openBill(page, bill);
  await page.getByRole("button", { name: "Send to a number" }).click();
  const dialog = page.getByRole("dialog", { name: `Send ${bill.number} on WhatsApp`, exact: true });
  await expect(dialog).toContainText("A walk-in has no number on record.");
  await afterDialog(page);
  await dialog.getByLabel("WhatsApp number").fill("98290 41122");
  await dialog.getByLabel("WhatsApp number").press("Enter");
  // the chat opens at once; the bill's PDF is made and downloads beside it before the send is recorded (plan 1E), and
  // the first PDF loads react-pdf: one run on the shared VM took over 30 s, and CI's 2-CPU runners may be as slow
  await expect(page.getByText(`${bill.number} sent`, { exact: true })).toBeVisible({ timeout: 60_000 });
  expect(await page.evaluate(() => window.__opened)).toEqual([expect.stringMatching(/^https:\/\/wa\.me\/919829041122\?text=/)]);
  expect((await api.get(`sales/${bill.id}/`)).sent).toMatchObject({ via: "whatsapp", to: "9829041122" });
});

test("desktop: Ctrl K puts the bill with the number typed first, so Enter opens it, and finds it deleted to restore", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop");
  const api = client(request);
  const bill = await billToSearch(api);
  await page.goto("/sales");
  await expect(page.getByRole("heading", { level: 1, name: "Sales" })).toBeVisible();
  await page.keyboard.press("Control+k");
  // the list has comboboxes of its own (its filters): the box is the Search dialog's
  const search = page.getByRole("dialog", { name: "Search" });
  await search.getByRole("combobox").fill(bill.number);
  // first of all the rows, though older bills of other years can have the same number and customers' phone numbers
  // can hold its digits (a paper bill's plain number, such as 31: since 1B Task 11)
  await expect(search.getByRole("option").first()).toHaveAccessibleName(new RegExp(`^${esc(bill.number)} ${esc(bill.customerName)} · `));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/sales/${bill.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: bill.number, exact: true })).toBeVisible();
  await api.del(`sales/${bill.id}/`, { reason: "Test bill" });
  // a fresh page: search's answers are kept 30 s
  await page.goto("/sales");
  await expect(page.getByRole("heading", { level: 1, name: "Sales" })).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "Search" }).getByRole("combobox").fill(bill.number);
  const gone = page.getByRole("option", { name: new RegExp(`^${esc(bill.number)} deleted .* open it to restore$`) });
  await expect(gone).toBeVisible();
  await afterDialog(page); // search is a dialog: its guard against the key that opened it
  await gone.click();
  await expect(page).toHaveURL(new RegExp(`/sales/${bill.id}$`));
  await expect(page.getByText("This bill was deleted")).toBeVisible();
});

test("desktop: v2's links open the v3 bill, by id and by firm, year and number", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop");
  const api = client(request);
  const bill = await newBill(api);
  await page.goto(`/billing/invoice/${bill.id}`);
  await expect(page).toHaveURL(new RegExp(`/sales/${bill.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: bill.number, exact: true })).toBeVisible();
  // v2 made number links only for numbers that fit in an address (no "/")
  if (!bill.number.includes("/")) {
    const y = Number(today().slice(0, 4));
    const fy = Number(today().slice(5, 7)) >= 4 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`;
    await page.goto(`/billing/invoice/${bill.business}/${fy}/${encodeURIComponent(bill.number)}`);
    await expect(page).toHaveURL(new RegExp(`/sales/${bill.id}$`));
  }
});

test("phone: today's bills are cards; a card opens the bill, and its bar has Print", async ({ page, request }, info) => {
  test.skip(info.project.name !== "phone");
  const api = client(request);
  const bill = await newBill(api);
  await page.goto(`/sales?firm=${bill.business}&month=today`);
  const card = page.getByRole("link", { name: new RegExp(`^${esc(bill.customerName)}, ${esc(bill.number)}, `) });
  await expect(card).toBeVisible();
  await opened(page);
  await card.click();
  await expect(page.getByRole("heading", { level: 1, name: `Bill ${bill.number}`, exact: true })).toBeVisible();
  await expect(page.locator("[data-actionbar]").getByRole("link", { name: "Print", exact: true })).toBeVisible();
});
