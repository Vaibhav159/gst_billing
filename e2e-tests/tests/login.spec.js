const { test, expect } = require('@playwright/test');

test.describe('Auth flow', () => {
  test('Login page loads', async ({ page }) => {
    const t0 = Date.now();
    await page.goto('/');
    await expect(page).toHaveURL(/login|\//);
    console.log(`[TIMING] Login page load: ${Date.now() - t0}ms`);
  });

  test('Can log in as testuser', async ({ page }) => {
    await page.goto('/');
    const t0 = Date.now();
    await page.fill('input[name="username"], input[type="text"]', 'testuser');
    await page.fill('input[name="password"], input[type="password"]', 'testpass2026');
    await page.click('button[type="submit"]');
    await page.waitForURL(/dashboard|invoice|home|^http:\/\/localhost\/?$/, { timeout: 15000 });
    console.log(`[TIMING] Login submit + redirect: ${Date.now() - t0}ms`);
  });
});
