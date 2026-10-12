// Synthetic people only. The signed-in owner is never stopped or given a new password.
const { randomBytes } = require("crypto");
const { expect } = require("@playwright/test");
const { savedToken, SIGNED_OUT, opened } = require("./session");
const { afterDialog, esc } = require("./sales-data");
const names = new Set();
const contexts = new Set();

function syntheticPerson() {
  const suffix = randomBytes(5).toString("hex");
  const person = { first_name: "Replay", last_name: `Verifier${suffix}`, username: `p4d_${suffix}`, email: "", role: "staff", usual_firm: null,
    password: `Sunrise9${randomBytes(9).toString("hex")}`, nextPassword: `Moonrise7${randomBytes(9).toString("hex")}` };
  names.add(person.username); // before POST, so a timeout after a successful write is cleaned up too
  return person;
}

/** No response bodies or request options in thrown errors: token and password calls use this too. */
async function privateCall(request, method, path, data, token = savedToken()) {
  let response;
  try { response = await request.fetch(`/api/${path}`, { method, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}), ...(data === undefined ? {} : { data }) }); }
  catch { throw new Error(`People fixture ${method} ${path} could not reach the app.`); }
  if (!response.ok()) throw new Error(`People fixture ${method} ${path} answered ${response.status()}.`);
  if (response.status() === 204) return null;
  try { return await response.json(); } catch { throw new Error(`People fixture ${method} ${path} did not answer JSON.`); }
}
async function makePerson(request) {
  const person = syntheticPerson();
  const { nextPassword, ...input } = person;
  const row = await privateCall(request, "POST", "people/", input);
  return { ...row, password: person.password, nextPassword };
}
async function accountToken(page) {
  return page.evaluate(() => sessionStorage.getItem("gst_access_token") || localStorage.getItem("gst_access_token"));
}
async function anotherPage(browser, baseURL, viewport) {
  const context = await browser.newContext({ baseURL, viewport, storageState: SIGNED_OUT });
  contexts.add(context);
  return context.newPage();
}

/** Like session.signIn's redaction, for generated accounts and password-change fields. */
async function secretField(page, label, value) {
  try { await page.getByLabel(label, { exact: true }).fill(value); }
  catch { throw new Error(`Could not fill the ${label.toLowerCase()} field.`); }
}
async function signInPerson(page, person, password = person.password, { refused = false, remember = true } = {}) {
  await page.goto("/login");
  await opened(page);
  await page.getByLabel("Username", { exact: true }).fill(person.username);
  await page.getByRole("checkbox", { name: "Keep me signed in on this device" }).setChecked(remember);
  await secretField(page, "Password", password);
  if (refused) {
    const [reply] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === "/api/token/" && r.request().method() === "POST"),
      page.getByRole("button", { name: "Sign in", exact: true }).click(),
    ]);
    const message = await page.getByText(`The owner has stopped @${person.username} signing in. Ask the owner.`, { exact: true }).textContent();
    // Strip the field before any assertion could snapshot it. Typing clears the error too.
    await secretField(page, "Password", "");
    return { status: reply.status(), message };
  }
  const [reply] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === "/api/token/" && r.request().method() === "POST"),
    page.getByRole("button", { name: "Sign in", exact: true }).click(),
  ]);
  if (!reply.ok()) {
    await secretField(page, "Password", "");
    throw new Error(`Fixture sign-in answered ${reply.status()}.`);
  }
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 30_000 });
}
async function choosePassword(page, person) {
  await page.waitForURL((url) => url.pathname === "/password");
  await opened(page);
  await secretField(page, "Current password", person.password);
  await secretField(page, "New password", person.nextPassword);
  await secretField(page, "New password again", person.nextPassword);
  await page.getByRole("button", { name: "Save my password" }).click();
  await page.waitForURL((url) => url.pathname !== "/password" && url.pathname !== "/login", { timeout: 30_000 });
}
async function openPeople(page, person) {
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Users and roles", exact: true })).toBeVisible();
  await opened(page);
  if (person) await page.getByRole("searchbox", { name: "Search people" }).fill(person.username);
}
async function personAction(page, person, action) {
  const label = { password: "Set a new password", firm: "Change usual firm", history: "Recent changes", stop: `Stop ${person.first_name} signing in`, allow: `Let ${person.first_name} back in` }[action];
  if (page.viewportSize().width < 768) {
    await page.getByRole("button", { name: new RegExp(`^${esc(person.name)}`) }).click();
    const detail = page.getByRole("dialog", { name: person.name, exact: true });
    await expect(detail).toBeVisible(); await afterDialog(page);
    if (action === "role") return detail.getByRole("button", { name: /^Role for / }).click();
    await detail.getByRole("button", { name: label, exact: true }).click();
  } else {
    if (action === "role") return page.getByRole("button", { name: new RegExp(`^Role for ${esc(person.name)}:`) }).click();
    await page.getByRole("button", { name: `More for ${person.name}`, exact: true }).click();
    await page.getByRole("menuitem", { name: new RegExp(`^${esc(label)}`) }).click();
  }
}

/** Cleanup is an afterEach, so timeouts cannot leave a newly created account allowed to sign in. */
function temporaryPeople(test) {
  test.afterEach(async ({ page, request }) => {
    await page.goto("about:blank").catch(() => {});
    for (const context of contexts) {
      for (const tab of context.pages()) await tab.goto("about:blank").catch(() => {});
      await context.close();
    }
    contexts.clear();
    if (!names.size) return;
    try {
      const { results } = await privateCall(request, "GET", "people/");
      for (const person of results.filter((p) => names.has(p.username) && p.active)) await privateCall(request, "POST", `people/${person.id}/stop/`);
    } finally { names.clear(); }
  });
}
module.exports = { syntheticPerson, privateCall, makePerson, accountToken, anotherPage, secretField, signInPerson, choosePassword, openPeople, personAction, temporaryPeople };
