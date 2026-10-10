// Signs in once through the real sign-in page and saves the session for the other specs.
const fs = require("fs");
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
  // nor from a copy of it kept on this device: the app keeps each person's preferences as it last saw them
  // (gst3.prefs.<id>), maybe Expert from that run. They're left out of what's saved rather than removed from the page,
  // which could write its copy back if its own request for them answers late
  const state = await page.context().storageState();
  for (const o of state.origins) o.localStorage = o.localStorage.filter((i) => !i.name.startsWith("gst3.prefs."));
  fs.writeFileSync(AUTH, JSON.stringify(state, null, 2));
});
