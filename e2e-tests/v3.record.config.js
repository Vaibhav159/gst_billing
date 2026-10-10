// The tours of what v3 has so far, recorded for the shop owner: one on a desktop and one on a phone, each a video with
// stills beside it in test-results/<test>/. Run as v3.config.js says, with -c v3.record.config.js instead (the tour
// searches for E2E_SEARCH, default "Sharma", and waits for E2E_SEARCH_HIT, default "Priya Sharma": the sandbox's).
// v3.config.js doesn't match tour.record.js, so the v3 suite and CI never run it.
const { defineConfig, devices } = require("@playwright/test");
const { AUTH, SIGNED_OUT } = require("./tests-v3/session");

const launchOptions = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH.replace(/^~/, process.env.HOME) } : {};

module.exports = defineConfig({
  testDir: "./tests-v3",
  testMatch: /tour\.record\.js/,
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  // one signed-in user, and the phone tour saves Easy or Expert on the server: nothing may run beside it
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  // no trace: the desktop tour types a password (Ruling 54). The video shows that field as dots.
  use: { baseURL: process.env.BASE_URL_V3 || "http://127.0.0.1:5180", trace: "off", launchOptions, video: { mode: "on", size: { width: 1440, height: 900 } } },
  projects: [
    { name: "setup", testMatch: /_auth\.setup\.js/, use: { video: "off" } },
    // each project runs its own tour, by tag: a grep on words would also match the project's and the file's names.
    // The desktop tour opens on the sign-in page and signs in there.
    { name: "desktop", grep: /@desktop/, use: { viewport: { width: 1440, height: 900 }, storageState: SIGNED_OUT } },
    {
      name: "phone", grep: /@phone/, dependencies: ["setup"],
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, storageState: AUTH, video: { mode: "on", size: { width: 390, height: 844 } } },
    },
  ],
});
