const fs = require('fs/promises');
const { test, expect } = require('@playwright/test');
const { opened } = require('./session');
const { afterDialog, esc } = require('./sales-data');
const { client, today, number, newPurchase, notesPurchases, makesPurchases, attachPhoto } = require('./purchases-data');
makesPurchases(test);
test.use({ video: 'on' });
async function detail(page, bill) {
  await page.goto(`/purchases/${bill.id}`); await expect(page.getByRole('heading', { level: 1 })).toContainText('Purchase'); await opened(page);
}
test('typed purchase saves exact tax, edits, and adds another from the same supplier', async ({ page, request }) => {
  const api = client(request), { bill, firm, supplier } = await newPurchase(api); notesPurchases(page);
  await page.goto(`/purchases/new?firm=${firm.id}&supplier=${supplier.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Add a purchase'); await opened(page);
  const next = number(); await page.getByLabel("Supplier's bill number", { exact: true }).fill(next); await page.getByRole('textbox', { name: 'Bill date', exact: true }).fill(today().split('-').reverse().join('/'));
  await page.getByRole('combobox', { name: 'Item', exact: true }).fill('Typed gold fixture (e2e)');
  await page.getByLabel('HSN code', { exact: true }).fill('7108'); await page.getByLabel('Quantity', { exact: true }).fill('1.001');
  await page.getByLabel('Rate per gms', { exact: true }).fill('99.950'); await page.getByRole('combobox', { name: 'GST slab', exact: true }).selectOption({ label: '3%' });
  const saving = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/purchases/');
  await page.getByRole('button', { name: 'Save purchase', exact: true }).click(); const response = await saving; expect(response.status()).toBe(201);
  const saved = await response.json(); expect(saved.taxable).toBe('100.05'); expect(saved.tax).toBe('3.00'); expect(saved.total_amount).toBe('103.05'); expect(saved.credit.eligible).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/purchases/${saved.id}(?:\\?|$)`)); await opened(page);
  await page.goto(`/purchases/${saved.id}/edit`); await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeVisible(); await opened(page);
  await page.getByLabel('Quantity', { exact: true }).fill('2.000'); await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/purchases/${saved.id}(?:\\?|$)`)); expect((await api.get(`purchases/${saved.id}/`)).lines[0].quantity).toBe('2.000');
  await page.goto(`/purchases/new?from=${bill.id}`); await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); await opened(page);
  await expect(page.getByRole('combobox', { name: 'Supplier', exact: true })).toHaveValue(supplier.name);
  await expect(page.getByLabel("Supplier's bill number", { exact: true })).not.toHaveValue(bill.invoice_number);
});
test('credit view includes an earlier FY, review clears, and old purchase links resolve', async ({ page, request }) => {
  const api = client(request), base = await newPurchase(api), thisDay = today(), year = Number(thisDay.slice(0, 4)) - (Number(thisDay.slice(5, 7)) < 4 ? 1 : 0);
  const day = `${year}-03-31`, months = await api.get('purchases/credit-months/', { business_id: base.firm.id, invoice_date: day });
  const option = [...months.options].reverse().find(m => m.in_time) || months.options[0]; expect(option).toBeTruthy();
  const { bill } = await newPurchase(api, { invoice_date: day, itc_month: option.month, needs_review: true });
  await page.goto(`/purchases?firm=${bill.business}&credit=${option.month}&q=${encodeURIComponent(bill.invoice_number)}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Purchases' })).toBeVisible(); await opened(page); await expect(page.getByText(new RegExp(esc(bill.invoice_number))).first()).toBeVisible();
  await detail(page, bill); await page.getByRole('button', { name: 'Looks right', exact: true }).click();
  await expect.poll(async () => (await api.get(`purchases/${bill.id}/`)).needs_review).toBe(false);
  await page.goto(`/billing/invoice/${bill.business}/${bill.fy}/${encodeURIComponent(bill.invoice_number)}`); await expect(page).toHaveURL(new RegExp(`/purchases/${bill.id}$`));
  await page.goto(`/inward-bills/${bill.id}`); await expect(page).toHaveURL(new RegExp(`/purchases/${bill.id}$`));
});
test('selected CSV and CA ZIP download the register and the original synthetic bill', async ({ page, request }, info) => {
  test.skip(info.project.name === 'phone', 'Selection exports belong to the desktop register.');
  const { bill } = await newPurchase(client(request)); const attached = await attachPhoto(request, bill);
  expect(attached.files).toHaveLength(1);
  await page.goto(`/purchases?firm=${bill.business}&q=${encodeURIComponent(bill.invoice_number)}`); await expect(page.getByText(new RegExp(esc(bill.invoice_number))).first()).toBeVisible(); await opened(page);
  await page.getByRole('checkbox', { name: `Tick ${bill.invoice_number}`, exact: true }).check();
  const selected = page.getByRole('region', { name: 'Ticked purchases' });
  const csvPromise = page.waitForEvent('download'); await selected.getByRole('button', { name: 'CSV', exact: true }).click(); const csv = await csvPromise;
  expect(await fs.readFile(await csv.path(), 'utf8')).toContain(bill.invoice_number);
  const zipPromise = page.waitForEvent('download'); await selected.getByRole('button', { name: 'For the CA', exact: true }).click(); const zip = await zipPromise;
  // Storage may add a collision suffix when an earlier run kept the same upload name.
  const bytes = await fs.readFile(await zip.path()); expect(bytes.readUInt32LE(0)).toBe(0x04034b50); expect(bytes.toString('utf8')).toContain(attached.files[0].name); expect(bytes.toString('utf8')).toContain('.xlsx');
});
test('delete moves the bill to its deleted page, then Restore returns the same lines and credit', async ({ page, request }) => {
  const api = client(request), { bill } = await newPurchase(api); await detail(page, bill);
  await page.getByRole('button', { name: 'More actions for this purchase' }).click();
  await page.getByRole('menuitem', { name: new RegExp(`Delete purchase ${esc(bill.invoice_number)}`) }).click(); await afterDialog(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Delete 1 purchase bill', exact: true }).click(); await expect(page).toHaveURL(/\/purchases(?:\?|$)/);
  await page.goto(`/purchases/${bill.id}`); await expect(page.getByText('This purchase was deleted', { exact: true })).toBeVisible(); await opened(page);
  await page.getByRole('button', { name: 'Restore it', exact: true }).click();
  await expect(page.getByText('This purchase was deleted', { exact: true })).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Purchase');
  const restored = await api.get(`purchases/${bill.id}/`);
  // Restoring recreates line rows; their money and entered values stay the same.
  const values = lines => lines.map(({ id, ...line }) => line);
  expect(restored.id).toBe(bill.id); expect(values(restored.lines)).toEqual(values(bill.lines)); expect(restored.credit).toEqual(bill.credit);
});
test('failed offline save keeps every typed field', async ({ page, request, context }) => {
  const { bill } = await newPurchase(client(request));
  await page.goto(`/purchases/${bill.id}/edit`); await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeVisible(); await opened(page);
  await page.getByLabel('Quantity', { exact: true }).fill('3.123'); await context.setOffline(true);
  try {
    await page.getByRole('button', { name: 'Save changes', exact: true }).click(); await expect(page.getByText(/You're offline, so this wasn't saved/)).toBeVisible();
    await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('3.123'); await expect(page).toHaveURL(new RegExp(`/purchases/${bill.id}/edit$`));
  } finally { await context.setOffline(false); }
});
test('duplicate and billed-to acknowledgements are explicit and persist on the saved purchase', async ({ page, request }) => {
  const api = client(request), { bill, supplier, firm } = await newPurchase(api); notesPurchases(page);
  await page.goto(`/purchases/new?from=${bill.id}`); await expect(page.getByRole('button', { name: 'Save purchase', exact: true })).toBeVisible(); await opened(page);
  await page.getByLabel("Supplier's bill number", { exact: true }).fill(bill.invoice_number);
  await expect(page.getByText('Already entered', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: "It's a different bill with the same number", exact: true }).check();
  const wrongBuyer = supplier.gst_number === firm.gst_number ? '08VRHFA2322D1ZI' : supplier.gst_number;
  await page.getByLabel('Billed to (GSTIN on the bill)', { exact: true }).fill(wrongBuyer);
  await expect(page.getByText(/This bill isn't addressed to/)).toBeVisible(); await page.getByRole('checkbox', { name: 'Record anyway', exact: true }).check();
  const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/purchases/');
  await page.getByRole('button', { name: 'Save purchase', exact: true }).click(); const result = await response; expect(result.status()).toBe(201);
  const saved = await result.json(); expect(saved.checks).toEqual(expect.arrayContaining(['duplicate', 'billed_to_other'])); expect(saved.buyer_ack).toBe(true);
  expect((await api.get(`purchases/${saved.id}/`)).buyer_gstin).toBe(wrongBuyer);
});

test('a typed late bill saves into the earliest open credit month', async ({ page, request }) => {
  const api = client(request), { bill, firm } = await newPurchase(api); notesPurchases(page);
  const [y, m] = today().split('-').map(Number); let late;
  for (let back = 1; back <= 12; back += 1) {
    const serial = y * 12 + m - 1 - back;
    const day = `${Math.floor(serial / 12)}-${String(serial % 12 + 1).padStart(2, '0')}-08`;
    if (day < '2025-04-01') break;
    const months = await api.get('purchases/credit-months/', { business_id: firm.id, invoice_date: day });
    if (months.bill_month_closed && months.default && !months.lapsed) { late = { day, month: months.default }; break; }
  }
  expect(late, '2A seed must contain a filed month with an open in-time credit month').toBeTruthy();
  await page.goto(`/purchases/new?from=${bill.id}`);
  await expect(page.getByRole('button', { name: 'Save purchase', exact: true })).toBeVisible(); await opened(page);
  await page.getByLabel("Supplier's bill number", { exact: true }).fill(number());
  await page.getByRole('textbox', { name: 'Bill date', exact: true }).fill(late.day.split('-').reverse().join('/'));
  await expect(page.getByText(/is filed, so its credit goes in a later return:/)).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Claim the credit in', exact: true })).toHaveValue(late.month);
  const saving = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/purchases/');
  await page.getByRole('button', { name: 'Save purchase', exact: true }).click();
  const response = await saving; expect(response.status()).toBe(201);
  const saved = await response.json(); expect(saved.invoice_date).toBe(late.day); expect(saved.credit.month).toBe(late.month);
  await expect(page.getByText('Purchase saved', { exact: true })).toBeVisible();
});
