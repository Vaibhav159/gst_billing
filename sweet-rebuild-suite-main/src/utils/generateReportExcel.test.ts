/**
 * The report mixes two bases on purpose: component columns carry paise
 * precision, Total Invoice Value carries the whole-rupee figure printed on
 * the invoice. The Round Off column is the bridge — these tests pin that
 * every table cross-foots: Taxable + CGST + SGST + IGST + RoundOff = Total.
 */
import { describe, expect, it } from "vitest";
import type { Invoice, Business, Customer } from "./mockData";
import { buildReconWorkbook, type ReconPayload } from "./generateReconExcel";
import * as XLSX from "xlsx-js-style";
import { generateReportExcel } from "./generateReportExcel";

// Mirrors the adapter (useDataStore mapDjangoInvoice): total is the
// whole-rupee rounded figure, roundedOff the signed difference.
function inv(id: string, taxable: number, cgst: number, sgst: number, igst: number) {
  const raw = taxable + cgst + sgst + igst;
  const total = Math.round(raw);
  const roundedOff = +(total - raw).toFixed(2);
  return {
    id, invoiceNumber: id, invoice_date: "2025-07-10",
    customerId: "c1", customerName: "Test Party",
    businessId: "b1", businessName: "TEST FIRM",
    type: "OUTWARD", isIGST: igst > 0,
    items: [{ productName: "Silver", hsn: "711311", gstRate: 3, qty: 1, rate: taxable, amount: raw, cgst, sgst, igst }],
    subtotal: taxable, totalCGST: cgst, totalSGST: sgst, totalIGST: igst,
    totalTax: cgst + sgst + igst, total,
    roundedOff: roundedOff !== 0 ? roundedOff : undefined,
    financialYear: "2025-26", createdAt: "", updatedAt: "", lineItemCount: 1,
  } as any;
}

const businesses = [{ id: "b1", name: "TEST FIRM", gst_number: "08AAGPL3375F1ZO" }] as any;
const customers = [{ id: "c1", name: "Test Party", gst_number: "" }] as any;

// 1000.37 rounds down (-0.37), 500.75 rounds up (+0.25): mixed signs like real data.
const INVOICES = [
  inv("1", 971.23, 14.57, 14.57, 0), // raw 1000.37 → total 1000, ro -0.37
  inv("2", 486.17, 7.29, 7.29, 0),   // raw 500.75 → total 501, ro +0.25
];

// jsdom's Blob has no arrayBuffer(); FileReader works in both jsdom and browsers.
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as ArrayBuffer);
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(blob);
  });
}

async function sheetOf(name: string) {
  const blob = generateReportExcel({ invoices: INVOICES, businesses, customers });
  const wb = XLSX.read(await blobToArrayBuffer(blob), { type: "array" });
  const ws = wb.Sheets[name];
  expect(ws).toBeTruthy();
  return ws;
}

function num(ws: any, r: number, c: number) {
  const cell = ws[XLSX.utils.encode_cell({ r, c })];
  return cell && typeof cell.v === "number" ? cell.v : 0;
}

function findRow(ws: any, col: number, value: string) {
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let r = 0; r <= range.e.r; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: col })];
    if (cell && cell.v === value) return r;
  }
  return -1;
}

describe("generateReportExcel round-off reconciliation", () => {
  it("invoice rows carry Round Off (col 14) and rounded Total (col 15) that cross-foot", async () => {
    const ws = await sheetOf("TEST FIRM");
    const hdr = findRow(ws, 14, "Round Off (₹)");
    expect(hdr).toBeGreaterThan(-1);
    for (let i = 0; i < INVOICES.length; i++) {
      const r = hdr + 1 + i;
      const sum = num(ws, r, 10) + num(ws, r, 11) + num(ws, r, 12) + num(ws, r, 13) + num(ws, r, 14);
      expect(sum).toBeCloseTo(num(ws, r, 15), 2);
      expect(Number.isInteger(num(ws, r, 15))).toBe(true); // whole-rupee invoice total
    }
  });

  it("section TOTAL row cross-foots and shows the accumulated round-off", async () => {
    const ws = await sheetOf("TEST FIRM");
    const r = findRow(ws, 0, "TOTAL");
    expect(num(ws, r, 14)).toBeCloseTo(-0.12, 2); // -0.37 + 0.25
    expect(num(ws, r, 15)).toBe(1501);
    const sum = num(ws, r, 10) + num(ws, r, 11) + num(ws, r, 12) + num(ws, r, 14);
    expect(sum).toBeCloseTo(num(ws, r, 15), 2);
  });

  it("period summary rows cross-foot", async () => {
    const ws = await sheetOf("TEST FIRM");
    const r = findRow(ws, 0, "Outward Supply (2 invoices)");
    expect(r).toBeGreaterThan(-1);
    const sum = num(ws, r, 10) + num(ws, r, 11) + num(ws, r, 12) + num(ws, r, 13) + num(ws, r, 14);
    expect(sum).toBeCloseTo(num(ws, r, 15), 2);
    expect(num(ws, r, 14)).toBeCloseTo(-0.12, 2);
  });

  it("all-firms Summary sheet carries Round Off in both halves and cross-foots", async () => {
    const ws = await sheetOf("Summary");
    const r = findRow(ws, 0, "GRAND TOTAL");
    // Outward half: cols 2..6 components+roundoff, col 7 total.
    const sum = num(ws, r, 2) + num(ws, r, 3) + num(ws, r, 4) + num(ws, r, 5) + num(ws, r, 6);
    expect(sum).toBeCloseTo(num(ws, r, 7), 2);
    expect(num(ws, r, 6)).toBeCloseTo(-0.12, 2);
    // Net Total sits in the last column (15) and equals outward total here.
    expect(num(ws, r, 15)).toBe(1501);
  });

  it("a data anomaly beyond round-off stays visible instead of being absorbed", async () => {
    // Invoice whose stored total was set independently of its line (₹3.40 gap):
    // roundedOff must NOT absorb it — the row deliberately fails to cross-foot.
    const anomaly = { ...inv("9", 48540.39, 728.11, 728.10, 0), total: 50000, roundedOff: undefined } as any;
    const blob = generateReportExcel({ invoices: [anomaly], businesses, customers });
    const wb = XLSX.read(await blobToArrayBuffer(blob), { type: "array" });
    const ws = wb.Sheets["TEST FIRM"];
    const r = findRow(ws, 0, "TOTAL");
    const sum = num(ws, r, 10) + num(ws, r, 11) + num(ws, r, 12) + num(ws, r, 14);
    expect(Math.abs(num(ws, r, 15) - sum)).toBeGreaterThan(1); // gap stays visible
  });
});


// ── cash/bank toggle coverage (appended) ──
/** Minimal invoice satisfying the generator's reads. */
function tInv(over: Partial<Invoice> = {}): Invoice {
  return {
    id: "1", invoiceNumber: "T-1", invoice_date: "2026-07-10",
    customerId: "1", customerName: "TEST PARTY", businessId: "1",
    businessName: "TEST JEWELLERS", type: "OUTWARD", isIGST: false,
    items: [{ productId: "1", productName: "Silver", hsn: "711311", gstRate: 3, qty: 10, rate: 100, unit: "gms", amount: 1030, cgst: 15, sgst: 15, igst: 0 }],
    subtotal: 1000, totalCGST: 15, totalSGST: 15, totalIGST: 0, totalTax: 30,
    total: 1030, paymentMode: "cash", financialYear: "2026-27",
    createdAt: "", updatedAt: "", lineItemCount: 1,
    ...over,
  } as unknown as Invoice;
}

const tBusinesses = [{ id: "1", name: "TEST JEWELLERS", gst_number: "08X", state_name: "RAJASTHAN" }] as unknown as Business[];
const tCustomers = [{ id: "1", name: "TEST PARTY" }] as unknown as Customer[];

function tBlobToArrayBuffer(b: Blob): Promise<ArrayBuffer> {
  // jsdom's Blob has no .arrayBuffer(); FileReader works everywhere.
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as ArrayBuffer);
    fr.onerror = () => rej(fr.error);
    fr.readAsArrayBuffer(b);
  });
}

async function tSheetTexts(blob: Blob): Promise<string[]> {
  const wb = XLSX.read(await tBlobToArrayBuffer(blob), { type: "array" });
  const out: string[] = [];
  wb.SheetNames.forEach((n) => {
    const ws = wb.Sheets[n];
    Object.keys(ws).forEach((k) => {
      if (k.startsWith("!")) return;
      const v = (ws as any)[k]?.v;
      if (v !== undefined && v !== "") out.push(String(v));
    });
  });
  return out;
}

describe("generateReportExcel cash/bank toggle", () => {
  it("plain by default: no Payment column, no split block", async () => {
    const blob = generateReportExcel({ invoices: [tInv()], businesses: tBusinesses, customers: tCustomers });
    const texts = await tSheetTexts(blob);
    expect(texts).not.toContain("Payment");
    expect(texts.join("|")).not.toContain("PAYMENT SPLIT");
    expect(texts.join("|")).toContain("Total Invoice Value");
  });

  it("toggle on: Payment column + per-mode totals block", async () => {
    const blob = generateReportExcel({
      invoices: [tInv(), tInv({ id: "2", invoiceNumber: "T-2", paymentMode: "bank" } as any)],
      businesses: tBusinesses, customers: tCustomers, includePayment: true,
    } as any);
    const texts = await tSheetTexts(blob);
    expect(texts).toContain("Payment");
    expect(texts.join("|")).toContain("PAYMENT SPLIT");
    expect(texts).toContain("Cash");
    expect(texts).toContain("Bank");
    expect(texts).toContain("SHARE %");
  });

  it("toggle state does not leak between calls", async () => {
    generateReportExcel({ invoices: [tInv()], businesses: tBusinesses, customers: tCustomers, includePayment: true } as any);
    const plain = generateReportExcel({ invoices: [tInv()], businesses: tBusinesses, customers: tCustomers });
    const texts = await tSheetTexts(plain);
    expect(texts).not.toContain("Payment");
  });
});

describe("buildReconWorkbook", () => {
  const payload: ReconPayload = {
    fy: "2025-26",
    quarters: [1, 2, 3, 4].map((q) => ({
      label: `Q${q}`,
      gstr3b: { taxable: "100.00", cgst: "1.50", sgst: "1.50", igst: "0.00" },
      b2b: { taxable: "40.00", cgst: "0.60", sgst: "0.60", igst: "0.00" },
      b2c: { taxable: "60.00", cgst: "0.90", sgst: "0.90", igst: "0.00" },
    })),
    total: {
      gstr3b: { taxable: "400.00", cgst: "6.00", sgst: "6.00", igst: "0.00" },
      b2b: { taxable: "160.00", cgst: "2.40", sgst: "2.40", igst: "0.00" },
      b2c: { taxable: "240.00", cgst: "3.60", sgst: "3.60", igst: "0.00" },
    },
    payment_split: [{ mode: "bank", gross: "412.00", taxable: "400.00", cgst: "6.00", sgst: "6.00", igst: "0.00", share_pct: "100.0000" }],
    checks: [{ id: "x", label: "B2B + B2C = 3B", period: "FY", expected: "400.00", actual: "400.00", difference: "0.00", status: "pass" }],
  };

  it("renders the three CA blocks and checks; payment section obeys the toggle", () => {
    const withSplit = buildReconWorkbook(payload, true);
    const ws = withSplit.Sheets[withSplit.SheetNames[0]];
    const texts = Object.keys(ws).filter((k) => !k.startsWith("!")).map((k) => String((ws as any)[k]?.v ?? ""));
    expect(texts.join("|")).toContain("GSTR-1 B2B");
    expect(texts.join("|")).toContain("PAYMENT SPLIT");
    expect(texts.join("|")).toContain("TIE-OUT CHECKS");

    const plain = buildReconWorkbook(payload, false);
    const ws2 = plain.Sheets[plain.SheetNames[0]];
    const texts2 = Object.keys(ws2).filter((k) => !k.startsWith("!")).map((k) => String((ws2 as any)[k]?.v ?? ""));
    expect(texts2.join("|")).not.toContain("PAYMENT SPLIT");
    expect(texts2.join("|")).toContain("TIE-OUT CHECKS");
  });
});
