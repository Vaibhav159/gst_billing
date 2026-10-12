const { test, expect } = require('@playwright/test');
const { measure } = require('./axe');
const { opened } = require('./session');
const { afterDialog } = require('./sales-data');
const { client, newPurchase, makesPurchases } = require('./purchases-data');
makesPurchases(test);
for (const theme of ['obsidian', 'pearl']) {
  test(`purchases list, detail, new/edit form and supplier sheet meet WCAG 2.2 AA in ${theme}`, async ({ page, request }, info) => {
    const { bill } = await newPurchase(client(request), { needs_review: true });
    await page.addInitScript(t => localStorage.setItem('gst3.theme', t), theme);
    for (const path of [`/purchases?firm=${bill.business}`, `/purchases/${bill.id}`, `/purchases/new?from=${bill.id}`, `/purchases/${bill.id}/edit`]) {
      await page.goto(path); await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); await opened(page);
      if (path.includes('/new') || path.endsWith('/edit')) await expect(page.getByLabel("Supplier's bill number", { exact: true })).toBeVisible();
      else await expect(page.getByText(bill.invoice_number, { exact: false }).first()).toBeVisible();
      expect(await measure(page), path).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no page overflow: ${path}`).toBe(true);
      const name = `${theme}-${path.replace(/[^a-z0-9]/gi, '_')}`;
      await info.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
      if (info.project.name === 'desktop' && path.startsWith('/purchases?')) {
        await page.setViewportSize({ width: 1100, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '1100px register fits').toBe(true);
        await info.attach(`${theme}-1100-register`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
        await page.setViewportSize({ width: 1440, height: 900 });
      }
    }
    await page.getByRole('combobox', { name: 'Supplier', exact: true }).fill('New supplier fixture');
    await page.getByRole('option', { name: 'Add a supplier', exact: true }).click(); await afterDialog(page);
    await expect(page.getByRole('dialog')).toBeVisible(); expect(await measure(page), 'supplier sheet').toEqual([]);
  });
  test(`deleted purchase and restore action meet WCAG 2.2 AA in ${theme}`, async ({ page, request }) => {
    const api = client(request), { bill } = await newPurchase(api); await api.del(`purchases/${bill.id}/`, { reason: 'Accessibility check' });
    await page.addInitScript(t => localStorage.setItem('gst3.theme', t), theme);
    await page.goto(`/purchases/${bill.id}`); await expect(page.getByRole('button', { name: 'Restore it', exact: true })).toBeVisible(); await opened(page);
    expect(await measure(page)).toEqual([]);
  });
}
