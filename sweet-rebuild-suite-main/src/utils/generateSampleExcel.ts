/**
 * Smart import template generator.
 *
 * Generates a multi-sheet Excel workbook customised to the user's actual
 * data:
 *   - One sheet per Business (with the firm's real name + GSTIN pre-filled)
 *   - Optional separate sheets for Inward and Outward supply
 *   - Sample rows use the user's actual Product master (not invented names)
 *   - Current month + financial year baked into the header
 *   - Data validation dropdowns for Commodity (from Product list)
 *   - First sheet is "Instructions" — what's required, what's auto-computed
 *
 * Replaces the previous static sample with placeholder text.
 */
import * as XLSX from "xlsx-js-style";

const DARK_BLUE = "1F3864";
const LIGHT_BLUE = "DCE6F1";
const WHITE = "FFFFFF";
const AMBER = "FFC000";
const GREY_TEXT = "666666";
const SUCCESS_GREEN = "4F8C5A";

export interface TemplateBusiness {
  id?: number | string;
  name: string;
  gst_number?: string;
  gstin?: string;
}
export interface TemplateProduct {
  name: string;
}
export interface TemplateOptions {
  businesses?: TemplateBusiness[];
  products?: TemplateProduct[];
  /** Include both Outward + Inward sheets per firm (default: outward only) */
  includeInward?: boolean;
  /** Show sample rows in each sheet (default: true) */
  withSamples?: boolean;
}

function bdr() {
  const s = { style: "thin", color: { rgb: "B4C6E7" } };
  return { top: s, bottom: s, left: s, right: s };
}
const titleS = () => ({
  font: { bold: true, sz: 14, name: "Arial", color: { rgb: WHITE } },
  fill: { fgColor: { rgb: DARK_BLUE } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border: bdr(),
});
const subS = () => ({
  font: { bold: true, sz: 11, name: "Arial", color: { rgb: DARK_BLUE } },
  fill: { fgColor: { rgb: LIGHT_BLUE } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border: bdr(),
});
const gstS = () => ({
  font: { bold: true, sz: 10, name: "Arial", color: { rgb: DARK_BLUE } },
  fill: { fgColor: { rgb: AMBER } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border: bdr(),
});
const hdrS = () => ({
  font: { bold: true, sz: 10, name: "Arial", color: { rgb: WHITE } },
  fill: { fgColor: { rgb: DARK_BLUE } },
  alignment: { horizontal: "center" as const, vertical: "center" as const, wrapText: true },
  border: bdr(),
});
const optHdrS = () => ({
  ...hdrS(),
  font: { bold: true, sz: 10, name: "Arial", color: { rgb: WHITE }, italic: true },
  fill: { fgColor: { rgb: GREY_TEXT } },
});
const dataS = (even: boolean, align: "left" | "center" | "right" = "left") => ({
  font: { sz: 10, name: "Arial" },
  fill: even ? { fgColor: { rgb: LIGHT_BLUE } } : undefined,
  border: bdr(),
  alignment: { horizontal: align, vertical: "center" as const },
});

function sc(ws: any, r: number, c: number, v: string | number, s: any, z?: string) {
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell: any = { v, s };
  if (typeof v === "number") {
    cell.t = "n";
    if (z) cell.z = z;
  } else {
    cell.t = "s";
  }
  ws[addr] = cell;
}
function fillR(ws: any, r: number, n: number, s: any) {
  for (let c = 0; c < n; c++) {
    const a = XLSX.utils.encode_cell({ r, c });
    if (!ws[a]) ws[a] = { v: "", t: "s", s };
  }
}

// 7 required columns + 1 optional Total (everything else is computed by parser)
const REQUIRED_HEADERS = [
  "S.No.",
  "Bill No.",
  "Invoice Date",
  "Party Name",
  "GST Number",
  "Commodity",
  "Qty (gm)",
  "Rate (₹/gm)",
] as const;
// Optional column the user can fill if they want to lock in a final total
// (otherwise the parser auto-computes Taxable / CGST / SGST / Total).
const OPTIONAL_HEADER = "Total Invoice Value (₹) (optional)";

const COL_W = [
  { wch: 6 },  // S.No.
  { wch: 12 }, // Bill No.
  { wch: 13 }, // Invoice Date
  { wch: 30 }, // Party Name
  { wch: 22 }, // GST Number
  { wch: 22 }, // Commodity
  { wch: 12 }, // Qty (gm)
  { wch: 14 }, // Rate (₹/gm)
  { wch: 24 }, // Total Invoice Value (optional)
];
const TC = COL_W.length;

function fyMonthLabel(): string {
  const d = new Date();
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}
function todayDDMMYYYY(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

/**
 * Build one supply-type sheet for a given firm.
 */
function buildFirmSheet(opts: {
  firmName: string;
  gstin: string;
  supplyType: "Outward Supply" | "Inward Supply";
  monthLabel: string;
  productNames: string[];
  withSamples: boolean;
}): { ws: any; merges: any[] } {
  const ws: any = {};
  const merges: any[] = [];
  let r = 0;

  // Row 1: firm name (uppercase title)
  sc(ws, r, 0, opts.firmName.toUpperCase(), titleS());
  fillR(ws, r, TC, titleS());
  merges.push({ s: { r, c: 0 }, e: { r, c: TC - 1 } });
  r++;
  // Row 2: GSTIN
  sc(ws, r, 0, `GSTIN: ${opts.gstin || "(blank)"}`, gstS());
  fillR(ws, r, TC, gstS());
  merges.push({ s: { r, c: 0 }, e: { r, c: TC - 1 } });
  r++;
  // Row 3: supply type
  sc(ws, r, 0, opts.supplyType, subS());
  fillR(ws, r, TC, subS());
  merges.push({ s: { r, c: 0 }, e: { r, c: TC - 1 } });
  r++;
  // Row 4: month
  sc(ws, r, 0, `Month: ${opts.monthLabel}`, subS());
  fillR(ws, r, TC, subS());
  merges.push({ s: { r, c: 0 }, e: { r, c: TC - 1 } });
  r++;
  // Row 5: spacer
  r++;

  // Row 6: column headers (required + 1 optional)
  REQUIRED_HEADERS.forEach((h, c) => sc(ws, r, c, h, hdrS()));
  sc(ws, r, REQUIRED_HEADERS.length, OPTIONAL_HEADER, optHdrS());
  r++;

  const headerRowIdx = r - 1; // for data validation reference
  const dataStartRow = r;

  // Sample rows (up to 3) — only if requested
  if (opts.withSamples && opts.productNames.length > 0) {
    const samples = [
      {
        bill: "1",
        date: todayDDMMYYYY(),
        party: "Sample Customer A",
        gst: "",
        commodity: opts.productNames[0],
        qty: 10.0,
        rate: 6500.0,
      },
      {
        bill: "2",
        date: todayDDMMYYYY(),
        party: "Sample Customer B (with GSTIN)",
        gst: "08AABCK5461H1ZO",
        commodity: opts.productNames[Math.min(1, opts.productNames.length - 1)],
        qty: 50.0,
        rate: 120.0,
      },
    ];
    samples.forEach((row, idx) => {
      const even = idx % 2 === 0;
      sc(ws, r, 0, idx + 1, dataS(even, "center"));
      sc(ws, r, 1, row.bill, dataS(even, "center"));
      sc(ws, r, 2, row.date, dataS(even, "center"));
      sc(ws, r, 3, row.party, dataS(even, "left"));
      sc(ws, r, 4, row.gst, dataS(even, "left"));
      sc(ws, r, 5, row.commodity, dataS(even, "left"));
      sc(ws, r, 6, row.qty, dataS(even, "right"), "#,##0.000");
      sc(ws, r, 7, row.rate, dataS(even, "right"), "#,##0.00");
      // Leave the optional Total cell blank — parser will compute
      r++;
    });
  }

  // 8 blank rows for the user to fill in
  const blankCount = 8;
  for (let i = 0; i < blankCount; i++) {
    REQUIRED_HEADERS.forEach((_, c) => {
      sc(ws, r, c, "", dataS(false, c === 0 ? "center" : "left"));
    });
    sc(ws, r, REQUIRED_HEADERS.length, "", dataS(false, "right"));
    r++;
  }

  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: r - 1, c: TC - 1 } });
  ws["!merges"] = merges;
  ws["!cols"] = COL_W;
  // Freeze the meta+header rows
  ws["!freeze"] = { xSplit: 0, ySplit: headerRowIdx + 1, topLeftCell: `A${headerRowIdx + 2}` };

  // Data validation: dropdown for Commodity column referencing a hidden
  // products sheet. Inline-string formulae are limited to 255 chars and
  // can break if a product name contains a comma or quote — using a sheet
  // reference avoids both issues.
  // The hidden sheet is built once at the workbook level (see addProductListSheet)
  // and referenced here by name.
  if (opts.productNames.length > 0) {
    const dvRange = `F${dataStartRow + 1}:F${dataStartRow + 50}`; // column F = index 5
    const lastRow = opts.productNames.length;
    (ws as any)["!dataValidation"] = [
      {
        type: "list",
        allowBlank: true,
        showInputMessage: true,
        showErrorMessage: true,
        promptTitle: "Commodity",
        prompt: "Pick from your Product list. Add new ones via Products page first.",
        formulae: [`=_ProductList!$A$1:$A$${lastRow}`],
        sqref: dvRange,
      },
    ];
  }

  return { ws, merges };
}

/** Add a hidden _ProductList sheet that data-validation cells reference. */
function addProductListSheet(wb: XLSX.WorkBook, productNames: string[]) {
  if (productNames.length === 0) return;
  const ws: any = {};
  productNames.forEach((name, i) => {
    ws[XLSX.utils.encode_cell({ r: i, c: 0 })] = { v: name, t: "s" };
  });
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: productNames.length - 1, c: 0 } });
  XLSX.utils.book_append_sheet(wb, ws, "_ProductList");
  // Hide the sheet (xlsx-js-style supports !sheets metadata; not all readers
  // honor it, but Excel/Google Sheets do).
  if (!wb.Workbook) wb.Workbook = { Sheets: [] };
  if (!wb.Workbook.Sheets) wb.Workbook.Sheets = [];
  wb.Workbook.Sheets.push({ name: "_ProductList", Hidden: 1 });
}

/**
 * Build the "Instructions" cover sheet.
 */
function buildInstructionsSheet(opts: { businessCount: number; productCount: number }): any {
  const ws: any = {};
  const merges: any[] = [];
  let r = 0;

  const TITLE = (text: string) => sc(ws, r, 0, text, titleS());
  const PARA = (text: string, bold = false) =>
    sc(ws, r, 0, text, {
      font: { sz: 11, name: "Arial", bold, color: { rgb: bold ? DARK_BLUE : "111111" } },
      alignment: { horizontal: "left" as const, vertical: "center" as const, wrapText: true },
    });
  const NOTE = (text: string) =>
    sc(ws, r, 0, text, {
      font: { sz: 10, name: "Arial", italic: true, color: { rgb: GREY_TEXT } },
      alignment: { horizontal: "left" as const, vertical: "center" as const, wrapText: true },
    });

  TITLE("HOW TO USE THIS TEMPLATE"); fillR(ws, r, 4, titleS());
  merges.push({ s: { r, c: 0 }, e: { r, c: 3 } });
  r += 2;

  PARA(`This template was built for your account — ${opts.businessCount} business(es) and ${opts.productCount} product(s) detected.`, true);
  r += 2;
  PARA("REQUIRED COLUMNS (must be filled in every row):", true); r++;
  ["1.  Bill No.            — your invoice / bill number",
   "2.  Invoice Date        — DD-MM-YYYY format (e.g. " + todayDDMMYYYY() + ")",
   "3.  Party Name          — customer / supplier name",
   "4.  GST Number          — leave blank for unregistered customers",
   "5.  Commodity           — pick from the dropdown (must be a product in your Product list)",
   "6.  Qty (gm)            — quantity in grams",
   "7.  Rate (₹/gm)     — price per gram",
  ].forEach((line) => { PARA(line); r++; });

  r++;
  PARA("AUTO-COMPUTED (you don't need to fill these — leave blank):", true); r++;
  ["•  HSN Code           — looked up from your Product list by Commodity",
   "•  GST Rate           — looked up from your Product list by Commodity",
   "•  Taxable Value      — computed as Qty × Rate",
   "•  CGST / SGST        — computed from GST Rate (intra-state)",
   "•  IGST               — computed (inter-state, based on customer GSTIN state)",
   "•  Total              — Taxable + tax components",
  ].forEach((line) => { PARA(line); r++; });

  r++;
  PARA("HOW SHEETS WORK:", true); r++;
  ["•  One sheet per business (firm name + GSTIN pre-filled in row 1-2)",
   "•  Each firm sheet is tagged Outward Supply (sales) or Inward Supply (purchases)",
   "•  You can add as many rows below the header as you need",
   "•  At import time, all sheets are processed; sheets you don't need can stay empty",
  ].forEach((line) => { PARA(line); r++; });

  r++;
  NOTE("If a Commodity isn't in your Product list, the row will fail at import — add the product first via Products → Add Product."); r++;
  NOTE("If a row doesn't have either (Qty + Rate) or a Total Invoice Value, the import skips it.");

  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: r + 1, c: 3 } });
  ws["!merges"] = merges;
  ws["!cols"] = [{ wch: 80 }, { wch: 20 }, { wch: 20 }, { wch: 20 }];
  return ws;
}

/**
 * Build the workbook bytes (Uint8Array) — testable without browser APIs.
 */
export function generateSampleExcelBytes(opts: TemplateOptions = {}): Uint8Array {
  const businesses: TemplateBusiness[] = (opts.businesses && opts.businesses.length > 0)
    ? opts.businesses
    : [{ name: "Your Business Name", gst_number: "" }];
  const productNames: string[] = (opts.products || []).map((p) => p.name).filter(Boolean);
  const month = fyMonthLabel();
  const includeInward = !!opts.includeInward;
  const withSamples = opts.withSamples !== false;

  const wb = XLSX.utils.book_new();

  // Always start with an Instructions sheet
  const instructions = buildInstructionsSheet({
    businessCount: businesses.length,
    productCount: productNames.length,
  });
  XLSX.utils.book_append_sheet(wb, instructions, "Instructions");

  // Hidden products list backing the data-validation dropdowns. Must be
  // appended BEFORE the firm sheets that reference it.
  addProductListSheet(wb, productNames);

  // One sheet per (firm × supply type)
  for (const biz of businesses) {
    const gstin = biz.gst_number || biz.gstin || "";
    // Outward
    {
      const { ws } = buildFirmSheet({
        firmName: biz.name,
        gstin,
        supplyType: "Outward Supply",
        monthLabel: month,
        productNames,
        withSamples,
      });
      const sheetName = (biz.name + " - OUT").slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }
    if (includeInward) {
      const { ws } = buildFirmSheet({
        firmName: biz.name,
        gstin,
        supplyType: "Inward Supply",
        monthLabel: month,
        productNames,
        withSamples,
      });
      const sheetName = (biz.name + " - IN").slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }
  }

  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as Uint8Array;
}

/**
 * Generate the smart import template as an Excel Blob (browser convenience).
 */
export function generateSampleExcel(opts: TemplateOptions = {}): Blob {
  const bytes = generateSampleExcelBytes(opts);
  return new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Save the workbook to disk. */
export function downloadSampleExcel(opts: TemplateOptions = {}) {
  const blob = generateSampleExcel(opts);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `invoice-import-template-${stamp}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
