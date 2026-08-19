// ============================================================
// GST BILLING APP — CENTRAL MOCK DATA STORE
// ============================================================

export type InvoiceType = "OUTWARD" | "INWARD";

/** Legacy camelCase demo shape. Nothing in the app receives these any more —
 *  every list comes from the API — but the fields stay optional so old seed
 *  data still type-checks. The snake_case fields below are what actually
 *  arrives; components were reading `.gst` off objects that only ever had
 *  `.gst_number`, which is why exports came out with empty columns. */
export interface Business {
  id: string;
  name: string;
  address?: string;
  email?: string | null;
  // API shape
  gst_number?: string | null;
  pan_number?: string | null;
  state_name?: string | null;
  mobile_number?: string | null;
  bank_name?: string | null;
  bank_account_number?: string | null;
  bank_ifsc_code?: string | null;
  bank_branch_name?: string | null;
  // legacy demo shape
  gst?: string;
  pan?: string;
  state?: string;
  mobile?: string;
  bankName?: string;
  accountNo?: string;
  ifsc?: string;
  branch?: string;
  createdAt?: string;
}

/** Same story as Business: snake_case is what the API sends, the camelCase
 *  fields are legacy demo data. */
export interface Customer {
  id: string;
  name: string;
  address?: string;
  email?: string | null;
  // API shape
  gst_number?: string | null;
  pan_number?: string | null;
  mobile_number?: string | null;
  state_name?: string | null;
  businesses?: string[];
  // legacy demo shape
  gst?: string;
  pan?: string;
  mobile?: string;
  state?: string;
  businessIds?: string[];
  tags?: string[];
  createdAt?: string;
}

export interface Product {
  id: string;
  name: string;
  hsn: string;
  gstRate: number;
  description: string;
  createdAt: string;
  defaultUnit?: ItemUnit;
  total_revenue?: number;
  qty_sold?: number;
  usage_count?: number;
}

export type ItemUnit = "gms" | "g" | "kg" | "pcs" | "unit" | "nos" | "mtr" | "ltr" | "ml" | "box" | "pair" | "ct" | "oz" | "tola" | "set" | "dozen";

export const itemUnits: ItemUnit[] = ["gms", "g", "kg", "pcs", "unit", "nos", "mtr", "ltr", "ml", "box", "pair", "ct", "oz", "tola", "set", "dozen"];

export const itemUnitLabels: Record<ItemUnit, string> = {
  gms: "Grams (gms)",
  g: "Grams (g)",
  kg: "Kilograms (kg)",
  pcs: "Pieces (pcs)",
  unit: "Unit",
  nos: "Numbers (nos)",
  mtr: "Meters (mtr)",
  ltr: "Litres (ltr)",
  ml: "Millilitres (ml)",
  box: "Box",
  pair: "Pair",
  ct: "Carat (ct)",
  oz: "Ounce (oz)",
  tola: "Tola",
  set: "Set",
  dozen: "Dozen",
};

export interface InvoiceItem {
  productId: string;
  productName: string;
  /** Free-text line description, printed by the Tally-format PDF. */
  description?: string;
  hsn: string;
  gstRate: number;
  qty: number;
  rate: number;
  unit?: ItemUnit;
  amount: number;
  cgst: number;
  sgst: number;
  igst: number;
}

/** Optional Tally-format header fields. The PDF renders each one only when
 *  present (`invoice.shippingName || customer.name`), so they stay optional —
 *  they were being read without ever being declared. */
export interface TallyInvoiceMeta {
  shippingName?: string;
  shippingAddress?: string;
  shippingGst?: string;
  deliveryNote?: string;
  deliveryNoteDate?: string;
  modeOfPayment?: string;
  referenceNo?: string;
  referenceDate?: string;
  buyersOrderNo?: string;
  buyersOrderDate?: string;
  dispatchDocNo?: string;
  dispatchedThrough?: string;
  destination?: string;
  termsOfDelivery?: string;
}

export interface Invoice extends TallyInvoiceMeta {
  id: string;
  invoiceNumber: string;
  invoice_date: string;
  customerId: string;
  customerName: string;
  businessId: string;
  businessName: string;
  type: InvoiceType;
  isIGST: boolean;
  items: InvoiceItem[];
  subtotal: number;
  totalCGST: number;
  totalSGST: number;
  totalIGST: number;
  totalTax: number;
  total: number;
  roundedOff?: number;
  jurisdictionCity?: string;
  financialYear: string;
  createdAt: string;
  updatedAt: string;
  lineItemCount?: number;
  // E-way bill fields
  eway_bill_number?: string;
  transporter_name?: string;
  vehicle_number?: string;
  transport_mode?: string;
  distance_km?: number;
  // Original invoice file uploaded for AI extraction — null when
  // the invoice was created manually. URL is relative to MEDIA_URL
  // ("/media/invoice_sources/YYYY/MM/filename"). Original format
  // preserved (could be JPEG, PNG, or HEIC from iPhone uploads).
  sourceFile?: string | null;
  // JPEG-rendered preview of sourceFile, for in-browser <img> display.
  // Browsers can't render HEIC inline — preview is the browser-safe
  // version. Falls back to sourceFile when null (e.g. older imports
  // before the preview generation was added).
  sourcePreview?: string | null;
}


function _generateFY() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-indexed, Apr=3
  const fyStart = m >= 3 ? y : y - 1;
  const current = `${fyStart}-${String(fyStart + 1).slice(2)}`;
  const years: string[] = [];
  for (let i = fyStart; i >= fyStart - 4; i--) {
    years.push(`${i}-${String(i + 1).slice(2)}`);
  }
  return { years, current };
}
const _fy = _generateFY();
export const financialYears = _fy.years;
export const currentFY = _fy.current;

// ── INDIAN STATES ──────────────────────────────────────
export const indianStates = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
  "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Delhi", "Jammu & Kashmir", "Ladakh", "Puducherry", "Chandigarh",
];

// ── HELPER FUNCTIONS ──────────────────────────────────
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Compact Indian-currency formatter for stat cards: ₹2.86L instead of
 * ₹2,86,252. Uses Cr / L / k thresholds matching how Indian businesses talk
 * about money. Returns "₹0" for falsy/NaN input.
 */
export function formatCompactCurrency(amount: number): string {
  const n = Number(amount) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(2)}L`;
  if (abs >= 1_000) return `${sign}₹${(abs / 1_000).toFixed(1)}k`;
  return `${sign}₹${abs.toFixed(0)}`;
}

/**
 * Chart-axis / tooltip formatter when the underlying datum is already in
 * thousands (e.g. tax-trend charts dividing by 1000 for display). Picks
 * the right Indian unit:
 *
 *   v = 6107.2  (₹61,07,200)  → "₹61.07L"
 *   v = 759.6   (₹7,59,600)   → "₹7.60L"
 *   v = 50      (₹50,000)     → "₹50.0k"
 *   v = 1.5     (₹1,500)      → "₹1.5k"
 *
 * Pass `withSymbol = false` (default true) to drop the ₹ for Y-axis ticks
 * where the legend already says ₹.
 */
export function formatChartK(v: number, withSymbol = true): string {
  const n = Number(v) || 0;
  const symbol = withSymbol ? "₹" : "";
  // 100 thousands = 1 lakh, 10000 thousands = 1 crore.
  if (n >= 10_000) return `${symbol}${(n / 100).toFixed(0)}L`;
  if (n >= 100) return `${symbol}${(n / 100).toFixed(2)}L`;
  return `${symbol}${n.toFixed(1)}k`;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function amountToWords(amount: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
    "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  if (amount === 0) return "Zero Rupees Only";

  function convert(n: number): string {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
    if (n < 1000) return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + convert(n % 100) : "");
    if (n < 100000) return convert(Math.floor(n / 1000)) + " Thousand" + (n % 1000 ? " " + convert(n % 1000) : "");
    if (n < 10000000) return convert(Math.floor(n / 100000)) + " Lakh" + (n % 100000 ? " " + convert(n % 100000) : "");
    return convert(Math.floor(n / 10000000)) + " Crore" + (n % 10000000 ? " " + convert(n % 10000000) : "");
  }

  const intPart = Math.floor(amount);
  const decPart = Math.round((amount - intPart) * 100);
  let result = convert(intPart) + " Rupees";
  if (decPart > 0) result += " and " + convert(decPart) + " Paise";
  return result + " Only";
}
