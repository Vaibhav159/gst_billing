/**
 * Phone layout of the inward pages (UX6).
 *
 * The register, a bill's page and the add page had no page margin, and on a
 * phone their one-column grids grew to their longest line: <main> scrolled
 * sideways (497 px of content on a 390 px phone), totals were cut at the
 * screen edge ("₹4,92,64") and the captures inbox put Fill in half and
 * Discard wholly off screen. Layout can't be checked in jsdom, so this
 * drives a phone-sized Chromium.
 *
 * Makes its own capture and bill (long names, lakh-sized totals) and removes
 * them. E2E_FIRM / E2E_TAG let it run against another seed.
 */
const { test, expect } = require('@playwright/test');

const FIRM = process.env.E2E_FIRM || 'TEST JEWELLERS';
const TAG = process.env.E2E_TAG || 'E2E';
const RUN = Date.now().toString().slice(-7);
// A 1x1 PNG: the inbox only needs a photo to show.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function apiToken(page) {
  const token = await page.evaluate(() => localStorage.getItem('gst_access_token'));
  if (!token) throw new Error('no access token in storage state');
  return { Authorization: `Bearer ${token}` };
}

/** <main> must not scroll sideways, and every element matched must end inside the screen. */
async function expectToFit(page, label, locators = []) {
  const { scroll, client } = await page.locator('main').evaluate((m) => ({ scroll: m.scrollWidth, client: m.clientWidth }));
  expect(scroll, `${label}: <main> scrolls sideways`).toBeLessThanOrEqual(client);
  const width = page.viewportSize().width;
  for (const locator of locators) {
    for (const el of await locator.all()) {
      const box = await el.boundingBox();
      expect(box, `${label}: ${await el.textContent()} is not on screen`).not.toBeNull();
      expect(box.x, `${label}: ${await el.textContent()} starts off screen`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${label}: ${await el.textContent()} runs off the screen`).toBeLessThanOrEqual(width + 0.5);
    }
  }
}

/**
 * The More drawer (UX3). After an item changed the route, the old drawer
 * stayed over most of the screen, its X and backdrop did nothing, and a tap
 * on the bottom nav landed on a drawer item. jsdom can't show that (it
 * needed the page's re-render mid-animation), so a phone-sized Chromium
 * checks it, in both phone modes.
 */
test.describe("The phone's More drawer (UX3)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  for (const mode of ['expert', 'easy']) {
    test(`${mode} mode: an item that navigates closes it, and the bottom nav answers`, async ({ page }) => {
      await page.addInitScript((m) => localStorage.setItem('mobile-mode', m), mode);
      await page.goto('/');
      const bottomNav = page.getByRole('navigation').filter({ hasText: 'Customers' }).last();
      await bottomNav.getByRole('button', { name: 'More', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'More', exact: true })).toBeVisible();

      await page.getByRole('link', { name: /Backup/ }).click();
      await expect(page).toHaveURL(/\/billing\/backup$/);
      // Gone, not just moved aside.
      await expect(page.getByRole('heading', { name: 'More', exact: true })).toBeHidden();
      await expect(page.getByRole('dialog')).toHaveCount(0);

      // The next tap reaches the bottom nav, not a drawer item under the finger.
      await bottomNav.getByRole('link', { name: 'Invoices', exact: true }).click();
      await expect(page).toHaveURL(/\/billing\/invoice\/list$/);
    });
  }
});

for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 740 }]) {
  test.describe(`Inward pages on a ${viewport.width} px phone (UX6)`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true });

    test('the register, its captures inbox and a bill keep to the screen', async ({ page }) => {
      await page.goto('/billing/inward-bills');
      const headers = await apiToken(page);
      const firm = (await (await page.request.get('/api/businesses/?page_size=200', { headers })).json())
        .results.find((b) => b.name === FIRM);
      expect(firm, `no firm named ${FIRM}`).toBeTruthy();

      const hint = `${TAG} ${RUN} SURAT DIAMOND AND BULLION WHOLESALE TRADERS`;
      const capture = await page.request.post('/api/inward-captures/', {
        headers,
        multipart: {
          image: { name: 'bill.png', mimeType: 'image/png', buffer: PNG },
          business_id: String(firm.id), supplier_hint: hint, note: 'Phone layout check',
        },
      });
      expect(capture.status(), await capture.text()).toBe(201);
      const captureId = (await capture.json()).id;

      // No GSTIN (so no input tax), and a supplier name no other record has:
      // the bill is booked on a supplier this test creates and then removes.
      const number = `${TAG}-PHONE-${viewport.width}-${RUN}`;
      const bill = await page.request.post('/api/inward-bills/', {
        headers,
        multipart: {
          business_id: String(firm.id), invoice_number: number, invoice_date: '2026-08-14',
          supplier_name: `${TAG} ${RUN}-${viewport.width} JAIPUR GEMS AND JEWELLERY EXPORTERS`,
          lines: JSON.stringify([{ product_name: 'Gold Bar 999 Fine', hsn_code: '710812', quantity: 100, rate: 7175.5, gst_tax_rate: 0 }]),
        },
      });
      expect(bill.status(), await bill.text()).toBe(201);
      const { id: billId, customer: supplierId } = await bill.json();

      try {
        await page.goto('/billing/inward-bills');
        await expect(page.getByText(hint)).toBeVisible();
        await expectToFit(page, 'register', [
          page.getByRole('button', { name: /Fill in/ }),
          page.getByRole('button', { name: 'Discard capture' }),
        ]);

        await page.goto(`/billing/inward-bills/${billId}`);
        await expect(page.getByRole('heading', { name: `#${number}` })).toBeVisible();
        // The figures the page exists to show, ₹7,17,550 (no tax): the line's
        // amount, the taxable value and the total, each wholly on screen.
        await expect(page.getByText('₹7,17,550')).toHaveCount(3);
        await expectToFit(page, 'bill', [page.getByText('₹7,17,550')]);

        await page.goto('/billing/inward-bills/add');
        await expect(page.getByRole('heading', { name: 'Add Inward Bill' })).toBeVisible();
        await expectToFit(page, 'add');
      } finally {
        await page.request.delete(`/api/inward-captures/${captureId}/`, { headers });
        await page.request.delete(`/api/invoices/${billId}/`, { headers });
        if (supplierId) await page.request.delete(`/api/customers/${supplierId}/`, { headers });
      }
    });
  });
}
