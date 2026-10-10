// Signs in once through the real sign-in page and saves the session for the other specs.
// Passwords come from env or from the sandbox's logins file, and are never printed.
const { test: setup, expect } = require("@playwright/test");
const fs = require("fs");

function credentials() {
  if (process.env.E2E_USER && process.env.E2E_PASS) return { user: process.env.E2E_USER, pass: process.env.E2E_PASS };
  const role = process.env.E2E_ROLE || "owner";
  const line = fs.readFileSync(process.env.LOGINS_FILE, "utf8").split("\n").find((l) => l.split("\t")[0] === role);
  if (!line) throw new Error(`No ${role} line in LOGINS_FILE`);
  const [, user, pass] = line.split("\t");
  return { user, pass: pass.trim() };
}

setup("sign in", async ({ page }) => {
  const { user, pass } = credentials();
  await page.goto("/login");
  await page.getByLabel("Username").fill(user);
  // exact: the show-password toggle's name ("Show password") also has "Password" in it
  await page.getByLabel("Password", { exact: true }).fill(pass);
  await page.getByRole("button", { name: "Sign in" }).click();
  // the suite's first requests to a server just started: each gunicorn worker loads every API module on its first
  // request (pandas and google-genai, ~4 s a worker on the sandbox VM), so this sign-in gets 30 s, not expect's 5
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  await page.context().storageState({ path: ".auth-v3.json" });
});
