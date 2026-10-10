const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { SIGNED_OUT } = require("./session");

/** What axe finds against WCAG 2.2 AA: each rule broken, with the elements that break it. */
async function problems(page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

// Each page by the address opened, and where it lands on a desktop and on a phone (null: not measured there).
// A phone opens Easy's home at /. A desktop sends the phone's /more home, so it measures a page under its More instead.
const PAGES = [
  { path: "/", desktop: "/", phone: "/e" },
  { path: "/sales", desktop: "/sales", phone: "/sales" },
  { path: "/products", desktop: "/products", phone: null },
  { path: "/more", desktop: null, phone: "/more" },
];
for (const theme of ["obsidian", "pearl"]) {
  for (const { path, ...lands } of PAGES) {
    test(`no WCAG 2.2 AA problems: ${path} in ${theme}`, async ({ page }, info) => {
      const landing = lands[info.project.name];
      test.skip(!landing, `${path} isn't measured on the ${info.project.name}`);
      await page.addInitScript((t) => localStorage.setItem("gst3.theme", t), theme);
      await page.goto(path);
      await expect(page).toHaveURL((url) => url.pathname === landing);
      // device.ts: Obsidian is the stylesheet's bare :root, every other theme a class on <html>
      await expect(page.locator("html")).toHaveClass(theme === "obsidian" ? "" : `theme-${theme}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); // the page itself, not the app still loading
      await page.waitForTimeout(500); // let the page's rise animation finish before measuring contrast
      expect(await problems(page)).toEqual([]);
    });
  }
}

test.describe("signed out", () => {
  test.use({ storageState: SIGNED_OUT });

  test("the sign-in page has no WCAG 2.2 AA problems", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    expect(await problems(page)).toEqual([]);
  });
});
