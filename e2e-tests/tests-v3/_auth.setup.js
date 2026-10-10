// Signs in once through the real sign-in page and saves the session for the other specs.
const { test: setup } = require("@playwright/test");
const { AUTH, easyIfExpertSaved, signIn, typesPassword } = require("./session");

typesPassword(setup);

setup("sign in", async ({ page }) => {
  await page.goto("/login");
  await signIn(page);
  // waitForURL, not expect: the password is still in its field if this fails (see typesPassword). 30 s: these are the
  // suite's first requests to a server just started, and each gunicorn worker loads every API module on its first
  // request (pandas and google-genai, ~4 s a worker on the sandbox VM)
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 30_000 });
  // a phone run that stopped part-way can leave Expert saved for this user: every project starts from Easy, or from no
  // saved mode at all (CI's), which stays so
  await easyIfExpertSaved(page.request, await page.evaluate(() => localStorage.getItem("gst_access_token")));
  await page.context().storageState({ path: AUTH });
});
