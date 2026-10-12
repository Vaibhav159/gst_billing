import { toPaise } from '@/core/format';
import { toBillRef, toBinRow, toLine, toPerson } from '@/core/sales/wire';
import type { Slab } from '@/core/sales/types';
import type { Credit, CreditMonths, DuplicateCheck, PurchaseActivity, PurchaseBinRow, PurchaseCheck, PurchaseDetail, PurchaseFile, PurchasePage, PurchaseRead, PurchaseRef, PurchaseRow, SupplierDetail, SupplierFigures, SupplierMemory, SupplierPage, SupplierRecord, SupplierRef, UsualRate } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON is read field-by-field into the contract's types.
type W = any;
const text = (v: W): string => v == null ? '' : String(v);
const whole = (v: W): number => Number.isFinite(Number(v)) ? Number(v) : 0;
const money = (v: W): number => toPaise(typeof v === 'number' || typeof v === 'string' ? v : null) ?? 0;
const list = (v: W): W[] => Array.isArray(v) ? v : [];
const nullableText = (v: W): string | null => v == null ? null : text(v);
const payment = (v: W) => v === 'cash' || v === 'bank' || v === 'credit' || v === 'mixed' ? v : '';
const CHECKS: PurchaseCheck[] = ['duplicate', 'no_lines', 'no_hsn', 'billed_to_other'];
const ACTIONS: PurchaseActivity['action'][] = ['created', 'imported', 'updated', 'checked', 'credit_set', 'deleted', 'restored', 'exported'];
export function toSupplierRef(w: W): SupplierRef {
  return { id: whole(w?.id), name: text(w?.name), gst_number: text(w?.gst_number), state_code: text(w?.state_code), state_name: text(w?.state_name), city: text(w?.city) };
}
export function toSupplierRecord(w: W): SupplierRecord {
  return { ...toSupplierRef(w), address: text(w?.address), pan: text(w?.pan), mobile_number: text(w?.mobile_number), email: text(w?.email), gstin_valid: w?.gstin_valid == null ? null : Boolean(w.gstin_valid), prefix: text(w?.prefix) };
}
export function toCredit(w: W): Credit {
  return { month: nullableText(w?.month), chosen: nullableText(w?.chosen), late: Boolean(w?.late), eligible: w?.eligible !== false, lapsed: Boolean(w?.lapsed), claimed: money(w?.claimed), state: w?.state === 'outside' || w?.state === 'filed' ? w.state : 'open', filed_on: nullableText(w?.filed_on), deadline: text(w?.deadline) };
}
export function toPurchaseRef(w: W): PurchaseRef {
  return { id: whole(w?.id), invoice_number: text(w?.invoice_number), invoice_date: text(w?.invoice_date), supplier_name: text(w?.supplier_name), total_amount: money(w?.total_amount), business_name: text(w?.business_name) };
}
export function toPurchaseRow(w: W): PurchaseRow {
  return {
    id: whole(w?.id), business: whole(w?.business), business_name: text(w?.business_name), invoice_number: text(w?.invoice_number), invoice_date: text(w?.invoice_date), fy: text(w?.fy), created_at: text(w?.created_at),
    supplier: toSupplierRef(w?.supplier), payment_mode: payment(w?.payment_mode), taxable: money(w?.taxable), cgst: money(w?.cgst), sgst: money(w?.sgst), igst: money(w?.igst), tax: money(w?.tax), total_amount: money(w?.total_amount),
    interstate: Boolean(w?.interstate), gst_percents: list(w?.gst_percents).map(text), line_count: whole(w?.line_count),
    first_line: w?.first_line ? { product_name: text(w.first_line.product_name), quantity: text(w.first_line.quantity), unit: text(w.first_line.unit), rate: text(w.first_line.rate), amount_only: Boolean(w.first_line.amount_only) } : null,
    weights: list(w?.weights).map((x) => ({ unit: text(x?.unit), quantity: text(x?.quantity) })), credit: toCredit(w?.credit), needs_review: Boolean(w?.needs_review),
    source: ['typed', 'capture', 'photos', 'excel'].includes(w?.source) ? w.source : '', has_files: Boolean(w?.has_files), checks: list(w?.checks).filter((x) => CHECKS.includes(x)), locked: Boolean(w?.locked),
    ...(Array.isArray(w?.lines) ? { lines: w.lines.map(toLine) } : {}),
  };
}
export function toPurchaseFile(w: W): PurchaseFile {
  return { id: text(w?.id), kind: w?.kind === 'pdf' ? 'pdf' : 'photo', name: text(w?.name), url: text(w?.url), preview_url: nullableText(w?.preview_url), page: whole(w?.page), size: whole(w?.size) };
}
const toSlab = (w: W): Slab => ({ gst_percent: text(w?.gst_percent), taxable: money(w?.taxable), cgst: money(w?.cgst), sgst: money(w?.sgst), igst: money(w?.igst), tax: money(w?.tax) });
export function toPurchaseDetail(w: W): PurchaseDetail {
  return {
    ...toPurchaseRow(w), supplier: toSupplierRecord(w?.supplier),
    firm: { id: whole(w?.firm?.id), name: text(w?.firm?.name), short: text(w?.firm?.short), gst_number: text(w?.firm?.gst_number), state_code: text(w?.firm?.state_code), state_name: text(w?.firm?.state_name) },
    buyer_gstin: text(w?.buyer_gstin), buyer_ack: Boolean(w?.buyer_ack), linked_sale: w?.linked_sale ? toBillRef(w.linked_sale) : null,
    lines: list(w?.lines).map(toLine), slabs: list(w?.slabs).map(toSlab), files: list(w?.files).map(toPurchaseFile),
    capture: w?.capture ? { id: whole(w.capture.id), captured_at: text(w.capture.captured_at), captured_by: toPerson(w.capture.captured_by), pages: whole(w.capture.pages), note: text(w.capture.note), hint: text(w.capture.hint), pdf: Boolean(w.capture.pdf), irn: text(w.capture.irn) } : null,
    history: { created_by: toPerson(w?.history?.created_by), activity: list(w?.history?.activity).map((a) => ({ at: text(a?.at), by: nullableText(a?.by), action: ACTIONS.includes(a?.action) ? a.action : 'updated', details: text(a?.details) })) },
  };
}
export function toPurchaseBin(w: W): PurchaseBinRow {
  const { customer: _customer, ...binned } = toBinRow(w);
  return { ...binned, type: 'purchase', kind: 'deleted', supplier: toSupplierRef(w?.supplier) };
}
export function toPurchasePage(w: W): PurchasePage {
  const results = list(w?.results).map(toPurchaseRow), s = w?.summary, f = w?.facets;
  return { count: w?.count == null ? results.length : whole(w.count), next: nullableText(w?.next), previous: nullableText(w?.previous), results,
    summary: s ? { bills: whole(s.bills), taxable: money(s.taxable), cgst: money(s.cgst), sgst: money(s.sgst), igst: money(s.igst), tax: money(s.tax), total_amount: money(s.total_amount), credit: money(s.credit) } : null,
    facets: f ? {
      months: list(f.months).map((x) => ({ month: text(x?.month), bills: whole(x?.bills), late_in: whole(x?.late_in), late_in_credit: money(x?.late_in_credit), closed: Boolean(x?.closed) })),
      credit_months: list(f.credit_months).map((x) => ({ month: text(x?.month), bills: whole(x?.bills), credit: money(x?.credit) })),
      checks: { needs_review: whole(f.checks?.needs_review), duplicate: whole(f.checks?.duplicate), no_lines: whole(f.checks?.no_lines), no_hsn: whole(f.checks?.no_hsn), photo: whole(f.checks?.photo) },
      elsewhere: list(f.elsewhere).map((x) => ({ fy: text(x?.fy), bills: whole(x?.bills) })),
    } : null,
  };
}
export function toCreditMonths(w: W): CreditMonths {
  return { bill_month: text(w?.bill_month), bill_month_closed: Boolean(w?.bill_month_closed), default: nullableText(w?.default), options: list(w?.options).map((x) => ({ month: text(x?.month), due: text(x?.due), running: Boolean(x?.running), in_time: Boolean(x?.in_time) })), deadline: text(w?.deadline), lapsed: Boolean(w?.lapsed) };
}
export function toDuplicateCheck(w: W): DuplicateCheck {
  return { duplicate: w?.duplicate ? toPurchaseRef(w.duplicate) : null, same_spelling: Boolean(w?.same_spelling), unchecked: Boolean(w?.unchecked) || !w || !Object.prototype.hasOwnProperty.call(w, 'duplicate') };
}
export function toUsualRate(w: W): UsualRate {
  return { rate: nullableText(w?.rate), from: w?.from === 'them' || w?.from === 'anyone' ? w.from : null, last: w?.last ? { rate: text(w.last.rate), invoice_date: text(w.last.invoice_date), invoice_number: text(w.last.invoice_number) } : null };
}
function toSupplierFigures(w: W): SupplierFigures {
  return { bills: whole(w?.bills), total: money(w?.total), tax: money(w?.tax), credit: money(w?.credit), last: w?.last ? { id: whole(w.last.id), invoice_date: text(w.last.invoice_date) } : null };
}
export function toSupplierPage(w: W): SupplierPage {
  const results = list(w?.results).map((x) => ({ ...toSupplierRef(x), figures: toSupplierFigures(x?.figures) }));
  return { count: w?.count == null ? results.length : whole(w.count), next: nullableText(w?.next), previous: nullableText(w?.previous), results,
    summary: { suppliers: whole(w?.summary?.suppliers), bills: whole(w?.summary?.bills), total: money(w?.summary?.total), tax: money(w?.summary?.tax) } };
}
export function toSupplierDetail(w: W): SupplierDetail {
  return { supplier: toSupplierRecord(w?.supplier), figures: toSupplierFigures(w?.figures),
    rates: list(w?.rates).map((x) => ({ product_name: text(x?.product_name), unit: text(x?.unit), quantity: text(x?.quantity), value: money(x?.value), bills: whole(x?.bills), average: text(x?.average), low: text(x?.low), high: text(x?.high) })), bills: list(w?.bills).map(toPurchaseRow) };
}
export function toSupplierMemory(w: W): SupplierMemory {
  return { bills: whole(w?.bills), last: w?.last ? { id: whole(w.last.id), invoice_number: text(w.last.invoice_number), invoice_date: text(w.last.invoice_date) } : null,
    line: w?.line ? { product_name: text(w.line.product_name), hsn_code: text(w.line.hsn_code), unit: text(w.line.unit), gst_percent: text(w.line.gst_percent) } : null, next_number: nullableText(w?.next_number) };
}
export function toPurchaseRead(w: W): PurchaseRead {
  const confidence = (key: string) => w?.confidence?.[key] === 'high' ? 'high' as const : 'medium' as const;
  return { source: w?.source === 'pdf' || w?.source === 'e-invoice' ? w.source : 'photo', irn: text(w?.irn),
    supplier: { name: text(w?.supplier?.name), gst_number: text(w?.supplier?.gst_number), id: w?.supplier?.id == null ? null : whole(w.supplier.id), state_code: text(w?.supplier?.state_code), city: text(w?.supplier?.city) },
    buyer: { name: text(w?.buyer?.name), gst_number: text(w?.buyer?.gst_number), business: w?.buyer?.business == null ? null : whole(w.buyer.business) }, seller_business: w?.seller_business == null ? null : whole(w.seller_business),
    invoice_number: text(w?.invoice_number), invoice_date: text(w?.invoice_date), payment_mode: payment(w?.payment_mode),
    lines: list(w?.lines).map((x) => ({ product_name: text(x?.product_name), hsn_code: text(x?.hsn_code), gst_percent: nullableText(x?.gst_percent), printed_rate: text(x?.printed_rate), quantity: nullableText(x?.quantity), unit: text(x?.unit) || 'gms', rate: nullableText(x?.rate), taxable: money(x?.taxable), amount_only: Boolean(x?.amount_only) })),
    printed_total: w?.printed_total == null ? null : money(w.printed_total), lines_total: money(w?.lines_total), confidence: { supplier: confidence('supplier'), gstin: confidence('gstin'), bill_no: confidence('bill_no'), date: confidence('date'), amounts: confidence('amounts') }, notes: list(w?.notes).map(text),
  };
}
