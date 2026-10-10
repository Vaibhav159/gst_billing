// Signs in once through the real sign-in page and saves the session for the other specs.
const { test: setup, expect } = require("@playwright/test");
const { AUTH, easyIfExpertSaved, signIn, typesPassword } = require("./session");

typesPassword(setup);

setup("sign in", async ({ page }) => {
  await page.goto("/login");
  await signIn(page);
  // the suite's first requests to a server just started: each gunicorn worker loads every API module on its first
  // request (pandas and google-genai, ~4 s a worker on the sandbox VM), so this sign-in gets 30 s, not expect's 5
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  // a phone run that stopped part-way can leave Expert saved for this user: every project starts from Easy, or from no
  // saved mode at all (CI's), which stays so
  await easyIfExpertSaved(page.request, await page.evaluate(() => localStorage.getItem("gst_access_token")));
  await page.context().storageState({ path: AUTH });
});
