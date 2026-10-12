// The production build works inside its Content-Security-Policy (part 7, Ruling 7-D19): nginx/conf.d/app.conf sends
// script-src 'self' 'wasm-unsafe-eval', connect-src 'self' data: and so on, and v3 had only run under Vite, which
// sends none. So this skips unless the page comes back with a CSP header, which means nginx serves the built app.
const { test, expect } = require("@playwright/test");
const { opened } = require("./session");
const { client, makesBills, newBill } = require("./sales-data");

makesBills(test);

const SCREENS = ["/", "/sales", "/sales/paper", "/purchases", "/purchases/inbox", "/customers", "/gst", "/reports", "/settings", "/audit", "/backup"];

test("the app works inside the shipped Content-Security-Policy", { tag: "@sandbox" }, async ({ page, request }, info) => {
  const home = await request.get("/");
  test.skip(!home.headers()["content-security-policy"], "no CSP header: Vite, not nginx");
  const refused = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) refused.push(m.text()); });
  // Keep events across document changes too, including any raised by a child frame.
  await page.exposeFunction("__reportCsp", (violation) => refused.push(violation));
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      const violation = `${e.violatedDirective} ${e.blockedURI}`;
      window.__csp.push(violation);
      window.__reportCsp(violation);
    });
  });
  const screens = info.project.name === "phone" ? ["/e", "/e/gst", ...SCREENS] : SCREENS;
  for (const path of screens) {
    await page.goto(path);
    // Lazy pages and their data must finish drawing before the check can prove anything.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
    await opened(page);
    expect(await page.evaluate(() => window.__csp), path).toEqual([]);
  }
  // A PDF: react-pdf's WebAssembly and the ₹ font, alongside the bill's paper preview.
  const bill = await newBill(client(request));
  await page.goto(`/sales/${bill.id}/print`);
  await expect(page.getByRole("document", { name: `Bill ${bill.number} on paper, ` }).first()).toBeVisible({ timeout: 20_000 });
  await opened(page);
  await expect(page.getByRole("button", { name: info.project.name === "phone" ? "Share" : "PDF", exact: true })).toBeEnabled({ timeout: 30_000 });
  expect(await page.evaluate(() => window.__csp), "print").toEqual([]);
  expect(refused).toEqual([]);
});
