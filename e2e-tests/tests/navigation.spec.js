const { test, expect } = require('@playwright/test');

// Each test asserts URL + a known heading/text so a 500, blank shell, or
// silent /login bounce fails the test instead of passing on networkidle alone.
const routes = [
  { name: 'Dashboard',      path: '/',                       text: /dashboard|welcome|recent invoices/i },
  { name: 'Invoice list',   path: '/billing/invoice/list',   text: /invoices/i },
  { name: 'Customer list',  path: '/billing/customer/list',  text: /customers/i },
  { name: 'Business list',  path: '/billing/business/list',  text: /businesses/i },
  { name: 'Product list',   path: '/billing/product/list',   text: /products/i },
  { name: 'GST Summary',    path: '/billing/gst-summary',    text: /gst summary|tax/i },
  { name: 'Backup page',    path: '/billing/backup',         text: /backup|restore/i },
  { name: 'Audit log',      path: '/billing/audit-log',      text: /audit log/i },
];

test.describe('Page navigation', () => {
  for (const { name, path, text } of routes) {
    test(`${name} loads`, async ({ page }) => {
      const t0 = Date.now();
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      console.log(`[TIMING] ${name} load: ${Date.now() - t0}ms`);

      await expect(page).toHaveURL(new RegExp(path.replace(/[/]/g, '\\/').replace(/^\\\//, '\\/?')));
      await expect(page.getByText(text).first()).toBeVisible();
    });
  }
});
