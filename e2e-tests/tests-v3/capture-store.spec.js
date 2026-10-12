const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../../web/node_modules/typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../web/src/core/captures/store.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const multipartCode = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../web/src/core/captures/multipart.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
async function install(page) {
  await page.evaluate(code => { const exports = {}; new Function('exports', code)(exports); window.captureStore = new exports.IndexedDbCaptureStore('gst3.capture-replay'); }, code);
  await page.evaluate(code => { const exports = {}; new Function('exports', code)(exports); window.captureMultipart = exports; }, multipartCode);
}
test.beforeEach(async ({ page }) => {
  await page.route('http://capture-storage.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Capture storage</title>' }));
  await page.goto('http://capture-storage.test/');
  await install(page);
});
test('real IndexedDB keeps file bytes, names and owner across reload', async ({ page }) => {
  await page.evaluate(async () => {
    await window.captureStore.putMany([{ clientId: 'one', userId: 1, files: [new File(['synthetic bill'], 'IMG_2041.jpg', { type: 'image/jpeg' })], businessId: null, hint: 'Gold', note: 'desk', createdAt: '2026-10-12T00:00:00Z', captureId: null, phase: 'queued', error: null }]);
  });
  await page.reload(); await install(page);
  const result = await page.evaluate(async () => {
    const [row] = await window.captureStore.list(1);
    return { name: row.files[0].name, type: row.files[0].type, bytes: await row.files[0].text(), others: await window.captureStore.list(2) };
  });
  expect(result).toEqual({ name: 'IMG_2041.jpg', type: 'image/jpeg', bytes: 'synthetic bill', others: [] });
});
test('transactions are atomic; concurrent receipt cannot regress or recreate a removed row', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const store = window.captureStore;
    const row = { clientId: 'one', userId: 1, files: [new File(['bill'], 'bill.pdf', { type: 'application/pdf' })], businessId: null, hint: '', note: '', createdAt: '2026-10-12T00:00:00Z', captureId: null, phase: 'queued', error: null };
    await store.putMany([row]);
    let failed = false;
    try { await store.putMany([{ ...row, clientId: 'two' }, row]); } catch { failed = true; }
    const count = (await store.list(1)).length;
    await store.update(1, 'one', { phase: 'uploaded', captureId: 12 });
    const receipt = await store.update(1, 'one', { phase: 'queued', captureId: null, error: 'late failure' });
    await store.remove(1, 'one');
    const removed = await store.update(1, 'one', { error: 'late failure' });
    return { failed, count, phase: receipt.phase, id: receipt.captureId, removed, left: await store.list(1) };
  });
  expect(result).toEqual({ failed: true, count: 1, phase: 'uploaded', id: 12, removed: null, left: [] });
});

test('X-30 bounds real browser multipart framing and UTF-8 metadata under 24 MB', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { captureFormData, MAX_REQUEST_BYTES } = window.captureMultipart;
    const half = MAX_REQUEST_BYTES / 2;
    const files = [new File([new Uint8Array(half - 32768)], 'सोना-"front.pdf', { type: 'application/pdf' }),
      new File([new Uint8Array(half - 32768)], 'back.pdf', { type: 'application/pdf' })];
    const body = captureFormData({ files, client_id: '7439a752-34d4-4c98-ae27-2f4506d91df4', hint: 'सोना', note: 'Front\nBack' });
    const actualBytes = (await new Response(body).blob()).size;
    let refused = '';
    try { captureFormData({ files: [new File([new Uint8Array(half)], 'front.pdf'), new File([new Uint8Array(half)], 'back.pdf')], client_id: 'same-id' }); }
    catch (error) { refused = error.message; }
    return { actualBytes, limit: MAX_REQUEST_BYTES, refused };
  });
  expect(result.actualBytes).toBeLessThanOrEqual(result.limit);
  expect(result.actualBytes).toBeGreaterThan(result.limit - 65536);
  expect(result.refused).toBe('These pages come to 24.1 MB. One bill can send at most 24 MB; take fewer or smaller pages.');
});
