import type { Capture, PurchaseRead } from './types';
export function readFixture(overrides: Partial<PurchaseRead> = {}): PurchaseRead {
  return { source: 'photo', irn: '', supplier: { name: 'Udaipur Bullion Suppliers', gst_number: '08AACFU5521R1ZN', id: 21, state_code: '08', city: '' },
    buyer: { name: 'Kiran Gold House', gst_number: '08VRHFA2322D1ZI', business: 3 }, seller_business: null,
    invoice_number: 'UBS/26-27/0866', invoice_date: '2026-10-07', payment_mode: '',
    lines: [{ product_name: 'Gold bullion 995', hsn_code: '7108', gst_percent: '3', printed_rate: '3%', quantity: '42.180', unit: 'gms', rate: '6878.000', taxable: '290114.04', amount_only: false }],
    printed_total: '298817.00', lines_total: '298817.46', confidence: { supplier: 'high', gstin: 'high', bill_no: 'high', date: 'medium', amounts: 'high' },
    notes: ["The bill shows ₹2,98,817.00; its lines add up to ₹2,98,817.46 (₹0.46 more, likely round-off). The lines are what's saved: edit them if the bill's figure is right."], ...overrides };
}
export function captureFixture(overrides: Partial<Capture> = {}): Capture {
  return { id: 12, business: 3, business_name: 'KIRAN GOLD HOUSE', label: 'Bill photo 4', hint: 'Solanki Jewellers', note: 'exhibition stall 14',
    captured_at: '2026-10-08T14:21:09+05:30', captured_by: { id: 1, name: 'Kailash Mehta' },
    pages: [{ page: 1, kind: 'photo', url: '/media/synthetic.jpg', preview_url: '/media/synthetic-preview.jpg', size: 1520000 }],
    pdf: false, status: 'ready', problem: '', read: readFixture(), purchase: null, discarded: null, ...overrides };
}
