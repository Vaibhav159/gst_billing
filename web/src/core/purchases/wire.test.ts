import { toCredit, toCreditMonths, toDuplicateCheck, toPurchaseDetail, toPurchasePage, toPurchaseRead, toSupplierDetail, toSupplierMemory } from './wire';
import { purchaseDetailWire, purchasePageWire } from './fixtures';

test('purchase detail reads all money in paise, preserves rates, and reuses sales lines', () => {
  const bill = toPurchaseDetail(purchaseDetailWire());
  expect(bill).toMatchObject({ id: 905, total_amount: 49264500, taxable: 47829612, tax: 1434888, credit: { claimed: 1434888 }, supplier: { pan: 'AACFU5521R' }, firm: { id: 3, short: 'Kiran' } });
  expect(bill.lines[0]).toMatchObject({ quantity: '69.540', rate: '6878.000', taxable: 47829612, amount: 49264500, note: '' });
  expect(bill.slabs[0].tax).toBe(1434888);
  expect(bill.files[0]).toMatchObject({ id: 'src', kind: 'photo', preview_url: '/api/media/preview?s=synthetic' });
});
test('list preserves optional export lines and all facets while later pages have no invented summary', () => {
  const page = toPurchasePage(purchasePageWire([purchaseDetailWire()]));
  expect(page.results[0].lines?.[0].tax).toBe(1434888);
  expect(page.summary).toMatchObject({ bills: 1, credit: 1434888, total_amount: 49264500 });
  expect(page.facets?.months[0]).toMatchObject({ late_in: 1, late_in_credit: 120540, closed: false });
  expect(page.facets?.credit_months[0].credit).toBe(1434888);
  expect(toPurchasePage({ results: [] }).summary).toBeNull();
});
test('missing fields have safe shapes without pretending an unchecked duplicate is free', () => {
  expect(toPurchaseDetail({})).toMatchObject({ lines: [], files: [], slabs: [], capture: null, linked_sale: null, history: { created_by: null, activity: [] } });
  expect(toCredit({})).toMatchObject({ chosen: null, claimed: 0, filed_on: null });
  expect(toDuplicateCheck({})).toMatchObject({ duplicate: null, unchecked: true });
  expect(toDuplicateCheck({ duplicate: null, same_spelling: true })).toMatchObject({ unchecked: false });
  expect(toDuplicateCheck({ duplicate: null, unchecked: true })).toMatchObject({ unchecked: true });
});
test('read keeps explicit zero, off-slab null and amount-only null quantity/rate for capture/import consumers', () => {
  const read = toPurchaseRead({ source: 'e-invoice', irn: 'a'.repeat(64), supplier: { id: null }, buyer: { business: 3 }, printed_total: null, lines_total: '100.01', confidence: { supplier: 'high', gstin: 'high', bill_no: 'high', date: 'medium', amounts: 'medium' }, lines: [{ gst_percent: '0', quantity: '1', rate: '100.000', taxable: '100.00' }, { gst_percent: null, printed_rate: '2.5%', quantity: null, rate: null, amount_only: true, taxable: '24.56' }] });
  expect(read).toMatchObject({ printed_total: null, lines_total: 10001, supplier: { id: null }, buyer: { business: 3 }, source: 'e-invoice' });
  expect(read.lines[0]).toMatchObject({ gst_percent: '0', rate: '100.000', taxable: 10000 });
  expect(read.lines[1]).toMatchObject({ gst_percent: null, printed_rate: '2.5%', quantity: null, rate: null, amount_only: true, taxable: 2456 });
  expect(read.confidence.date).toBe('medium');
});
test('supplier figures and rates preserve precision, memory carries no invented next number', () => {
  const result = toSupplierDetail({ supplier: { id: 21, pan: 'AACFU5521R' }, figures: { total: '123.45', credit: '3.00' }, rates: [{ quantity: '12.345', value: '123.45', average: '10.123', low: '9.123', high: '11.123' }] });
  expect(result.figures).toMatchObject({ total: 12345, credit: 300, last: null });
  expect(result.rates[0]).toMatchObject({ quantity: '12.345', value: 12345, average: '10.123' });
  expect(toSupplierMemory({})).toEqual({ bills: 0, last: null, line: null, next_number: null });
});
test('credit options keep the server default and unchoosable out-of-time months', () => {
  expect(toCreditMonths({ bill_month: '2025-08', default: '2026-11', lapsed: true, options: [{ month: '2026-11', due: '2026-12-20', running: true, in_time: false }] })).toMatchObject({ default: '2026-11', lapsed: true, options: [{ in_time: false }] });
});
