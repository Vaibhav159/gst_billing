// Runtime waits for 5A rates/seed, 5B dashboard slots and corrected 4C mapping.
const { test, expect } = require('@playwright/test');
const { measure } = require('./axe');
const { client, firstFirm, afterDialog, today } = require('./sales-data');
const { monthBefore } = require('./bill-form-data');
const { quoted, ratesScenario, open, pickProduct, makeProduct } = require('./rates-data');
ratesScenario(test);
for (const theme of ['obsidian', 'pearl']) {
  test(`rates board and confirmation are accessible in ${theme}`, async ({ page, request }, info) => {
    await open(page, theme, '/'); await expect(page).toHaveURL(/\/$/);
    if (info.project.name === 'phone') await page.getByRole('button', { name: /Today's rates.*Change/ }).click();
    else await page.getByRole('button', { name: 'Change', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: "Today's rates" }); await expect(sheet).toBeVisible(); await afterDialog(page);
    expect(await measure(page)).toEqual([]);
    await sheet.getByRole('textbox', { name: 'Gold 22K (916) per 10 g', exact: true }).fill('90000');
    await sheet.getByRole('button', { name: "Save today's rates" }).click();
    await expect(sheet.getByRole('button', { name: 'Yes, save these rates' })).toBeVisible(); expect(await measure(page)).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`rates-confirm-${theme}.png`), fullPage: true });
    await sheet.getByRole('button', { name: 'Yes, save these rates' }).click();
    await expect(sheet).not.toBeVisible();
    expect((await client(request).get('rates/')).latest.quoted).toEqual({ ...quoted, 'gold-22K': '90000.00' });
    expect(await measure(page)).toEqual([]);
  });
  test(`bill reference never prefills and its voluntary fix is accessible in ${theme}`, async ({ page, request }, info) => {
    const api = client(request), phone = info.project.name === 'phone';
    const p = await makeProduct(api), firm = await firstFirm(api);
    await open(page, theme, `/sales/new?firm=${firm.id}`); await pickProduct(page, phone, p.name);
    const rate = page.getByRole('textbox', { name: phone ? 'Rate per gram' : 'Line 1 rate per gram', exact: true });
    await expect(rate).toHaveValue('');
    await rate.fill('65125');
    await expect(page.getByText(/Today's board: ₹6,512\.50 a gram/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use ₹6,512.50' })).toBeVisible(); expect(await measure(page)).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`rates-slip-${theme}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Use ₹6,512.50' }).click();
    await expect(rate).toHaveValue(/^(6,512\.50|6512\.500)$/); await expect(rate).toBeFocused();
    await expect(page.getByRole('button', { name: 'Use ₹6,512.50' })).toHaveCount(0);
  });
}
test('earlier paper date requests only its in-force board; latest cannot leak into it', async ({ page, request }, info) => {
  const api = client(request), phone = info.project.name === 'phone'; const p = await makeProduct(api), firm = await firstFirm(api);
  const day = today().slice(8) === '01' ? `${monthBefore(today(), 1)}-27` : `${today().slice(0, 8)}01`;
  // Deterministic historical read: POST never accepts backdating. The real POST/GET path is covered above.
  const seen = [];
  await page.route('**/api/rates/**', async route => {
    const asked = new URL(route.request().url()).searchParams.get('date'); seen.push(asked);
    const live = await api.get('rates/'); await route.fulfill({ json: { ...live, in_force: null } });
  });
  await open(page, 'obsidian', `/sales/new?paper=1&firm=${firm.id}&date=${day}`); await pickProduct(page, phone, p.name);
  const rate = page.getByRole('textbox', { name: phone ? 'Rate per gram' : 'Line 1 rate per gram', exact: true }); await rate.fill('65125');
  await expect.poll(() => seen).toContain(day); expect(seen.every(d => d === day)).toBe(true);
  await expect(page.getByText(/Today's board:|Board on |Board of /)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Use ₹/ })).toHaveCount(0); await expect(rate).toHaveValue('65125');
});
