// Plan 6B + 6A integration: the browser makes a real PDF and the real server records the send.
// Only the operating system's external share/chat handoff is replaced; no API route is mocked.
const { test, expect } = require("@playwright/test");
const { opened } = require("./session");
const { afterDialog, client, makesBills, newBill, walkIn } = require("./sales-data");
makesBills(test);

async function openPrint(page, bill) {
  await page.goto(`/e/bill/${bill.id}/print`);
  await expect(page.getByRole("document", { name: `Bill ${bill.number} on paper, ` }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeEnabled({ timeout: 30_000 });
  await opened(page);
}

for (const supported of [true, false]) {
  test(`phone: a walk-in ${supported ? "shares the PDF without a number" : "needs a number for the WhatsApp fallback"}`, async ({ page, request }, info) => {
    test.skip(info.project.name !== "phone", "the phone's Easy send flow");
    const api = client(request);
    const bill = await newBill(api, { customer: await walkIn(api) });
    await page.addInitScript(({ supported }) => {
      window.__billShares = [];
      window.__billChats = [];
      Object.defineProperty(navigator, "canShare", { configurable: true, value: ({ files }) => supported && files.every(f => f.type === "application/pdf") });
      Object.defineProperty(navigator, "share", { configurable: true, value: async ({ files, title, text }) => { window.__billShares.push({ files: files.map(f => ({ name: f.name, type: f.type, size: f.size })), title, text }); } });
      // Exercise ShareHost's second press deterministically, even when this bill's PDF was already ready.
      Object.defineProperty(navigator, "userActivation", { configurable: true, value: { isActive: false, hasBeenActive: true } });
      window.open = (url) => { window.__billChats.push(String(url)); return { opener: null, closed: false }; };
    }, { supported });
    await openPrint(page, bill);
    const endpoint = `/api/sales/${bill.id}/sent/`;
    const posts = [];
    page.on("request", req => { if (req.method() === "POST" && new URL(req.url()).pathname === endpoint) posts.push(req.postDataJSON()); });
    await page.getByRole("button", { name: "Send to a WhatsApp number", exact: true }).click();
    if (supported) {
      const ready = page.getByRole("dialog", { name: "Your PDF is ready" });
      await expect(ready).toBeVisible();
      await expect(page.getByLabel("WhatsApp number")).toHaveCount(0);
      expect(posts).toEqual([]);
      await afterDialog(page);
      await page.evaluate(() => Object.defineProperty(navigator, "userActivation", { configurable: true, value: { isActive: true, hasBeenActive: true } }));
      const answer = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === endpoint);
      await ready.getByRole("button", { name: "Share", exact: true }).click();
      const response = await answer;
      expect(response.status()).toBe(200);
      expect(posts).toEqual([{ via: "share", to: "" }]);
      expect((await response.json()).sent).toMatchObject({ via: "share", to: "", count: 1 });
      const shares = await page.evaluate(() => window.__billShares);
      expect(shares).toHaveLength(1);
      expect(shares[0].files[0]).toMatchObject({ type: "application/pdf", name: expect.stringMatching(/\.pdf$/) });
      expect(shares[0].files[0].size).toBeGreaterThan(1000);
      expect(await page.evaluate(() => window.__billChats)).toEqual([]);
    } else {
      const dialog = page.getByRole("dialog", { name: `Send ${bill.number} on WhatsApp` });
      await expect(dialog).toBeVisible();
      expect(posts).toEqual([]);
      await afterDialog(page);
      await dialog.getByLabel("WhatsApp number").fill("98290 41122");
      const answer = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === endpoint);
      await dialog.getByRole("button", { name: "Send", exact: true }).click();
      const response = await answer;
      expect(response.status()).toBe(200);
      expect(posts).toEqual([{ via: "whatsapp", to: "9829041122" }]);
      expect((await response.json()).sent).toMatchObject({ via: "whatsapp", to: "9829041122", count: 1 });
      expect(await page.evaluate(() => window.__billShares)).toEqual([]);
      expect(await page.evaluate(() => window.__billChats)).toEqual([expect.stringMatching(/^https:\/\/wa\.me\/919829041122\?text=/)]);
    }
    expect((await api.get(`sales/${bill.id}/`)).sent).toMatchObject({ via: supported ? "share" : "whatsapp", to: supported ? "" : "9829041122", count: 1 });
  });
}
