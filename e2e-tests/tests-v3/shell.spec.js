const { test, expect } = require("@playwright/test");
const { easyIfExpertSaved, opened, savedToken } = require("./session");

test("desktop: the nav, More, the firm picker and search work against the real server", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto("/sales");
  const nav = page.getByRole("navigation", { name: /main/i });
  await expect(nav.getByRole("link", { name: "Sales" })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("button", { name: /more/i }).click();
  await expect(page.getByRole("menuitem", { name: "Products" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "Products" })).toBeHidden(); // gone, not still closing
  // the firm picker names the firm lists follow: pick another and see its name there, then the usual one goes back
  const picker = page.getByRole("button", { name: /^Firm: / });
  await expect(picker).not.toHaveAccessibleName(/^Firm: (loading|couldn't load)$/);
  const usual = await picker.getAttribute("aria-label");
  await picker.click();
  const items = page.getByRole("menuitem");
  await expect(items.filter({ hasText: "All firms" })).toBeVisible();
  const was = await items.evaluateAll((els) => els.findIndex((el) => el.hasAttribute("aria-current")));
  expect(was).toBeGreaterThanOrEqual(0);
  const other = items.nth(was === 0 ? 1 : 0);
  const name = (await other.innerText()).split("\n")[0]; // the firm's name, above its GSTIN
  await other.click();
  await expect(picker).toHaveAccessibleName(`Firm: ${name}`);
  await picker.click();
  await items.nth(was).click();
  await expect(picker).toHaveAccessibleName(usual);
  await page.keyboard.press("Control+k");
  const box = page.getByRole("combobox");
  await expect(box).toBeFocused();
  await box.fill(process.env.E2E_SEARCH || "TEST");
  // a row only the server's search returns: the app lists its own pages, actions and firms
  await expect(page.getByRole("option", { name: process.env.E2E_SEARCH_HIT || "TEST CUSTOMER" }).first()).toBeVisible();
});

test("desktop: theme and text size stick after a reload", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto("/");
  const account = page.getByRole("button", { name: /account/i });
  await account.click();
  await page.getByRole("menuitem", { name: "Pearl" }).click();
  await account.click();
  await page.getByRole("menuitem", { name: /^Larger/ }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/theme-pearl/);
  await expect(page.locator("#root")).toHaveCSS("zoom", "1.2"); // device.ts: a larger text size zooms the app
  await account.click();
  await page.getByRole("menuitem", { name: "Obsidian" }).click();
  await account.click();
  await page.getByRole("menuitem", { name: /^Normal/ }).click();
  await expect(page.locator("#root")).toHaveCSS("zoom", "1");
});

test.describe(() => {
  // one user for every spec and every run: however the phone test ended, Easy goes back on the server. An afterEach,
  // not a finally: a test that times out has its request disposed before a finally could use it
  test.afterEach(async ({ request }, info) => {
    if (info.project.name === "phone") await easyIfExpertSaved(request, savedToken());
  });

  test("phone: Easy opens first, its tabs work, and More switches to Expert", async ({ page }, info) => {
    test.skip(info.project.name !== "phone");
    await page.goto("/");
    await expect(page).toHaveURL(/\/e$/);
    const tabs = page.getByRole("navigation", { name: /tabs/i });
    await expect(tabs.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    // the tabs sit outside the page, so the page frame's guard doesn't hold them back; what's inside a page waits (opened)
    for (const tab of ["Bills", "Capture", "Customers", "More"]) {
      await tabs.getByRole("link", { name: tab }).click();
      await expect(tabs.getByRole("link", { name: tab })).toHaveAttribute("aria-current", "page");
    }
    await opened(page);
    await page.getByRole("button", { name: /switch to expert/i }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(tabs.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    // Back returns to the link that opened the page, with focus on it
    await tabs.getByRole("link", { name: "More" }).click();
    await expect(tabs.getByRole("link", { name: "More" })).toHaveAttribute("aria-current", "page");
    await opened(page);
    await page.getByRole("link", { name: /products/i }).click();
    await expect(page).toHaveURL(/\/products$/);
    // Back once the new page has taken focus (its title): the frame focuses a page 90 ms after it opens, and a Back
    // quicker than that can see the late focus land on the title of the page it returns to (a known race in PageFrame)
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    await page.goBack();
    await expect(page.getByRole("link", { name: /products/i })).toBeFocused();
    await opened(page);
    await page.getByRole("button", { name: /switch to easy/i }).click();
    await expect(page).toHaveURL(/\/e$/);
  });
});
