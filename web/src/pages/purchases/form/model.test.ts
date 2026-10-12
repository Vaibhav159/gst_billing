import { blankPurchase, purchaseErrors, payloadOf, fillEmpty, fromRead, copyPurchase } from './model';
import type { PurchaseDetail, PurchaseRead } from '@/core/purchases/types';
const valid = () => ({ ...blankPurchase(3), supplier: 21, invoice_number: 'B/12', invoice_date: '2026-03-31', lines: [{ product_name: 'Gold', hsn_code: '', quantity: '0.017', rate: '1.00', gst_percent: '3', unit: 'gms', note: '' }] });
test('blank form has no default slab or bill date; March 31 and blank HSN are valid', () => {
  expect(blankPurchase(3).lines[0].gst_percent).toBe('');
  expect(blankPurchase(3).invoice_date).toBe('');
  expect(purchaseErrors(valid(), '2026-10-08')).toEqual({});
});
test('no-GSTIN and lapsed display state never writes eligible false', () => {
  const v = valid();
  expect(payloadOf(v, { noGstin: true, pending: ['date'] })).toMatchObject({ itc_eligible: true, needs_review: true, lines: [{ gst_percent: '0' }] });
  expect(payloadOf(v, { noGstin: false, pending: [] }).itc_eligible).toBe(true);
});
test('untouched edit omits credit month; explicit choice survives', () => {
  const v = valid();
  expect(payloadOf(v, { noGstin: false, pending: [], editing: true })).not.toHaveProperty('itc_month');
  expect(payloadOf({ ...v, itc_month: '2026-09' }, { noGstin: false, pending: [], editing: true }).itc_month).toBe('2026-09');
});
test('read fills only empty values and an amount-only value remains a decimal request', () => {
  const read = { supplier: { id: 21 }, invoice_number: 'Read/12', invoice_date: '2026-10-07', payment_mode: '', buyer: { gst_number: '' }, lines: [{ product_name: 'Silver', hsn_code: '', quantity: null, rate: null, unit: 'kg', gst_percent: '0.25', taxable: 12345, amount_only: true }] } as PurchaseRead;
  const v = { ...blankPurchase(3), invoice_number: 'Typed/1' };
  const next = fillEmpty(v, fromRead(read, 3));
  expect(next.invoice_number).toBe('Typed/1');
  expect(next.lines[0]).toMatchObject({ amount_only: true, taxable: '123.45', gst_percent: '0.25' });
});
test('invalid date, 4-decimal quantity and off-slab rates refuse with words', () => {
  const v = valid(); v.invoice_date = '2026-02-31'; v.lines[0].quantity = '1.0001'; v.lines[0].gst_percent = '2.5';
  expect(purchaseErrors(v, '2026-10-08')).toMatchObject({ invoice_date: 'Type the date like 2026-09-30.', 'lines.0.quantity': 'Type the quantity in grams.', 'lines.0.gst_percent': 'Choose the slab printed on the bill (0% if it charges no GST).' });
});
test('Add another clears the read, attachments, date, billed-to and chosen credit month', () => {
  const source = { ...valid(), id: 905, buyer_gstin: '08AAGPL3375F1ZO', buyer_ack: true, credit: { eligible: false }, lines: valid().lines } as unknown as PurchaseDetail;
  const v = copyPurchase(source, 'B/13', '2026-10-08');
  expect(v).toMatchObject({ invoice_number: 'B/13', invoice_date: '2026-10-08', buyer_gstin: '', buyer_ack: false, itc_eligible: true, capture: null, source: 'typed' });
  expect(v).not.toHaveProperty('itc_month');
});
test('Add another keeps how the source bill was paid, including not recorded', () => {
  for (const payment_mode of ['cash', ''] as const) {
    const source = { ...valid(), id: 905, payment_mode, credit: { eligible: true }, lines: valid().lines } as unknown as PurchaseDetail;
    expect(copyPurchase(source, null, '2026-10-08').payment_mode).toBe(payment_mode);
  }
});
test('a read fills an empty payment mode and never replaces a chosen one', () => {
  const read = { supplier: { id: 21 }, invoice_number: 'Read/12', invoice_date: '2026-10-07', payment_mode: 'cash', buyer: { gst_number: '' }, lines: [] } as unknown as PurchaseRead;
  expect(fillEmpty(blankPurchase(3), fromRead(read, 3)).payment_mode).toBe('cash');
  expect(fillEmpty({ ...blankPurchase(3), payment_mode: 'bank' }, fromRead(read, 3)).payment_mode).toBe('bank');
});
