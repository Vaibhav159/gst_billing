// P4-11 / X-40: run after 4B's fake-file provider lands, on the assigned sandbox under its lock.
const { isAbsolute } = require("node:path");
const { randomInt } = require("node:crypto");
const { test, expect } = require("@playwright/test");
const { typesPassword, opened } = require("./session");
const { afterDialog } = require("./sales-data");
const { syntheticPerson, privateCall, accountToken, anotherPage, secretField, signInPerson, choosePassword, temporaryPeople } = require("./people-data");
const { outboxVersion, readFakeSms } = require("./fake-sms");

typesPassword(test);
test.use({ trace: "off", screenshot: "off", video: "off" });
temporaryPeople(test);

test("fake SMS resets a temporary owner's password and ends their existing session", async ({ page, request, browser, baseURL }) => {
  test.skip(process.env.SANDBOX_FAKE_SMS !== "1", "P4-11 / X-40: requires 4B's explicitly enabled sandbox fake SMS provider and readable outbox.");
  const file = process.env.SMS_FAKE_OUTBOX_FILE;
  if (!file || !isAbsolute(file)) throw new Error("Set the assigned sandbox's absolute fake SMS outbox path.");
  expect((await privateCall(request, "GET", "auth/options/", undefined, null)).sms_reset).toBe(true);

  // Never reset the suite owner. Only this generated owner gets a synthetic mobile.
  const person = syntheticPerson();
  const { nextPassword, ...input } = person;
  const row = await privateCall(request, "POST", "people/", { ...input, role: "owner" });
  const owner = { ...row, password: person.password, nextPassword };
  const signedIn = await anotherPage(browser, baseURL, page.viewportSize());
  await signInPerson(signedIn, owner); await choosePassword(signedIn, owner);
  // A fresh synthetic mobile each run: a stopped owner from an earlier run never shares it (4B may make phones unique).
  const phone = `9${String(randomInt(0, 1_000_000_000)).padStart(9, "0")}`;
  // R4B-2: a phone change needs the current password (this device stays signed in).
  await privateCall(request, "PATCH", "account/", { phone, current: owner.nextPassword }, await accountToken(signedIn));

  const guest = await anotherPage(browser, baseURL, page.viewportSize());
  try {
    await guest.goto("/login"); await opened(guest);
    await guest.getByRole("button", { name: "Forgot your password?", exact: true }).click();
    const dialog = guest.getByRole("dialog", { name: "Forgot your password?", exact: true });
    await dialog.waitFor({ state: "visible" }); await afterDialog(guest);
    await dialog.getByRole("button", { name: /^The owner/ }).click(); await afterDialog(guest);
    await dialog.getByLabel("Username", { exact: true }).fill(owner.username);

    const responseTo = (endpoint) => guest.waitForResponse((r) => new URL(r.url()).pathname === `/api/auth/reset/${endpoint}/` && r.request().method() === "POST");
    let previous = outboxVersion(file);
    const [started] = await Promise.all([responseTo("start"), dialog.getByRole("button", { name: "Send a code", exact: true }).click()]);
    test.skip(started.status() === 429, "Reset is throttled at ten an hour: run again after an hour.");
    expect(started.status()).toBe(200);
    const firstCode = readFakeSms(file, { phone, previous });
    await dialog.getByLabel("Code from the SMS", { exact: true }).waitFor({ state: "visible" }); await afterDialog(guest);

    previous = outboxVersion(file);
    const [resent] = await Promise.all([responseTo("start"), dialog.getByRole("button", { name: "Send a new code", exact: true }).click()]);
    expect(resent.status()).toBe(200);
    const code = readFakeSms(file, { phone, previous });
    // Two random deliveries can match. In that case use a different wrong code; never assert randomness.
    const wrong = firstCode === code ? (code === "000000" ? "000001" : "000000") : firstCode;
    const fillReset = async (value) => {
      await secretField(guest, "Code from the SMS", value);
      await secretField(guest, "New password", person.password);
      await secretField(guest, "New password again", person.password);
    };
    await fillReset(wrong);
    const [refused] = await Promise.all([responseTo("finish"), dialog.getByRole("button", { name: "Set the new password", exact: true }).click()]);
    const refusal = await refused.json();
    // No assertions/snapshots while any credential is filled.
    await secretField(guest, "Code from the SMS", "");
    await secretField(guest, "New password", "");
    await secretField(guest, "New password again", "");
    expect(refused.status()).toBe(400);
    expect(Array.isArray(refusal.code) && refusal.code.length === 1 && refusal.code[0] === "That code isn't right or has run out. Ask for a new code.").toBe(true);

    await fillReset(code);
    const [finished] = await Promise.all([responseTo("finish"), dialog.getByRole("button", { name: "Set the new password", exact: true }).click()]);
    // Wait for the successful form to erase secrets before asserting; errors still blank the page in finally.
    await dialog.getByLabel("Code from the SMS", { exact: true }).waitFor({ state: "hidden" });
    expect(finished.status()).toBe(200);
    await expect(dialog.getByText("Password changed. Sign in with the new one. Every other device is signed out.", { exact: true })).toBeVisible();
    await signedIn.goto("/profile");
    await signedIn.waitForURL((url) => url.pathname === "/login" && url.searchParams.get("reason") === "signed_out");
    await signInPerson(guest, owner, person.password);
    const me = await privateCall(request, "GET", "me/", undefined, await accountToken(guest));
    expect(me.username).toBe(owner.username);
    expect(me.must_change_password).toBe(false);
    // The stopped temporary owner left behind keeps no mobile number; clearing it needs the password just signed in with (R4B-2).
    await privateCall(request, "PATCH", "account/", { phone: "", current: person.password }, await accountToken(guest));
  } finally {
    await guest.goto("about:blank").catch(() => {});
  }
  // Two starts + two finishes per viewport: eight requests across desktop/phone, below reset's ten/hour.
});
