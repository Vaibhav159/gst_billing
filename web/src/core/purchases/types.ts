import type { BillRef, BinRow, Line, PaymentMode, Person, Slab } from '@/core/sales/types';

// Part 2 contract: money is integer paise after wire.ts; quantities, unit rates and GST percentages remain decimal strings.
export type SupplierRef = { id: number; name: string; gst_number: string; state_code: string; state_name: string; city: string };
export type SupplierRecord = SupplierRef & { address: string; pan: string; mobile_number: string; email: string; gstin_valid: boolean | null; prefix: string };
export type Credit = { month: string; chosen: string | null; late: boolean; eligible: boolean; lapsed: boolean; claimed: number; state: 'open' | 'filed'; filed_on: string | null; deadline: string };
export type PurchaseCheck = 'duplicate' | 'no_lines' | 'no_hsn' | 'billed_to_other';
export type PurchaseSource = 'typed' | 'capture' | 'photos' | 'excel' | '';
export type PurchaseRef = { id: number; invoice_number: string; invoice_date: string; supplier_name: string; total_amount: number; business_name: string };
export type PurchaseFirstLine = { product_name: string; quantity: string; unit: string; rate: string; amount_only: boolean };
export type PurchaseRow = {
  id: number; business: number; business_name: string; invoice_number: string; invoice_date: string; fy: string; created_at: string;
  supplier: SupplierRef; payment_mode: PaymentMode; taxable: number; cgst: number; sgst: number; igst: number; tax: number; total_amount: number;
  interstate: boolean; gst_percents: string[]; line_count: number; first_line: PurchaseFirstLine | null; weights: { unit: string; quantity: string }[];
  credit: Credit; needs_review: boolean; source: PurchaseSource; has_files: boolean; checks: PurchaseCheck[]; locked: boolean; lines?: Line[];
};
export type PurchaseFile = { id: string; kind: 'photo' | 'pdf'; name: string; url: string; preview_url: string | null; page: number; size: number };
export type PurchaseActivity = { at: string; by: string | null; action: 'created' | 'imported' | 'updated' | 'checked' | 'credit_set' | 'deleted' | 'restored' | 'exported'; details: string };
export type PurchaseDetail = Omit<PurchaseRow, 'supplier' | 'lines'> & {
  firm: { id: number; name: string; short: string; gst_number: string; state_code: string; state_name: string };
  supplier: SupplierRecord; buyer_gstin: string; buyer_ack: boolean; linked_sale: BillRef | null; lines: Line[]; slabs: Slab[]; files: PurchaseFile[];
  capture: { id: number; captured_at: string; captured_by: Person; pages: number; note: string; hint: string; pdf: boolean; irn: string } | null;
  history: { created_by: Person; activity: PurchaseActivity[] };
};
export type PurchaseBinRow = Omit<BinRow, 'customer' | 'kind'> & { type: 'purchase'; kind: 'deleted'; supplier: SupplierRef };
export type PurchaseSummary = { bills: number; taxable: number; cgst: number; sgst: number; igst: number; tax: number; total_amount: number; credit: number };
export type PurchaseFacets = {
  months: { month: string; bills: number; late_in: number; late_in_credit: number; closed: boolean }[];
  credit_months: { month: string; bills: number; credit: number }[];
  checks: { needs_review: number; duplicate: number; no_lines: number; no_hsn: number; photo: number };
  elsewhere: { fy: string; bills: number }[];
};
export type PurchasePage = { count: number; next: string | null; previous: string | null; results: PurchaseRow[]; summary: PurchaseSummary | null; facets: PurchaseFacets | null };
export type PurchaseLineInput = { product_name: string; hsn_code: string; gst_percent: string; quantity?: string; unit: string; rate?: string; note: string; amount_only?: boolean; taxable?: string };
export type PurchaseInput = {
  business: number; supplier: number; invoice_number: string; invoice_date: string; payment_mode: PaymentMode;
  itc_eligible: boolean; itc_month?: string | null; buyer_gstin: string; buyer_ack: boolean; duplicate_ok?: boolean; needs_review?: boolean;
  capture?: number | null; source?: 'typed' | 'capture'; lines: PurchaseLineInput[];
};
export type CreditMonthOption = { month: string; due: string; running: boolean; in_time: boolean };
export type CreditMonths = { bill_month: string; bill_month_closed: boolean; default: string | null; options: CreditMonthOption[]; deadline: string; lapsed: boolean };
export type DuplicateCheck = { duplicate: PurchaseRef | null; same_spelling: boolean; unchecked: boolean };
export type UsualRate = { rate: string | null; from: 'them' | 'anyone' | null; last: { rate: string; invoice_date: string; invoice_number: string } | null };
export type SupplierFigures = { bills: number; total: number; tax: number; credit: number; last: { id: number; invoice_date: string } | null };
export type SupplierRow = SupplierRef & { figures: SupplierFigures };
export type SupplierPage = { count: number; next: string | null; previous: string | null; results: SupplierRow[]; summary: { suppliers: number; bills: number; total: number; tax: number } };
export type SupplierDetail = {
  supplier: SupplierRecord; figures: SupplierFigures;
  rates: { product_name: string; unit: string; quantity: string; value: number; bills: number; average: string; low: string; high: string }[];
  bills: PurchaseRow[];
};
export type SupplierInput = { name: string; gst_number: string; state_name: string; city: string; address: string; mobile_number: string; pan_number: string; email: string };
export type SupplierMemory = { bills: number; last: { id: number; invoice_number: string; invoice_date: string } | null; line: { product_name: string; hsn_code: string; unit: string; gst_percent: string } | null; next_number: string | null };
export type ReadConfidence = 'high' | 'medium';
export type ReadGroup = 'supplier' | 'gstin' | 'bill_no' | 'date' | 'amounts';
export type PurchaseReadLine = { product_name: string; hsn_code: string; gst_percent: string | null; printed_rate: string; quantity: string | null; unit: string; rate: string | null; taxable: number; amount_only: boolean };
export type PurchaseRead = {
  source: 'photo' | 'pdf' | 'e-invoice'; irn: string;
  supplier: { name: string; gst_number: string; id: number | null; state_code: string; city: string };
  buyer: { name: string; gst_number: string; business: number | null }; seller_business: number | null;
  invoice_number: string; invoice_date: string; payment_mode: PaymentMode; lines: PurchaseReadLine[];
  printed_total: number | null; lines_total: number; confidence: Record<ReadGroup, ReadConfidence>; notes: string[];
};
// Captures and both import doors consume this same reader type.
export type Read = PurchaseRead;
