// v3 end-to-end tests. Locally: BASE_URL_V3=http://127.0.0.1:5180 (the sandbox), LOGINS_FILE=../../env/logins.txt
// (the second sandbox: BASE_URL_V3=http://127.0.0.1:5280, LOGINS_FILE=<env>/logins-2.txt; see deploy/sandbox/README.md)
// E2E_ROLE=owner E2E_SEARCH=Sharma E2E_SEARCH_HIT="Priya Sharma" CHROMIUM_PATH=~/.cache/ms-playwright/chromium_headless_shell-1228/chrome-linux/headless_shell.
// In CI: BASE_URL_V3=http://127.0.0.1:8081 E2E_USER=testuser E2E_PASS=testpass2026 E2E_SEARCH=TEST E2E_SEARCH_HIT="TEST CUSTOMER".
const { defineConfig, devices } = require("@playwright/test");
const { AUTH } = require("./tests-v3/session");

const launchOptions = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH.replace(/^~/, process.env.HOME) } : {};

// X-87: the full seed/four-role and long-running acceptance suite is the release gate.
// CI proves these self-contained flows on its fresh one-user database, in both viewports.
const ci = !!process.env.CI;
module.exports = defineConfig({
  testMatch: ci ? /(?:^|\/)(shell|signed-out|sales|bill-form|purchases|purchases-a11y|gst-returns|easy-bill|easy-send-core)\.spec\.js$/ : undefined,
  grepInvert: ci ? /@sandbox|@acceptance/ : undefined,
  globalTimeout: ci ? 20 * 60_000 : undefined,
  testDir: "./tests-v3",
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  // One signed-in user for every spec: the phone test's mode switch is saved on the server, so nothing may run beside it.
  // No retries: a flaky spec is a failing spec.
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: process.env.BASE_URL_V3 || "http://127.0.0.1:5180", trace: "retain-on-failure", launchOptions },
  projects: [
    { name: "setup", testMatch: /_auth\.setup\.js/ },
    { name: "desktop", dependencies: ["setup"], use: { viewport: { width: 1440, height: 900 }, storageState: AUTH }, testIgnore: /_auth\.setup\.js/ },
    { name: "phone", dependencies: ["setup"], use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, storageState: AUTH }, testIgnore: /_auth\.setup\.js/ },
  ],
});
