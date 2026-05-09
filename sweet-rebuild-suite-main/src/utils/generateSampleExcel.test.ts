import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx-js-style";
import { generateSampleExcelBytes } from "./generateSampleExcel";

function buildWorkbook(opts: Parameters<typeof generateSampleExcelBytes>[0]) {
  const bytes = generateSampleExcelBytes(opts);
  return XLSX.read(bytes, { type: "array" });
}

function getCellText(ws: XLSX.WorkSheet, addr: string): string {
  const c = ws[addr];
  if (!c) return "";
  return String(c.v ?? "");
}

describe("generateSampleExcel — smart import template", () => {
  it("includes an Instructions sheet first", async () => {
    const wb = buildWorkbook({
      businesses: [{ name: "LODHA", gst_number: "08AAGPL3375F1ZO" }],
      products: [{ name: "GOLD" }],
    });
    
    expect(wb.SheetNames[0]).toBe("Instructions");
  });

  it("creates one Outward sheet per business by default", async () => {
    const wb = buildWorkbook({
      businesses: [
        { name: "ALPHA", gst_number: "08A1" },
        { name: "BETA", gst_number: "08B2" },
      ],
      products: [{ name: "GOLD" }],
      includeInward: false,
    });
    
    expect(wb.SheetNames).toContain("ALPHA - OUT");
    expect(wb.SheetNames).toContain("BETA - OUT");
    expect(wb.SheetNames).not.toContain("ALPHA - IN");
  });

  it("adds Inward sheets when includeInward: true", async () => {
    const wb = buildWorkbook({
      businesses: [{ name: "ALPHA", gst_number: "08A1" }],
      products: [{ name: "GOLD" }],
      includeInward: true,
    });
    
    expect(wb.SheetNames).toContain("ALPHA - OUT");
    expect(wb.SheetNames).toContain("ALPHA - IN");
  });

  it("pre-fills business name and GSTIN in firm sheets", async () => {
    const wb = buildWorkbook({
      businesses: [{ name: "Test Firm", gst_number: "08TESTGSTIN1Z1" }],
      products: [{ name: "GOLD" }],
    });
    
    const ws = wb.Sheets["Test Firm - OUT"];
    expect(getCellText(ws, "A1")).toBe("TEST FIRM"); // uppercase title
    expect(getCellText(ws, "A2")).toContain("08TESTGSTIN1Z1");
    expect(getCellText(ws, "A3")).toBe("Outward Supply");
  });

  it("uses real product names in sample rows", async () => {
    const wb = buildWorkbook({
      businesses: [{ name: "F1", gst_number: "08X" }],
      products: [{ name: "GOLD ORNAMENTS" }, { name: "SILVER ORNAMENTS" }],
      withSamples: true,
    });
    
    const ws = wb.Sheets["F1 - OUT"];
    // Sample data starts at row 7 (index 6) — col F is index 5
    const sampleCommodity1 = getCellText(ws, "F7");
    const sampleCommodity2 = getCellText(ws, "F8");
    expect(sampleCommodity1).toBe("GOLD ORNAMENTS");
    expect(sampleCommodity2).toBe("SILVER ORNAMENTS");
  });

  it("falls back gracefully when no businesses/products supplied", async () => {
    const wb = buildWorkbook({});
    
    expect(wb.SheetNames[0]).toBe("Instructions");
    expect(wb.SheetNames.length).toBeGreaterThan(1); // at least one fallback firm sheet
  });

  it("template has 8 column headers (7 required + 1 optional Total)", async () => {
    const wb = buildWorkbook({
      businesses: [{ name: "F1", gst_number: "08X" }],
      products: [{ name: "GOLD" }],
    });
    
    const ws = wb.Sheets["F1 - OUT"];
    // Header row at row 6 (index 5)
    expect(getCellText(ws, "A6")).toBe("S.No.");
    expect(getCellText(ws, "B6")).toBe("Bill No.");
    expect(getCellText(ws, "C6")).toBe("Invoice Date");
    expect(getCellText(ws, "D6")).toBe("Party Name");
    expect(getCellText(ws, "E6")).toBe("GST Number");
    expect(getCellText(ws, "F6")).toBe("Commodity");
    expect(getCellText(ws, "G6")).toBe("Qty (gm)");
    expect(getCellText(ws, "H6")).toBe("Rate (₹/gm)");
    expect(getCellText(ws, "I6")).toContain("Total Invoice Value");
    // Should NOT have a "GST Rate" or "HSN Code" column in the smart template
    expect(getCellText(ws, "J6")).toBe("");
  });
});
