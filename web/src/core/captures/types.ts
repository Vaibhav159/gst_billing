import type { Person, PaymentMode } from '@/core/sales/types';

/** §4.1 transport DTO: decimal strings are converted with toPaise at display/form boundaries. */
export type ReadGroup = 'supplier' | 'gstin' | 'bill_no' | 'date' | 'amounts';
export type PurchaseRead = {
  source: 'photo' | 'pdf' | 'e-invoice'; irn: string;
  supplier: { name: string; gst_number: string; id: number | null; state_code: string; city: string };
  buyer: { name: string; gst_number: string; business: number | null };
  seller_business: number | null; invoice_number: string; invoice_date: string | null; payment_mode: PaymentMode;
  lines: { product_name: string; hsn_code: string; gst_percent: string | null; printed_rate: string;
    quantity: string | null; unit: string; rate: string | null; taxable: string; amount_only: boolean }[];
  printed_total: string | null; lines_total: string; confidence: Record<ReadGroup, 'high' | 'medium'>; notes: string[];
};
export type CapturePage = { page: number; kind: 'photo' | 'pdf'; url: string; preview_url: string | null; size: number };
export type Capture = {
  id: number; business: number | null; business_name: string; label: string; hint: string; note: string;
  captured_at: string; captured_by: Person; pages: CapturePage[]; pdf: boolean;
  status: 'reading' | 'ready' | 'failed' | 'filled' | 'discarded'; problem: string; read: PurchaseRead | null;
  purchase: { id: number; invoice_number: string; invoice_date: string; supplier_name: string; total_amount: string; business_name: string } | null;
  discarded: { at: string; by: Person } | null;
};
export type CaptureList = { results: Capture[]; count: number; counts: { reading: number; ready: number; failed: number; no_firm: number } };
/** X-18: narrow read-only projection; total is printed_total, pages is a count. */
export type CaptureSummary = {
  id: number; status: Capture['status']; supplier: string; number: string; total: string | null;
  problem: string; pages: number; who: Person; when: string;
};
export type CaptureSummaryList = { count: number; next: string | null; previous: string | null; results: CaptureSummary[] };
export type AiReads = { month: string; used: number };
