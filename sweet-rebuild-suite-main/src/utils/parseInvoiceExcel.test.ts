import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx-js-style";
import { normalizeDate, toImportReadyInvoices, parseInvoiceExcel } from "./parseInvoiceExcel";
import type { ParsedExcelResult } from "./parseInvoiceExcel";
import { generateSampleExcelBytes } from "./generateSampleExcel";

describe("normalizeDate", () => {
  it("converts DD-MM-YYYY to YYYY-MM-DD", () => {
    expect(normalizeDate("15-03-2026")).toBe("2026-03-15");
  });

  it("converts DD/MM/YYYY to YYYY-MM-DD", () => {
    expect(normalizeDate("01/12/2025")).toBe("2025-12-01");
  });

  it("returns YYYY-MM-DD as-is", () => {
    expect(normalizeDate("2026-04-10")).toBe("2026-04-10");
  });

  it("handles single-digit day and month", () => {
    expect(normalizeDate("5-3-2026")).toBe("2026-03-05");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeDate("")).toBe("");
  });
});

describe("toImportReadyInvoices — Product master lookup", () => {
  function makeParsed(rows: Array<Partial<{ commodity: string; qty: number; rate: number; gstRate: number; totalInvoiceValue: number }>>): ParsedExcelResult {
    return {
      firms: [{
        firmName: "Test Firm",
        gstin: "08AAGPL3375F1ZO",
        supplyType: "Outward Supply",
        month: "Apr 2026",
        invoices: rows.map((r, i) => ({
          sNo: i + 1,
          billNo: String(i + 1),
          invoiceDate: "2026-04-01",
          partyName: `Party ${i + 1}`,
          gstNumber: "",
          commodity: r.commodity || "GOLD",
          hsnCode: "",
          gstRate: r.gstRate ?? 0,
          qty: r.qty ?? 0,
          rate: r.rate ?? 0,
          taxableValue: 0,
          cgst: 0,
          sgst: 0,
          igst: 0,
          totalInvoiceValue: r.totalInvoiceValue ?? 0,
        })),
      }],
      summary: [],
    };
  }

  it("computes taxable + tax + total when only Qty + Rate are present, looking up GST from Product master", () => {
    const parsed = makeParsed([{ commodity: "GOLD ORNAMENTS", qty: 5, rate: 14000 }]);
    const products = [{ name: "GOLD ORNAMENTS", hsn_code: "711319", gst_tax_rate: 0.03 }];
    const out = toImportReadyInvoices(parsed, products);
    expect(out).toHaveLength(1);
    const inv = out[0];
    // 5g × ₹14,000 = ₹70,000 taxable; 3% GST = ₹2,100 (₹1,050 CGST + ₹1,050 SGST); total = ₹72,100
    expect(inv.subtotal).toBe(70000);
    expect(inv.totalCGST).toBe(1050);
    expect(inv.totalSGST).toBe(1050);
    expect(inv.totalIGST).toBe(0);
    expect(inv.total).toBe(72100);
    // Item should have HSN looked up too
    expect(inv.items[0].hsn).toBe("711319");
    expect(inv.items[0].gstRate).toBe(3); // 3% (percentage form)
    expect(inv.items[0].amount).toBe(72100); // gross
  });

  it("falls back to gstRate from file row when product not in lookup", () => {
    const parsed = makeParsed([{ commodity: "PLATINUM", qty: 2, rate: 50000, gstRate: 5 }]);
    const out = toImportReadyInvoices(parsed, []); // empty product map
    const inv = out[0];
    // 2 × 50,000 = 100,000; 5% = 5,000 (2,500 CGST + 2,500 SGST); total 105,000
    expect(inv.subtotal).toBe(100000);
    expect(inv.totalCGST).toBe(2500);
    expect(inv.total).toBe(105000);
  });

  it("leaves zero values when neither file row nor product master has a GST rate", () => {
    const parsed = makeParsed([{ commodity: "UNKNOWN_THING", qty: 1, rate: 1000 }]);
    const out = toImportReadyInvoices(parsed, []);
    const inv = out[0];
    // Taxable computed (qty*rate) but no GST → no taxes
    expect(inv.subtotal).toBe(1000);
    expect(inv.totalCGST).toBe(0);
    expect(inv.totalSGST).toBe(0);
    expect(inv.total).toBe(1000); // amount = taxable since taxes are 0
  });

  it("back-derives taxable from a supplied total + GST rate", () => {
    const parsed = makeParsed([{ commodity: "GOLD ORNAMENTS", totalInvoiceValue: 1030 }]);
    const products = [{ name: "GOLD ORNAMENTS", hsn_code: "711319", gst_tax_rate: 0.03 }];
    const out = toImportReadyInvoices(parsed, products);
    const inv = out[0];
    // 1030 / 1.03 = 1000 taxable; 3% = 30 (15 + 15)
    expect(inv.subtotal).toBe(1000);
    expect(inv.totalCGST).toBe(15);
    expect(inv.totalSGST).toBe(15);
    expect(inv.total).toBe(1030);
  });
});

describe("parseInvoiceExcel — regression: smart template (no HSN/GST Rate columns)", () => {
  it("does NOT misread the Rate column as GST Rate when columns are missing", () => {
    // Smart template has only 8 columns: S.No., Bill, Date, Party, GST,
    // Commodity, Qty, Rate. Old positional fallback (gst rate at index 7)
    // would have picked up the Rate value (~14000) and treated it as 14000%.
    // After fix: gstRate column missing → gstRate = 0, backend resolves from
    // Product master.
    const bytes = generateSampleExcelBytes({
      businesses: [{ name: "F1", gst_number: "08AAA1234A1Z1" }],
      products: [{ name: "GOLD ORNAMENTS" }],
      withSamples: true,
    });
    // generateSampleExcelBytes returns a Uint8Array; pass as ArrayBuffer
    const ab = new Uint8Array(bytes).buffer;
    const result = parseInvoiceExcel(ab);

    expect(result.firms.length).toBeGreaterThan(0);
    const firm = result.firms[0];
    expect(firm.invoices.length).toBeGreaterThan(0);
    for (const inv of firm.invoices) {
      // gstRate should be 0 (not present in file → backend resolves it)
      expect(inv.gstRate).toBe(0);
      // Rate should be the actual Rate value (≥ 100, not weirdly bonkers)
      // and qty should be a sensible weight
      if (inv.qty > 0 && inv.rate > 0) {
        expect(inv.rate).toBeGreaterThan(50); // any realistic rate
        expect(inv.qty).toBeLessThan(10000); // sanity: not millions
      }
    }
  });

  it("computed CGST stays sane for smart-template imports (Product master lookup)", () => {
    const bytes = generateSampleExcelBytes({
      businesses: [{ name: "F1", gst_number: "08AAA1234A1Z1" }],
      products: [{ name: "GOLD ORNAMENTS" }],
      withSamples: true,
    });
    // generateSampleExcelBytes returns a Uint8Array; pass as ArrayBuffer
    const ab = new Uint8Array(bytes).buffer;
    const result = parseInvoiceExcel(ab);
    const products = [{ name: "GOLD ORNAMENTS", hsn_code: "711319", gst_tax_rate: 0.03 }];
    const out = toImportReadyInvoices(result, products);

    // Pre-fix bug: CGST would be ~7300× actual on the sample row.
    // Post-fix: CGST is at most ~5% of taxable.
    for (const inv of out) {
      if (inv.subtotal > 0) {
        const ratio = inv.totalCGST / inv.subtotal;
        expect(ratio).toBeLessThan(0.1); // way under 10% — realistic CGST is 1.5%
      }
    }
  });
});
