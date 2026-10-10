// A tour of what part 0 built, for the shop owner to watch: v3.record.config.js records each one as a video, and the
// stills go beside it. 600 ms between steps, so a person can follow; that also keeps the first click inside a page
// clear of the page frame's 300 ms guard (AGENTS.md).
const { test, expect } = require("@playwright/test");
const { easyIfExpertSaved, savedToken, signIn, typesPassword } = require("./session");

typesPassword(test);

const SEARCH = process.env.E2E_SEARCH || "Sharma";
const HIT = process.env.E2E_SEARCH_HIT || "Priya Sharma";

/** Time for a person to see what just happened. */
const pause = (page) => page.waitForTimeout(600);
/** A still for the owner, beside the video: test-results/<test>/<name>.png. */
const still = (page, name) => page.screenshot({ path: test.info().outputPath(`${name}.png`) });

test("the desktop tour: sign in, Sales, More, the firm picker, search, theme and text size, sign out", { tag: "@desktop" }, async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await pause(page);
  await still(page, "desktop-1-sign-in"); // before signing in: both fields empty
  await signIn(page);
  // waitForURL, not expect: the password is still in its field if this fails (see typesPassword)
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 30_000 });
  await expect(page.getByText(/comes in part \d/)).toBeVisible();
  await pause(page);

  // Sales: a placeholder until part 1, with the nav marking where you are
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: "Sales" }).click();
  await expect(nav.getByRole("link", { name: "Sales" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(/comes in part \d/)).toBeVisible();
  await pause(page);
  await still(page, "desktop-2-sales");

  // More, and Esc closes it
  await nav.getByRole("button", { name: /^More/ }).click();
  await expect(page.getByRole("menuitem", { name: "Products" })).toBeVisible();
  await pause(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "Products" })).toBeHidden();
  await pause(page);

  // the firm picker: another firm, then the usual one back
  const picker = page.getByRole("button", { name: /^Firm: / });
  await expect(picker).not.toHaveAccessibleName(/^Firm: (loading|couldn't load)$/);
  const usual = await picker.getAttribute("aria-label");
  await picker.click();
  const items = page.getByRole("menuitem");
  await expect(items.filter({ hasText: "All firms" })).toBeVisible();
  await pause(page);
  const was = await items.evaluateAll((els) => els.findIndex((el) => el.hasAttribute("aria-current")));
  expect(was).toBeGreaterThanOrEqual(0);
  // a firm other than the one showing (item 0 is All firms), or All firms for a shop with one firm
  const other = [...Array(await items.count()).keys()].find((i) => i > 0 && i !== was) ?? 0;
  const name = (await items.nth(other).innerText()).split("\n")[0]; // the firm's name, above its GSTIN
  await items.nth(other).click();
  await expect(picker).toHaveAccessibleName(`Firm: ${name}`);
  await pause(page);
  await picker.click();
  await expect(items.nth(was)).toBeVisible();
  await pause(page);
  await items.nth(was).click();
  await expect(picker).toHaveAccessibleName(usual);
  await pause(page);

  // Ctrl K: search finds a customer on the server
  await page.keyboard.press("Control+k");
  const box = page.getByRole("combobox");
  await expect(box).toBeFocused();
  await pause(page);
  await box.pressSequentially(SEARCH, { delay: 120 });
  await expect(page.getByRole("option", { name: HIT }).first()).toBeVisible();
  await pause(page);
  await still(page, "desktop-3-search");
  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();
  await pause(page);

  // the account menu: Pearl, Larger text, then Normal and Obsidian again (this browser's own: it started empty)
  const account = page.getByRole("button", { name: /^Account/ });
  await account.click();
  await pause(page);
  await page.getByRole("menuitem", { name: "Pearl" }).click();
  await expect(page.locator("html")).toHaveClass("theme-pearl");
  await pause(page);
  await account.click();
  await pause(page);
  await still(page, "desktop-4-pearl"); // the app in Pearl, its menu open on the themes and text sizes
  await page.getByRole("menuitem", { name: /^Larger/ }).click();
  await expect(page.locator("#root")).toHaveCSS("zoom", "1.2");
  await pause(page);
  await account.click();
  await pause(page);
  await page.getByRole("menuitem", { name: /^Normal/ }).click();
  await expect(page.locator("#root")).toHaveCSS("zoom", "1");
  await pause(page);
  await account.click();
  await pause(page);
  await page.getByRole("menuitem", { name: "Obsidian" }).click();
  await expect(page.locator("html")).toHaveClass("");
  await pause(page);

  // sign out: asked first, then the sign-in page
  await account.click();
  await pause(page);
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  const ask = page.getByRole("dialog", { name: "Sign out?" });
  await expect(ask).toBeVisible();
  await pause(page);
  await ask.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL((url) => url.pathname === "/login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await pause(page);
});

test.describe(() => {
  // Easy or Expert is saved on the server, for this user and every run: Easy goes back however the tour ended. An
  // afterEach, not a finally: a finally can't run after a timeout.
  test.afterEach(async ({ request }) => {
    await easyIfExpertSaved(request, savedToken());
  });

  test("the phone tour: Easy and its tabs, More, Expert and its tabs, back to Easy", { tag: "@phone" }, async ({ page }) => {
    const tabs = page.getByRole("navigation", { name: "Tabs" });
    const tab = (label) => tabs.getByRole("link", { name: label, exact: true });
    const visitTabs = async () => {
      for (const label of ["Bills", "Capture", "Customers", "More"]) {
        await tab(label).click();
        await expect(tab(label)).toHaveAttribute("aria-current", "page");
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await pause(page);
      }
    };

    // a phone opens on Easy's home
    await page.goto("/");
    await expect(page).toHaveURL((url) => url.pathname === "/e");
    await expect(tab("Home")).toHaveAttribute("aria-current", "page");
    await expect(page.getByText(/comes in part \d/)).toBeVisible();
    await pause(page);
    await still(page, "phone-1-easy-home");
    await visitTabs();
    await still(page, "phone-2-more"); // Easy's More, the switch to Expert at the top

    // Expert: its home is Today, with search in the header
    await page.getByRole("button", { name: /^Switch to Expert/ }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/");
    await expect(tab("Home")).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "Search customers and bills" })).toBeVisible();
    await pause(page);
    await still(page, "phone-3-expert-today");
    await visitTabs();

    // and back to Easy, from Expert's More
    await page.getByRole("button", { name: /^Switch to Easy/ }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/e");
    await expect(tab("Home")).toHaveAttribute("aria-current", "page");
    await pause(page);
  });
});
