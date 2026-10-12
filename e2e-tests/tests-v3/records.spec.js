// Part 4C against a real 4A/4B server. New-shop routing is covered by unit tests and a
// separately labelled fixture demonstration, never by deleting the shared sandbox's records.
const { test, expect } = require("@playwright/test");
const { measure } = require("./axe");
const { opened } = require("./session");
const { afterDialog, client } = require("./sales-data");
const { firmBody, freshName, noteProduct, rememberFirm, makeProduct, makeFirm, usePersonalFirm,
  cleanRecordsAfter, openRecord, recordMenu } = require("./records-data");

cleanRecordsAfter(test);
const main = (page) => page.locator("#app-main");

test("desktop: add a diamond by keyboard, then delete and undo @record", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop");
  const api = client(request);
  const name = noteProduct(freshName("Diamond"));
  await openRecord(page, "/products/new?from=list", "Add product");
  await expect(page.locator("#pr-gst")).toHaveValue("");
  await expect(page.locator("#pr-unit option")).toHaveCount(16);
  await page.locator("#pr-name").fill(name);
  await page.locator("#pr-hsn").fill("7102");
  await page.locator("#pr-hsn").press("Enter");
  await expect(page.locator("#pr-gst")).toHaveValue("0.25");
  await expect(page.locator("#pr-kind")).toHaveValue("");
  await expect(page.locator("#pr-kind option:checked")).toHaveText("Automatic: Diamond");
  await page.waitForTimeout(600); // a beat for the owner when this flow is recorded
  await expect(page).toHaveURL(/\/products\/new/);
  await page.getByRole("button", { name: "VVS", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.locator("#pr-unit").selectOption("ct");
  await page.locator("#pr-rate").fill("12500.125");
  await expect(page.getByText("Shown on the product; bills take the rate written on the paper bill", { exact: true })).toBeVisible();
  await page.waitForTimeout(600); // show the chosen product before saving in the recording
  await page.keyboard.press("Control+s");
  await expect(page).toHaveURL(/\/products$/);
  await expect(page.locator("tr.anim-flash")).toContainText(name);
  const product = (await api.get("catalog/", { q: name })).results.find((p) => p.name === name);
  expect(product).toMatchObject({ kind: null, kind_effective: "diamond", purity: "VVS", gst_percent: "0.25", unit: "ct", usual_rate: "12500.125" });
  await opened(page);
  await main(page).getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
  await opened(page);
  await page.screenshot({ path: info.outputPath("keyboard-product.png") });
  await expect(page.getByRole("columnheader", { name: "Making", exact: true })).toHaveCount(0);
  await recordMenu(page, name, info.project.name);
  await page.getByRole("menuitem", { name: /^Delete product/ }).click();
  const dialog = page.getByRole("dialog", { name: "Delete " + name + "?", exact: true });
  await expect(dialog).toBeVisible();
  await afterDialog(page);
  await dialog.getByRole("button", { name: "Delete product", exact: true }).click();
  await expect(page).toHaveURL(/\/products$/);
  await expect(page.getByText(name + " deleted", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Undo(?:\s|$)/ }).click();
  await expect(page).toHaveURL(new RegExp("/products/" + product.id + "$"));
  await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
  expect((await api.get("catalog/" + product.id + "/")).name).toBe(name);
});

test("desktop: check a changed bank account once, save it, and restore every original field @record", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop");
  const api = client(request);
  const firm = await makeFirm(api);
  rememberFirm(firm);
  const before = firmBody(firm);
  const next = "000111222334";
  const saves = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && new URL(r.url()).pathname === "/api/firms/" + firm.id + "/") saves.push(r);
  });
  await openRecord(page, "/firms/" + firm.id + "/edit");
  await page.locator("#fm-account").fill(next);
  await page.getByRole("button", { name: "Save firm details", exact: true }).last().click();
  const dialog = page.getByRole("dialog", { name: "Check the new bank account", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(firm.bank_account_number + " → " + next);
  expect(saves).toHaveLength(0);
  await afterDialog(page);
  await page.screenshot({ path: info.outputPath("bank-confirmation.png") });
  await page.waitForTimeout(600); // show the old and new accounts in the recording
  await dialog.getByRole("button", { name: "Save the new account", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("/firms/" + firm.id + "$"));
  await expect(page.getByRole("heading", { level: 1, name: firm.name, exact: true })).toBeVisible();
  expect(saves).toHaveLength(1);
  expect((await api.get("firms/" + firm.id + "/")).bank_account_number).toBe(next);
  await expect(page.getByText(/Every bill now prints the new account\./)).toBeVisible();
  await page.screenshot({ path: info.outputPath("bank-saved.png") });
  await api.put("firms/" + firm.id + "/", before);
  expect(firmBody(await api.get("firms/" + firm.id + "/"))).toEqual(before);
});

test("setup ticks its four steps from the server's actual counts", async ({ page, request }, info) => {
  const data = await client(request).get("setup/");
  const done = [data.firms.count, data.customers.count, data.products.count, data.bills.count].filter((n) => n > 0).length;
  await openRecord(page, "/setup", "Set up GST Billing");
  await expect(main(page)).toContainText(done + " of 4 done");
  await expect(main(page).getByText(/^Step [1-4]$/)).toHaveCount(4);
  if (data.customers.count) await expect(main(page)).toContainText(data.customers.count + (data.customers.count === 1 ? " customer" : " customers") + " on file, besides walk-in sales");
  if (data.products.count) await expect(main(page)).toContainText(data.products.count + (data.products.count === 1 ? " product" : " products") + " with HSN and GST rate");
  if (data.bills.count) await expect(main(page)).toContainText(data.bills.count + (data.bills.count === 1 ? " sales bill" : " sales bills") + " made");
  if (data.bills.count && data.bills.cancelled) await expect(main(page)).toContainText(data.bills.cancelled + " cancelled not counted");
  await page.screenshot({ path: info.outputPath("setup-real-counts.png") });
});

for (const theme of ["obsidian", "pearl"]) {
  test("all Records screens and dialogs meet WCAG 2.2 AA in " + theme, async ({ page, request }, info) => {
    test.setTimeout(240_000);
    const api = client(request);
    const product = await makeProduct(api);
    const firm = await makeFirm(api);
    await usePersonalFirm(api, firm.id);
    await page.addInitScript((t) => localStorage.setItem("gst3.theme", t), theme);
    const paths = ["/products", "/products/new", "/products/" + product.id, "/products/" + product.id + "/edit",
      "/firms", "/firms/new", "/firms/new?first=1", "/firms/" + firm.id, "/firms/" + firm.id + "/edit",
      "/settings", "/setup"];
    for (const route of paths) {
      await openRecord(page, route);
      await expect(page.locator("html")).toHaveClass(theme === "obsidian" ? "" : "theme-" + theme);
      expect(await measure(page), route).toEqual([]);
      await page.screenshot({ path: info.outputPath(theme + "-" + route.replace(/[^a-z0-9]+/gi, "-") + ".png") });
    }
    await openRecord(page, "/products/new");
    await page.locator("#pr-hsn").click();
    await expect(page.getByRole("listbox", { name: "Common HSN codes", exact: true })).toBeVisible();
    expect(await measure(page), "Common HSN codes").toEqual([]);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Save product", exact: true }).last().click();
    await expect(page.getByText("Choose the GST rate. There\'s no default, so a wrong rate can\'t slip onto bills.", { exact: true }).first()).toBeVisible();
    expect(await measure(page), "Product field errors").toEqual([]);

    await openRecord(page, "/products/" + product.id);
    await recordMenu(page, product.name, info.project.name);
    expect(await measure(page), "Product actions").toEqual([]);
    await page.getByRole("menuitem", { name: /^Delete product/ }).click();
    await expect(page.getByRole("dialog", { name: "Delete " + product.name + "?", exact: true })).toBeVisible();
    await afterDialog(page);
    expect(await measure(page), "Delete product").toEqual([]);
    await page.keyboard.press("Escape");

    await openRecord(page, "/firms/" + firm.id);
    await recordMenu(page, firm.name, info.project.name);
    expect(await measure(page), "Firm actions").toEqual([]);
    await page.getByRole("menuitem", { name: /^Delete firm/ }).click();
    const remove = page.getByRole("dialog", { name: "Delete " + firm.name + "?", exact: true });
    await expect(remove).toBeVisible();
    await afterDialog(page);
    await expect(remove.getByRole("button", { name: "Delete firm", exact: true })).toBeDisabled();
    expect(await measure(page), "Delete firm, acknowledgement not ticked").toEqual([]);
    await remove.getByRole("checkbox").check();
    expect(await measure(page), "Delete firm, acknowledgement ticked").toEqual([]);
    await page.keyboard.press("Escape");

    await openRecord(page, "/firms/" + firm.id + "/edit");
    await page.locator("#fm-account").fill("000111222334");
    await page.getByRole("button", { name: "Save firm details", exact: true }).last().click();
    await expect(page.getByRole("dialog", { name: "Check the new bank account", exact: true })).toBeVisible();
    await afterDialog(page);
    expect(await measure(page), "Changed bank account").toEqual([]);
    await page.keyboard.press("Escape");
    await page.locator("#fm-account").fill(firm.bank_account_number);

    await openRecord(page, "/settings");
    await main(page).getByRole("button", { name: "Reset my preferences", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Reset your preferences?", exact: true })).toBeVisible();
    await afterDialog(page);
    expect(await measure(page), "Reset my preferences").toEqual([]);
    await page.keyboard.press("Escape");
    if (info.project.name === "desktop") {
      await main(page).getByRole("button", { name: "Show all", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true })).toBeVisible();
      await afterDialog(page);
      expect(await measure(page), "Keyboard shortcuts").toEqual([]);
      await page.keyboard.press("Escape");
    }

    await openRecord(page, "/products/" + product.id + "/edit");
    await page.locator("#pr-name").fill(product.name + " changed");
    if (info.project.name === "phone") await main(page).getByRole("button", { name: "Back", exact: true }).click();
    else await main(page).getByRole("link", { name: "Products", exact: true }).first().click();
    await expect(page.getByRole("dialog", { name: "Leave without saving?", exact: true })).toBeVisible();
    await afterDialog(page);
    expect(await measure(page), "Leave an unsaved record").toEqual([]);
    await page.getByRole("dialog").getByRole("button", { name: "Stay", exact: true }).click();
    await page.locator("#pr-name").fill(product.name);
  });
}

test("desktop: every Records page stays idle for 180 seconds without another API request", { tag: "@acceptance" }, async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop");
  test.setTimeout(300_000);
  const api = client(request);
  const product = await makeProduct(api);
  const firm = await makeFirm(api);
  const paths = ["/products", "/products/new", "/products/" + product.id, "/products/" + product.id + "/edit",
    "/firms", "/firms/new", "/firms/new?first=1", "/firms/" + firm.id, "/firms/" + firm.id + "/edit", "/settings", "/setup"];
  const calls = [];
  const inflight = new Set();
  const context = page.context();
  context.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) {
      inflight.add(r);
      calls.push(r.method() + " " + new URL(r.url()).pathname + new URL(r.url()).search);
    }
  });
  const finished = (r) => inflight.delete(r);
  context.on("requestfinished", finished);
  context.on("requestfailed", finished);
  for (const path of paths) {
    const tab = await context.newPage();
    await openRecord(tab, path);
  }
  await expect.poll(() => inflight.size).toBe(0);
  await page.waitForTimeout(1500);
  expect(inflight.size).toBe(0);
  const before = calls.length;
  // Observe time passing; these waits never send a request or query the database.
  for (let minute = 0; minute < 3; minute++) await page.waitForTimeout(60_000);
  expect(calls.slice(before), "API requests from idle Records tabs").toEqual([]);
  await info.attach("idle-api-observation", {
    body: Buffer.from("All 11 Records routes were open for 180 seconds. No new browser API request occurred.\nThis checks client polling; it does not measure unrelated server background database activity.\n"),
    contentType: "text/plain",
  });
});
