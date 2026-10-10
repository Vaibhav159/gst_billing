// The session the setup saves and the specs start from, who signs in, and the API calls a spec makes beside the app's.
// Passwords come from env or from the sandbox's logins file, and are never printed.
const fs = require("fs");
const path = require("path");
const { expect } = require("@playwright/test");

/** The signed-in session (git-ignored): one absolute path for the config, the setup and the specs. */
const AUTH = path.join(__dirname, "..", ".auth-v3.json");
/** A signed-out browser: no cookies, nothing stored. */
const SIGNED_OUT = { cookies: [], origins: [] };

function credentials() {
  if (process.env.E2E_USER && process.env.E2E_PASS) return { user: process.env.E2E_USER, pass: process.env.E2E_PASS };
  const role = process.env.E2E_ROLE || "owner";
  const line = fs.readFileSync(process.env.LOGINS_FILE, "utf8").split("\n").find((l) => l.split("\t")[0] === role);
  if (!line) throw new Error(`No ${role} line in LOGINS_FILE`);
  const [, user, pass] = line.split("\t");
  return { user, pass: pass.trim() };
}

/**
 * For a file whose tests type a password, called at its top level (Ruling 54): no trace, and a test that fails or times
 * out leaves its page for about:blank before the page closes, so the page snapshot Playwright writes to error-context.md
 * can't show the password field's value. trace is a worker option, so this can't go in a describe.
 * A failed expect(page) or expect(locator) snapshots the page there and then, before this runs: while a password is in
 * its field, wait with page.waitForURL (a plain timeout, no snapshot), never with an expect.
 */
function typesPassword(test) {
  test.use({ trace: "off" });
  test.afterEach(async ({ page }, info) => {
    if (info.status !== info.expectedStatus) await page.goto("about:blank");
  });
}

/** Signs in on the sign-in page showing. Its file calls typesPassword(test). */
async function signIn(page) {
  const { user, pass } = credentials();
  await page.getByLabel("Username").fill(user);
  // exact: the show-password toggle's name ("Show password") also has "Password" in it
  await page.getByLabel("Password", { exact: true }).fill(pass);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** The saved session's access token. */
function savedToken() {
  const { origins } = JSON.parse(fs.readFileSync(AUTH, "utf8"));
  return origins.flatMap((o) => o.localStorage).find((i) => i.name === "gst_access_token").value;
}

/** Easy or Expert is saved on the server for the signed-in user: Expert goes back to Easy, and no saved mode stays so. */
async function easyIfExpertSaved(request, token) {
  const headers = { Authorization: `Bearer ${token}` };
  const saved = await request.get("/api/preferences/", { headers });
  expect(saved.ok()).toBe(true);
  if ((await saved.json()).data.phoneMode !== "expert") return;
  const put = await request.patch("/api/preferences/", { headers, data: { phoneMode: "easy" } });
  expect(put.ok()).toBe(true);
}

module.exports = { AUTH, SIGNED_OUT, typesPassword, signIn, savedToken, easyIfExpertSaved };
