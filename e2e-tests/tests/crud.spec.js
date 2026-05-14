const { test, expect } = require('@playwright/test');

test.describe('Invoice CRUD', () => {
  test('Create invoice via UI', async ({ page }) => {
    const t0 = Date.now();
    // Note: invoice creation route is /add (not /new like customer/business).
    await page.goto('/billing/invoice/add');
    await page.waitForLoadState('networkidle');
    console.log(`[TIMING] Invoice form load: ${Date.now() - t0}ms`);

    // Assert the form actually rendered — guards against the route 500ing,
    // bouncing to /login, or shipping a blank shell.
    await expect(page).toHaveURL(/\/billing\/invoice\/add/);
    await expect(page.getByText(/invoice number|create invoice/i).first()).toBeVisible();
  });

  test('Customer create flow', async ({ page }) => {
    const t0 = Date.now();
    await page.goto('/billing/customer/new');
    await page.waitForLoadState('networkidle');
    console.log(`[TIMING] Customer form load: ${Date.now() - t0}ms`);

    await expect(page).toHaveURL(/\/billing\/customer\/new/);
    await expect(page.getByText(/new customer|customer name|full name/i).first()).toBeVisible();
  });

  test('Business create flow', async ({ page }) => {
    const t0 = Date.now();
    await page.goto('/billing/business/new');
    await page.waitForLoadState('networkidle');
    console.log(`[TIMING] Business form load: ${Date.now() - t0}ms`);

    await expect(page).toHaveURL(/\/billing\/business\/new/);
    await expect(page.getByText(/new business|business name/i).first()).toBeVisible();
  });
});
