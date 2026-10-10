const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

const PAGES = ["/", "/sales", "/more"];
for (const theme of ["obsidian", "pearl"]) {
  for (const path of PAGES) {
    test(`no WCAG 2.2 AA problems: ${path} in ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("gst3.theme", t), theme);
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); // the page itself, not the app still loading
      await page.waitForTimeout(500); // let the page's rise animation finish before measuring contrast
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    });
  }
}

test("the sign-in page has no WCAG 2.2 AA problems", async ({ browser }) => {
  // an empty storage state: a context made here would otherwise take the project's, signed in, and leave this page
  const page = await (await browser.newContext({ storageState: { cookies: [], origins: [] } })).newPage();
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});
