import { excelBlob, uniqueSheetNames, type Cell, type Row, type Sheet } from "./writer";
import { paiseToDecimal, toPaise } from "@/core/format";

export type WorkbookValue = string | number | boolean | null | WorkbookValue[] | { [key: string]: WorkbookValue };
export type WorkbookRecord = { [key: string]: WorkbookValue };
export interface WorkbookTotals { bills?: number; taxable: string; cgst: string; sgst: string; igst: string; round_off: string; value: string }
export interface WorkbookSection { rows: (string | number)[][]; totals: WorkbookTotals; split: WorkbookRecord[] }
export interface CaWorkbook {
  scope: string; period: string; file: string;
  summary: { firm: string; sales: WorkbookTotals; purchases: WorkbookTotals }[];
  firms: {
    firm: { id: number; name: string; gst_number: string };
    months: { month: string; sales: WorkbookSection; purchases: WorkbookSection }[];
    gstr1: { month: string; stage: string; sections: WorkbookRecord }[];
    gstr3b: { month: string; stage: string; tables: WorkbookRecord | null; filing: WorkbookRecord | null }[];
    amendments: WorkbookRecord[];
  }[];
}

// X-81: A:P are the CA's existing v2 Excel Report, including its legacy unit labels.
// Native units and the unrounded rate follow those columns; no quantity is converted.
const LINE_HEAD = ["S.No.", "Bill No.", "Invoice Date", "Party Name", "GST Number", "Commodity", "HSN Code", "GST Rate", "Qty (gm)", "Rate (₹/gm)", "Taxable Value (₹)", "CGST (₹)", "SGST (₹)", "IGST (₹)", "Round Off (₹)", "Total Invoice Value (₹)", "Payment", "Unit", "Rate per unit"];
const LINE_W = [44, 120, 92, 170, 140, 170, 68, 64, 80, 100, 112, 90, 90, 90, 80, 140, 96, 52, 100, 120, 120];
const MONEY_FORMAT = "#,##0.00";
const TOTAL_HEAD = LINE_HEAD.slice(10, 16);
const TOTAL_KEYS = ["taxable", "cgst", "sgst", "igst", "round_off", "value"] as const;
const record = (value: WorkbookValue | undefined): WorkbookRecord => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const records = (value: WorkbookValue | undefined) => Array.isArray(value) ? value.map(record) : [];
const scalar = (value: WorkbookValue | undefined): string | number => value === null || value === undefined ? "" : typeof value === "boolean" ? value ? "Yes" : "No" : Array.isArray(value) ? value.map(scalar).join(", ") : typeof value === "object" ? "" : value;
const get = (value: WorkbookRecord, path: string) => path.split(".").reduce<WorkbookValue | undefined>((current, key) => record(current)[key], value);
const cells = (values: (string | number)[]): Cell[] => values.map(v => ({ v }));
const band = (value: string, width: number): Row => ({ kind: "band", cells: [{ v: value, span: width }] });
const head = (values: string[]): Row => ({ kind: "head", cells: cells(values) });
const totalCells = (totals: WorkbookTotals) => TOTAL_KEYS.map(key => ({ v: totals[key], num: true, format: MONEY_FORMAT }));
const countCell = (value: number): Cell => ({ v: value, num: true, format: "General" });
const addMoney = (values: string[]) => paiseToDecimal(values.reduce((sum, value) => sum + (toPaise(value) ?? 0), 0));
function sumTotals(values: WorkbookTotals[]): WorkbookTotals {
  return { bills: values.reduce((sum, value) => sum + (value.bills ?? 0), 0),
    ...Object.fromEntries(TOTAL_KEYS.map(key => [key, addMoney(values.map(value => value[key]))])) } as WorkbookTotals;
}
const payment = (value: string | number) => String(value).replace(/^./, first => first.toUpperCase());
const monthLabel = (month: string) => `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;

function invoiceOrder(a: WorkbookSection["rows"][number], b: WorkbookSection["rows"][number]): number {
  const left = String(a[1]), right = String(b[1]);
  const na = parseInt(left, 10), nb = parseInt(right, 10);
  // Match v2's canonical-integer shortcut and the browser's own numeric collation.
  return String(a[2]).localeCompare(String(b[2])) ||
    (!Number.isNaN(na) && !Number.isNaN(nb) && String(na) === left && String(nb) === right
      ? na - nb : left.localeCompare(right, undefined, { numeric: true }));
}

function invoiceRows(lines: WorkbookSection["rows"]): Row[] {
  const bills: WorkbookSection["rows"][] = [];
  for (const line of lines) {
    if (line[0] !== "") bills.push([]);
    bills[bills.length - 1].push(line);
  }
  bills.sort((a, b) => invoiceOrder(a[0], b[0]));
  return bills.flatMap((bill, index) => bill.map((line, item) => {
    const empty = line[8] === "" && line[10] === "";
    const values = [item === 0 ? index + 1 : "", line[1], String(line[2]).split("-").reverse().join("-"), line[3], line[4],
      empty ? "" : line[5], line[6], line[7] === "" ? "" : `${line[7]}%`, empty ? "0.000" : line[8],
      // Only this legacy display column follows v2's Math.round, including halfway rates.
      // The server's amounts and the precise rate in column S stay intact.
      paiseToDecimal(Math.round(Number(line[10]) * 100)), ...line.slice(11, 17), item === 0 ? payment(line[17]) : "", line[9], line[10], ...line.slice(18)];
    return { kind: "data", cells: values.map((v, column): Cell => ({ v,
      ...([0, 8, 9, 10, 11, 12, 13, 14, 15, 18].includes(column) ? { num: true,
        format: column === 0 ? "General" : column === 8 || column === 18 ? "#,##0.000" : MONEY_FORMAT } : {}),
    })) };
  }));
}

function summaryRow(label: string, sales: WorkbookTotals, purchases: WorkbookTotals, kind: Row["kind"] = "data"): Row {
  return { kind, cells: [{ v: label }, countCell(sales.bills ?? 0), ...totalCells(sales), countCell(purchases.bills ?? 0), ...totalCells(purchases),
    { v: addMoney([sales.value, purchases.value]), num: true, format: MONEY_FORMAT }] };
}
type Column = [label: string, path: string, numeric?: boolean];
const moneyColumns: Column[] = [["Taxable value", "taxable", true], ["IGST", "igst", true], ["CGST", "cgst", true], ["SGST", "sgst", true]];
function table(rows: Row[], title: string, values: WorkbookRecord[], columns: Column[]) {
  rows.push(band(title, columns.length), head(columns.map(([label]) => label)));
  for (const value of values) rows.push({ kind: "data", cells: columns.map(([, path, num]) => ({ v: scalar(get(value, path)), num })) });
}

function splitRows(rows: Row[], split: WorkbookRecord[], lines: WorkbookSection["rows"]) {
  if (!split.length) return;
  const modes = new Map<string, number>();
  for (const line of lines.filter(line => line[0] !== "").sort(invoiceOrder)) {
    const mode = String(line[17]).trim();
    if (!modes.has(mode)) modes.set(mode, modes.size);
  }
  const ordered: WorkbookRecord[] = [];
  const gross = split.map(value => toPaise(scalar(value.value)));
  for (let start = 0; start < split.length;) {
    let end = start + 1;
    while (end < split.length && gross[end] === gross[start]) end += 1;
    const group = split.slice(start, end).sort((a, b) =>
      (modes.get(String(scalar(a.mode)).trim()) ?? Infinity) - (modes.get(String(scalar(b.mode)).trim()) ?? Infinity));
    // Equal-gross modes keep the server's shares by position, including its last
    // residual. Only their locale-dependent presentation order changes.
    group.forEach((value, index) => ordered.push({ ...value, share: split[start + index].share }));
    start = end;
  }
  rows.push({ kind: "blank", cells: [] }, band("PAYMENT SPLIT (cash / bank)", 9),
    head(["MODE", "INVOICES", "GROSS (₹)", "TAXABLE (₹)", "GST (₹)", "SHARE %", "IGST (₹)", "CGST (₹)", "SGST (₹)"]));
  for (const value of ordered) {
    const heads = ["igst", "cgst", "sgst"].map(key => String(scalar(value[key])));
    rows.push({ kind: "data", cells: [{ v: payment(scalar(value.mode) || "(not set)") }, countCell(Number(value.bills)),
      ...[scalar(value.value), scalar(value.taxable), addMoney(heads)].map(v => ({ v, num: true, format: MONEY_FORMAT })),
      { v: scalar(value.share), num: true, format: "0.0000" }, ...heads.map(v => ({ v, num: true, format: MONEY_FORMAT }))] });
  }
  rows.push({ kind: "blank", cells: [] });
}

function gstr1Rows(rows: Row[], firm: string, value: CaWorkbook["firms"][number]["gstr1"][number]) {
  const data = value.sections;
  rows.push(band(`${firm} · ${value.month} · ${value.stage}`, 12));
  table(rows, "B2B", records(data.b2b), [["Bill No.", "bill.invoice_number"], ["Date", "bill.invoice_date"], ["Place of supply", "place_of_supply"], ["GST rate", "rates"], ...moneyColumns, ["Bill value", "total", true]]);
  const b2cl = records(data.b2cl).flatMap(row => records(row.rates).map(rate => ({ ...row, ...rate })));
  table(rows, "B2CL", b2cl, [["Bill No.", "bill.invoice_number"], ["Date", "bill.invoice_date"], ["Place of supply", "place_of_supply"], ["GST rate", "rate", true], ...moneyColumns, ["Bill value", "total", true]]);
  table(rows, "B2CS", records(data.b2cs), [["Place of supply", "place_of_supply"], ["State", "place_of_supply_name"], ["Inter-state", "interstate"], ["GST rate", "rate", true], ["Bills", "bills", true], ...moneyColumns]);
  table(rows, "Nil and exempt", records(data.nil), [["Supply", "supply"], ["Bills", "bills", true], ["Value", "value", true]]);
  table(rows, "By GST rate", records(data.by_rate), [["GST rate", "rate", true], ["Bills", "bills", true], ...moneyColumns, ["Tax", "tax", true], ["Value", "value", true]]);
  const hsn = record(data.hsn);
  const hsnGroups = Array.isArray(hsn.data) ? [["HSN · all buyers", hsn.data]] as const : [["HSN B2B", hsn.b2b], ["HSN B2C", hsn.b2c]] as const;
  for (const [label, values] of hsnGroups) table(rows, label, records(values), [["HSN", "hsn"], ["Description", "description"], ["UQC", "uqc"], ["Qty", "quantity", true], ["GST rate", "rate", true], ...moneyColumns, ["Bills", "bills", true], ["Service", "service"]]);
  table(rows, "Table 13 · Documents issued", records(data.docs), [["From", "from"], ["To", "to"], ["Total", "total", true], ["Cancelled", "cancelled", true], ["Net issued", "net", true]]);
  if (Array.isArray(data.docs_notes)) for (const note of data.docs_notes) rows.push({ kind: "sub", cells: [{ v: scalar(note), span: 12 }] });
  table(rows, "Cancelled and deleted bills", records(data.cancelled), [["Bill No.", "bill.invoice_number"], ["Date", "bill.invoice_date"], ["Kind", "kind"], ["Bill value", "total", true], ["Reason", "reason"], ["On", "on"]]);
  table(rows, "Amendment sections carried", [record(data.amendments)], [["B2BA", "b2ba", true], ["B2CLA", "b2cla", true], ["B2CSA", "b2csa", true]]);
}

function gstr3bRows(rows: Row[], firm: string, value: CaWorkbook["firms"][number]["gstr3b"][number]) {
  const data = value.tables;
  if (data === null) {
    rows.push(band(`${firm} · ${value.month}`, 12), { kind: "sub", cells: [{ v: "Before the app's credit ledger (it starts April 2025).", span: 12 }] });
    return;
  }
  rows.push(band(`${firm} · ${value.month} · ${value.stage === "filed" ? "Filed" : "To file"}`, 12));
  if (value.filing) table(rows, "Filing record", [value.filing], [["Filed on", "filed_on"], ["ARN", "arn"], ["Recorded by", "marked_by.name"], ["Recorded at", "marked_at"], ["Cash paid", "cash.total", true], ["Cash worked out", "cash_worked_out.total", true], ["Late fee", "late_fee", true], ["Interest", "interest", true]]);
  // These four rows are fixed zero by design 3-D7; every other figure is supplied by the server.
  const zero = { taxable: "0.00", igst: "0.00", cgst: "0.00", sgst: "0.00", total: "0.00", bills: 0 };
  table(rows, "3.1 · Outward supplies", [{ ...record(data.t31a), label: "3.1(a) · Taxable" }, { ...zero, label: "3.1(b) · Zero-rated" }, { ...record(data.t31c), label: "3.1(c) · Nil and exempt" }, ...["3.1(d) · Reverse charge", "3.1(e) · Non-GST", "3.1.1 · E-commerce supplies"].map(label => ({ ...zero, label }))], [["Table", "label"], ...moneyColumns, ["Bills", "bills", true], ["Value", "total", true]]);
  table(rows, "3.2 · Inter-state supplies", records(data.t32), [["Place of supply", "place_of_supply"], ["State", "place_of_supply_name"], ["Bills", "bills", true], ["Taxable value", "taxable", true], ["IGST", "igst", true]]);
  const credit = [["t4a5", "Credit on purchases [4(A)(5)]"], ["t4b1", "Credit not allowed [4(B)(1)]"], ["t4c", "Credit available [4(C)]"], ["t4d2", "Credit too late to claim [4(D)(2)]"]] as const;
  table(rows, "4 · Input tax credit", credit.map(([key, label]) => ({ label, ...record(data[key]), ...record(record(data[key]).heads) })), [["Table", "label"], ["Bills", "bills", true], ...moneyColumns.slice(1)]);
  const purchaseColumns: Column[] = [["Bill No.", "bill_no"], ["Bill date", "bill_date"], ["Supplier", "supplier_name"], ["Entered on", "entered_on"], ["IGST", "heads.igst", true], ["CGST", "heads.cgst", true], ["SGST", "heads.sgst", true]];
  table(rows, "Earlier purchases in this return", records(record(data.t4a5).late), purchaseColumns);
  table(rows, "Credit not allowed · bills", records(record(data.t4b1).list), purchaseColumns);
  table(rows, "Credit too late to claim · bills", records(record(data.t4d2).list), purchaseColumns);
  table(rows, "Credit to confirm", records(data.to_confirm), purchaseColumns);
  table(rows, "5 · Exempt, nil and non-GST purchases", [record(data.t5)], [["Inter-state", "inter", true], ["Within the state", "intra", true]]);
  for (const note of [data.t5_note, data.reduction_note]) if (typeof note === "string" && note) rows.push({ kind: "sub", cells: [{ v: note, span: 12 }] });
  const balanceKeys = [["carry_in", "Credit carried in"], ["available", "Credit available"], ["used", "6.1 · Credit used"], ["cash", "6.1 · Cash to pay"], ["cash_paid", "6.1 · Cash paid"], ["carry_on", "Credit carried on"]] as const;
  table(rows, "6.1 · Payment and credit carried", balanceKeys.filter(([key]) => data[key] != null).map(([key, label]) => ({ label, ...record(data[key]), ...record(record(data[key]).heads) })), [["Working", "label"], ...moneyColumns.slice(1), ["Total", "total", true], ["From", "from"], ["As filed", "as_filed"], ["Opening", "opening"]]);
  table(rows, "Credit set-off", records(data.steps), [["Credit head", "from"], ["Tax head", "to"], ["Amount", "amount", true]]);
  if (data.amendments) table(rows, "Corrections carried", [record(data.amendments)], [["Corrected months", "months"], ["Output IGST", "output.igst", true], ["Output CGST", "output.cgst", true], ["Output SGST", "output.sgst", true], ["Credit IGST", "credit.igst", true], ["Credit CGST", "credit.cgst", true], ["Credit SGST", "credit.sgst", true]]);
  if (data.late) {
    const late = record(data.late);
    table(rows, `Late fee · ${late.recorded ? "as recorded" : "estimate"}`, ["gstr1", "gstr3b"].map(kind => ({ ...record(late[kind]), kind: kind === "gstr1" ? "GSTR-1" : "GSTR-3B" })), [["Return", "kind"], ["Days", "days", true], ["Per day", "per_day", true], ["Late fee", "fee", true], ["Cap", "cap", true], ["Capped", "capped"]]);
    table(rows, `Late fee and interest · ${late.recorded ? "as recorded" : "estimate"}`, [{ ...late, interest_note: data.interest_note ?? "" }], [["Interest", "interest", true], ["Interest on", "interest_on", true], ["Interest from", "interest_from"], ["Total", "total", true], ["Interest note", "interest_note"]]);
  }
  if (data.opening_missing) rows.push({ kind: "sub", cells: [{ v: "The opening credit isn't typed yet, so the credit carried in may be too low.", span: 12 }] });
}

/** The preview and the file use these same cells, with all figures taken from §10.2. */
export function workbookSheets(data: CaWorkbook): Sheet[] {
  const reserved = uniqueSheetNames(["Summary", "GSTR-1", "GSTR-3B", "Amendments", ...data.firms.map(value => value.firm.name)]);
  const active = data.summary.filter(row => (row.sales.bills ?? 0) + (row.purchases.bills ?? 0) > 0);
  const summary: Sheet = { name: "Summary", cols: [170, ...Array<number>(15).fill(112)], rows: [
    { kind: "title", cells: [{ v: "GST INVOICE SUMMARY – ALL FIRMS", span: 16 }] },
    { kind: "band", cells: [{ v: "" }, { v: "OUTWARD SUPPLY", span: 7 }, { v: "INWARD SUPPLY", span: 7 }, { v: "" }] },
    head(["Firm Name", "Invoices", ...TOTAL_HEAD, "Invoices", ...TOTAL_HEAD, "Net Total (₹)"]),
    ...active.map(row => summaryRow(row.firm, row.sales, row.purchases)),
    summaryRow("GRAND TOTAL", sumTotals(active.map(row => row.sales)), sumTotals(active.map(row => row.purchases)), "total"),
  ], note: `${data.scope} · ${data.period}. Net Total is the combined invoice value of sales and purchases.` };
  const gstr1: Sheet = { name: "GSTR-1", cols: Array<number>(12).fill(140), rows: [], note: "Amounts are in rupees. Figures come from the server; carats use CTM." };
  const gstr3b: Sheet = { name: "GSTR-3B", cols: Array<number>(12).fill(140), rows: [], note: "Amounts are in rupees. Figures come from the server; filed returns keep their recorded figures." };
  const amendments: Sheet = { name: "Amendments", cols: Array<number>(19).fill(140), rows: [] };
  const firms = data.firms.map((value, i) => {
    const rows: Row[] = [];
    const populated = value.months.filter(month => month.sales.rows.length || month.purchases.rows.length);
    for (const month of value.months) for (const side of ["sales", "purchases"] as const) {
      const section = month[side];
      if (!section.rows.length) continue;
      rows.push(band(value.firm.name.toUpperCase(), LINE_W.length), { kind: "sub", cells: [{ v: side === "sales" ? "Outward Supply" : "Inward Supply", span: LINE_W.length }] }, { kind: "sub", cells: [{ v: `Month: ${monthLabel(month.month)}`, span: LINE_W.length }] }, { kind: "sub", cells: [{ v: `GSTIN: ${value.firm.gst_number || "-"}`, span: LINE_W.length }] });
      rows.push(head([...LINE_HEAD, ...(side === "sales" ? ["GSTR-1 table", "Place of supply"] : ["Credit in", "Credit state"])]));
      rows.push(...invoiceRows(section.rows));
      const totals = totalCells(section.totals);
      if (!section.rows.some(line => (toPaise(line[14]) ?? 0) > 0)) totals[3] = { ...totals[3], v: "-" };
      rows.push({ kind: "total", cells: [{ v: "TOTAL", span: 10 }, ...totals] });
      splitRows(rows, section.split, section.rows);
    }
    if (populated.length) {
      const sales = sumTotals(populated.map(month => month.sales.totals));
      const purchases = sumTotals(populated.map(month => month.purchases.totals));
      rows.push({ kind: "blank", cells: [] }, { kind: "blank", cells: [] },
        band(`PERIOD SUMMARY (${monthLabel(populated[0].month)} to ${monthLabel(populated[populated.length - 1].month)})`, LINE_W.length),
        { kind: "head", cells: [{ v: "Supply Type", span: 10 }, ...cells(["Taxable Value", "CGST", "SGST", "IGST", "Round Off", "Total Invoice Value"])] });
      for (const [label, totals] of [["Outward Supply", sales], ["Inward Supply", purchases]] as const) {
        if (totals.bills) rows.push({ kind: "data", cells: [{ v: `${label} (${totals.bills} invoices)`, span: 10 }, ...totalCells(totals)] });
      }
      rows.push({ kind: "total", cells: [{ v: "GRAND TOTAL", span: 10 }, ...totalCells(sumTotals([sales, purchases]))] });
    }
    for (const entry of value.gstr1) gstr1Rows(gstr1.rows, value.firm.name, entry);
    for (const entry of value.gstr3b) gstr3bRows(gstr3b.rows, value.firm.name, entry);
    if (value.amendments.length) table(amendments.rows, value.firm.name, value.amendments.map(row => ({ ...row, too_late_words: row.too_late ? "Too late to amend" : "Within time" })), [["Corrected month", "month"], ["Bill No.", "invoice_number"], ["Change", "kind"], ["Section", "section"], ["Place of supply", "place_of_supply"], ["GST rate", "rate", true], ...["before", "after"].flatMap(side => [...moneyColumns, ["Bill value", "total", true] as Column].map(([label, key, num]): Column => [`${side === "before" ? "As filed" : "Now"} · ${label}`, `${side}.${key}`, num])), ["Tax difference", "tax_diff", true], ["Goes in", "goes_in"], ["Amendment deadline", "too_late_words"]]);
    return { name: reserved[i + 4], cols: LINE_W, rows, note: "Amounts are in rupees. A:P keep v2's Excel Report columns and labels. Quantities use each item's stored unit; Unit and the full-precision Rate per unit follow the legacy columns. A bill's details and value sit on its first row." };
  }).filter(sheet => sheet.rows.length);
  return [summary, ...firms, gstr1, gstr3b, ...(amendments.rows.length ? [amendments] : [])];
}

export function workbookBlob(data: CaWorkbook): Promise<Blob> { return excelBlob(workbookSheets(data)); }
