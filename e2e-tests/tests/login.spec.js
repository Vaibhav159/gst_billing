const { test, expect } = require('@playwright/test');

test.describe('Auth flow', () => {
  // Opt out of the stored auth state from _auth.setup.js so this describe
  // block exercises the actual login page. Without this, `storageState:
  // 'auth-state.json'` keeps the user authenticated and `/` redirects past
  // the login form, causing page.fill('input[name="username"]') to time out.
  test.use({ storageState: { cookies: [], origins: [] } });

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
    // Login.tsx navigates to "/" on success. Match any URL whose path is
    // "/" (or contains dashboard/invoice/home) regardless of host:port.
    await page.waitForURL((url) => url.pathname === '/' || /dashboard|invoice|home/.test(url.pathname), { timeout: 15000 });
    console.log(`[TIMING] Login submit + redirect: ${Date.now() - t0}ms`);
  });
});
