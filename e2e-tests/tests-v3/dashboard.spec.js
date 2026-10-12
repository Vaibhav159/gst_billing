const { test, expect } = require("@playwright/test");
const { measure } = require("./axe");
const { SIGNED_OUT, hasLogin, opened, signIn, typesPassword } = require("./session");
const { client, makesBills, noteBill, today, walkIn } = require("./sales-data");
const { CURRENT_FY, PAST_FY, ITEMS, fixtureDashboard, expertOnThisPage, dueText } = require("./dashboard-data");

// The viewer case uses a real role login. The common helper turns off traces and
// removes a failed password page before Playwright writes its error snapshot.
// Declare bill cleanup before that hook, as other mutation specs do.
makesBills(test);
typesPassword(test);

async function dashboardShown(page) {
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(page.getByRole("heading", { level: 1, name: "Today", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Due next", exact: true })).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await opened(page);
}

for (const theme of ["obsidian", "pearl"]) {
  for (const scenario of ["dashboard", "dashboard-rates", "dashboard-quiet", "dashboard-past-year"]) {
    test(`${scenario}: ${theme}, prototype content and WCAG 2.2 AA`, async ({ page }, info) => {
      const fixture = await fixtureDashboard(page, { scenario, theme });
      await page.goto(fixture.path);
      await dashboardShown(page);
      const phone = info.project.name === "phone";
      await expect(page.locator("html")).toHaveClass(theme === "obsidian" ? "" : "theme-pearl");
      const due = page.getByRole("region", { name: "Due next", exact: true });
      const limit = phone ? 4 : 6;
      await expect(due.getByRole("link")).toHaveCount(limit);
      await expect(due.getByRole("link").first()).toContainText(ITEMS[0].title);
      await expect(due.getByRole("link").first()).toContainText("3 days");
      await expect(due.getByRole("link").first()).toHaveAttribute("href", "/gst?firm=3&month=2026-09&fix=1");
      await expect(due.getByRole("button", { name: `Show ${ITEMS.length - limit} more` })).toHaveAttribute("aria-expanded", "false");
      if (scenario === "dashboard-quiet") {
        await expect(page.getByText(/No bills yet today/)).toBeVisible();
        await expect(page.getByRole("link", { name: "Print KGH/2026-27/51", exact: true })).toBeVisible();
        await expect(page.getByText("No items", { exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: "Fix it", exact: true })).toHaveAttribute("href", "/sales/433");
      } else {
        await expect(page.getByText("Anil Gupta", { exact: true }).first()).toBeVisible();
        await expect(page.getByText("On paper", { exact: true }).first()).toBeVisible();
        await expect(page.getByText(/Billed today:/)).toBeVisible();
        if (phone) {
          await expect(page.getByText("Dashboard customer 5", { exact: true })).toBeVisible();
          await expect(page.getByText("Dashboard customer 6", { exact: true })).toHaveCount(0);
          await expect(page.getByRole("link", { name: /All 6 bills today/ })).toHaveAttribute("href", "/sales?when=today");
        } else {
          await expect(page.getByText("Dashboard customer 6", { exact: true })).toBeVisible();
          await expect(page.getByRole("region", { name: "Latest changes", exact: true })).toContainText("Sent KGH/2026-27/31");
        }
      }
      if (scenario === "dashboard-rates") {
        await expect(page.getByText(/Not set today · last set 07 Oct at 10:12/)).toBeVisible();
        await expect(page.getByText("Set today's rates before the first bill", { exact: true })).toHaveCount(0);
      }
      if (scenario === "dashboard-past-year") {
        await expect(page.getByRole("heading", { name: "March 2026", exact: true })).toBeVisible();
        await expect(page.getByRole("region", { name: `FY ${PAST_FY} returns`, exact: true })).toContainText("All 12 filed and locked");
        await expect(page.getByRole("radiogroup", { name: "Period", exact: true })).toHaveCount(0);
        if (!phone) await expect(page.getByRole("list", { name: "Months: open a month's sales bills" }).getByRole("link")).toHaveCount(12);
      } else {
        await expect(page.getByRole("heading", { name: "October so far", exact: true })).toBeVisible();
        await expect(page.getByRole("region", { name: "September 2026 returns", exact: true })).toContainText("KIRAN GOLD HOUSE");
      }
      expect(await measure(page)).toEqual([]);
      const path = info.outputPath(`${scenario}-${theme}-${info.project.name}.png`);
      await page.screenshot({ path, fullPage: true, animations: "disabled" });
      await info.attach(`${scenario} ${theme} ${info.project.name}`, { path, contentType: "image/png" });
      const heading = page.getByRole("heading", { level: 1, name: "Today", exact: true });
      const titleWidth = () => heading.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getBoundingClientRect().width;
      });
      const normalTitleWidth = await titleWidth();
      expect(normalTitleWidth).toBeGreaterThan(0);
      // Font tokens are px-based. Use the app's applyTextSize layout strategy so
      // text really doubles while the available layout width shrinks to fit.
      await page.evaluate(() => {
        const root = document.getElementById("root");
        root.style.zoom = "2";
        root.style.width = `${Math.floor(window.innerWidth / 2)}px`;
        root.style.height = `${Math.floor(window.innerHeight / 2)}px`;
      });
      await expect.poll(async () => (await titleWidth()) / normalTitleWidth).toBeCloseTo(2, 1);
      await expect(heading).toBeVisible();
      await expect.poll(() => page.evaluate(() => {
        const main = document.getElementById("app-main");
        return Math.max(document.documentElement.scrollWidth - window.innerWidth, main.scrollWidth - main.clientWidth);
      })).toBeLessThanOrEqual(1);
      if (phone) await expect.poll(() => page.locator('[data-actionbar] [data-variant="primary"] .btn-label').evaluate(label => label.scrollWidth - label.clientWidth)).toBeLessThanOrEqual(1);
      expect(await measure(page)).toEqual([]);
    });
  }
}

test("firm and FY changes keep the right due list; month and chart toggles ask nothing", async ({ page }, info) => {
  const fixture = await fixtureDashboard(page);
  await page.goto("/");
  await dashboardShown(page);
  const beforeToggle = fixture.calls.filter((call) => ["/api/dashboard/", "/api/due-next/"].includes(call.path)).length;
  const period = page.getByRole("radiogroup", { name: "Period", exact: true });
  await period.getByRole("radio", { name: "Last 30 days", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Last 30 days", exact: true })).toBeVisible();
  await period.getByRole("radio", { name: /^This month/ }).click();
  await expect(page.getByRole("heading", { name: "October so far", exact: true })).toBeVisible();
  if (info.project.name === "desktop") {
    const chart = page.getByRole("radiogroup", { name: "Chart shows", exact: true });
    await chart.getByRole("radio", { name: "Bills", exact: true }).click();
    await expect(page.getByRole("region", { name: `FY ${CURRENT_FY} by month`, exact: true })).toContainText("bill counts");
    await chart.getByRole("radio", { name: "Value", exact: true }).click();
  }
  expect(fixture.calls.filter((call) => ["/api/dashboard/", "/api/due-next/"].includes(call.path))).toHaveLength(beforeToggle);
  if (info.project.name === "phone") {
    await page.getByRole("radiogroup", { name: "Firm", exact: true }).getByRole("radio", { name: "Kiran", exact: true }).click();
  } else {
    await page.getByRole("button", { name: /^Firm: / }).click();
    await page.getByRole("menuitem", { name: /^Kiran/ }).click();
  }
  const due = page.getByRole("region", { name: "Due next", exact: true });
  await expect(due.getByText(ITEMS[0].title, { exact: true })).toBeVisible();
  await expect(due.getByText(ITEMS[1].title, { exact: true })).toHaveCount(0);
  await expect.poll(() => fixture.calls.filter((call) => call.path === "/api/due-next/" && call.params.business_id === "3").length).toBeGreaterThan(0);
  const dueBeforeFY = fixture.calls.filter((call) => call.path === "/api/due-next/").length;
  await page.getByRole("button", { name: /^Financial year / }).click();
  await page.getByRole("menuitem", { name: new RegExp(`^FY ${PAST_FY}`) }).click();
  await expect(page.getByRole("heading", { name: "March 2026", exact: true })).toBeVisible();
  await expect(due.getByText(ITEMS[0].title, { exact: true })).toBeVisible();
  await expect(page.getByText("Anil Gupta", { exact: true }).first()).toBeVisible();
  expect(fixture.calls.filter((call) => call.path === "/api/due-next/")).toHaveLength(dueBeforeFY);
  expect(fixture.calls.filter((call) => call.path === "/api/due-next/").every((call) => !("fy" in call.params))).toBe(true);
});

test("Due next expands the server order and keeps keyboard actions", async ({ page }, info) => {
  await fixtureDashboard(page);
  await page.goto("/");
  await dashboardShown(page);
  const due = page.getByRole("region", { name: "Due next", exact: true });
  const more = due.getByRole("button", { name: /^Show \d+ more$/ });
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(due.getByRole("button", { name: "Show fewer", exact: true })).toHaveAttribute("aria-expanded", "true");
  const links = due.getByRole("link");
  await expect(links).toHaveCount(ITEMS.length);
  for (let n = 0; n < ITEMS.length; n += 1) await expect(links.nth(n)).toContainText(ITEMS[n].title);
  await expect(links.nth(4)).toHaveAttribute("href", "/purchases/inbox");
  await expect(links.nth(5)).toHaveAttribute("href", `/sales/new?draft=${ITEMS[5].draft_id}`);
  await expect(links.nth(6)).toHaveAttribute("href", "/purchases?status=check");
  await due.getByRole("button", { name: "Show fewer", exact: true }).click();
  await expect(links).toHaveCount(info.project.name === "phone" ? 4 : 6);
});

test.describe("a real viewer session", () => {
  test.use({ storageState: SIGNED_OUT });
  test("empty Due next uses viewer words and offers View on returns", async ({ page }, info) => {
    test.skip(!hasLogin("viewer"), "Requires the dispatched sandbox's real viewer login; CI has one owner user.");
    await fixtureDashboard(page, { viewer: true });
    await page.goto("/login");
    await opened(page);
    await signIn(page, "viewer");
    await page.waitForURL((url) => url.pathname !== "/login");
    await page.goto("/");
    await dashboardShown(page);
    const due = page.getByRole("region", { name: "Due next", exact: true });
    await expect(due).toContainText("Nothing for you to do here");
    await expect(due).toContainText("The owner and the accountant look after filing and the day's loose ends. Figures below are for reading.");
    await expect(page.getByRole("link", { name: "New bill", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Set today's rates", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Change", exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Latest changes", exact: true })).toHaveCount(0);
    const returns = page.getByRole("region", { name: "September 2026 returns", exact: true });
    await expect(returns.getByRole("link", { name: "Fix the problem", exact: true })).toHaveCount(0);
    await expect(returns.getByRole("link", { name: "File GSTR-3B", exact: true })).toHaveCount(0);
    if (info.project.name === "phone") {
      await expect(returns.getByRole("link", { name: /KIRAN GOLD HOUSE/ })).toHaveAttribute("href", "/gst?firm=3&month=2026-09");
      await expect(returns).toContainText("Blocked · the owner is fixing it");
      await expect(page.getByRole("button", { name: /Today's rates · set/ })).toHaveAttribute("aria-disabled", "true");
    } else {
      await expect(returns.getByRole("link", { name: "View", exact: true })).toHaveCount(2);
    }
    expect(await measure(page)).toEqual([]);
  });
});

test("real server: three contiguous paper bills leave Due next unchanged", async ({ page, request }) => {
  const api = client(request);
  const due = await api.get("due-next/", { returns: 1 });
  expect(due.returns, "5A's returns reader must be installed for the real paper regression").not.toBeNull();
  const candidate = due.returns.firms.find((row) => ["ready", "blocked"].includes(row.stage));
  test.skip(!candidate, "All firms filed the month just ended; run this case in an unfiled seeded month.");
  const firm = candidate.firm;
  const month = due.returns.month;
  const [year, number] = month.split("-").map(Number);
  const day = `${month}-${String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, "0")}`;
  const thisDay = today();
  const fyYear = Number(thisDay.slice(0, 4)) - (Number(thisDay.slice(5, 7)) < 4 ? 1 : 0);
  await expertOnThisPage(page, { firm: firm.id, fy: `${fyYear}-${String((fyYear + 1) % 100).padStart(2, "0")}` });
  await page.goto(`/?firm=${firm.id}`);
  await dashboardShown(page);
  const before = await dueText(page);
  const serverList = await api.get("due-next/", { business_id: firm.id, returns: 1 });
  const shown = page.getByRole("region", { name: "Due next", exact: true }).getByRole("link");
  await expect(shown).toHaveCount(serverList.items.length);
  for (let n = 0; n < serverList.items.length; n += 1) {
    await expect(shown.nth(n)).toContainText(serverList.items[n].title);
    await expect(shown.nth(n)).toContainText(serverList.items[n].detail);
  }
  const bookBefore = await api.get("sales/paper-book/", { business_id: firm.id, month });
  const customer = await walkIn(api);
  const numbers = [];
  for (let n = 0; n < 3; n += 1) {
    const next = await api.get("sales/next-number/", { business_id: firm.id, invoice_date: day });
    const saved = await api.post("sales/", {
      business: firm.id, customer: customer.id, invoice_number: next.invoice_number, invoice_date: day,
      payment_mode: "cash", place_of_supply: null, notes: "Dashboard paper acceptance", paper: true,
      // Synthetic nil-rated lines keep a credit-covered return from changing into a
      // cash-paying return. This case isolates paper/no-send and number-gap behavior.
      lines: [{ product_name: "Dashboard paper fixture", hsn_code: "711319", gst_percent: "0", quantity: "1.000", unit: "gms", rate: "100.000", note: "" }],
    });
    noteBill(saved.id, saved.invoice_number);
    numbers.push(saved.counter);
    expect(saved.paper).toBe(true);
    expect(saved.sent).toBeNull();
  }
  expect(numbers[1]).toBe(numbers[0] + 1);
  expect(numbers[2]).toBe(numbers[1] + 1);
  const bookAfter = await api.get("sales/paper-book/", { business_id: firm.id, month });
  expect(bookAfter.missing_count).toBe(bookBefore.missing_count);
  // A hard reload discards the query cache: unchanged text cannot pass by showing
  // the pre-save answer. The awaited successful response proves the fresh read.
  const fresh = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/due-next/" && response.status() === 200);
  await page.reload();
  await fresh;
  await dashboardShown(page);
  expect(await dueText(page)).toBe(before);
});
