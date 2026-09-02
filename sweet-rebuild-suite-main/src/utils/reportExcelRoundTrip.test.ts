/**
 * The export -> re-import round trip (audit A4 and A6).
 *
 * This workbook is what the Backup page's "Full Backup" produces and what the
 * import screen accepts back, so a disagreement between the two surfaces is a
 * data-loss path, not a cosmetic one.
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx-js-style";
import { generateReportExcel } from "./generateReportExcel";
import { parseInvoiceExcel, toImportReadyInvoices } from "./parseInvoiceExcel";

const businesses = [{ id: "b1", name: "TEST FIRM", gst_number: "08AAGPL3375F1ZO" }] as any;
const customers = [
  { id: "c1", name: "Test Party", gst_number: "" },
  { id: "c2", name: "Registered Party", gst_number: "27AAAAA0000A1Z5" },
] as any;

/** An invoice with `lines` items, each `taxable` net at 3% intra-state. */
function multiLine(id: string, lines: number, taxable: number, type = "OUTWARD") {
  const items = Array.from({ length: lines }, (_, i) => {
    const cgst = +(taxable * 0.015).toFixed(2);
    return {
      productName: `Item ${i + 1}`, hsn: "711319", gstRate: 3,
      qty: 1, rate: taxable,
      amount: taxable + cgst * 2, // tax-inclusive, matching the app contract
      cgst, sgst: cgst, igst: 0,
    };
  });
  const subtotal = taxable * lines;
  const totalCGST = +(taxable * 0.015).toFixed(2) * lines;
  const raw = subtotal + totalCGST * 2;
  return {
    id, invoiceNumber: id, invoice_date: "2026-05-10",
    customerId: "c1", customerName: "Test Party",
    businessId: "b1", businessName: "TEST FIRM",
    type, isIGST: false, items,
    subtotal, totalCGST, totalSGST: totalCGST, totalIGST: 0,
    totalTax: totalCGST * 2, total: Math.round(raw),
    roundedOff: +(Math.round(raw) - raw).toFixed(2) || undefined,
    financialYear: "2026-27", createdAt: "", updatedAt: "", lineItemCount: lines,
  } as any;
}

// jsdom's Blob has no arrayBuffer(); read it the way the sibling suite does.
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as ArrayBuffer);
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(blob);
  });
}

// generateReportExcel returns a Blob — the bytes the user actually downloads.
async function buildBuffer(invoices: any[]): Promise<ArrayBuffer> {
  return blobToArrayBuffer(generateReportExcel({ invoices, businesses, customers }));
}

async function sheetRows(invoices: any[], name: string): Promise<any[][]> {
  const wb = XLSX.read(await buildBuffer(invoices), { type: "array" });
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" }) as any[][];
}

/** Feed the exported bytes straight back into the importer. */
async function roundTrip(invoices: any[]) {
  return parseInvoiceExcel(await buildBuffer(invoices));
}

describe("A4 — the Taxable Value column holds taxable value", () => {
  it("writes net, not gross, for a multi-line invoice", async () => {
    const rows = await sheetRows([multiLine("1", 2, 10000)], "TEST FIRM");
    // Two lines of 10,000 net at 3%: each row's taxable must be 10000, not 10300.
    const taxables = rows
      .filter((r) => String(r[5] || "").startsWith("Item "))
      .map((r) => Number(r[10]));
    expect(taxables).toEqual([10000, 10000]);
  });

  it("the column foots against the TOTAL row", async () => {
    const rows = await sheetRows([multiLine("1", 3, 10000), multiLine("2", 1, 5000)], "TEST FIRM");
    const lineTaxables = rows
      .filter((r) => String(r[5] || "").startsWith("Item "))
      .map((r) => Number(r[10]));
    const totalRow = rows.find((r) => String(r[0]).trim() === "TOTAL");
    expect(totalRow).toBeDefined();
    const summed = +lineTaxables.reduce((a, b) => a + b, 0).toFixed(2);
    expect(summed).toBeCloseTo(Number(totalRow![10]), 2);
  });

  it("per row, Taxable + CGST + SGST does not double-count the tax", async () => {
    const rows = await sheetRows([multiLine("1", 2, 10000)], "TEST FIRM");
    for (const r of rows.filter((x) => String(x[5] || "").startsWith("Item "))) {
      const [taxable, cgst, sgst] = [Number(r[10]), Number(r[11]), Number(r[12])];
      expect(taxable + cgst + sgst).toBeCloseTo(10300, 2);
    }
  });
});

describe("A6 — the workbook survives its own importer", () => {
  it("a 3-line invoice comes back as 3 lines", async () => {
    const parsed = await roundTrip([multiLine("1", 3, 10000)]);
    const rows = parsed.firms.flatMap((f) => f.invoices).filter((r) => r.billNo === "1");
    expect(rows).toHaveLength(3);
  });

  it("continuation rows keep the invoice's identity", async () => {
    const parsed = await roundTrip([multiLine("1", 3, 10000)]);
    const rows = parsed.firms.flatMap((f) => f.invoices);
    for (const r of rows) {
      expect(r.billNo).toBe("1");
      expect(r.partyName).toBe("Test Party");
    }
  });

  it("purchases do not come back as sales", async () => {
    const parsed = await roundTrip([
      multiLine("S1", 1, 10000, "OUTWARD"),
      multiLine("P1", 1, 7000, "INWARD"),
    ]);
    const rows = parsed.firms.flatMap((f) => f.invoices);
    const sale = rows.find((r) => r.billNo === "S1");
    const purchase = rows.find((r) => r.billNo === "P1");
    expect(sale?.supplyType).toBe("Outward Supply");
    expect(purchase?.supplyType).toBe("Inward Supply");
  });

  it("outward turnover is not doubled by re-import", async () => {
    const parsed = await roundTrip([
      multiLine("S1", 1, 10000, "OUTWARD"),
      multiLine("P1", 1, 7000, "INWARD"),
    ]);
    const rows = parsed.firms.flatMap((f) => f.invoices);
    const outward = rows
      .filter((r) => r.supplyType === "Outward Supply")
      .reduce((s, r) => s + r.taxableValue, 0);
    expect(outward).toBeCloseTo(10000, 2);
  });

  it("every exported line survives the trip", async () => {
    const parsed = await roundTrip([multiLine("1", 3, 10000), multiLine("2", 2, 5000)]);
    const rows = parsed.firms.flatMap((f) => f.invoices);
    expect(rows).toHaveLength(5);
  });

  it("taxable values survive as net, so a re-import does not inflate the books", async () => {
    const parsed = await roundTrip([multiLine("1", 2, 10000)]);
    const rows = parsed.firms.flatMap((f) => f.invoices).filter((r) => r.billNo === "1");
    for (const r of rows) expect(r.taxableValue).toBeCloseTo(10000, 2);
  });
});

/** Re-parse the generated sheet with one extra row spliced in after a bill. */
async function withInjectedRow(invoices: any[], afterBill: string, row: any[]) {
  const wb = XLSX.read(await buildBuffer(invoices), { type: "array" });
  const name = "TEST FIRM";
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" }) as any[][];
  const idx = aoa.findIndex((r) => String(r[1]) === afterBill);
  expect(idx).toBeGreaterThan(-1);
  aoa.splice(idx + 1, 0, row);
  const wb2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet(aoa), name);
  return parseInvoiceExcel(XLSX.write(wb2, { bookType: "xlsx", type: "array" }) as ArrayBuffer);
}

describe("review follow-ups — the trip all the way to the importer's payload", () => {
  it("purchases reach the importer as INWARD, not just the parser", async () => {
    // The parser tagged rows correctly; toImportReadyInvoices still read the
    // sheet-level type, so purchases were POSTed as sales anyway.
    const parsed = await roundTrip([
      multiLine("S1", 1, 10000, "OUTWARD"),
      multiLine("P1", 1, 7000, "INWARD"),
    ]);
    const ready = toImportReadyInvoices(parsed);
    expect(ready.find((i) => i.invoiceNumber === "S1")?.type).toBe("OUTWARD");
    expect(ready.find((i) => i.invoiceNumber === "P1")?.type).toBe("INWARD");
  });

  it("the firm name survives the report's own summary rows", async () => {
    // "Outward Supply (N invoices)" in the recap used to re-arm section
    // detection, after which "GRAND TOTAL" was taken as the firm name.
    const parsed = await roundTrip([multiLine("1", 1, 10000), multiLine("2", 1, 5000, "INWARD")]);
    expect(parsed.firms[0].firmName).toBe("TEST FIRM");
  });

  it("a new bill with a blank GSTIN does not inherit the previous party's", async () => {
    const registered = { ...multiLine("1", 1, 10000), customerId: "c2", customerName: "Registered Party" };
    const walkIn = multiLine("2", 1, 5000); // c1, no GSTIN — the template says leave it blank
    const rows = (await roundTrip([registered, walkIn])).firms.flatMap((f) => f.invoices);
    const bill2 = rows.find((r) => r.billNo === "2");
    expect(bill2?.partyName).toBe("Test Party");
    expect(bill2?.gstNumber ?? "").not.toBe("27AAAAA0000A1Z5");
  });

  it("an unlabeled subtotal line is not absorbed as a phantom item", async () => {
    const subtotal = new Array(16).fill("");
    subtotal[15] = 10300; // only Total Invoice Value filled, no bill/party/commodity
    const parsed = await withInjectedRow([multiLine("1", 1, 10000), multiLine("2", 1, 5000)], "1", subtotal);
    const rows = parsed.firms.flatMap((f) => f.invoices);
    expect(rows.filter((r) => r.billNo === "1")).toHaveLength(1);
    expect(rows).toHaveLength(2);
  });

  it("continuation rows still inherit the bill (all-or-nothing)", async () => {
    const rows = (await roundTrip([multiLine("7", 3, 10000)])).firms.flatMap((f) => f.invoices);
    expect(rows.filter((r) => r.billNo === "7")).toHaveLength(3);
    for (const r of rows) expect(r.partyName).toBe("Test Party");
  });
});
