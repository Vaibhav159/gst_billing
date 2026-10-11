// Run only after 4B lands, on the assigned sandbox under its lock. No real shop account is mutated.
const { test, expect } = require("@playwright/test");
const { typesPassword, opened } = require("./session");
const { afterDialog } = require("./sales-data");
const { syntheticPerson, privateCall, makePerson, accountToken, anotherPage, secretField, signInPerson, choosePassword, openPeople, personAction, temporaryPeople } = require("./people-data");

typesPassword(test);
test.use({ trace: "off", screenshot: "off", video: "off" });
temporaryPeople(test);

test("add a person, sign in, and choose their own password before opening the shop", async ({ page, request, browser, baseURL }) => {
  const person = syntheticPerson();
  await openPeople(page);
  await page.getByRole("button", { name: "Add a person", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a person" });
  await expect(dialog).toBeVisible(); await afterDialog(page);
  await dialog.getByLabel(/First name/).fill(person.first_name);
  await dialog.getByLabel(/Last name/).fill(person.last_name);
  await dialog.getByLabel(/Username/).fill(person.username);
  await secretField(page, "Password", person.password);
  await secretField(page, "Password again", person.password);
  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === "/api/people/" && r.request().method() === "POST"),
    dialog.getByRole("button", { name: `Add ${person.first_name}`, exact: true }).click(),
  ]);
  if (response.status() !== 201) throw new Error(`Adding the synthetic person answered ${response.status()}.`);
  await dialog.waitFor({ state: "hidden" }); // no expect while a secret might still be in the form
  const row = await response.json();
  expect(row.must_change_password).toBe(true);
  const staff = await anotherPage(browser, baseURL, page.viewportSize());
  await signInPerson(staff, person, person.password, { remember: false });
  await staff.waitForURL((url) => url.pathname === "/password");
  await expect(staff.getByRole("heading", { name: "Choose your own password" })).toBeVisible();
  await staff.goto("/sales");
  await staff.waitForURL((url) => url.pathname === "/password");
  await choosePassword(staff, person);
  expect(await staff.evaluate(() => localStorage.getItem("gst_access_token") === null && sessionStorage.getItem("gst_access_token") !== null)).toBe(true);
  await staff.goto("/profile");
  await expect(staff.getByRole("heading", { name: "Profile and password", exact: true })).toBeVisible();
  const me = await privateCall(request, "GET", "me/", undefined, await accountToken(staff));
  expect(me.must_change_password).toBe(false);
  expect(me.username).toBe(person.username);
});

test("stop signs out a temporary person and allowing them keeps their role and password", async ({ page, request, browser, baseURL }) => {
  const person = await makePerson(request);
  const staff = await anotherPage(browser, baseURL, page.viewportSize());
  await signInPerson(staff, person); await choosePassword(staff, person);
  await openPeople(page, person); await personAction(page, person, "stop");
  const stop = page.getByRole("dialog", { name: `Stop ${person.name} signing in?`, exact: true });
  await expect(stop).toBeVisible(); await afterDialog(page);
  await stop.getByRole("button", { name: `Stop ${person.first_name} signing in`, exact: true }).click();
  await expect(stop).not.toBeVisible();
  await staff.goto("/profile"); await staff.waitForURL((url) => url.pathname === "/login");
  expect(await signInPerson(staff, person, person.nextPassword, { refused: true })).toEqual({ status: 401, message: `The owner has stopped @${person.username} signing in. Ask the owner.` });
  await personAction(page, person, "allow");
  const allow = page.getByRole("dialog", { name: `Let ${person.name} back in?`, exact: true });
  await expect(allow).toBeVisible(); await afterDialog(page);
  await allow.getByRole("button", { name: "Let them back in", exact: true }).click();
  await expect(allow).not.toBeVisible();
  await signInPerson(staff, person, person.nextPassword);
  await staff.goto("/profile");
  await expect(staff.getByRole("heading", { name: "Profile and password", exact: true })).toBeVisible();
  const me = await privateCall(request, "GET", "me/", undefined, await accountToken(staff));
  expect(me.role).toBe("staff"); expect(me.must_change_password).toBe(false);
});

test("signing out another device refuses its next request and leaves this device signed in", async ({ page, request, browser, baseURL }) => {
  const person = await makePerson(request);
  const first = await anotherPage(browser, baseURL, page.viewportSize());
  await signInPerson(first, person); await choosePassword(first, person);
  const second = await anotherPage(browser, baseURL, page.viewportSize());
  await signInPerson(second, person, person.nextPassword);
  await first.goto("/profile");
  await expect(first.getByRole("heading", { name: "Profile and password", exact: true })).toBeVisible(); await opened(first);
  const other = first.getByRole("button", { name: /^Sign out on / });
  await expect(other).toHaveCount(1); await other.click();
  const confirm = first.getByRole("dialog", { name: /^Sign out on / });
  await expect(confirm).toBeVisible(); await afterDialog(first);
  await confirm.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(confirm).not.toBeVisible();
  await second.goto("/profile");
  await second.waitForURL((url) => url.pathname === "/login" && url.searchParams.get("reason") === "signed_out");
  await expect(second.getByText("You were signed out on this device. Sign in again.", { exact: true })).toBeVisible();
  await expect(first.getByText("You're signed in on this device only.", { exact: true })).toBeVisible();
  expect((await privateCall(request, "GET", "me/", undefined, await accountToken(first))).username).toBe(person.username);
});

test("SMS ships off and Forgot password explains the owner's existing route", async ({ page, request, browser, baseURL }) => {
  const options = await privateCall(request, "GET", "auth/options/", undefined, null);
  test.skip(options.sms_reset, "This check requires SMS_RESET_ENABLED off; full SMS-on replay is covered by server fake-provider tests and mocked web tests, because the contract has no browser-accessible fake-code fixture.");
  const guest = await anotherPage(browser, baseURL, page.viewportSize());
  await guest.goto("/login"); await opened(guest);
  await guest.getByRole("button", { name: "Forgot your password?", exact: true }).click();
  const dialog = guest.getByRole("dialog", { name: "Forgot your password?", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Password codes by SMS aren't switched on yet. Ask the owner to set a new password for you. If you are the owner, ask the person who looks after the app.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Send a code" })).toHaveCount(0);
});
