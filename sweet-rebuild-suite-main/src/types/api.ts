/**
 * API response types for Django REST Framework backend.
 * Replaces `any` types throughout the codebase.
 */

// ── Paginated Response ──
export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// ── Django API Models ──
export interface DjangoInvoice {
  id: number;
  invoice_number: string;
  invoice_date: string;
  customer: number;
  customer_name?: string;
  business: number;
  business_name?: string;
  type_of_invoice: string;
  total_amount: string;
  line_items?: DjangoLineItem[];
  line_item_count?: number;
  total_tax?: string;
  total_cgst_tax?: string;
  total_sgst_tax?: string;
  total_igst_tax?: string;
  eway_bill_number?: string;
  transporter_name?: string;
  vehicle_number?: string;
  transport_mode?: string;
  distance_km?: number;
  created_at?: string;
  updated_at?: string;
}

export interface DjangoLineItem {
  id: number;
  invoice: number;
  product?: number;
  product_name: string;
  item_name?: string;
  hsn_code: string;
  gst_tax_rate: string;
  quantity: string;
  rate: string;
  amount: string;
  cgst: string;
  sgst: string;
  igst: string;
  unit?: string;
}

export interface DjangoBusiness {
  id: number;
  name: string;
  gst_number: string;
  pan_number?: string;
  mobile_number: string;
  email?: string;
  address?: string;
  state_name?: string;
  bank_name?: string;
  bank_account_number?: string;
  bank_ifsc_code?: string;
  bank_branch_name?: string;
  invoice_prefix?: string;
  signature_image?: string;
  primary_color_theme?: string;
  total_revenue?: string;
  total_purchases?: string;
  customer_count?: number;
  invoice_count?: number;
}

export interface DjangoCustomer {
  id: number;
  name: string;
  gst_number?: string;
  pan_number?: string;
  mobile_number?: string;
  email?: string;
  address?: string;
  state_name?: string;
  businesses?: number[];
  total_revenue?: string;
  invoice_count?: number;
}

export interface DjangoProduct {
  id: number;
  name: string;
  hsn_code: string;
  gst_tax_rate: string;
  description?: string;
}

// ── Dashboard Stats ──
export interface DashboardStatsResponse {
  totals: {
    outward: number;
    inward: number;
    net: number;
    tax: number;
    inward_tax: number;
    count: number;
  };
  monthly: Array<{
    month: number;
    year: number;
    outward_total: number;
    inward_total: number;
    outward_count: number;
    inward_count: number;
  }>;
  top_customers: Array<{
    customer_id: number;
    customer__name: string;
    total: number;
  }>;
  top_products: Array<{
    product_name: string;
    total: number;
    count: number;
  }>;
  recent_invoices: DjangoInvoice[];
  tax_distribution?: {
    cgst: number;
    sgst: number;
    igst: number;
  };
}

// ── GST Summary ──
export interface GSTSummaryResponse {
  rate_slabs: {
    outward: RateSlabRow[];
    inward: RateSlabRow[];
  };
  hsn_summary: HSNRow[];
  gstr3b: GSTR3BData;
}

export interface RateSlabRow {
  rate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  invoice_count: number;
}

export interface HSNRow {
  hsn_code: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  qty: number;
  count: number;
}

export interface GSTR3BData {
  output_tax: { cgst: number; sgst: number; igst: number; total: number };
  input_tax_credit: { cgst: number; sgst: number; igst: number; total: number };
  net_payable: { cgst: number; sgst: number; igst: number; total: number };
}

// ── Audit Log ──
export interface DjangoAuditLog {
  id: number;
  action: string;
  entity: string;
  entity_id: number;
  entity_name: string;
  user: number | null;
  user_name: string;
  details: string;
  changes: Record<string, { old: string | null; new: string | null }> | null;
  timestamp: string;
  can_undo: boolean;
}

// ── Next Invoice Number ──
export interface NextInvoiceNumberResponse {
  next_invoice_number: string;
}

// ── Duplicate Check ──
export interface DuplicateCheckResponse {
  exists: boolean;
  message: string;
}

// ── Profile ──
export interface ProfileResponse {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  date_joined?: string;
}
