import { date, paiseToDecimal, todayIST, UNITS } from '@/core/format';
import { SLABS } from '@/core/sales/slabs';
import type { PurchaseDetail, PurchaseInput, PurchaseRead } from '@/core/purchases/types';

export type FormLine = { product_name: string; hsn_code: string; quantity: string; unit: string; rate: string; gst_percent: string; note: string; amount_only?: boolean; taxable?: string; fromMemory?: boolean };
export type PurchaseValues = Omit<PurchaseInput, 'lines'> & { lines: FormLine[] };
export const newLine = (): FormLine => ({ product_name: '', hsn_code: '', quantity: '', unit: 'gms', rate: '', gst_percent: '', note: '' });
export const blankPurchase = (business = 0): PurchaseValues => ({ business, supplier: 0, invoice_number: '', invoice_date: '', payment_mode: '', itc_eligible: true, buyer_gstin: '', buyer_ack: false, duplicate_ok: false, needs_review: false, capture: null, source: 'typed', lines: [newLine()] });
export function fromPurchase(p: PurchaseDetail): PurchaseValues {
  return { ...blankPurchase(p.business), supplier: p.supplier.id, invoice_number: p.invoice_number, invoice_date: p.invoice_date, payment_mode: p.payment_mode, itc_eligible: p.credit.eligible, buyer_gstin: p.buyer_gstin, buyer_ack: p.buyer_ack,
    lines: p.lines.map(l => ({ product_name: l.product_name, hsn_code: l.hsn_code, quantity: l.quantity, unit: l.unit, rate: l.rate, gst_percent: l.gst_percent, note: l.note, ...(l.note === 'Amount only' ? { amount_only: true, taxable: paiseToDecimal(l.taxable) } : {}) })) };
}
export function copyPurchase(p: PurchaseDetail, next: string | null, today = todayIST()): PurchaseValues {
  return { ...fromPurchase(p), invoice_number: next || '', invoice_date: today, itc_eligible: true, buyer_gstin: '', buyer_ack: false };
}
export function fromRead(r: PurchaseRead, business = 0): PurchaseValues {
  return { ...blankPurchase(business), supplier: r.supplier.id ?? 0, invoice_number: r.invoice_number, invoice_date: r.invoice_date, payment_mode: r.payment_mode, buyer_gstin: r.buyer.gst_number,
    lines: r.lines.map(l => ({ product_name: l.product_name, hsn_code: l.hsn_code, quantity: l.quantity ?? '', rate: l.rate ?? '', unit: l.unit, gst_percent: l.gst_percent ?? '', note: l.amount_only ? 'Amount only' : '', ...(l.amount_only ? { amount_only: true, taxable: paiseToDecimal(l.taxable) } : {}) })) };
}
export const emptyLine = (l: FormLine) => !l.product_name.trim() && !l.quantity && !l.rate && !l.taxable;
export function fillEmpty(v: PurchaseValues, read: PurchaseValues): PurchaseValues {
  return { ...v, supplier: v.supplier || read.supplier, invoice_number: v.invoice_number || read.invoice_number, invoice_date: v.invoice_date || read.invoice_date, payment_mode: v.payment_mode || read.payment_mode, buyer_gstin: v.buyer_gstin || read.buyer_gstin,
    lines: v.lines.length === 1 && emptyLine(v.lines[0]) ? read.lines : v.lines };
}
const positive = (v: string, decimals = 3) => new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(v) && Number(v) > 0;
export function purchaseErrors(v: PurchaseValues, today = todayIST()): Record<string, string> {
  const e: Record<string, string> = {};
  if (!v.business) e.business = 'Choose which firm bought this.';
  if (!v.supplier) e.supplier = 'Choose the supplier, or add a new one.';
  if (!v.invoice_number.trim()) e.invoice_number = "Type the bill number printed on the supplier's bill.";
  else if (v.invoice_number.trim().length > 50) e.invoice_number = 'Keep the bill number to 50 characters.';
  const d = v.invoice_date; const parsed = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00Z`) : null;
  if (!d) e.invoice_date = 'Type the date printed on the bill, like 08 Oct 2026.';
  else if (!parsed || !Number.isFinite(parsed.getTime()) || parsed.getUTCFullYear() !== Number(d.slice(0, 4)) || parsed.getUTCMonth() + 1 !== Number(d.slice(5, 7)) || parsed.getUTCDate() !== Number(d.slice(8))) e.invoice_date = 'Type the date like 2026-09-30.';
  else if (d < '2000-01-01') e.invoice_date = 'Pick a date from 2000 to 2099.';
  else if (d > today) e.invoice_date = `That's after today (${date(today)}). Check the date on the bill.`;
  if (!v.lines.length) e.lines = 'Add at least one item from the bill.';
  else if (v.lines.length > 200) e.lines = 'A bill can have at most 200 items.';
  v.lines.forEach((l, i) => {
    const k = `lines.${i}.`;
    if (!l.product_name.trim()) e[k + 'product_name'] = 'Choose the item from the bill.';
    else if (l.product_name.length > 255) e[k + 'product_name'] = "Keep the item's name to 255 characters.";
    if (l.hsn_code && !/^\d{4,8}$/.test(l.hsn_code)) e[k + 'hsn_code'] = 'Type the HSN code from the bill: 4 to 8 digits.';
    if (!SLABS.includes(l.gst_percent as typeof SLABS[number])) e[k + 'gst_percent'] = 'Choose the slab printed on the bill (0% if it charges no GST).';
    if (l.amount_only) { if (!positive(l.taxable ?? '', 2)) e[k + 'taxable'] = "Type the line's value from the bill."; }
    else {
      if (!positive(l.quantity)) e[k + 'quantity'] = `Type the quantity in ${UNITS.find(u => u.value === l.unit)?.label.replace(/ \(.*\)/, '').toLowerCase() ?? l.unit}.`;
      if (!positive(l.rate)) e[k + 'rate'] = 'Type the rate printed on the bill.';
    }
    if (!UNITS.some(u => u.value === l.unit)) e[k + 'unit'] = 'Pick a unit from the list.';
    if (l.note.length > 60) e[k + 'note'] = 'Keep the note to 60 characters.';
  });
  return e;
}
export function payloadOf(v: PurchaseValues, { noGstin, pending, editing = false }: { noGstin: boolean; pending: string[]; editing?: boolean }): PurchaseInput {
  const body: PurchaseInput = { ...v, invoice_number: v.invoice_number.trim(), buyer_gstin: (v.buyer_gstin ?? '').trim().toUpperCase(),
    itc_eligible: noGstin ? true : v.itc_eligible, needs_review: pending.length > 0,
    lines: v.lines.map(({ fromMemory: _memory, ...l }) => ({ ...l, product_name: l.product_name.trim(), gst_percent: noGstin ? '0' : l.gst_percent })) };
  if (v.invoice_date < '2025-04-01') body.itc_month = null;
  if (editing) { delete body.capture; delete body.source; delete body.needs_review; }
  return body;
}
