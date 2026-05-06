import * as XLSX from "xlsx-js-style";

const DARK_BLUE = "1F3864";
const LIGHT_BLUE = "DCE6F1";
const WHITE = "FFFFFF";
const AMBER = "FFC000";

function bdr() {
  const s = { style: "thin", color: { rgb: "B4C6E7" } };
  return { top: s, bottom: s, left: s, right: s };
}

const hdrS = () => ({
  font: { bold: true, sz: 10, name: "Arial", color: { rgb: WHITE } },
  fill: { fgColor: { rgb: DARK_BLUE } },
  alignment: { horizontal: "center" as const, vertical: "center" as const, wrapText: true },
  border: bdr(),
});

const metaS = () => ({
  font: { bold: true, sz: 11, name: "Arial", color: { rgb: DARK_BLUE } },
  fill: { fgColor: { rgb: LIGHT_BLUE } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
  border: bdr(),
});

const dataS = (even: boolean, align: "left" | "center" | "right" = "left") => ({
  font: { sz: 9, name: "Arial" },
  fill: even ? { fgColor: { rgb: LIGHT_BLUE } } : undefined,
  border: bdr(),
  alignment: { horizontal: align, vertical: "center" as const },
});

const totalS = () => ({
  font: { bold: true, sz: 10, name: "Arial" },
  fill: { fgColor: { rgb: AMBER } },
  border: bdr(),
});

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

const TC = 15;

function sc(ws: any, r: number, c: number, v: string | number, s: any, z?: string) {
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell: any = { v, s };
  if (typeof v === "number") { cell.t = "n"; if (z) cell.z = z; } else { cell.t = "s"; }
  ws[addr] = cell;
}

function fillR(ws: any, r: number, n: number, s: any) {
  for (let c = 0; c < n; c++) {
    const a = XLSX.utils.encode_cell({ r, c });
    if (!ws[a]) ws[a] = { v: "", t: "s", s };
  }
}

const SAMPLE_ROWS = [
  { sno: 1, bill: "100", date: "01-04-2025", party: "Rajesh Kumar", gst: "08AABCK5461H1ZO", commodity: "Gold Ornaments", hsn: "711319", gstRate: "3%", qty: 5.250, rate: 6500.00 },
  { sno: 2, bill: "101", date: "05-04-2025", party: "Priya Sharma", gst: "-", commodity: "Silver Ornaments", hsn: "711319", gstRate: "3%", qty: 45.000, rate: 120.00 },
  { sno: 3, bill: "102", date: "10-04-2025", party: "Deepak Ji Suthar", gst: "08BBDPK1234L1Z5", commodity: "Gold Ornaments", hsn: "711319", gstRate: "3%", qty: 3.150, rate: 7200.00 },
];

export function generateSampleExcel(): Blob {
  const ws: any = {};
  const merges: any[] = [];
  let r = 0;

  // Meta rows
  const metaRows = [
    "YOUR BUSINESS NAME",
    "Outward Supply",
    "Month: Apr 2025",
    "GSTIN: 08XXXXX1234X1ZX",
  ];
  metaRows.forEach((text) => {
    sc(ws, r, 0, text, metaS());
    fillR(ws, r, TC, metaS());
    merges.push({ s: { r, c: 0 }, e: { r, c: TC - 1 } });
    r++;
  });

  // Blank row
  r++;

  // Column headers
  COL_HDRS.forEach((h, c) => sc(ws, r, c, h, hdrS()));
  r++;

  // Data rows
  const NF = "#,##0.00";
  SAMPLE_ROWS.forEach((row, idx) => {
    const even = idx % 2 === 0;
    const taxable = Math.round(row.qty * row.rate * 100) / 100;
    const cgst = Math.round(taxable * 0.015 * 100) / 100;
    const sgst = cgst;
    const total = Math.round((taxable + cgst + sgst) * 100) / 100;

    sc(ws, r, 0, row.sno, dataS(even, "center"));
    sc(ws, r, 1, row.bill, dataS(even, "center"));
    sc(ws, r, 2, row.date, dataS(even, "center"));
    sc(ws, r, 3, row.party, dataS(even, "left"));
    sc(ws, r, 4, row.gst, dataS(even, "left"));
    sc(ws, r, 5, row.commodity, dataS(even, "left"));
    sc(ws, r, 6, row.hsn, dataS(even, "center"));
    sc(ws, r, 7, row.gstRate, dataS(even, "center"));
    sc(ws, r, 8, row.qty, dataS(even, "right"), "#,##0.000");
    sc(ws, r, 9, row.rate, dataS(even, "right"), NF);
    sc(ws, r, 10, taxable, dataS(even, "right"), NF);
    sc(ws, r, 11, cgst, dataS(even, "right"), NF);
    sc(ws, r, 12, sgst, dataS(even, "right"), NF);
    sc(ws, r, 13, 0, dataS(even, "right"), NF);
    sc(ws, r, 14, total, dataS(even, "right"), NF);
    r++;
  });

  // Total row
  const ts = totalS();
  const tsr = { ...ts, alignment: { horizontal: "right" as const } };
  sc(ws, r, 0, "TOTAL", ts);
  for (let c = 1; c <= 9; c++) sc(ws, r, c, "", ts);
  merges.push({ s: { r, c: 0 }, e: { r, c: 9 } });

  const totTaxable = SAMPLE_ROWS.reduce((s, row) => s + Math.round(row.qty * row.rate * 100) / 100, 0);
  const totCgst = Math.round(totTaxable * 0.015 * 100) / 100;
  const totSgst = totCgst;
  const totTotal = Math.round((totTaxable + totCgst + totSgst) * 100) / 100;

  sc(ws, r, 10, totTaxable, tsr, NF);
  sc(ws, r, 11, totCgst, tsr, NF);
  sc(ws, r, 12, totSgst, tsr, NF);
  sc(ws, r, 13, 0, tsr, NF);
  sc(ws, r, 14, totTotal, tsr, NF);

  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r, c: TC - 1 } });
  ws["!merges"] = merges;
  ws["!cols"] = COL_W;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sample Data");

  const wbOut = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([wbOut], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function downloadSampleExcel() {
  const blob = generateSampleExcel();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "invoice-import-template.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}
