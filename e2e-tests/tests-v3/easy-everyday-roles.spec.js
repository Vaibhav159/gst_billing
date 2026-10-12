const { test, expect } = require("@playwright/test");
const { SIGNED_OUT, hasLogin, signIn, typesPassword, opened } = require("./session");
const { client, newBill, makesBills, afterDialog, esc } = require("./sales-data");

test.use({ storageState: SIGNED_OUT });
test.beforeEach(async ({}, info) => test.skip(info.project.name !== "phone", "Easy phone roles"));
makesBills(test);
typesPassword(test);

async function login(page, role) {
  await page.goto("/login");
  await opened(page);
  await signIn(page, role);
  // No expect() while a real password could still be in its field.
  await page.waitForURL((url) => url.pathname !== "/login");
}
async function logout(page) {
  await page.goto("/e/more");
  await expect(page.getByRole("heading", { name: "More", exact: true })).toBeVisible();
  await opened(page);
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Log out of this phone?" });
  await afterDialog(page);
  await dialog.getByRole("button", { name: "Log out", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/login");
}
async function choose(page, name) {
  await page.goto("/e/more");
  await expect(page.getByRole("heading", { name: "More", exact: true })).toBeVisible();
  await opened(page);
  await page.getByRole("button", { name: /^Firm on this phone/ }).click();
  const dialog = page.getByRole("dialog", { name: "Which firm are you billing for?" });
  await afterDialog(page);
  await dialog.getByRole("radio", { name: new RegExp(`^${esc(name)}`) }).click();
  await expect(page.getByRole("button", { name: /^Firm on this phone/ })).toContainText(name);
}

for (const role of ["owner", "accountant", "staff", "viewer"]) test(`${role}: Everyday actions follow the role and the bill stays readable`, async ({ page, request }) => {
  test.skip(!hasLogin(role), `${role} login is not supplied in this environment`);
  const bill = await newBill(client(request));
  await login(page, role);
  await page.goto("/e");
  await expect(page.getByRole("button", { name: "New bill", exact: true })).toBeVisible();
  const makes = role === "owner" || role === "staff";
  if (makes) await expect(page.getByRole("button", { name: "New bill", exact: true })).toBeEnabled();
  else await expect(page.getByRole("button", { name: "New bill", exact: true })).toBeDisabled();
  await page.goto(`/e/bill/${bill.id}`);
  await expect(page.getByRole("heading", { name: `Bill ${bill.counter}`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Print", exact: true })).toBeVisible();
  if (makes) await expect(page.getByRole("button", { name: "Send the bill", exact: true })).toBeVisible();
  else {
    await expect(page.getByRole("button", { name: "Send the bill", exact: true })).toHaveCount(0);
    await expect(page.getByText("Not sent yet", { exact: true })).toBeVisible();
  }
  if (role === "owner") {
    await expect(page.getByRole("button", { name: "Made a mistake? Cancel this bill" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open in the full view" })).toBeVisible();
  } else {
    await expect(page.getByText("Made a mistake? Ask the owner to cancel it.")).toBeVisible();
    await expect(page.getByText("Need to change it? Ask the owner.")).toBeVisible();
  }
  await page.goto("/e/customers");
  await expect(page.getByRole("heading", { name: "Customers", exact: true })).toBeVisible();
  if (role === "viewer") await expect(page.getByRole("button", { name: "Add a customer" })).toHaveCount(0);
  else await expect(page.getByRole("button", { name: "Add a customer" })).toBeVisible();
});

test("two people on one phone retain different explicit firms across sign-out", async ({ page, request }) => {
  test.skip(!hasLogin("owner") || !hasLogin("staff"), "owner and staff logins are needed");
  const firms = (await client(request).get("businesses/", { page_size: 100 })).results;
  expect(firms.length).toBeGreaterThanOrEqual(2);
  await login(page, "owner");
  await choose(page, firms[0].name);
  const ownerId = await page.evaluate(() => JSON.parse(localStorage.getItem("gst3.me")).id);
  await logout(page);
  await login(page, "staff");
  await choose(page, firms[1].name);
  const staffId = await page.evaluate(() => JSON.parse(localStorage.getItem("gst3.me")).id);
  expect(staffId).not.toBe(ownerId);
  await logout(page);
  await login(page, "owner");
  await page.goto("/e/more");
  await expect(page.getByRole("button", { name: /^Firm on this phone/ })).toContainText(firms[0].name);
  const kept = await page.evaluate(([owner, staff]) => [JSON.parse(localStorage.getItem(`gst3.easy.firm.${owner}`)), JSON.parse(localStorage.getItem(`gst3.easy.firm.${staff}`))], [ownerId, staffId]);
  expect(kept).toEqual([firms[0].id, firms[1].id]);
});
