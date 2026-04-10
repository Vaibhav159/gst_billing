// ============================================================
// GST BILLING APP — CENTRAL MOCK DATA STORE
// ============================================================

export type InvoiceType = "OUTWARD" | "INWARD";

export interface Business {
  id: string;
  name: string;
  gst: string;
  pan: string;
  state: string;
  address: string;
  mobile: string;
  email: string;
  bankName: string;
  accountNo: string;
  ifsc: string;
  branch: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  gst: string;
  pan: string;
  mobile: string;
  email: string;
  state: string;
  address: string;
  businesses: string[];
  tags: string[];
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  hsn: string;
  gstRate: number;
  description: string;
  createdAt: string;
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

export interface Invoice {
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
}


// ── PRODUCTS ──────────────────────────────────────────────
export const products: Product[] = [
  {
    id: "p1",
    name: "Diamond Ring",
    hsn: "71131910",
    gstRate: 3,
    description: "Diamond-studded gold ring, 18K gold with certified diamonds",
    createdAt: "2023-04-05",
  },
  {
    id: "p2",
    name: "Gold Bar 24K",
    hsn: "71081300",
    gstRate: 3,
    description: "24 Karat gold bar, 10 grams, BIS hallmarked",
    createdAt: "2023-04-05",
  },
  {
    id: "p3",
    name: "Gold Chain 22K",
    hsn: "71131910",
    gstRate: 3,
    description: "22 Karat gold chain, 10 grams, BIS hallmarked",
    createdAt: "2023-04-10",
  },
  {
    id: "p4",
    name: "Silver Anklet",
    hsn: "71131990",
    gstRate: 3,
    description: "Pure silver anklet, traditional design, 30 grams",
    createdAt: "2023-04-12",
  },
  {
    id: "p5",
    name: "Pearl Necklace",
    hsn: "71162000",
    gstRate: 3,
    description: "Freshwater pearl necklace with gold clasp",
    createdAt: "2023-05-01",
  },
  {
    id: "p6",
    name: "Ruby Earrings",
    hsn: "71131910",
    gstRate: 3,
    description: "18K gold earrings with certified ruby stones",
    createdAt: "2023-05-15",
  },
  {
    id: "p7",
    name: "Platinum Ring",
    hsn: "71131920",
    gstRate: 3,
    description: "950 platinum solitaire ring",
    createdAt: "2023-06-01",
  },
  {
    id: "p8",
    name: "Emerald Bracelet",
    hsn: "71131910",
    gstRate: 3,
    description: "18K gold bracelet with Colombian emerald stones",
    createdAt: "2023-06-20",
  },
];

// ── INVOICES ──────────────────────────────────────────────
export const invoices: Invoice[] = [
  {
    id: "inv1",
    invoiceNumber: "SGJ/2024-25/101",
    invoice_date: "2024-04-05",
    customerId: "c1",
    customerName: "Rajesh Kumar",
    businessId: "b1",
    businessName: "Sharma Gold & Jewellers",
    type: "OUTWARD",
    isIGST: false,
    items: [
      { productId: "p1", productName: "Diamond Ring", hsn: "71131910", gstRate: 3, qty: 2, rate: 85000, amount: 170000, cgst: 2550, sgst: 2550, igst: 0 },
      { productId: "p3", productName: "Gold Chain 22K", hsn: "71131910", gstRate: 3, qty: 1, rate: 45000, amount: 45000, cgst: 675, sgst: 675, igst: 0 },
    ],
    subtotal: 215000,
    totalCGST: 3225,
    totalSGST: 3225,
    totalIGST: 0,
    totalTax: 6450,
    total: 221450,
    financialYear: "2024-25",
    createdAt: "2024-04-05T10:30:00",
    updatedAt: "2024-04-05T10:30:00",
  },
  {
    id: "inv2",
    invoiceNumber: "SGJ/2024-25/102",
    invoice_date: "2024-04-12",
    customerId: "c2",
    customerName: "Amit Joshi",
    businessId: "b1",
    businessName: "Sharma Gold & Jewellers",
    type: "OUTWARD",
    isIGST: false,
    items: [
      { productId: "p2", productName: "Gold Bar 24K", hsn: "71081300", gstRate: 3, qty: 5, rate: 62000, amount: 310000, cgst: 4650, sgst: 4650, igst: 0 },
    ],
    subtotal: 310000,
    totalCGST: 4650,
    totalSGST: 4650,
    totalIGST: 0,
    totalTax: 9300,
    total: 319300,
    financialYear: "2024-25",
    createdAt: "2024-04-12T14:00:00",
    updatedAt: "2024-04-12T14:00:00",
  },
  {
    id: "inv3",
    invoiceNumber: "PGO/2024-25/101",
    invoice_date: "2024-04-18",
    customerId: "c3",
    customerName: "Priya Mehta",
    businessId: "b2",
    businessName: "Patel Gems & Ornaments",
    type: "OUTWARD",
    isIGST: true,
    items: [
      { productId: "p5", productName: "Pearl Necklace", hsn: "71162000", gstRate: 3, qty: 1, rate: 28000, amount: 28000, cgst: 0, sgst: 0, igst: 840 },
      { productId: "p6", productName: "Ruby Earrings", hsn: "71131910", gstRate: 3, qty: 2, rate: 35000, amount: 70000, cgst: 0, sgst: 0, igst: 2100 },
    ],
    subtotal: 98000,
    totalCGST: 0,
    totalSGST: 0,
    totalIGST: 2940,
    totalTax: 2940,
    total: 100940,
    financialYear: "2024-25",
    createdAt: "2024-04-18T11:00:00",
    updatedAt: "2024-04-18T11:00:00",
  },
  {
    id: "inv4",
    invoiceNumber: "SGJ/2024-25/103",
    invoice_date: "2024-05-02",
    customerId: "c4",
    customerName: "Suresh Patel",
    businessId: "b1",
    businessName: "Sharma Gold & Jewellers",
    type: "INWARD",
    isIGST: true,
    items: [
      { productId: "p7", productName: "Platinum Ring", hsn: "71131920", gstRate: 3, qty: 3, rate: 120000, amount: 360000, cgst: 0, sgst: 0, igst: 10800 },
    ],
    subtotal: 360000,
    totalCGST: 0,
    totalSGST: 0,
    totalIGST: 10800,
    totalTax: 10800,
    total: 370800,
    financialYear: "2024-25",
    createdAt: "2024-05-02T09:00:00",
    updatedAt: "2024-05-02T09:00:00",
  },
  {
    id: "inv5",
    invoiceNumber: "PGO/2024-25/102",
    invoice_date: "2024-05-15",
    customerId: "c5",
    customerName: "Neha Sharma",
    businessId: "b2",
    businessName: "Patel Gems & Ornaments",
    type: "OUTWARD",
    isIGST: true,
    items: [
      { productId: "p8", productName: "Emerald Bracelet", hsn: "71131910", gstRate: 3, qty: 1, rate: 95000, amount: 95000, cgst: 0, sgst: 0, igst: 2850 },
    ],
    subtotal: 95000,
    totalCGST: 0,
    totalSGST: 0,
    totalIGST: 2850,
    totalTax: 2850,
    total: 97850,
    financialYear: "2024-25",
    createdAt: "2024-05-15T15:00:00",
    updatedAt: "2024-05-15T15:00:00",
  },
  {
    id: "inv6",
    invoiceNumber: "SGJ/2024-25/104",
    invoice_date: "2024-06-08",
    customerId: "c6",
    customerName: "Vikram Singh",
    businessId: "b1",
    businessName: "Sharma Gold & Jewellers",
    type: "OUTWARD",
    isIGST: true,
    items: [
      { productId: "p2", productName: "Gold Bar 24K", hsn: "71081300", gstRate: 3, qty: 8, rate: 62000, amount: 496000, cgst: 0, sgst: 0, igst: 14880 },
    ],
    subtotal: 496000,
    totalCGST: 0,
    totalSGST: 0,
    totalIGST: 14880,
    totalTax: 14880,
    total: 510880,
    financialYear: "2024-25",
    createdAt: "2024-06-08T10:00:00",
    updatedAt: "2024-06-08T10:00:00",
  },
  {
    id: "inv7",
    invoiceNumber: "PGO/2024-25/103",
    invoice_date: "2024-06-20",
    customerId: "c7",
    customerName: "Kavita Reddy",
    businessId: "b2",
    businessName: "Patel Gems & Ornaments",
    type: "OUTWARD",
    isIGST: true,
    items: [
      { productId: "p1", productName: "Diamond Ring", hsn: "71131910", gstRate: 3, qty: 1, rate: 150000, amount: 150000, cgst: 0, sgst: 0, igst: 4500 },
      { productId: "p4", productName: "Silver Anklet", hsn: "71131990", gstRate: 3, qty: 2, rate: 3500, amount: 7000, cgst: 0, sgst: 0, igst: 210 },
    ],
    subtotal: 157000,
    totalCGST: 0,
    totalSGST: 0,
    totalIGST: 4710,
    totalTax: 4710,
    total: 161710,
    financialYear: "2024-25",
    
    createdAt: "2024-06-20T13:30:00",
    updatedAt: "2024-06-20T13:30:00",
  },
  {
    id: "inv8",
    invoiceNumber: "SGJ/2024-25/105",
    invoice_date: "2024-07-10",
    customerId: "c8",
    customerName: "Mohan Das",
    businessId: "b1",
    businessName: "Sharma Gold & Jewellers",
    type: "INWARD",
    isIGST: true,
    items: [
      { productId: "p3", productName: "Gold Chain 22K", hsn: "71131910", gstRate: 3, qty: 10, rate: 45000, amount: 450000, cgst: 0, sgst: 0, igst: 13500 },
    ],
    subtotal: 450000,
    totalCGST: 0,
    totalSGST: 0,
    totalIGST: 13500,
    totalTax: 13500,
    total: 463500,
    financialYear: "2024-25",
    createdAt: "2024-07-10T11:00:00",
    updatedAt: "2024-07-10T11:00:00",
  },
  {
    id: "inv9",
    invoiceNumber: "PGO/2024-25/104",
    invoice_date: "2024-07-25",
    customerId: "c1",
    customerName: "Rajesh Kumar",
    businessId: "b2",
    businessName: "Patel Gems & Ornaments",
    type: "OUTWARD",
    isIGST: false,
    items: [
      { productId: "p7", productName: "Platinum Ring", hsn: "71131920", gstRate: 3, qty: 2, rate: 120000, amount: 240000, cgst: 3600, sgst: 3600, igst: 0 },
    ],
    subtotal: 240000,
    totalCGST: 3600,
    totalSGST: 3600,
    totalIGST: 0,
    totalTax: 7200,
    total: 247200,
    financialYear: "2024-25",
    createdAt: "2024-07-25T14:00:00",
    updatedAt: "2024-07-25T14:00:00",
  },
  {
    id: "inv10",
    invoiceNumber: "SGJ/2024-25/106",
    invoice_date: "2024-08-14",
    customerId: "c2",
    customerName: "Amit Joshi",
    businessId: "b1",
    businessName: "Sharma Gold & Jewellers",
    type: "OUTWARD",
    isIGST: false,
    items: [
      { productId: "p1", productName: "Diamond Ring", hsn: "71131910", gstRate: 3, qty: 3, rate: 85000, amount: 255000, cgst: 3825, sgst: 3825, igst: 0 },
    ],
    subtotal: 255000,
    totalCGST: 3825,
    totalSGST: 3825,
    totalIGST: 0,
    totalTax: 7650,
    total: 262650,
    financialYear: "2024-25",
    
    createdAt: "2024-08-14T10:00:00",
    updatedAt: "2024-08-14T10:00:00",
  },
  {
    id: "inv11",
    invoiceNumber: "PGO/2024-25/105",
    invoice_date: "2024-09-05",
    customerId: "c4",
    customerName: "Suresh Patel",
    businessId: "b2",
    businessName: "Patel Gems & Ornaments",
    type: "OUTWARD",
    isIGST: false,
    items: [
      { productId: "p8", productName: "Emerald Bracelet", hsn: "71131910", gstRate: 3, qty: 2, rate: 95000, amount: 190000, cgst: 2850, sgst: 2850, igst: 0 },
      { productId: "p6", productName: "Ruby Earrings", hsn: "71131910", gstRate: 3, qty: 3, rate: 35000, amount: 105000, cgst: 1575, sgst: 1575, igst: 0 },
    ],
    subtotal: 295000,
    totalCGST: 4425,
    totalSGST: 4425,
    totalIGST: 0,
    totalTax: 8850,
    total: 303850,
    financialYear: "2024-25",
    
    createdAt: "2024-09-05T09:30:00",
    updatedAt: "2024-09-05T09:30:00",
  },
  {
    id: "inv12",
    invoiceNumber: "SGJ/2024-25/107",
    invoice_date: "2024-09-20",
    customerId: "c8",
    customerName: "Mohan Das",
    businessId: "b1",
    businessName: "Sharma Gold & Jewellers",
    type: "OUTWARD",
    isIGST: false,
    items: [
      { productId: "p2", productName: "Gold Bar 24K", hsn: "71081300", gstRate: 3, qty: 3, rate: 62000, amount: 186000, cgst: 2790, sgst: 2790, igst: 0 },
      { productId: "p3", productName: "Gold Chain 22K", hsn: "71131910", gstRate: 3, qty: 2, rate: 45000, amount: 90000, cgst: 1350, sgst: 1350, igst: 0 },
    ],
    subtotal: 276000,
    totalCGST: 4140,
    totalSGST: 4140,
    totalIGST: 0,
    totalTax: 8280,
    total: 284280,
    financialYear: "2024-25",
    
    createdAt: "2024-09-20T16:00:00",
    updatedAt: "2024-09-20T16:00:00",
  },
];

// ── AUDIT LOG ──────────────────────────────────────────────
export type AuditAction = "created" | "updated" | "deleted" | "printed" | "exported" | "duplicated";
export type AuditEntity = "invoice" | "customer" | "product" | "business" | "settings";

export interface AuditLogEntry {
  id: string;
  action: AuditAction;
  entity: AuditEntity;
  entityId: string;
  entityName: string;
  user: string;
  details?: string;
  timestamp: string;
}

export const auditLog: AuditLogEntry[] = [
  { id: "al1", action: "created", entity: "invoice", entityId: "inv12", entityName: "SGJ/2024-25/107", user: "Admin", details: "Invoice for Mohan Das — ₹2,84,280", timestamp: "2024-09-20T16:00:00" },
  { id: "al2", action: "created", entity: "invoice", entityId: "inv11", entityName: "PGO/2024-25/105", user: "Admin", details: "Invoice for Suresh Patel — ₹3,03,850", timestamp: "2024-09-05T09:30:00" },
  { id: "al3", action: "updated", entity: "customer", entityId: "c3", entityName: "Priya Mehta", user: "Admin", details: "Updated address and GST number", timestamp: "2024-09-01T14:20:00" },
  { id: "al4", action: "created", entity: "invoice", entityId: "inv10", entityName: "SGJ/2024-25/106", user: "Admin", details: "Invoice for Amit Joshi — ₹2,62,650", timestamp: "2024-08-14T10:00:00" },
  { id: "al5", action: "created", entity: "product", entityId: "p8", entityName: "Emerald Bracelet", user: "Admin", details: "HSN: 71131910, GST: 3%", timestamp: "2024-08-10T11:00:00" },
  { id: "al6", action: "printed", entity: "invoice", entityId: "inv9", entityName: "PGO/2024-25/104", user: "Admin", details: "PDF generated and printed", timestamp: "2024-07-26T09:15:00" },
  { id: "al7", action: "created", entity: "invoice", entityId: "inv9", entityName: "PGO/2024-25/104", user: "Admin", details: "Invoice for Rajesh Kumar — ₹2,47,200", timestamp: "2024-07-25T14:00:00" },
  { id: "al8", action: "updated", entity: "business", entityId: "b1", entityName: "Sharma Gold & Jewellers", user: "Admin", details: "Updated bank account details", timestamp: "2024-07-20T10:30:00" },
  { id: "al9", action: "deleted", entity: "product", entityId: "p-old", entityName: "Silver Bangle (Old)", user: "Admin", details: "Discontinued product removed", timestamp: "2024-07-15T16:45:00" },
  { id: "al10", action: "created", entity: "customer", entityId: "c8", entityName: "Mohan Das", user: "Admin", details: "New VIP wholesale customer", timestamp: "2024-07-10T08:00:00" },
  { id: "al11", action: "exported", entity: "invoice", entityId: "", entityName: "Bulk Export", user: "Admin", details: "12 invoices exported to CSV", timestamp: "2024-07-05T15:30:00" },
  { id: "al12", action: "duplicated", entity: "invoice", entityId: "inv7", entityName: "PGO/2024-25/103", user: "Admin", details: "Duplicated as new draft invoice", timestamp: "2024-06-22T11:00:00" },
  { id: "al13", action: "created", entity: "invoice", entityId: "inv7", entityName: "PGO/2024-25/103", user: "Admin", details: "Invoice for Kavita Reddy — ₹1,61,710", timestamp: "2024-06-20T13:30:00" },
  { id: "al14", action: "updated", entity: "settings", entityId: "settings", entityName: "App Settings", user: "Admin", details: "Changed default GST rate to 3%", timestamp: "2024-06-15T09:00:00" },
  { id: "al15", action: "created", entity: "customer", entityId: "c7", entityName: "Kavita Reddy", user: "Admin", details: "Retail customer from Telangana", timestamp: "2024-06-10T10:00:00" },
];

// ── FINANCIAL YEARS (auto-generated from current date) ──
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

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function getOutwardInvoices(fy?: string) {
  return invoices.filter(
    (inv) => inv.type === "OUTWARD" && (!fy || inv.financialYear === fy)
  );
}

export function getInwardInvoices(fy?: string) {
  return invoices.filter(
    (inv) => inv.type === "INWARD" && (!fy || inv.financialYear === fy)
  );
}

export function getTotalOutward(fy?: string): number {
  return getOutwardInvoices(fy).reduce((sum, inv) => sum + inv.total, 0);
}

export function getTotalInward(fy?: string): number {
  return getInwardInvoices(fy).reduce((sum, inv) => sum + inv.total, 0);
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
