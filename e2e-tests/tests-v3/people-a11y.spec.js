// No password is typed in these checks. Synthetic credentials/tokens travel only through privateCall;
// no trace, video, screenshot, attachment or saved browser-state file carries them.
const { test, expect } = require("@playwright/test");
const { typesPassword, opened } = require("./session");
const { afterDialog } = require("./sales-data");
const { measure } = require("./axe");
const { privateCall, makePerson, anotherPage, openPeople, personAction, temporaryPeople } = require("./people-data");

typesPassword(test);
test.use({ trace: "off", screenshot: "off", video: "off" });
temporaryPeople(test);

async function themePage(page, theme, path) {
  await page.addInitScript((value) => localStorage.setItem("gst3.theme", value), theme);
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("html")).toHaveClass(theme === "obsidian" ? "" : `theme-${theme}`);
  await opened(page);
}
async function checkDialog(page, name) {
  await expect(page.getByRole("dialog", { name, exact: true })).toBeVisible();
  await afterDialog(page);
  expect(await measure(page), `WCAG 2.2 AA: ${name}`).toEqual([]);
}
async function withTokens(page, tokens) {
  try {
    await page.addInitScript(({ access, refresh }) => {
      localStorage.setItem("gst_access_token", access);
      localStorage.setItem("gst_refresh_token", refresh);
    }, { access: tokens.access, refresh: tokens.refresh });
  } catch { throw new Error("Could not prepare the synthetic sign-in session."); }
}

for (const theme of ["obsidian", "pearl"]) {
  for (const path of ["/users", "/profile"]) {
    test(`WCAG 2.2 AA: ${path} in ${theme}`, async ({ page }) => {
      await themePage(page, theme, path);
      expect(await measure(page)).toEqual([]);
    });
  }
  test(`WCAG 2.2 AA: login and Forgot password in ${theme}`, async ({ page, browser, baseURL }) => {
    const guest = await anotherPage(browser, baseURL, page.viewportSize());
    await themePage(guest, theme, "/login");
    expect(await measure(guest)).toEqual([]);
    await guest.getByRole("button", { name: "Forgot your password?", exact: true }).click();
    await checkDialog(guest, "Forgot your password?");
  });
  test(`WCAG 2.2 AA: mandatory password page in ${theme}`, async ({ page, request, browser, baseURL }) => {
    const person = await makePerson(request);
    const tokens = await privateCall(request, "POST", "token/", { username: person.username, password: person.password }, null);
    const staff = await anotherPage(browser, baseURL, page.viewportSize());
    await withTokens(staff, tokens);
    await themePage(staff, theme, "/password");
    await expect(staff.getByRole("heading", { name: "Choose your own password", exact: true })).toBeVisible();
    expect(await measure(staff)).toEqual([]);
  });
  test(`WCAG 2.2 AA: people dialogs in ${theme}`, async ({ page, request }) => {
    const person = await makePerson(request);
    await themePage(page, theme, "/users");
    await page.getByRole("button", { name: "Add a person", exact: true }).click();
    await checkDialog(page, "Add a person");
    for (const [action, title] of [
      ["password", `New password for ${person.name}`],
      ["firm", `${person.name} usually works for`],
      ["history", `Recent changes to ${person.name}`],
      ["stop", `Stop ${person.name} signing in?`],
    ]) {
      await openPeople(page, person); await personAction(page, person, action);
      await checkDialog(page, title);
    }
    await openPeople(page, person); await personAction(page, person, "role");
    await afterDialog(page);
    await page.getByRole("menuitem", { name: /^Accountant/ }).click();
    await checkDialog(page, `${person.name}: Counter staff → Accountant`);
    await page.goto("about:blank");
    await privateCall(request, "POST", `people/${person.id}/stop/`);
    await openPeople(page, person); await personAction(page, person, "allow");
    await checkDialog(page, `Let ${person.name} back in?`);
  });
  test(`WCAG 2.2 AA: signed-in-device confirmations in ${theme}`, async ({ page, request, browser, baseURL }) => {
    const person = await makePerson(request);
    const issued = await privateCall(request, "POST", "token/", { username: person.username, password: person.password }, null);
    const current = await privateCall(request, "POST", "account/password/", { current: person.password, password: person.nextPassword }, issued.access);
    // A second real sign-in session for this temporary person; never another device of the suite's owner.
    await privateCall(request, "POST", "token/", { username: person.username, password: person.nextPassword }, null);
    const staff = await anotherPage(browser, baseURL, page.viewportSize());
    await withTokens(staff, current);
    await themePage(staff, theme, "/profile");
    await staff.getByRole("button", { name: /^Sign out on / }).click();
    const single = staff.getByRole("dialog", { name: /^Sign out on / });
    await expect(single).toBeVisible(); await afterDialog(staff);
    expect(await measure(staff), "WCAG 2.2 AA: sign out one device").toEqual([]);
    await single.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(single).not.toBeVisible();
    await staff.getByRole("button", { name: "Sign out all others", exact: true }).click();
    await checkDialog(staff, "Sign out on 1 other devices?");
  });
}
