// Synthetic contract examples. Only tests import these; serve is the app's existing fake API adapter.
import { serve, type Answer } from '@/test/server';
type Wire = Record<string, unknown>;
export const SUPPLIER = { id: 21, name: 'Udaipur Bullion Suppliers', gst_number: '08AACFU5521R1ZN', state_code: '08', state_name: 'RAJASTHAN', city: 'Udaipur' };
export const PURCHASE_FIRM = { id: 3, name: 'KIRAN GOLD HOUSE', short: 'Kiran', gst_number: '08VRHFA2322D1ZI', state_code: '08', state_name: 'RAJASTHAN' };
export const PURCHASE_CREDIT = { month: '2026-10', chosen: null, late: false, eligible: true, lapsed: false, claimed: '14348.88', state: 'open', filed_on: null, deadline: '2027-11-30' };
export const PURCHASE_LINE = { id: 901, product_name: 'Gold bullion 995', quantity: '69.540', unit: 'gms', rate: '6878.000', hsn_code: '7108', gst_percent: '3', taxable: '478296.12', cgst: '7174.44', sgst: '7174.44', igst: '0.00', tax: '14348.88', amount: '492645.00', note: '' };
export function purchaseRowWire(over: Wire = {}): Wire {
  return { id: 905, business: 3, business_name: PURCHASE_FIRM.name, invoice_number: 'UBS/26-27/0850', invoice_date: '2026-10-04', fy: '2026-27', created_at: '2026-10-04T18:02:11.104412+05:30', supplier: SUPPLIER, payment_mode: 'bank',
    taxable: '478296.12', cgst: '7174.44', sgst: '7174.44', igst: '0.00', tax: '14348.88', total_amount: '492645.00', interstate: false, gst_percents: ['3'], line_count: 1,
    first_line: { product_name: 'Gold bullion 995', quantity: '69.540', unit: 'gms', rate: '6878.000', amount_only: false }, weights: [{ unit: 'gms', quantity: '69.540' }], credit: PURCHASE_CREDIT, needs_review: false, source: 'typed', has_files: true, checks: [], locked: false, ...over };
}
export function purchaseDetailWire(over: Wire = {}): Wire {
  return { ...purchaseRowWire(), firm: PURCHASE_FIRM, supplier: { ...SUPPLIER, address: 'Synthetic bullion market', pan: 'AACFU5521R', mobile_number: '', email: '', gstin_valid: true, prefix: 'UBS/26-27/' }, buyer_gstin: '', buyer_ack: false, linked_sale: null, lines: [PURCHASE_LINE],
    slabs: [{ gst_percent: '3', taxable: '478296.12', cgst: '7174.44', sgst: '7174.44', igst: '0.00', tax: '14348.88' }], files: [{ id: 'src', kind: 'photo', name: 'synthetic.jpg', url: '/api/media/original?s=synthetic', preview_url: '/api/media/preview?s=synthetic', page: 1, size: 1380000 }], capture: null,
    history: { created_by: { id: 1, name: 'Owner' }, activity: [{ at: '2026-10-04T18:02:11+05:30', by: 'Owner', action: 'created', details: 'Udaipur Bullion Suppliers · ₹4,92,645.00' }] }, ...over };
}
export function purchasePageWire(results: Wire[] = [purchaseRowWire()], over: Wire = {}): Wire {
  return { count: results.length, next: null, previous: null, results, summary: { bills: results.length, taxable: '478296.12', cgst: '7174.44', sgst: '7174.44', igst: '0.00', tax: '14348.88', total_amount: '492645.00', credit: '14348.88' },
    facets: { months: [{ month: '2026-10', bills: results.length, late_in: 1, late_in_credit: '1205.40', closed: false }], credit_months: [{ month: '2026-10', bills: results.length, credit: '14348.88' }], checks: { needs_review: 0, duplicate: 0, no_lines: 0, no_hsn: 0, photo: 1 }, elsewhere: [] }, ...over };
}
export function purchaseBinWire(over: Wire = {}): Wire {
  return { id: 4, original_id: 905, kind: 'deleted', type: 'purchase', business: 3, business_name: PURCHASE_FIRM.name, invoice_number: 'UBS/26-27/0850', invoice_date: '2026-10-04', fy: '2026-27', supplier: SUPPLIER, total_amount: '492645.00', reason: 'Entered twice', deleted_at: '2026-10-08T12:00:00+05:30', deleted_by: { id: 1, name: 'Owner' }, locked: false, ...over };
}
export const CREDIT_MONTHS = { bill_month: '2026-08', bill_month_closed: true, default: '2026-09', options: [{ month: '2026-09', due: '2026-10-20', running: false, in_time: true }, { month: '2026-10', due: '2026-11-20', running: true, in_time: true }], deadline: '2027-11-30', lapsed: false };
export function purchasesServer(extra: Record<string, Answer> = {}) {
  return serve({ 'GET purchases/': purchasePageWire(), 'GET purchases/905/': purchaseDetailWire(), 'GET purchases/credit-months/': CREDIT_MONTHS, 'GET purchases/check-duplicate/': { duplicate: null, same_spelling: true }, 'GET purchases/usual-rate/': { rate: null, from: null, last: null },
    'GET suppliers/': { count: 1, next: null, previous: null, results: [{ ...SUPPLIER, figures: { bills: 1, total: '492645.00', tax: '14348.88', credit: '14348.88', last: { id: 905, invoice_date: '2026-10-04' } } }], summary: { suppliers: 1, bills: 1, total: '492645.00', tax: '14348.88' } },
    'GET suppliers/21/': { supplier: (purchaseDetailWire().supplier), figures: { bills: 1, total: '492645.00', tax: '14348.88', credit: '14348.88', last: { id: 905, invoice_date: '2026-10-04' } }, rates: [], bills: [purchaseRowWire()] },
    'GET suppliers/21/memory/': { bills: 1, last: { id: 905, invoice_number: 'UBS/26-27/0850', invoice_date: '2026-10-04' }, line: { product_name: 'Gold bullion 995', hsn_code: '7108', unit: 'gms', gst_percent: '3' }, next_number: 'UBS/26-27/0851' }, ...extra });
}
