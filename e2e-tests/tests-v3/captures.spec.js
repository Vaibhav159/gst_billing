const { test, expect } = require('@playwright/test');
const { opened, savedToken } = require('./session');
const { client, afterDialog, firstFirm } = require('./sales-data');
const { measure } = require('./axe');
const { supplier: ensureSyntheticSupplier } = require('./purchases-data');
// Ordinary CI has no fake reader. These live flows run only in the controller's confirmed sandbox lane.
test.skip(process.env.E2E_AI_READER !== 'fake', 'Requires the assigned sandbox running AI_READER=fake');
test.use({ video: 'on' });
const made = [];
const purchases = [];
test.beforeEach(() => { expect(process.env.E2E_AI_READER, 'controller must confirm sandbox uses AI_READER=fake').toBe('fake'); });
test.afterEach(async ({ request, page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const api = client(request);
  for (const id of purchases.splice(0)) await api.del(`purchases/${id}/`, { reason: 'Capture e2e cleanup' });
  for (const id of made.splice(0)) {
    const capture = await api.get(`captures/${id}/`);
    if (capture.status !== 'filled' && capture.status !== 'discarded') await api.del(`captures/${id}/`);
  }
});
async function openCapture(page) {
  await page.goto('/purchases/capture');
  await expect(page.getByRole('heading', { level: 1, name: /Capture supplier bills|Capture a supplier's bill/ })).toBeVisible();
  await opened(page);
}
async function synthetic(page, name = 'IMG_2041.jpg') {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 1000;
    const context = canvas.getContext('2d'); context.fillStyle = 'white'; context.fillRect(0, 0, 800, 1000);
    context.fillStyle = 'black'; context.font = '24px sans-serif'; context.fillText('SYNTHETIC BILL — NO REAL CUSTOMER DATA', 20, 60);
    context.fillText('Gold bullion 995  42.180 gms  GST 3%', 20, 100);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  return { name, mimeType: 'image/jpeg', buffer: Buffer.from(data, 'base64') };
}
async function upload(page, files) {
  const response = page.waitForResponse(r => /\/api\/captures\/$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST' && r.ok());
  await page.getByLabel(/^(Choose files|Choose bill photos or PDFs)$/).setInputFiles(files);
  return response;
}
async function uploadOne(page, file) {
  const response = await upload(page, file);
  const capture = await response.json(); made.push(capture.id);
  return capture;
}
async function waitReady(page, id) {
  await expect(page.locator(`[data-row="${id}"]`).getByText('Ready to fill in', { exact: true })).toBeVisible();
  const response = await page.request.get(`/api/captures/${id}/`, { headers: { Authorization: `Bearer ${savedToken()}` } });
  expect(response.ok()).toBe(true); const capture = await response.json(); expect(capture.status).toBe('ready'); return capture;
}
test('same pages become one capture; save keeps source, file, exact lines and review status', { tag: "@sandbox" }, async ({ page, request }) => {
  const api = client(request);
  const firm = await firstFirm(api);
  const suppliers = await api.get('suppliers/', { q: 'Udaipur Bullion Suppliers', page_size: 100 });
  if (!suppliers.results.some(s => s.name.toLowerCase() === 'udaipur bullion suppliers' || s.gst_number === '08AACFU5521R1ZN')) await ensureSyntheticSupplier(api);
  await openCapture(page);
  await expect(page.getByLabel('Buying firm', { exact: true })).toBeEnabled();
  await page.getByLabel('Buying firm', { exact: true }).selectOption(String(firm.id));
  const first = await synthetic(page);
  const second = { ...first, name: 'second-page.jpg' };
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/captures/' && r.request().method() === 'POST' && r.ok());
  await page.getByLabel(/^(Choose files|Choose bill photos or PDFs)$/).setInputFiles([first, second]);
  await expect(page.getByRole('dialog', { name: 'You chose 2 files' })).toBeVisible(); await afterDialog(page);
  await page.getByRole('button', { name: 'One bill with 2 pages' }).click();
  const created = await (await response).json(); made.push(created.id);
  const read = await waitReady(page, created.id);
  expect(read.pages).toHaveLength(2);
  const filling = page.waitForResponse(r => new URL(r.url()).pathname === `/api/captures/${created.id}/` && r.request().method() === 'GET' && r.ok());
  await page.goto(`/purchases/inbox/${created.id}`); await opened(page);
  const displayed = await (await filling).json();
  await expect(page.getByLabel("Supplier's bill number")).toHaveValue(read.read.invoice_number);
  await expect(page.getByLabel('Bought by', { exact: true })).toHaveValue(String(firm.id));
  await opened(page);
  // X-41 replaces prototype checks 330 (desktop) and 634 (phone).
  const fieldList = page.getByRole('region', { name: 'What was read', exact: true });
  await expect(fieldList).toBeVisible();
  const readLabels = { supplier: 'supplier', gstin: 'GSTIN', bill_no: 'bill number', date: 'date', amounts: 'quantities and rates' };
  for (const [key, label] of Object.entries(readLabels)) {
    const group = fieldList.getByRole('group', { name: label, exact: true });
    await expect(group).toBeVisible();
    await expect(group.getByText('Needs a check', { exact: true })).toHaveCount(read.read.confidence[key] === 'medium' ? 1 : 0);
  }
  await expect(fieldList.getByRole('group', { name: 'supplier', exact: true })).toContainText(read.read.supplier.name);
  await expect(fieldList.getByRole('group', { name: 'GSTIN', exact: true })).toContainText(read.read.supplier.gst_number || '—');
  await expect(fieldList.getByRole('group', { name: 'bill number', exact: true })).toContainText(read.read.invoice_number);
  await expect(fieldList.getByRole('group', { name: 'date', exact: true })).toContainText(read.read.invoice_date || '—');
  const photo = page.getByRole('img', { name: /^Photo of .+, page 1$/ });
  await expect(photo).toBeVisible();
  await expect(photo).toHaveAttribute('src', displayed.pages[0].url);
  await expect.poll(() => photo.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  const zoomOut = page.getByRole('button', { name: 'Zoom out', exact: true });
  await expect(zoomOut).toBeDisabled();
  await page.getByLabel("Supplier's bill number").focus();
  await expect(fieldList.getByRole('group', { name: 'bill number', exact: true })).toHaveAttribute('data-focused', 'true');
  await expect(zoomOut).toBeDisabled();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.getByText('150%', { exact: true })).toHaveText('150%');
  await page.getByLabel("Supplier's bill number").focus();
  await expect(page.getByText('150%', { exact: true })).toHaveText('150%');
  // The synthetic reader's buyer differs from generated sandbox firms. Acknowledge only this test bill.
  if (read.read.buyer.gst_number && read.read.buyer.gst_number !== firm.gst_number) {
    await page.getByRole('checkbox', { name: 'Record anyway', exact: true }).check();
  }
  const unique = `CAP-${Date.now()}`;
  await page.getByLabel("Supplier's bill number").fill(unique);
  const saved = page.waitForResponse(r => new URL(r.url()).pathname === '/api/purchases/' && r.request().method() === 'POST' && r.ok());
  await page.getByRole('button', { name: 'Save as purchase', exact: true }).click();
  const bill = await (await saved).json(); purchases.push(bill.id);
  expect(bill.source).toBe('capture'); expect(bill.needs_review).toBe(true);
  expect(bill.capture.id).toBe(created.id); expect(bill.files).toHaveLength(2);
  expect(bill.total_amount).toBe(read.read.lines_total);
  const decimal = value => String(value).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  const lineValues = line => ({ product_name: line.product_name, hsn_code: line.hsn_code, unit: line.unit,
    quantity: decimal(line.quantity), rate: decimal(line.rate), gst_percent: decimal(line.gst_percent), taxable: decimal(line.taxable) });
  expect(bill.lines.map(lineValues)).toEqual(read.read.lines.map(lineValues));
  const stored = await client(request).get(`captures/${created.id}/`);
  expect(stored.status).toBe('filled'); expect(stored.purchase.id).toBe(bill.id);
  await expect(page).toHaveURL(new RegExp(`/purchases/${bill.id}\\?from=capture$`));
  await expect(page.getByText('Saved as a purchase', { exact: true })).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('capture-saved.png'), fullPage: true });
});
test('failed upload survives reload, retries same UUID and reads only once', { tag: "@sandbox" }, async ({ page }) => {
  await openCapture(page);
  const attempts = [];
  let failUploads = true;
  const reads = [];
  page.on('request', r => { if (/\/api\/(?:captures\/\d+|purchases)\/read\/$/.test(new URL(r.url()).pathname) && r.method() === 'POST') reads.push(r.url()); });
  await page.route('**/api/captures/', async route => {
    if (route.request().method() === 'POST') {
      attempts.push(route.request().postData());
      if (failUploads) await route.abort('failed'); else await route.continue();
    }
    else await route.continue();
  });
  await page.getByLabel(/^(Choose files|Choose bill photos or PDFs)$/).setInputFiles(await synthetic(page));
  await expect(page.getByText(/Not uploaded: kept on this/)).toBeVisible();
  await page.reload(); await opened(page);
  await expect(page.getByText(/Not uploaded: kept on this/)).toBeVisible();
  const localIds = await page.evaluate(async () => new Promise((resolve, reject) => {
    const open = indexedDB.open('gst3.capture-queue'); open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result; const query = db.transaction('pending').objectStore('pending').getAll(); query.onsuccess = () => { db.close(); resolve(query.result.map(x => x.clientId)); }; };
  }));
  expect(localIds).toHaveLength(1);
  expect(attempts.length).toBeGreaterThan(0);
  for (const body of attempts) expect(body).toContain(localIds[0]);
  failUploads = false;
  const posted = page.waitForResponse(r => new URL(r.url()).pathname === '/api/captures/' && r.request().method() === 'POST' && r.ok());
  await page.getByRole('button', { name: 'Try now', exact: true }).first().click();
  const response = await posted;
  expect(attempts.at(-1)).toContain(localIds[0]);
  const capture = await response.json(); made.push(capture.id);
  const ready = await waitReady(page, capture.id);
  expect(reads).toHaveLength(1);
  await page.goto(`/purchases/inbox/${capture.id}`);
  await expect(page.getByLabel("Supplier's bill number", { exact: true })).toHaveValue(ready.read.invoice_number);
  await opened(page);
  expect(reads).toHaveLength(1);
  await page.reload();
  await expect(page.getByLabel("Supplier's bill number", { exact: true })).toHaveValue(ready.read.invoice_number);
  await opened(page);
  expect(reads).toHaveLength(1);
});
test('failed synthetic read stays available; discard can be undone', { tag: "@sandbox" }, async ({ page, request }) => {
  await openCapture(page);
  const readResult = page.waitForResponse(r => /\/api\/captures\/\d+\/read\/$/.test(new URL(r.url()).pathname) && r.ok());
  const capture = await uploadOne(page, await synthetic(page, 'blur.jpg'));
  const response = await readResult;
  expect(new URL(response.url()).pathname).toBe(`/api/captures/${capture.id}/read/`);
  expect((await response.json()).status).toBe('failed');
  await page.goto(`/purchases/inbox/${capture.id}`); await opened(page);
  await expect(page.getByText('The photo is too blurred to read the numbers.', { exact: false })).toBeVisible();
  await opened(page);
  await page.getByRole('button', { name: 'Discard photo', exact: true }).click(); await afterDialog(page);
  await page.getByRole('dialog', { name: 'Discard this photo?' }).getByRole('button', { name: 'Discard photo', exact: true }).click();
  const restored = page.waitForResponse(r => new URL(r.url()).pathname === `/api/captures/${capture.id}/restore/` && r.ok());
  await page.getByRole('button', { name: /^Undo(?:\s|$)/ }).click();
  expect((await (await restored).json()).status).toBe('failed');
});
for (const theme of ['obsidian', 'pearl']) {
  test(`capture, inbox, fill and discard are WCAG 2.2 AA in ${theme}`, { tag: "@sandbox" }, async ({ page }, info) => {
    await page.addInitScript(theme => localStorage.setItem('gst3.theme', theme), theme);
    await openCapture(page); expect(await measure(page)).toEqual([]);
    const capture = await uploadOne(page, await synthetic(page)); const ready = await waitReady(page, capture.id);
    await page.goto('/purchases/inbox'); await opened(page); expect(await measure(page)).toEqual([]);
    await page.goto(`/purchases/inbox/${capture.id}`);
    await expect(page.getByLabel("Supplier's bill number", { exact: true })).toHaveValue(ready.read.invoice_number);
    await opened(page); expect(await measure(page)).toEqual([]);
    await page.screenshot({ path: info.outputPath(`capture-fill-${theme}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Discard photo', exact: true }).click(); await afterDialog(page); expect(await measure(page)).toEqual([]);
  });
}
