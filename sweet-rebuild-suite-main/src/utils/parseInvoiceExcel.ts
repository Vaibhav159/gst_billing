import * as XLSX from "xlsx-js-style";

/**
 * Parsed invoice row from the user's Excel format.
 * Matches the format:
 *   S.No. | Bill No. | Invoice Date | Party Name | GST Number |
 *   Commodity | HSN Code | GST Rate | Qty | Rate |
 *   Taxable Value | CGST | SGST | IGST | Total Invoice Value
 */
export interface ParsedInvoiceRow {
  sNo: number;
  billNo: string;
  invoiceDate: string; // DD-MM-YYYY format from Excel
  partyName: string;
  gstNumber: string;
  commodity: string;
  hsnCode: string;
  gstRate: number; // percentage, e.g. 3
  qty: number;
  rate: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalInvoiceValue: number;
}

export interface ParsedFirmSheet {
  firmName: string;
  gstin: string;
  supplyType: string; // "Outward Supply" / "Inward Supply"
  month: string; // e.g. "Feb 2026"
  invoices: ParsedInvoiceRow[];
}

export interface ParsedExcelResult {
  firms: ParsedFirmSheet[];
  summary: {
    firmName: string;
    invoiceCount: number;
    totalTaxable: number;
    totalCGST: number;
    totalSGST: number;
    grandTotal: number;
  }[];
}

/**
 * Try to extract a numeric value from a cell that might contain a formula string or a number.
 */
function numVal(cell: any): number {
  if (cell === null || cell === undefined || cell === "" || cell === "-") return 0;
  if (typeof cell === "number") return cell;
  const s = String(cell).replace(/[₹,%\s]/g, "").replace(/,/g, "");
  if (s === "-" || s === "") return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function strVal(cell: any): string {
  if (cell === null || cell === undefined) return "";
  return String(cell).trim();
}

/**
 * Convert DD-MM-YYYY or other date formats to YYYY-MM-DD for API
 */
export function normalizeDate(dateStr: string): string {
  const s = strVal(dateStr);
  // DD-MM-YYYY
  const m1 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2].padStart(2, "0")}-${m1[1].padStart(2, "0")}`;
  // YYYY-MM-DD already
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return s;
  // DD/MM/YYYY
  const m3 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m3) return `${m3[3]}-${m3[2].padStart(2, "0")}-${m3[1].padStart(2, "0")}`;
  // Try as Date object
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
  } catch { /* ignore */ }
  return s;
}

/**
 * Detect if a row is a header row (contains column names like "S.No.", "Bill No.", etc.)
 */
function isHeaderRow(row: any[]): boolean {
  const joined = row.map(c => strVal(c).toLowerCase()).join("|");
  // Match both "S.No. | Bill No." format and "Bill No. | Invoice Date" format (no S.No.)
  return (joined.includes("s.no") && (joined.includes("bill no") || joined.includes("invoice"))) ||
    (joined.includes("bill no") && joined.includes("invoice date") && joined.includes("party name"));
}

/**
 * Detect if a row is a total/summary row
 */
function isTotalRow(row: any[]): boolean {
  const first = strVal(row[0]).toLowerCase();
  return first === "total" || first === "grand total" || first.startsWith("total");
}

/**
 * Detect if a row is a firm header row (business name, GSTIN, supply type, month)
 */
function isMergedHeaderRow(row: any[]): boolean {
  // These rows typically have data only in the first cell, rest are null
  const nonNull = row.filter(c => c !== null && c !== undefined && strVal(c) !== "");
  if (nonNull.length > 2) return false;
  const first = strVal(row[0]);
  if (!first) return false;
  // Check for known patterns
  if (first.toLowerCase().startsWith("gstin:")) return true;
  if (first.toLowerCase().includes("outward") || first.toLowerCase().includes("inward")) return true;
  if (first.toLowerCase().startsWith("month:")) return true;
  // Business name (all uppercase, length > 3)
  if (first === first.toUpperCase() && first.length > 3 && !first.match(/^\d/)) return true;
  return false;
}

/**
 * Detect column mapping from header row. Returns a map of logical field -> column index.
 */
function detectColumnMap(row: any[]): Record<string, number> {
  const map: Record<string, number> = {};
  row.forEach((cell, idx) => {
    const val = strVal(cell).toLowerCase();
    if (val.includes("s.no") || val === "s.no." || val === "sno") map.sNo = idx;
    if (val.includes("bill no") || val === "invoice no" || val === "invoice number" || val === "inv no") map.billNo = idx;
    if (val.includes("invoice date") || val === "date" || val === "inv date") map.invoiceDate = idx;
    if (val.includes("party name") || val === "customer" || val === "customer name") map.partyName = idx;
    if (val.includes("gst number") || val.includes("gstin") || val === "gst no") map.gstNumber = idx;
    if (val.includes("commodity") || val.includes("product") || val.includes("item") || val.includes("description")) map.commodity = idx;
    if (val.includes("hsn")) map.hsnCode = idx;
    if (val.includes("gst rate") || val === "rate %" || val === "tax rate") map.gstRate = idx;
    if (val.includes("qty") || val.includes("quantity") || val.includes("weight")) map.qty = idx;
    if ((val.includes("rate") && !val.includes("gst") && !val.includes("tax")) || val.includes("price") || val.includes("rate (")) map.rate = idx;
    if (val.includes("taxable")) map.taxableValue = idx;
    if (val === "cgst" || val.includes("cgst")) map.cgst = idx;
    if (val === "sgst" || val.includes("sgst")) map.sgst = idx;
    if (val === "igst" || val.includes("igst")) map.igst = idx;
    if (val.includes("total") && !val.includes("cgst") && !val.includes("sgst") && !val.includes("igst")) map.total = idx;
  });
  return map;
}

/**
 * Parse a single sheet into firm data.
 */
function parseSheet(ws: XLSX.WorkSheet, sheetName: string): ParsedFirmSheet {
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  const rows: any[][] = [];

  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: any[] = [];
    for (let c = range.s.c; c <= Math.min(range.e.c, 20); c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      row.push(cell ? cell.v : null);
    }
    rows.push(row);
  }

  let firmName = sheetName;
  let gstin = "";
  let supplyType = "Outward Supply";
  let month = "";
  const invoices: ParsedInvoiceRow[] = [];
  let headerFound = false;
  let colMap: Record<string, number> = {};

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const first = strVal(row[0]);

    // Parse header metadata rows
    if (!headerFound) {
      if (first.toLowerCase().startsWith("gstin:")) {
        gstin = first.replace(/^gstin:\s*/i, "").trim();
        continue;
      }
      if (first.toLowerCase().includes("outward")) {
        supplyType = "Outward Supply";
        continue;
      }
      if (first.toLowerCase().includes("inward")) {
        supplyType = "Inward Supply";
        continue;
      }
      if (first.toLowerCase().startsWith("month:")) {
        month = first.replace(/^month:\s*/i, "").trim();
        continue;
      }
      // Business name (first non-empty row that's not a header)
      if (first && first === first.toUpperCase() && first.length > 3 && !first.match(/^s\.?no/i)) {
        firmName = first;
        continue;
      }
    }

    // Column header row
    if (isHeaderRow(row)) {
      headerFound = true;
      colMap = detectColumnMap(row);
      continue;
    }

    // Skip total rows
    if (isTotalRow(row)) continue;

    // Skip empty rows
    if (!first && !row[1] && !row[2] && !row[3]) continue;

    // Data row - must have at least a bill number or party name
    if (headerFound) {
      // Use detected column map, with fallbacks to positional
      const hasSNo = colMap.sNo !== undefined;
      const offset = hasSNo ? 0 : -1; // If no S.No column, all columns shift left by 1

      const sNo = colMap.sNo !== undefined ? numVal(row[colMap.sNo]) : 0;
      const billNo = strVal(row[colMap.billNo ?? (hasSNo ? 1 : 0)]);
      const invoiceDate = strVal(row[colMap.invoiceDate ?? (hasSNo ? 2 : 1)]);
      const partyName = strVal(row[colMap.partyName ?? (hasSNo ? 3 : 2)]);
      const gstNumber = strVal(row[colMap.gstNumber ?? (hasSNo ? 4 : 3)]);
      // Read raw values — NO silent defaults. The backend looks up HSN + GST rate
      // from the Product master via the commodity name.
      const commodity = strVal(row[colMap.commodity ?? (hasSNo ? 5 : 4)]);
      const hsnCode = strVal(row[colMap.hsnCode ?? (hasSNo ? 6 : 5)]);
      const gstRateStr = strVal(row[colMap.gstRate ?? (hasSNo ? 7 : 6)]).replace("%", "");
      const gstRate = numVal(gstRateStr); // 0 if not provided — backend resolves
      const qty = numVal(row[colMap.qty ?? (hasSNo ? 8 : 7)]);
      const rate = numVal(row[colMap.rate ?? (hasSNo ? 9 : 8)]);

      // Read columns if present; otherwise leave 0 and let the backend compute
      // them after resolving the GST rate from Product master.
      let taxableValue = colMap.taxableValue !== undefined ? numVal(row[colMap.taxableValue]) : numVal(row[hasSNo ? 10 : 9]);
      let cgst = colMap.cgst !== undefined ? numVal(row[colMap.cgst]) : numVal(row[hasSNo ? 11 : 10]);
      let sgst = colMap.sgst !== undefined ? numVal(row[colMap.sgst]) : numVal(row[hasSNo ? 12 : 11]);
      let igst = colMap.igst !== undefined ? numVal(row[colMap.igst]) : numVal(row[hasSNo ? 13 : 12]);
      let totalInvoiceValue = colMap.total !== undefined ? numVal(row[colMap.total]) : (numVal(row[hasSNo ? 14 : 13]) || numVal(row[hasSNo ? 15 : 14]));

      // Skip blank lines — must have a bill# AND party name AND qty+rate or total
      if (!billNo || !partyName) continue;
      if ((qty === 0 || rate === 0) && totalInvoiceValue === 0) continue;

      invoices.push({
        sNo: sNo || invoices.length + 1,
        billNo,
        invoiceDate: invoiceDate ? normalizeDate(invoiceDate) : "",
        partyName,
        gstNumber: gstNumber === "-" ? "" : gstNumber,
        commodity,
        hsnCode,
        gstRate,
        qty,
        rate,
        taxableValue,
        cgst,
        sgst,
        igst,
        totalInvoiceValue,
      });
    }
  }

  return { firmName, gstin, supplyType, month, invoices };
}

/**
 * Parse an Excel file (ArrayBuffer) matching the user's invoice format.
 * Supports both multi-firm workbooks (one sheet per firm + summary sheet) and
 * single-firm workbooks (one sheet with all invoices).
 */
export function parseInvoiceExcel(data: ArrayBuffer): ParsedExcelResult {
  const wb = XLSX.read(data, { type: "array" });
  const firms: ParsedFirmSheet[] = [];
  const summary: ParsedExcelResult["summary"] = [];

  for (const sheetName of wb.SheetNames) {
    // Skip Summary sheet
    if (sheetName.toLowerCase() === "summary") {
      // Parse summary for validation
      const ws = wb.Sheets[sheetName];
      const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
      for (let r = range.s.r + 2; r <= range.e.r; r++) {
        const nameCell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
        const name = nameCell ? strVal(nameCell.v) : "";
        if (!name || name.toLowerCase() === "grand total") continue;
        summary.push({
          firmName: name,
          invoiceCount: numVal(ws[XLSX.utils.encode_cell({ r, c: 1 })]?.v),
          totalTaxable: numVal(ws[XLSX.utils.encode_cell({ r, c: 2 })]?.v),
          totalCGST: numVal(ws[XLSX.utils.encode_cell({ r, c: 3 })]?.v),
          totalSGST: numVal(ws[XLSX.utils.encode_cell({ r, c: 4 })]?.v),
          grandTotal: numVal(ws[XLSX.utils.encode_cell({ r, c: 5 })]?.v),
        });
      }
      continue;
    }

    const ws = wb.Sheets[sheetName];
    if (!ws["!ref"]) continue;
    const parsed = parseSheet(ws, sheetName);
    if (parsed.invoices.length > 0) {
      firms.push(parsed);
    }
  }

  return { firms, summary };
}

/**
 * Convert parsed Excel data into API-ready invoice objects for bulk import.
 * Each firm's invoices are grouped by bill number to handle multi-item invoices.
 */
export interface ImportReadyInvoice {
  invoiceNumber: string;
  invoice_date: string;
  customerName: string;
  customerGST: string;
  type: "OUTWARD" | "INWARD";
  firmName: string;
  firmGSTIN: string;
  items: {
    productName: string;
    hsn: string;
    gstRate: number;
    qty: number;
    rate: number;
    unit: string;
    amount: number;
    cgst: number;
    sgst: number;
    igst: number;
  }[];
  subtotal: number;
  totalCGST: number;
  totalSGST: number;
  totalIGST: number;
  total: number;
}

export function toImportReadyInvoices(result: ParsedExcelResult): ImportReadyInvoice[] {
  const invoices: ImportReadyInvoice[] = [];

  for (const firm of result.firms) {
    const type: "OUTWARD" | "INWARD" = firm.supplyType.toLowerCase().includes("inward") ? "INWARD" : "OUTWARD";

    // Group by bill number to handle multi-item invoices
    const byBill = new Map<string, ParsedInvoiceRow[]>();
    for (const row of firm.invoices) {
      const key = row.billNo || `auto-${row.sNo}`;
      if (!byBill.has(key)) byBill.set(key, []);
      byBill.get(key)!.push(row);
    }

    for (const [billNo, rows] of byBill) {
      const firstRow = rows[0];
      const items = rows.map(row => ({
        productName: row.commodity || "Item",
        hsn: row.hsnCode,
        gstRate: row.gstRate,
        qty: row.qty,
        rate: row.rate,
        unit: "gms", // default for jewellery
        amount: row.taxableValue,
        cgst: row.cgst,
        sgst: row.sgst,
        igst: row.igst,
      }));

      const subtotal = items.reduce((s, i) => s + i.amount, 0);
      const totalCGST = items.reduce((s, i) => s + i.cgst, 0);
      const totalSGST = items.reduce((s, i) => s + i.sgst, 0);
      const totalIGST = items.reduce((s, i) => s + i.igst, 0);
      // Use the total from the first row if available (handles round-off), else calculate
      const total = firstRow.totalInvoiceValue > 0
        ? firstRow.totalInvoiceValue
        : Math.round((subtotal + totalCGST + totalSGST + totalIGST) * 100) / 100;

      invoices.push({
        invoiceNumber: billNo,
        invoice_date: firstRow.invoiceDate,
        customerName: firstRow.partyName,
        customerGST: firstRow.gstNumber,
        type,
        firmName: firm.firmName,
        firmGSTIN: firm.gstin,
        items,
        subtotal: Math.round(subtotal * 100) / 100,
        totalCGST: Math.round(totalCGST * 100) / 100,
        totalSGST: Math.round(totalSGST * 100) / 100,
        totalIGST: Math.round(totalIGST * 100) / 100,
        total: Math.round(total * 100) / 100,
      });
    }
  }

  return invoices;
}
