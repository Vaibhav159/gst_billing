const { test } = require('@playwright/test');
const path = require('path');

test('authenticate', async ({ page }) => {
  await page.goto('/');
  await page.fill('input[type="text"], input[name="username"]', 'testuser');
  await page.fill('input[type="password"]', 'testpass2026');
  const responsePromise = page.waitForResponse(r => r.url().includes('/api/token/'));
  await page.click('button[type="submit"]');
  const tokenResp = await responsePromise;
  if (tokenResp.status() !== 200) {
    throw new Error(`Login failed: ${tokenResp.status()}`);
  }
  await page.waitForLoadState('networkidle', { timeout: 20000 });
  await page.context().storageState({ path: path.join(__dirname, '..', 'auth-state.json') });
  console.log('[AUTH] Saved auth state');
});
