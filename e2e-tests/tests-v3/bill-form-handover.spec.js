// An unfinished bill is the shop's (part 1D): started on one device, it's listed on another with who started it, and
// finished there by someone else: LOGINS_FILE's E2E_OTHER_ROLE line (staff) on the sandbox, signed in through the real
// sign-in page; where there's one user (CI), the same person on a second device. Saving it takes it off the list. The
// bill goes to the bin after the test (makesBills), and an unfinished bill a failure left behind is deleted (startsDrafts).
const { test, expect } = require("@playwright/test");
const { AUTH, SIGNED_OUT, hasLogin, opened, signIn, typesPassword } = require("./session");
const { afterDialog, client, esc, makesBills, someCustomer } = require("./sales-data");
const { aProduct, draftWrites, leaveForm, notesSavedBills, possessive, startsDrafts, typeBill } = require("./bill-form-data");

// startsDrafts first (afterEach hooks run in the order they're declared): its hook leaves the form, with its writes
// stopped, before typesPassword's moves a failed test's page, and notes the bill saved there before makesBills' runs
startsDrafts(test);
typesPassword(test);
makesBills(test);
const OTHER = process.env.E2E_OTHER_ROLE || "staff";

test("desktop: a bill started on one device is finished on another, by someone else", async ({ page, request, browser }, info) => {
  test.skip(info.project.name !== "desktop", "one handover is enough; the phone's form is checked in the unit tests");
  const api = client(request);
  const customer = await someCustomer(api);
  const product = await aProduct(api);
  // here: a customer and a weighed item, kept as an unfinished bill on the shop's list
  await page.goto("/sales/new");
  await expect(page.getByRole("combobox", { name: /^Customer/ })).toBeFocused();
  await opened(page);
  await typeBill(page, { customer, product });
  // the address names the draft at its first keep; the shop's list has the weight once the keep after it has landed
  await page.waitForURL(/[?&]draft=/);
  const draftId = new URL(page.url()).searchParams.get("draft");
  expect(draftId).toMatch(/^[0-9a-f-]{36}$/);
  const listed = async () => (await api.get("drafts/")).results.find((d) => d.id === draftId);
  await expect.poll(async () => (await listed())?.data.lines[0]?.qty, { timeout: 15_000 }).toBe(2);
  await expect(page.getByText(/^Kept as a draft at \d\d:\d\d$/)).toBeVisible();
  const draft = await listed();
  expect(draft.data.lines[0]).toMatchObject({ name: product.name, qty: 2 });

  // there: another device, and someone else where the sandbox has a second login
  const someoneElse = hasLogin(OTHER);
  const other = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: someoneElse ? SIGNED_OUT : AUTH });
  const there = await other.newPage();
  const writes = draftWrites(there);
  try {
    notesSavedBills(there);
    if (someoneElse) {
      await there.goto("/login");
      await signIn(there, OTHER);
      // waitForURL, not expect: the password is still in its field if this fails (see typesPassword)
      await there.waitForURL((url) => url.pathname !== "/login", { timeout: 30_000 });
    }
    await there.goto("/sales/new");
    // newest change first: the one just kept here, whatever else the shop has unfinished for this customer
    const open = there.getByRole("list", { name: "Unfinished bills" }).getByRole("button", { name: `Open ${possessive(customer.name)} unfinished bill` }).first();
    await expect(open).toBeVisible();
    await opened(there);
    await open.click();
    await expect(there).toHaveURL(new RegExp(`[?&]draft=${draftId}`));
    await expect(there.getByText("Finishing an unfinished bill")).toBeVisible();
    await expect(there.getByText(new RegExp(`^Started at \\d\\d:\\d\\d by ${esc(draft.started_by.name)}\\.`))).toBeVisible();
    await expect(there.getByRole("textbox", { name: /^Line 1 (weight|quantity) in / })).toHaveValue(/^2(\.0+)?$/);
    await opened(there);
    // finished there: the rate, then Check and save
    await there.getByRole("textbox", { name: /^Line 1 rate per / }).fill("6500");
    await there.keyboard.press("Control+s");
    const review = there.getByRole("dialog", { name: "Check the bill before saving" });
    await expect(review).toBeVisible();
    await afterDialog(there);
    await review.getByRole("radio", { name: "Cash", exact: true }).click();
    await review.getByRole("button", { name: "Save bill" }).click();
    await there.waitForURL(/\/sales\/\d+\?saved=new/);
    // saved as a bill, it's off the shop's list of unfinished bills
    expect(await listed()).toBeUndefined();
  } finally {
    // the form left with its writes stopped (leaveForm) before the cleanup; and closing a context after a failure snapshots
    // its page, so a password in its field is never what that shows (typesPassword)
    try { await leaveForm(there, writes); } finally { await other.close(); }
  }
});
