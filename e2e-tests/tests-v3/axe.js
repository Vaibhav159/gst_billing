// The WCAG 2.2 AA pass the specs share: what axe finds, and measure(), which waits for the page to settle first and
// fails a page that reloaded under it.
const { expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

/** What axe finds against WCAG 2.2 AA: each rule broken, with the elements that break it. */
async function problems(page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

/**
 * What axe finds once the page has settled: its heading drawn, nothing busy (the data, not its skeleton, and a
 * statement's PDF made), and its rise over before contrast is measured. The sandbox's Vite reloads the page when v3
 * moves, and axe would find nothing wrong with a half-drawn page: it has to be the same page, heading and all, when axe
 * is done.
 */
async function measure(page) {
  const heading = page.getByRole("heading", { level: 1 });
  const loaded = () => page.evaluate(() => performance.timeOrigin); // a reload starts a new one
  const was = await loaded();
  await expect(heading).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(500);
  const found = await problems(page);
  expect(await loaded(), "the page reloaded while axe measured it").toBe(was);
  await expect(heading).toBeVisible();
  return found;
}

module.exports = { problems, measure };
