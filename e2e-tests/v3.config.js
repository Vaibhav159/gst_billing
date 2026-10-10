// v3 end-to-end tests. Locally: BASE_URL_V3=http://127.0.0.1:5180 (the sandbox), LOGINS_FILE=../../env/logins.txt
// E2E_ROLE=owner CHROMIUM_PATH=~/.cache/ms-playwright/chromium_headless_shell-1228/chrome-linux/headless_shell.
// In CI: BASE_URL_V3=http://127.0.0.1:8081 E2E_USER=testuser E2E_PASS=testpass2026.
const { defineConfig, devices } = require("@playwright/test");

const launchOptions = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH.replace(/^~/, process.env.HOME) } : {};

module.exports = defineConfig({
  testDir: "./tests-v3",
  timeout: 60_000,
  // One signed-in user for every spec: the phone test's mode switch is saved on the server, so nothing may run beside it.
  // No retries: a flaky spec is a failing spec.
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: process.env.BASE_URL_V3 || "http://127.0.0.1:5180", trace: "retain-on-failure", launchOptions },
  projects: [
    { name: "setup", testMatch: /_auth\.setup\.js/ },
    { name: "desktop", dependencies: ["setup"], use: { viewport: { width: 1440, height: 900 }, storageState: ".auth-v3.json" }, testIgnore: /_auth\.setup\.js/ },
    { name: "phone", dependencies: ["setup"], use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, storageState: ".auth-v3.json" }, testIgnore: /_auth\.setup\.js/ },
  ],
});
