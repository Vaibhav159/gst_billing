import * as XLSX from "xlsx-js-style";

/**
 * Sales Reconciliation workbook — the CA's year-end working, one sheet:
 * three side-by-side blocks (GSTR-3B | GSTR-1 B2B | GSTR-1 B2C), a row per
 * quarter plus TOTAL, optionally followed by the payment-mode split and
 * the tie-out check list. Layout mirrors the spreadsheet the CA keeps.
 */

interface Cell4 { taxable: string; cgst: string; sgst: string; igst: string }
interface QuarterRow { label: string; gstr3b: Cell4; b2b: Cell4; b2c: Cell4 }
export interface ReconPayload {
  fy: string;
  quarters: QuarterRow[];
  total: { gstr3b: Cell4; b2b: Cell4; b2c: Cell4 };
  payment_split: { mode: string; gross: string; taxable: string; cgst: string; sgst: string; igst: string; share_pct: string }[];
  checks: { id: string; label: string; period: string; expected: string; actual: string; difference: string; status: string }[];
}

const DARK = "1F3864";
const LIGHT = "DCE6F1";
const AMBER = "FFC000";
const NF = "#,##0.00";

const bdr = () => ({ top: { style: "thin", color: { rgb: "B4C6E7" } }, bottom: { style: "thin", color: { rgb: "B4C6E7" } }, left: { style: "thin", color: { rgb: "B4C6E7" } }, right: { style: "thin", color: { rgb: "B4C6E7" } } });
const hdr = () => ({ font: { bold: true, sz: 10, name: "Arial", color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: DARK } }, alignment: { horizontal: "center" as const, wrapText: true }, border: bdr() });
const block = () => ({ font: { bold: true, sz: 11, name: "Arial", color: { rgb: DARK } }, fill: { fgColor: { rgb: LIGHT } }, alignment: { horizontal: "center" as const }, border: bdr() });
const dataS = (right = true) => ({ font: { sz: 10, name: "Arial" }, border: bdr(), alignment: { horizontal: right ? ("right" as const) : ("left" as const) } });
const totS = () => ({ font: { bold: true, sz: 10, name: "Arial" }, fill: { fgColor: { rgb: AMBER } }, border: bdr(), alignment: { horizontal: "right" as const } });

function sc(ws: any, r: number, c: number, v: any, s: any, z?: string) {
  const ref = XLSX.utils.encode_cell({ r, c });
  ws[ref] = { v, t: typeof v === "number" ? "n" : "s", s, ...(z ? { z } : {}) };
}

const n = (s: string) => Number(s) || 0;

export function buildReconWorkbook(data: ReconPayload, includePayment: boolean) {
  const ws: any = {};
  const merges: any[] = [];
  const COLS = 13; // period + 3 blocks × 4
  let r = 0;

  sc(ws, r, 0, `SALES RECONCILIATION — FY ${data.fy}`, { font: { bold: true, sz: 14, name: "Arial", color: { rgb: DARK } }, fill: { fgColor: { rgb: LIGHT } }, alignment: { horizontal: "center" } });
  for (let c = 1; c < COLS; c++) sc(ws, r, c, "", block());
  merges.push({ s: { r, c: 0 }, e: { r, c: COLS - 1 } });
  r += 2;

  sc(ws, r, 0, "", block());
  (["GSTR-3B", "GSTR-1 B2B", "GSTR-1 B2C"] as const).forEach((b, i) => {
    sc(ws, r, 1 + i * 4, b, block());
    for (let k = 1; k < 4; k++) sc(ws, r, 1 + i * 4 + k, "", block());
    merges.push({ s: { r, c: 1 + i * 4 }, e: { r, c: 4 + i * 4 } });
  });
  r++;
  sc(ws, r, 0, "PERIOD", hdr());
  for (let i = 0; i < 3; i++) ["TAXABLE VALUE", "IGST", "CGST", "SGST"].forEach((h, k) => sc(ws, r, 1 + i * 4 + k, h, hdr()));
  r++;

  const writeRow = (label: string, cells: [Cell4, Cell4, Cell4], style: () => any) => {
    sc(ws, r, 0, label, { ...style(), alignment: { horizontal: "left" } });
    cells.forEach((cell, i) => {
      sc(ws, r, 1 + i * 4, n(cell.taxable), style(), NF);
      sc(ws, r, 2 + i * 4, n(cell.igst), style(), NF);
      sc(ws, r, 3 + i * 4, n(cell.cgst), style(), NF);
      sc(ws, r, 4 + i * 4, n(cell.sgst), style(), NF);
    });
    r++;
  };
  data.quarters.forEach((q) => writeRow(q.label, [q.gstr3b, q.b2b, q.b2c], () => dataS()));
  writeRow("TOTAL", [data.total.gstr3b, data.total.b2b, data.total.b2c], totS);
  r += 2;

  if (includePayment && data.payment_split.length) {
    sc(ws, r, 0, "PAYMENT SPLIT (cash / bank)", block());
    for (let c = 1; c < 7; c++) sc(ws, r, c, "", block());
    merges.push({ s: { r, c: 0 }, e: { r, c: 6 } });
    r++;
    ["MODE", "GROSS", "TAXABLE", "CGST", "SGST", "IGST", "SHARE %"].forEach((h, c) => sc(ws, r, c, h, hdr()));
    r++;
    data.payment_split.forEach((m) => {
      sc(ws, r, 0, m.mode, dataS(false));
      sc(ws, r, 1, n(m.gross), dataS(), NF);
      sc(ws, r, 2, n(m.taxable), dataS(), NF);
      sc(ws, r, 3, n(m.cgst), dataS(), NF);
      sc(ws, r, 4, n(m.sgst), dataS(), NF);
      sc(ws, r, 5, n(m.igst), dataS(), NF);
      sc(ws, r, 6, n(m.share_pct), dataS(), "0.0000");
      r++;
    });
    r += 2;
  }

  sc(ws, r, 0, "TIE-OUT CHECKS", block());
  for (let c = 1; c < 6; c++) sc(ws, r, c, "", block());
  merges.push({ s: { r, c: 0 }, e: { r, c: 5 } });
  r++;
  ["CHECK", "PERIOD", "EXPECTED", "ACTUAL", "DIFFERENCE", "STATUS"].forEach((h, c) => sc(ws, r, c, h, hdr()));
  r++;
  data.checks.forEach((c) => {
    const failed = c.status === "fail";
    const st = failed
      ? { ...dataS(false), font: { sz: 10, name: "Arial", bold: true, color: { rgb: "9C0006" } } }
      : dataS(false);
    sc(ws, r, 0, c.label, st);
    sc(ws, r, 1, c.period, dataS(false));
    sc(ws, r, 2, n(c.expected), dataS(), NF);
    sc(ws, r, 3, n(c.actual), dataS(), NF);
    sc(ws, r, 4, n(c.difference), dataS(), NF);
    sc(ws, r, 5, c.status.toUpperCase(), st);
    r++;
  });

  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r, c: COLS - 1 } });
  ws["!merges"] = merges;
  ws["!cols"] = [{ wch: 14 }, ...Array.from({ length: 12 }, () => ({ wch: 13 }))];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Reconciliation ${data.fy}`);
  return wb;
}

export function downloadReconExcel(data: ReconPayload, includePayment: boolean) {
  const wb = buildReconWorkbook(data, includePayment);
  XLSX.writeFile(wb, `Reconciliation_${data.fy}${includePayment ? "_with_split" : ""}.xlsx`);
}
