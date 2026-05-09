const { test, expect } = require('@playwright/test');

test.describe('Page navigation', () => {
  test('Dashboard loads', async ({ page }) => {
    const t0 = Date.now();
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    console.log(`[TIMING] Dashboard load: ${Date.now() - t0}ms`);
  });

  test('Invoice list loads', async ({ page }) => {
    const t0 = Date.now();
    await page.goto('/billing/invoice/list');
    await page.waitForLoadState('networkidle');
    console.log(`[TIMING] Invoice list load: ${Date.now() - t0}ms`);
    const html = await page.content();
    expect(html.toLowerCase()).toContain('invoice');
  });

  test('Customer list loads', async ({ page }) => {
    const t0 = Date.now();
    await page.goto('/billing/customer/list');
    await page.waitForLoadState('networkidle');
    console.log(`[TIMING] Customer list load: ${Date.now() - t0}ms`);
  });

  test('Business list loads', async ({ page }) => {
    const t0 = Date.now();
    await page.goto('/billing/business/list');
    await page.waitForLoadState('networkidle');
    console.log(`[TIMING] Business list load: ${Date.now() - t0}ms`);
  });

  test('Product list loads', async ({ page }) => {
    const t0 = Date.now();
    await page.goto('/billing/product/list');
    await page.waitForLoadState('networkidle');
    console.log(`[TIMING] Product list load: ${Date.now() - t0}ms`);
  });

  test('GST Summary loads', async ({ page }) => {
    const t0 = Date.now();
    await page.goto('/billing/gst-summary');
    await page.waitForLoadState('networkidle');
    console.log(`[TIMING] GST Summary load: ${Date.now() - t0}ms`);
  });

  test('Backup page loads', async ({ page }) => {
    const t0 = Date.now();
    await page.goto('/billing/backup');
    await page.waitForLoadState('networkidle');
    console.log(`[TIMING] Backup load: ${Date.now() - t0}ms`);
  });

  test('Audit log loads', async ({ page }) => {
    const t0 = Date.now();
    await page.goto('/billing/audit-log');
    await page.waitForLoadState('networkidle');
    console.log(`[TIMING] Audit log load: ${Date.now() - t0}ms`);
  });
});
