// Real purchase API fixtures. No seed IDs, AI keys, database writes or filing changes.
const { expect } = require('@playwright/test');
const { savedToken } = require('./session');
const { client, firstFirm, today } = require('./sales-data');
const made = new Set();
const pending = new Set();
const GSTIN = '08AACFU5521R1ZN';
const number = () => `P2B-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
async function supplier(api) {
  const found = await api.get('suppliers/', { q: GSTIN, page_size: 20 });
  return found.results.find(s => s.gst_number === GSTIN) || api.post('suppliers/', {
    name: 'Purchase test supplier (e2e)', gst_number: GSTIN, state_name: 'RAJASTHAN', city: 'Udaipur', address: '', pan_number: '', mobile_number: '', email: '',
  });
}
async function newPurchase(api, overrides = {}) {
  const firm = await firstFirm(api), party = await supplier(api);
  const payload = { business: firm.id, supplier: party.id, invoice_number: number(), invoice_date: today(), payment_mode: 'bank', itc_eligible: true, buyer_gstin: '', buyer_ack: false, source: 'typed',
    lines: [{ product_name: 'Purchase gold fixture (e2e)', hsn_code: '7108', quantity: '1.001', unit: 'gms', rate: '99.950', gst_percent: '3', note: '' }], ...overrides };
  const bill = await api.post('purchases/', payload); made.add(bill.id); return { bill, payload, firm, supplier: party };
}
function notesPurchases(page) {
  page.on('response', response => {
    if (response.request().method() !== 'POST' || !/\/api\/purchases\/$/.test(new URL(response.url()).pathname) || response.status() !== 201) return;
    const task = response.json().then(b => made.add(b.id)); pending.add(task); void task.finally(() => pending.delete(task));
  });
}
function makesPurchases(test) {
  test.afterEach(async ({ request }) => {
    await Promise.all([...pending]);
    const failures = [], headers = { Authorization: `Bearer ${savedToken()}` };
    for (const id of [...made]) {
      try {
        const before = await request.get(`/api/purchases/${id}/`, { headers });
        if (before.status() !== 404) {
          expect(before.ok(), `Check test purchase ${id}`).toBe(true);
          const gone = await request.delete(`/api/purchases/${id}/`, { headers, data: { reason: 'Test purchase' } });
          expect(gone.ok() || gone.status() === 404, `Delete test purchase ${id}: ${gone.status()}`).toBe(true);
        }
        made.delete(id);
      } catch (error) { failures.push(String(error)); }
    }
    expect(failures, 'Test purchases must be in the bin').toEqual([]);
  });
}
async function attachPhoto(request, bill) {
  const response = await request.post(`/api/purchases/${bill.id}/files/`, { headers: { Authorization: `Bearer ${savedToken()}` }, multipart: { file: {
    name: 'synthetic-purchase.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4tCUFAARGAes42ZwhAAAAAElFTkSuQmCC', 'base64'),
  } } });
  expect(response.ok(), `Attach synthetic purchase: ${response.status()}`).toBe(true);
  return response.json();
}
module.exports = { client, firstFirm, today, number, supplier, newPurchase, notesPurchases, makesPurchases, attachPhoto };
