// Explicitly mocked new-shop demonstration for the recording, not real-server acceptance.
// The shared sandbox is never emptied. Real first-firm acceptance waits for a controller-provided
// isolated empty fixture; the normal suite proves setup counts against the real server instead.
const { test, expect } = require("@playwright/test");
const { client } = require("./sales-data");
const { opened } = require("./session");
const { cleanRecordsAfter, makeFirm } = require("./records-data");

cleanRecordsAfter(test);

test("API-mocked new-shop welcome and first-business demonstration @record", async ({ page, request }, info) => {
  const template = await makeFirm(client(request));
  const demo = { ...template, name: "DEMO JEWELLERS", short: "Demo", short_name: "Demo" };
  let created = false;
  await page.route("**/api/firms/**", async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname !== "/api/firms/") return route.continue();
    if (request.method() === "POST") {
      created = true;
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(demo) });
    }
    if (request.method() !== "GET") return route.continue();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: created ? [demo] : [] }) });
  });
  await page.route("**/api/setup/", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      firms: { count: created ? 1 : 0, names: created ? [demo.name] : [] },
      customers: { count: 0, names: [] }, products: { count: 0, names: [] },
      bills: { count: 0, cancelled: 0 }, people: 1, last_backup_at: null,
    }),
  }));
  await page.route("**/api/registry/**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      gstin: demo.gst_number, status: "unknown", reason: "", state_code: "08", state_name: "RAJASTHAN",
      pan: demo.gst_number.slice(2, 12), registry: null, lookup: "unreachable", on_file: { customers: [], firms: [] },
    }),
  }));
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { name: "Welcome to GST Billing", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip setup", exact: true })).toHaveCount(0);
  await opened(page);
  await info.attach("recording-scope", {
    body: Buffer.from("API-MOCKED NEW-SHOP DEMONSTRATION\nThe firms, setup and registry responses are fixtures. The shared database was not emptied. This video is not evidence of the server creating its first firm or walk-in customer.\n"),
    contentType: "text/plain",
  });
  await page.screenshot({ path: info.outputPath("API-MOCKED-new-shop-welcome.png") });
  await page.getByRole("link", { name: "Add your first business", exact: true }).click();
  await expect(page).toHaveURL(/\/firms\/new\?first=1$/);
  await opened(page);
  await page.locator("#fm-name").fill(demo.name);
  await page.locator("#fm-gstin").fill(demo.gst_number);
  await page.locator("#fm-address").fill(demo.address);
  await page.locator("#fm-phone").fill(demo.mobile_number);
  await page.getByRole("button", { name: "Save and continue", exact: true }).last().click();
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.locator("#app-main")).toContainText("1 of 4 done");
  await expect(page.locator("#app-main")).toContainText(demo.name);
  await page.screenshot({ path: info.outputPath("API-MOCKED-first-business-done.png") });
});
