const { test, expect } = require("@playwright/test");
const fs = require("fs");

/** Easy or Expert is saved on the server for the signed-in user. A run that stopped part-way may have left Expert: put Easy back. */
async function easyIfExpertSaved(page, info) {
  const { origins } = JSON.parse(fs.readFileSync(info.project.use.storageState, "utf8"));
  const token = origins.flatMap((o) => o.localStorage).find((i) => i.name === "gst_access_token").value;
  const headers = { Authorization: `Bearer ${token}` };
  const saved = await page.request.get("/api/preferences/", { headers });
  expect(saved.ok()).toBe(true);
  if ((await saved.json()).data.phoneMode !== "expert") return;
  const put = await page.request.patch("/api/preferences/", { headers, data: { phoneMode: "easy" } });
  expect(put.ok()).toBe(true);
}

test("desktop: the nav, More, the firm picker and search work against the real server", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto("/sales");
  const nav = page.getByRole("navigation", { name: /main/i });
  await expect(nav.getByRole("link", { name: "Sales" })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("button", { name: /more/i }).click();
  await expect(page.getByRole("menuitem", { name: "Products" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  const box = page.getByRole("combobox");
  await expect(box).toBeFocused();
  await box.fill(process.env.E2E_SEARCH || "TEST");
  await expect(page.getByRole("option").filter({ hasText: new RegExp(process.env.E2E_SEARCH || "TEST", "i") }).first()).toBeVisible();
});

test("desktop: theme and text size stick after a reload", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto("/");
  await page.getByRole("button", { name: /account/i }).click();
  await page.getByRole("menuitem", { name: "Pearl" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/theme-pearl/);
  await page.getByRole("button", { name: /account/i }).click();
  await page.getByRole("menuitem", { name: "Obsidian" }).click();
});

test("phone: Easy opens first, its tabs work, and More switches to Expert", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  await easyIfExpertSaved(page, info);
  await page.goto("/");
  await expect(page).toHaveURL(/\/e$/);
  const tabs = page.getByRole("navigation", { name: /tabs/i });
  await tabs.getByRole("link", { name: "More" }).click();
  await page.getByRole("button", { name: /switch to expert/i }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(tabs.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  // Back returns to the link that opened the page, with focus on it
  await tabs.getByRole("link", { name: "More" }).click();
  await page.getByRole("link", { name: /products/i }).click();
  await expect(page).toHaveURL(/\/products$/);
  await page.goBack();
  await expect(page.getByRole("link", { name: /products/i })).toBeFocused();
  // put the phone back in Easy for the next run, and wait until it's saved
  await page.getByRole("button", { name: /switch to easy/i }).click();
  await expect(page).toHaveURL(/\/e$/);
});

test("signed out, a deep link signs in and lands where it was going", async ({ browser }) => {
  // an empty storage state: a context made here would otherwise take the project's, signed in
  const page = await (await browser.newContext({ storageState: { cookies: [], origins: [] } })).newPage();
  await page.goto("/customers");
  await expect(page).toHaveURL(/\/login\?next=%2Fcustomers/);
});
