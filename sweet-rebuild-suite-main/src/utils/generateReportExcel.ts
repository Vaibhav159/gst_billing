import * as XLSX from "xlsx-js-style";
import type { Invoice, Business, Customer } from "./mockData";
import { format } from "date-fns";

interface ReportOptions {
  invoices: Invoice[];
  businesses: Business[];
  customers: Customer[];
}

const DARK_BLUE = "1F3864";
const LIGHT_BLUE = "DCE6F1";
const WHITE = "FFFFFF";
const GREY_TEXT = "444444";
const AMBER = "FFC000";

const MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function mk(d: string) { return d.slice(0, 7); }
function ml(k: string) { const [y, m] = k.split("-"); return `${MN[parseInt(m, 10) - 1]} ${y}`; }
function trunc(n: string) { return n.length > 31 ? n.slice(0, 31) : n; }
function r2(n: number) { return Math.round(n * 100) / 100; }
function fd(d: string) { try { return format(new Date(d), "dd-MM-yyyy"); } catch { return d; } }

function bdr() {
  const s = { style: "thin", color: { rgb: "B4C6E7" } };
  return { top: s, bottom: s, left: s, right: s };
}

const titleS = (sz = 14) => ({ font: { bold: true, sz, name: "Arial", color: { rgb: DARK_BLUE } }, fill: { fgColor: { rgb: LIGHT_BLUE } }, alignment: { horizontal: "center" as const, vertical: "center" as const } });
const hdrS = () => ({ font: { bold: true, sz: 10, name: "Arial", color: { rgb: WHITE } }, fill: { fgColor: { rgb: DARK_BLUE } }, alignment: { horizontal: "center" as const, vertical: "center" as const, wrapText: true }, border: bdr() });
const totS = () => ({ font: { bold: true, sz: 10, name: "Arial" }, fill: { fgColor: { rgb: AMBER } }, border: bdr() });
const dS = (ev: boolean, a: "left"|"center"|"right" = "left") => ({ font: { sz: 9, name: "Arial" }, fill: ev ? { fgColor: { rgb: LIGHT_BLUE } } : undefined, border: bdr(), alignment: { horizontal: a, vertical: "center" as const } });
const plainS = (a: "left"|"center"|"right" = "left") => ({ font: { sz: 9, name: "Arial" }, alignment: { horizontal: a, vertical: "center" as const } });

const NF = "#,##0.00";
const TC = 15; // columns: S.No thru Total Invoice Value (matching user's format)

function sc(ws: any, r: number, c: number, v: string|number, s: any, z?: string) {
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell: any = { v, s };
  if (typeof v === "number") { cell.t = "n"; if (z) cell.z = z; } else { cell.t = "s"; }
  ws[addr] = cell;
}

function fillR(ws: any, r: number, n: number, s: any) {
  for (let c = 0; c < n; c++) { const a = XLSX.utils.encode_cell({ r, c }); if (!ws[a]) ws[a] = { v: "", t: "s", s }; }
}

const COL_HDRS = [
  "S.No.", "Bill No.", "Invoice Date", "Party Name", "GST Number",
  "Commodity", "HSN Code", "GST Rate", "Qty (gm)", "Rate (\u20b9/gm)",
  "Taxable Value (\u20b9)", "CGST (\u20b9)", "SGST (\u20b9)", "IGST (\u20b9)", "Total Invoice Value (\u20b9)",
];

const COL_W = [
  { wch: 6 }, { wch: 12 }, { wch: 13 }, { wch: 30 }, { wch: 20 },
  { wch: 26 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 14 },
  { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 22 },
];

// Section header styles
const hdrBizS = () => ({
  font: { bold: true, sz: 13, name: "Arial", color: { rgb: WHITE } },
  fill: { fgColor: { rgb: DARK_BLUE } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border: bdr(),
});
const hdrSupplyS = () => ({
  font: { bold: true, sz: 11, name: "Arial", color: { rgb: DARK_BLUE } },
  fill: { fgColor: { rgb: LIGHT_BLUE } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border: bdr(),
});
const hdrMonthS = () => ({
  font: { bold: false, sz: 10, name: "Arial", color: { rgb: GREY_TEXT } },
  fill: { fgColor: { rgb: LIGHT_BLUE } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border: bdr(),
});
const hdrGstinS = () => ({
  font: { bold: true, sz: 10, name: "Arial", color: { rgb: DARK_BLUE } },
  fill: { fgColor: { rgb: AMBER } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border: bdr(),
});

/** Write a section header block (4 rows) and return new row offset */
function writeHeader(ws: any, merges: any[], r: number, bizName: string, supplyType: string, monthLabel: string, gstin: string): number {
  // Business name - dark blue bg, white bold text, centered
  sc(ws, r, 0, bizName.toUpperCase(), hdrBizS());
  fillR(ws, r, TC, hdrBizS());
  merges.push({ s: { r, c: 0 }, e: { r, c: TC - 1 } });
  r++;
  // Supply type - light blue bg, dark blue bold text, centered
  sc(ws, r, 0, supplyType, hdrSupplyS());
  fillR(ws, r, TC, hdrSupplyS());
  merges.push({ s: { r, c: 0 }, e: { r, c: TC - 1 } });
  r++;
  // Month - light blue bg, grey text, centered
  sc(ws, r, 0, `Month: ${monthLabel}`, hdrMonthS());
  fillR(ws, r, TC, hdrMonthS());
  merges.push({ s: { r, c: 0 }, e: { r, c: TC - 1 } });
  r++;
  // GSTIN - amber bg, dark blue bold text, centered
  sc(ws, r, 0, `GSTIN: ${gstin}`, hdrGstinS());
  fillR(ws, r, TC, hdrGstinS());
  merges.push({ s: { r, c: 0 }, e: { r, c: TC - 1 } });
  r++;
  return r;
}

/** Write column header row */
function writeColHeaders(ws: any, r: number): number {
  COL_HDRS.forEach((h, c) => sc(ws, r, c, h, hdrS()));
  return r + 1;
}

/** Write invoice data rows, return new row offset */
function writeInvoices(ws: any, r: number, invs: Invoice[], custMap: Record<string, Customer>): number {
  let sno = 1;
  const startR = r;
  invs.forEach((inv) => {
    const cust = custMap[inv.customerId];
    // Support both API field names (gst_number/pan_number) and old field names (gst/pan)
    const custGst = (cust as any)?.gst_number || (cust as any)?.gst || "";
    const custPan = (cust as any)?.pan_number || (cust as any)?.pan || "";
    const cGst = custGst ? custGst : custPan ? `${custPan} (PAN)` : "-";
    const ds = fd(inv.invoice_date);
    const ev = (r - startR) % 2 === 0;

    if (inv.items.length <= 1) {
      const item = inv.items[0];
      sc(ws, r, 0, sno, dS(ev, "center"));
      sc(ws, r, 1, inv.invoiceNumber, dS(ev, "center"));
      sc(ws, r, 2, ds, dS(ev, "center"));
      sc(ws, r, 3, inv.customerName, dS(ev, "left"));
      sc(ws, r, 4, cGst, dS(ev, "left"));
      sc(ws, r, 5, item?.productName || "", dS(ev, "left"));
      sc(ws, r, 6, item?.hsn || "", dS(ev, "center"));
      sc(ws, r, 7, item ? `${item.gstRate}%` : "", dS(ev, "center"));
      sc(ws, r, 8, item ? item.qty : 0, dS(ev, "right"), "#,##0.000");
      sc(ws, r, 9, item ? r2(item.rate) : 0, dS(ev, "right"), NF);
      sc(ws, r, 10, r2(inv.subtotal), dS(ev, "right"), NF);
      sc(ws, r, 11, r2(inv.totalCGST), dS(ev, "right"), NF);
      sc(ws, r, 12, r2(inv.totalSGST), dS(ev, "right"), NF);
      sc(ws, r, 13, inv.totalIGST > 0 ? r2(inv.totalIGST) : 0, dS(ev, "right"), NF);
      sc(ws, r, 14, r2(inv.total), dS(ev, "right"), NF);
      r++; sno++;
    } else {
      inv.items.forEach((item, idx) => {
        const re = (r - startR) % 2 === 0;
        sc(ws, r, 0, idx === 0 ? sno : "", dS(re, "center"));
        sc(ws, r, 1, idx === 0 ? inv.invoiceNumber : "", dS(re, "center"));
        sc(ws, r, 2, idx === 0 ? ds : "", dS(re, "center"));
        sc(ws, r, 3, idx === 0 ? inv.customerName : "", dS(re, "left"));
        sc(ws, r, 4, idx === 0 ? cGst : "", dS(re, "left"));
        sc(ws, r, 5, item.productName, dS(re, "left"));
        sc(ws, r, 6, item.hsn, dS(re, "center"));
        sc(ws, r, 7, `${item.gstRate}%`, dS(re, "center"));
        sc(ws, r, 8, item.qty, dS(re, "right"), "#,##0.000");
        sc(ws, r, 9, r2(item.rate), dS(re, "right"), NF);
        sc(ws, r, 10, r2(item.amount), dS(re, "right"), NF);
        sc(ws, r, 11, r2(item.cgst), dS(re, "right"), NF);
        sc(ws, r, 12, r2(item.sgst), dS(re, "right"), NF);
        sc(ws, r, 13, item.igst > 0 ? r2(item.igst) : 0, dS(re, "right"), NF);
        // Total Invoice Value only on first item row
        sc(ws, r, 14, idx === 0 ? r2(inv.total) : "", dS(re, "right"), idx === 0 ? NF : undefined);
        r++;
      });
      sno++;
    }
  });
  return r;
}

/** Write TOTAL row, return new row offset */
function writeGrandTotal(ws: any, merges: any[], r: number, invs: Invoice[]): number {
  const ts = totS();
  const tsr = { ...ts, alignment: { horizontal: "right" as const } };
  sc(ws, r, 0, "TOTAL", ts);
  for (let c = 1; c <= 9; c++) sc(ws, r, c, "", ts);
  merges.push({ s: { r, c: 0 }, e: { r, c: 9 } });
  sc(ws, r, 10, r2(invs.reduce((s, i) => s + i.subtotal, 0)), tsr, NF);
  sc(ws, r, 11, r2(invs.reduce((s, i) => s + i.totalCGST, 0)), tsr, NF);
  sc(ws, r, 12, r2(invs.reduce((s, i) => s + i.totalSGST, 0)), tsr, NF);
  sc(ws, r, 13, invs.some(i => i.totalIGST > 0) ? r2(invs.reduce((s, i) => s + i.totalIGST, 0)) : "-" as any, tsr, NF);
  sc(ws, r, 14, r2(invs.reduce((s, i) => s + i.total, 0)), tsr, NF);
  return r + 1;
}

export function generateReportExcel({ invoices, businesses, customers }: ReportOptions) {
  const wb = XLSX.utils.book_new();

  const bizMap: Record<string, Business> = {};
  businesses.forEach((b) => (bizMap[b.id] = b));
  const custMap: Record<string, Customer> = {};
  customers.forEach((c) => (custMap[c.id] = c));

  // Group by business
  const byBiz: Record<string, Invoice[]> = {};
  invoices.forEach((inv) => { if (!byBiz[inv.businessId]) byBiz[inv.businessId] = []; byBiz[inv.businessId].push(inv); });
  // Sort by date, then by invoice number numerically (so "9" comes before "10")
  const numericInvoiceCompare = (a: string, b: string) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    if (!isNaN(na) && !isNaN(nb) && String(na) === a && String(nb) === b) return na - nb;
    return a.localeCompare(b, undefined, { numeric: true });
  };
  Object.values(byBiz).forEach((l) => l.sort((a, b) =>
    a.invoice_date.localeCompare(b.invoice_date) ||
    numericInvoiceCompare(a.invoiceNumber, b.invoiceNumber)
  ));
  const bizIds = Object.keys(byBiz);

  // ── Summary Sheet ──
  const ws: any = {};
  const SC = 14;
  const sMerges: any[] = [];

  // Title row
  sc(ws, 0, 0, "GST INVOICE SUMMARY \u2013 ALL FIRMS", titleS(14));
  for (let c = 1; c < SC; c++) sc(ws, 0, c, "", titleS(14));
  sMerges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: SC - 1 } });

  // Group header row (Outward / Inward)
  const grpS = () => ({ font: { bold: true, sz: 10, name: "Arial", color: { rgb: WHITE } }, fill: { fgColor: { rgb: DARK_BLUE } }, alignment: { horizontal: "center" as const, vertical: "center" as const }, border: bdr() });
  sc(ws, 1, 0, "", grpS());
  // Outward group header (cols 1-6)
  sc(ws, 1, 1, "OUTWARD SUPPLY", grpS());
  for (let c = 2; c <= 6; c++) sc(ws, 1, c, "", grpS());
  sMerges.push({ s: { r: 1, c: 1 }, e: { r: 1, c: 6 } });
  // Inward group header (cols 7-12)
  sc(ws, 1, 7, "INWARD SUPPLY", grpS());
  for (let c = 8; c <= 12; c++) sc(ws, 1, c, "", grpS());
  sMerges.push({ s: { r: 1, c: 7 }, e: { r: 1, c: 12 } });
  sc(ws, 1, 13, "", grpS());

  // Column headers
  const subHdrs = ["Firm Name", "Invoices", "Taxable Value (\u20b9)", "CGST (\u20b9)", "SGST (\u20b9)", "IGST (\u20b9)", "Total Invoice Value (\u20b9)", "Invoices", "Taxable Value (\u20b9)", "CGST (\u20b9)", "SGST (\u20b9)", "IGST (\u20b9)", "Total Invoice Value (\u20b9)", "Net Total (\u20b9)"];
  subHdrs.forEach((h, c) => sc(ws, 2, c, h, hdrS()));

  let row = 3;
  bizIds.forEach((bizId, idx) => {
    const biz = bizMap[bizId]; const list = byBiz[bizId];
    const out = list.filter((i) => i.type === "OUTWARD");
    const inw = list.filter((i) => i.type === "INWARD");
    const ev = idx % 2 === 0;

    sc(ws, row, 0, biz?.name || bizId, dS(ev, "left"));
    // Outward columns
    sc(ws, row, 1, out.length, dS(ev, "center"));
    sc(ws, row, 2, r2(out.reduce((s, i) => s + i.subtotal, 0)), dS(ev, "right"), NF);
    sc(ws, row, 3, r2(out.reduce((s, i) => s + i.totalCGST, 0)), dS(ev, "right"), NF);
    sc(ws, row, 4, r2(out.reduce((s, i) => s + i.totalSGST, 0)), dS(ev, "right"), NF);
    sc(ws, row, 5, r2(out.reduce((s, i) => s + i.totalIGST, 0)), dS(ev, "right"), NF);
    sc(ws, row, 6, r2(out.reduce((s, i) => s + i.total, 0)), dS(ev, "right"), NF);
    // Inward columns
    sc(ws, row, 7, inw.length, dS(ev, "center"));
    sc(ws, row, 8, r2(inw.reduce((s, i) => s + i.subtotal, 0)), dS(ev, "right"), NF);
    sc(ws, row, 9, r2(inw.reduce((s, i) => s + i.totalCGST, 0)), dS(ev, "right"), NF);
    sc(ws, row, 10, r2(inw.reduce((s, i) => s + i.totalSGST, 0)), dS(ev, "right"), NF);
    sc(ws, row, 11, r2(inw.reduce((s, i) => s + i.totalIGST, 0)), dS(ev, "right"), NF);
    sc(ws, row, 12, r2(inw.reduce((s, i) => s + i.total, 0)), dS(ev, "right"), NF);
    // Net total
    sc(ws, row, 13, r2(list.reduce((s, i) => s + i.total, 0)), dS(ev, "right"), NF);
    row++;
  });

  // Grand Total row
  const gt = totS(); const gtr = { ...gt, alignment: { horizontal: "right" as const } }; const gtc = { ...gt, alignment: { horizontal: "center" as const } };
  const outAll = invoices.filter((i) => i.type === "OUTWARD");
  const inwAll = invoices.filter((i) => i.type === "INWARD");
  sc(ws, row, 0, "GRAND TOTAL", gt);
  sc(ws, row, 1, outAll.length, gtc);
  sc(ws, row, 2, r2(outAll.reduce((s, i) => s + i.subtotal, 0)), gtr, NF);
  sc(ws, row, 3, r2(outAll.reduce((s, i) => s + i.totalCGST, 0)), gtr, NF);
  sc(ws, row, 4, r2(outAll.reduce((s, i) => s + i.totalSGST, 0)), gtr, NF);
  sc(ws, row, 5, r2(outAll.reduce((s, i) => s + i.totalIGST, 0)), gtr, NF);
  sc(ws, row, 6, r2(outAll.reduce((s, i) => s + i.total, 0)), gtr, NF);
  sc(ws, row, 7, inwAll.length, gtc);
  sc(ws, row, 8, r2(inwAll.reduce((s, i) => s + i.subtotal, 0)), gtr, NF);
  sc(ws, row, 9, r2(inwAll.reduce((s, i) => s + i.totalCGST, 0)), gtr, NF);
  sc(ws, row, 10, r2(inwAll.reduce((s, i) => s + i.totalSGST, 0)), gtr, NF);
  sc(ws, row, 11, r2(inwAll.reduce((s, i) => s + i.totalIGST, 0)), gtr, NF);
  sc(ws, row, 12, r2(inwAll.reduce((s, i) => s + i.total, 0)), gtr, NF);
  sc(ws, row, 13, r2(invoices.reduce((s, i) => s + i.total, 0)), gtr, NF);

  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: row, c: SC - 1 } });
  ws["!merges"] = sMerges;
  ws["!cols"] = [
    { wch: 28 }, // Firm Name
    { wch: 10 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, // Outward
    { wch: 10 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, // Inward
    { wch: 20 }, // Net Total
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Summary");

  // ── Per-Business Sheets ──
  bizIds.forEach((bizId) => {
    const biz = bizMap[bizId];
    const list = byBiz[bizId];
    const bizName = biz?.name || bizId;
    const gstin = (biz as any)?.gst_number || (biz as any)?.gst || "-";

    // Group by month
    const byMonth: Record<string, Invoice[]> = {};
    list.forEach((inv) => { const k = mk(inv.invoice_date); if (!byMonth[k]) byMonth[k] = []; byMonth[k].push(inv); });
    const mKeys = Object.keys(byMonth).sort();

    const bws: any = {};
    const merges: any[] = [];
    let r = 0;

    // For each month: write Outward section, then Inward section
    mKeys.forEach((mKey) => {
      const mInvs = byMonth[mKey];
      const outInvs = mInvs.filter((i) => i.type === "OUTWARD");
      const inInvs = mInvs.filter((i) => i.type === "INWARD");
      const mLbl = ml(mKey);

      // ── Outward Supply section ──
      if (outInvs.length > 0) {
        r = writeHeader(bws, merges, r, bizName, "Outward Supply", mLbl, gstin);
        r = writeColHeaders(bws, r);
        r = writeInvoices(bws, r, outInvs, custMap);
        r = writeGrandTotal(bws, merges, r, outInvs);
      }

      // ── Inward Supply section ──
      if (inInvs.length > 0) {
        r = writeHeader(bws, merges, r, bizName, "Inward Supply", mLbl, gstin);
        r = writeColHeaders(bws, r);
        r = writeInvoices(bws, r, inInvs, custMap);
        r = writeGrandTotal(bws, merges, r, inInvs);
      }
    });

    // ── Period Summary at the bottom ──
    if (mKeys.length > 0) {
      r += 2; // 2 blank rows

      // Summary header
      const summS = () => ({ font: { bold: true, sz: 12, name: "Arial", color: { rgb: WHITE } }, fill: { fgColor: { rgb: DARK_BLUE } }, alignment: { horizontal: "center" as const, vertical: "center" as const }, border: bdr() });
      const dateRange = `${ml(mKeys[0])} to ${ml(mKeys[mKeys.length - 1])}`;
      sc(bws, r, 0, `PERIOD SUMMARY (${dateRange})`, summS());
      fillR(bws, r, TC, summS());
      merges.push({ s: { r, c: 0 }, e: { r, c: TC - 1 } });
      r++;

      // Sub-header row for values
      const subHdrS = () => ({ font: { bold: true, sz: 9, name: "Arial", color: { rgb: DARK_BLUE } }, fill: { fgColor: { rgb: LIGHT_BLUE } }, alignment: { horizontal: "center" as const, vertical: "center" as const }, border: bdr() });
      sc(bws, r, 0, "Supply Type", subHdrS());
      fillR(bws, r, 10, subHdrS());
      merges.push({ s: { r, c: 0 }, e: { r, c: 9 } });
      sc(bws, r, 10, "Taxable Value", subHdrS());
      sc(bws, r, 11, "CGST", subHdrS());
      sc(bws, r, 12, "SGST", subHdrS());
      sc(bws, r, 13, "IGST", subHdrS());
      sc(bws, r, 14, "Total Invoice Value", subHdrS());
      r++;

      const allOut = list.filter(i => i.type === "OUTWARD");
      const allIn = list.filter(i => i.type === "INWARD");

      const rowS = (ev: boolean) => ({ font: { sz: 10, name: "Arial" }, fill: ev ? { fgColor: { rgb: LIGHT_BLUE } } : undefined, border: bdr() });
      const rowSR = (ev: boolean) => ({ ...rowS(ev), alignment: { horizontal: "right" as const } });

      // Outward row
      if (allOut.length > 0) {
        sc(bws, r, 0, `Outward Supply (${allOut.length} invoices)`, rowS(true));
        fillR(bws, r, 10, rowS(true));
        merges.push({ s: { r, c: 0 }, e: { r, c: 9 } });
        sc(bws, r, 10, r2(allOut.reduce((s, i) => s + i.subtotal, 0)), rowSR(true), NF);
        sc(bws, r, 11, r2(allOut.reduce((s, i) => s + i.totalCGST, 0)), rowSR(true), NF);
        sc(bws, r, 12, r2(allOut.reduce((s, i) => s + i.totalSGST, 0)), rowSR(true), NF);
        sc(bws, r, 13, allOut.some(i => i.totalIGST > 0) ? r2(allOut.reduce((s, i) => s + i.totalIGST, 0)) : 0, rowSR(true), NF);
        sc(bws, r, 14, r2(allOut.reduce((s, i) => s + i.total, 0)), rowSR(true), NF);
        r++;
      }

      // Inward row
      if (allIn.length > 0) {
        sc(bws, r, 0, `Inward Supply (${allIn.length} invoices)`, rowS(false));
        fillR(bws, r, 10, rowS(false));
        merges.push({ s: { r, c: 0 }, e: { r, c: 9 } });
        sc(bws, r, 10, r2(allIn.reduce((s, i) => s + i.subtotal, 0)), rowSR(false), NF);
        sc(bws, r, 11, r2(allIn.reduce((s, i) => s + i.totalCGST, 0)), rowSR(false), NF);
        sc(bws, r, 12, r2(allIn.reduce((s, i) => s + i.totalSGST, 0)), rowSR(false), NF);
        sc(bws, r, 13, allIn.some(i => i.totalIGST > 0) ? r2(allIn.reduce((s, i) => s + i.totalIGST, 0)) : 0, rowSR(false), NF);
        sc(bws, r, 14, r2(allIn.reduce((s, i) => s + i.total, 0)), rowSR(false), NF);
        r++;
      }

      // Grand Total row
      const ts = totS(); const tsr = { ...ts, alignment: { horizontal: "right" as const } };
      sc(bws, r, 0, "GRAND TOTAL", ts);
      fillR(bws, r, 10, ts);
      merges.push({ s: { r, c: 0 }, e: { r, c: 9 } });
      sc(bws, r, 10, r2(list.reduce((s, i) => s + i.subtotal, 0)), tsr, NF);
      sc(bws, r, 11, r2(list.reduce((s, i) => s + i.totalCGST, 0)), tsr, NF);
      sc(bws, r, 12, r2(list.reduce((s, i) => s + i.totalSGST, 0)), tsr, NF);
      sc(bws, r, 13, list.some(i => i.totalIGST > 0) ? r2(list.reduce((s, i) => s + i.totalIGST, 0)) : 0, tsr, NF);
      sc(bws, r, 14, r2(list.reduce((s, i) => s + i.total, 0)), tsr, NF);
      r++;
    }

    bws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r, c: TC - 1 } });
    bws["!merges"] = merges;
    bws["!cols"] = COL_W;

    XLSX.utils.book_append_sheet(wb, bws, trunc(bizName));
  });

  const wbOut = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([wbOut], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function downloadReportExcel(options: ReportOptions, filename?: string) {
  const blob = generateReportExcel(options);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "GST Report.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}
