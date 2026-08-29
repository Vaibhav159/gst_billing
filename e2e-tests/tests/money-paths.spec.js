/**
 * Money-path E2E: the flows where a regression costs actual rupees.
 *
 * The interstate tests exist because of a real incident: a number-vs-string id
 * comparison silently disabled auto-IGST for months, booking every interstate
 * sale under the wrong tax heads with a correct-looking total. Nothing on
 * screen failed, so only a test that drives the REAL form and then asserts the
 * STORED heads can guard it. UI-driven where the bug lived, API-asserted where
 * the money lands.
 */
const { test, expect } = require('@playwright/test');

// A checksum-valid Maharashtra GSTIN (GSTN's own documented example) so these
// tests keep passing if stricter validation ever lands server-side.
const MH_GSTIN = '27AAPFU0939F1ZV';
const RUN = Date.now().toString().slice(-7); // unique numbers on persistent local DBs

async function apiToken(page) {
  const token = await page.evaluate(() => localStorage.getItem('gst_access_token'));
  if (!token) throw new Error('no access token in storage state');
  return { Authorization: `Bearer ${token}` };
}

async function ensureCustomer(page, headers, name, fields) {
  const list = await page.request.get(`/api/customers/?search=${encodeURIComponent(name)}`, { headers });
  const found = (await list.json()).results?.find((c) => c.name === name);
  if (found) return found;
  const biz = await page.request.get('/api/businesses/', { headers });
  const bizId = (await biz.json()).results[0].id;
  const resp = await page.request.post('/api/customers/', {
    headers, data: { name, businesses: [bizId], ...fields },
  });
  expect(resp.status(), await resp.text()).toBe(201);
  return await resp.json();
}

/** SearchableSelect: click the trigger button, then the option by text. */
async function pickOption(page, triggerText, optionText) {
  await page.getByRole('button', { name: triggerText }).first().click();
  await page.getByText(optionText, { exact: true }).last().click();
}

test.describe('Outward invoice — tax heads land correctly', () => {
  test('interstate sale books IGST (the incident regression)', async ({ page }) => {
    await page.goto('/');
    const headers = await apiToken(page);
    await ensureCustomer(page, headers, 'E2E ACME MUMBAI',
      { gst_number: MH_GSTIN, state_name: 'MAHARASHTRA' });

    await page.goto('/billing/invoice/add');
    await pickOption(page, /Search Business/, 'TEST JEWELLERS');
    await pickOption(page, /Search Customer/, 'E2E ACME MUMBAI');

    // The chip is the UI half of the guard: with the old id-type bug it could
    // never flip, so this line alone would have caught the incident.
    await expect(page.getByText('Inter-state · IGST')).toBeVisible();

    await pickOption(page, /Search Product/, 'Gold Ornaments');
    const qty = page.locator('input[type="number"]').first();
    const rate = page.locator('input[type="number"]').last();
    await qty.fill('10');
    await rate.fill('7000');

    const create = page.waitForResponse(
      (r) => r.url().includes('/api/invoices/') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create Invoice' }).click();
    // The form now opens a review-&-confirm sheet before saving — the POST
    // fires only from its Confirm button.
    await page.getByRole('button', { name: /Confirm & Save/ }).click();
    const resp = await create;
    expect(resp.status(), await resp.text()).toBe(201);
    const { id } = await resp.json();

    // The API half: what actually got STORED. Totals looked right during the
    // incident — only the head split reveals the bug.
    const inv = await (await page.request.get(`/api/invoices/${id}/`, { headers })).json();
    const li = inv.line_items[0];
    expect(Number(li.igst)).toBeCloseTo(2100, 0);        // 70,000 × 3%
    expect(Number(li.cgst)).toBe(0);
    expect(Number(li.sgst)).toBe(0);
    expect(Number(inv.total_amount)).toBeCloseTo(72100, 0);
  });

  test('local sale books CGST + SGST', async ({ page }) => {
    await page.goto('/billing/invoice/add');
    await pickOption(page, /Search Business/, 'TEST JEWELLERS');
    await pickOption(page, /Search Customer/, 'TEST CUSTOMER');
    await expect(page.getByText('Local · CGST + SGST')).toBeVisible();

    await pickOption(page, /Search Product/, 'Gold Ornaments');
    await page.locator('input[type="number"]').first().fill('5');
    await page.locator('input[type="number"]').last().fill('1000');

    const create = page.waitForResponse(
      (r) => r.url().includes('/api/invoices/') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create Invoice' }).click();
    // The form now opens a review-&-confirm sheet before saving — the POST
    // fires only from its Confirm button.
    await page.getByRole('button', { name: /Confirm & Save/ }).click();
    const resp = await create;
    expect(resp.status(), await resp.text()).toBe(201);
    const { id } = await resp.json();

    const headers = await apiToken(page);
    const inv = await (await page.request.get(`/api/invoices/${id}/`, { headers })).json();
    const li = inv.line_items[0];
    expect(Number(li.cgst)).toBeCloseTo(75, 0);          // 5,000 × 3% ÷ 2
    expect(Number(li.sgst)).toBeCloseTo(75, 0);
    expect(Number(li.igst)).toBe(0);
  });
});

test.describe('Inward bill — capture to register', () => {
  const BILL_NO = `E2E-${RUN}`;

  async function fillLine(page, { product, hsn, qty, rate }) {
    await page.getByPlaceholder('Product').fill(product);
    await page.getByPlaceholder('HSN').fill(hsn);
    await page.getByPlaceholder('Qty').fill(qty);
    await page.getByPlaceholder('Rate').fill(rate);
  }

  test('manual capture saves with intra-state heads and appears in the register', async ({ page }) => {
    await page.goto('/billing/inward-bills/add');
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'TEST JEWELLERS' }).click();
    await page.getByRole('button', { name: /Enter details manually/ }).click();

    // Blank supplier GSTIN must default to LOCAL — the capture form shipped
    // assuming inter-state for unknown suppliers, which taxed unregistered
    // local suppliers IGST until the shared rule fixed it.
    await expect(page.getByText('Intra-state · CGST + SGST')).toBeVisible();

    const field = (label) =>
      page.locator('label', { hasText: label }).locator('..').locator('input');
    await field('Supplier name').fill('E2E LOCAL SUPPLIER');
    await field('Invoice #').fill(BILL_NO);
    await field('Invoice date').fill('2026-08-12');
    await fillLine(page, { product: 'Silver Payal', hsn: '711311', qty: '100', rate: '95' });

    const create = page.waitForResponse(
      (r) => r.url().endsWith('/api/inward-bills/') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save inward bill' }).click();
    const resp = await create;
    expect(resp.status(), await resp.text()).toBe(201);
    const bill = await resp.json();

    // Detail page renders what we saved
    await expect(page.getByText('E2E LOCAL SUPPLIER').first()).toBeVisible();

    const headers = await apiToken(page);
    const detail = await (await page.request.get(`/api/inward-bills/${bill.id}/`, { headers })).json();
    const li = detail.line_items[0];
    expect(Number(li.cgst)).toBeCloseTo(142.5, 1);       // 9,500 × 3% ÷ 2
    expect(Number(li.sgst)).toBeCloseTo(142.5, 1);
    expect(Number(li.igst)).toBe(0);
    expect(Number(detail.total_amount)).toBeCloseTo(9785, 0);

    // And the register lists it
    await page.goto('/billing/inward-bills');
    await expect(page.getByText(BILL_NO).first()).toBeVisible();
  });

  test('same supplier reusing a bill number is refused with a 409', async ({ page }) => {
    await page.goto('/billing/inward-bills/add');
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'TEST JEWELLERS' }).click();
    await page.getByRole('button', { name: /Enter details manually/ }).click();

    const field = (label) =>
      page.locator('label', { hasText: label }).locator('..').locator('input');
    await field('Supplier name').fill('E2E LOCAL SUPPLIER');
    await field('Invoice #').fill(BILL_NO);               // the number just used
    await field('Invoice date').fill('2026-08-13');
    await fillLine(page, { product: 'Silver Payal', hsn: '711311', qty: '1', rate: '95' });

    const create = page.waitForResponse(
      (r) => r.url().endsWith('/api/inward-bills/') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save inward bill' }).click();
    expect((await create).status()).toBe(409);
    await expect(page.getByText(/duplicate/i).first()).toBeVisible();
  });
});
