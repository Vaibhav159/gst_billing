// Records videos use the same acceptance flows as the normal suite, plus the explicitly
// API-mocked new-shop demonstration. Run only after 4A and 4B land on the assigned locked sandbox.
const { defineConfig } = require("@playwright/test");
const base = require("./v3.config");

module.exports = defineConfig({
  ...base,
  timeout: 90_000,
  testMatch: /(?:records\.spec|records-setup\.record|_auth\.setup)\.js/,
  use: { ...base.use, video: { mode: "on", size: { width: 1440, height: 900 } } },
  projects: base.projects.map((project) => project.name === "setup"
    ? { ...project, use: { ...project.use, video: "off" } }
    : { ...project, grep: /@record/, use: {
      ...project.use, video: { mode: "on", size: project.name === "phone" ? { width: 390, height: 844 } : { width: 1440, height: 900 } },
    } }),
});
