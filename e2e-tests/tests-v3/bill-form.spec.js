// The bill form (part 1D) against the real server: a counter bill made by keyboard alone, and a run of three paper bills
// from the paper book, each saved and followed by the saved bill's Next paper bill (Save and next). Firms, customers,
// products and numbers are read at run time. Every bill the form saves is noted as the server answers and goes to the bin
// after the test (makesBills: its number stays used, so no gap opens), and an unfinished bill a failure left behind is
// deleted (startsDrafts).
const { test, expect } = require("@playwright/test");
const { opened } = require("./session");
const { afterDialog, client, esc, firstFirm, makesBills, someCustomer, today } = require("./sales-data");
const { aProduct, monthBefore, notesSavedBills, savedId, startsDrafts, typeBill } = require("./bill-form-data");

// startsDrafts first: its afterEach notes the bills the form saved before makesBills' empties the list
startsDrafts(test);
makesBills(test);

test("desktop: a counter bill by keyboard alone, from the customer box to Save", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop", "the keyboard flow is the desktop's");
  const api = client(request);
  const customer = await someCustomer(api);
  const product = await aProduct(api);
  notesSavedBills(page);
  await page.goto("/sales/new");
  await expect(page.getByRole("heading", { level: 1, name: "New sales bill" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /^Customer/ })).toBeFocused();
  await opened(page);
  await typeBill(page, { customer, product });
  // Enter goes from the weight to the rate, as a run of bills goes by keyboard
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: /^Line 1 rate per / })).toBeFocused();
  await page.keyboard.type("6500");
  // Ctrl S: Check and save. Nothing is picked for how it was paid: Space picks Cash, and focus moves to Save
  await page.keyboard.press("Control+s");
  const review = page.getByRole("dialog", { name: "Check the bill before saving" });
  await expect(review).toBeVisible();
  await afterDialog(page);
  await expect(review.getByRole("radio", { name: "Cash", exact: true })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(review.getByRole("button", { name: "Save bill" })).toBeFocused();
  await page.keyboard.press("Enter");
  const id = await savedId(page);
  // two at ₹6,500, with GST at the product's rate, to the paisa
  const taxable = 1300000;
  const total = taxable + Math.round(taxable * Number(product.gst_tax_rate));
  const bill = await api.get(`sales/${id}/`);
  expect(bill).toMatchObject({ customer: expect.objectContaining({ id: customer.id }), payment_mode: "cash", paper: false, invoice_date: today(), total_amount: (total / 100).toFixed(2) });
  await expect(page.getByText(`Saved ${bill.invoice_number}`, { exact: true })).toBeVisible();
});

test("desktop: three paper bills in a run, from the paper book: Enter bill, then Save and Next paper bill", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop", "the keyboard run is the desktop's");
  test.slow(); // three bills, each saved through the server
  const api = client(request);
  const firm = await firstFirm(api);
  const customer = await someCustomer(api);
  const product = await aProduct(api);
  // last month's run, as the shop types it in; this month's when last month is filed
  const last = monthBefore(today());
  const month = (await api.get("sales/paper-book/", { business_id: firm.id, month: last })).locked ? today().slice(0, 7) : last;
  notesSavedBills(page);
  // what the run asks of the server, from opening the paper book to the third bill's save, by method and path (never a
  // header or a body): a paper-book day against the user's requests for the day. Attached to the test as api-requests
  const asked = [];
  let saves = 0;
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (saves === 3 || !u.pathname.startsWith("/api/")) return;
    asked.push({ bill: saves + 1, method: r.method(), path: `${u.pathname}${u.search}` });
    if (r.method() === "POST" && u.pathname === "/api/sales/") saves += 1;
  });
  await page.goto(`/sales/paper?firm=${firm.id}&month=${month}`);
  await expect(page.getByRole("heading", { level: 1, name: "Bills from the paper book" })).toBeVisible();
  const enter = page.getByRole("button", { name: /^Enter bill \d+$/ });
  await expect(enter).toBeEnabled();
  await opened(page);
  await enter.click();
  const made = [];
  let day = "";
  for (let n = 0; n < 3; n += 1) {
    await page.waitForURL(/\/sales\/new\?paper=1/);
    const link = new URL(page.url());
    const number = link.searchParams.get("number");
    // the paper book's next number, and the run's date: the first bill's, kept for the next ones
    if (n === 0) day = link.searchParams.get("date");
    expect(link.searchParams.get("date")).toBe(day);
    await expect(page.getByLabel("Number on the paper bill")).toHaveValue(number);
    await expect(page.getByRole("combobox", { name: /^Customer/ })).toBeFocused();
    await opened(page);
    await typeBill(page, { customer, product });
    await page.keyboard.press("Enter");
    await page.keyboard.type("6500");
    await page.keyboard.press("Control+s");
    const review = page.getByRole("dialog", { name: "Check the paper bill before saving" });
    await expect(review).toBeVisible();
    await afterDialog(page);
    await page.keyboard.press("Space");
    await expect(review.getByRole("button", { name: "Save bill" })).toBeFocused();
    await page.keyboard.press("Enter");
    const id = await savedId(page);
    made.push(id);
    expect(await api.get(`sales/${id}/`)).toMatchObject({ paper: true, invoice_date: day, counter: Number(number), business: firm.id });
    if (n < 2) {
      // Save and next: the saved bill's next step is the next paper bill, already focused. Enter on it is a click, which
      // the page frame drops within 300 ms of the saved bill's page opening (Ruling 1D-4)
      await expect(page.getByRole("link", { name: /^Next paper bill · \d+$/ })).toBeFocused();
      await opened(page);
      await page.keyboard.press("Enter");
    }
  }
  await info.attach("api-requests", { body: JSON.stringify(asked, null, 1), contentType: "application/json" });
  await opened(page);
  await page.getByRole("link", { name: "Back to the paper book" }).click();
  await page.waitForURL(/\/sales\/paper\?/);
  const table = page.getByRole("table", { name: new RegExp(`bills for ${esc(firm.name)}, in number order$`) });
  for (const id of made) {
    const { invoice_number: no } = await api.get(`sales/${id}/`);
    await expect(table.getByRole("link", { name: no, exact: true })).toBeVisible();
  }
});
