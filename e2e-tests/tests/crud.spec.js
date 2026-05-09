const { test, expect } = require('@playwright/test');

test.describe('Invoice CRUD', () => {
  test('Create invoice via UI', async ({ page }) => {
    const t0 = Date.now();
    await page.goto('/billing/invoice/new');
    await page.waitForLoadState('networkidle');
    console.log(`[TIMING] Invoice form load: ${Date.now() - t0}ms`);

    // Try to find form fields and create
    const t1 = Date.now();
    // Look for any invoice creation success indicator
    const html = await page.content();
    const hasForm = html.toLowerCase().includes('invoice number') || html.toLowerCase().includes('create invoice');
    console.log(`[TIMING] Invoice form has fields: ${hasForm} (${Date.now() - t1}ms)`);
  });

  test('Customer create flow', async ({ page }) => {
    const t0 = Date.now();
    await page.goto('/billing/customer/new');
    await page.waitForLoadState('networkidle');
    console.log(`[TIMING] Customer form load: ${Date.now() - t0}ms`);
  });

  test('Business create flow', async ({ page }) => {
    const t0 = Date.now();
    await page.goto('/billing/business/new');
    await page.waitForLoadState('networkidle');
    console.log(`[TIMING] Business form load: ${Date.now() - t0}ms`);
  });
});
