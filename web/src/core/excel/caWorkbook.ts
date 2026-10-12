import { excelBlob, uniqueSheetNames, type Cell, type Row, type Sheet } from "./writer";

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
    gstr3b: { month: string; stage: string; tables: WorkbookRecord; filing: WorkbookRecord | null }[];
    amendments: WorkbookRecord[];
  }[];
}

const LINE_HEAD = ["S.No.", "Bill No.", "Date", "Party", "GSTIN or PAN", "Item", "HSN", "GST rate", "Qty", "Unit", "Rate per unit", "Taxable value", "CGST", "SGST", "IGST", "Round off", "Bill value", "Payment"];
const LINE_W = [44, 120, 92, 170, 140, 170, 68, 64, 80, 52, 100, 112, 90, 90, 90, 80, 112, 96, 120, 120];
const TOTAL_KEYS = ["taxable", "cgst", "sgst", "igst", "round_off", "value"] as const;
const record = (value: WorkbookValue | undefined): WorkbookRecord => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const records = (value: WorkbookValue | undefined) => Array.isArray(value) ? value.map(record) : [];
const scalar = (value: WorkbookValue | undefined): string | number => value === null || value === undefined ? "" : typeof value === "boolean" ? value ? "Yes" : "No" : Array.isArray(value) ? value.map(scalar).join(", ") : typeof value === "object" ? "" : value;
const get = (value: WorkbookRecord, path: string) => path.split(".").reduce<WorkbookValue | undefined>((current, key) => record(current)[key], value);
const cells = (values: (string | number)[]): Cell[] => values.map(v => ({ v }));
const band = (value: string, width: number): Row => ({ kind: "band", cells: [{ v: value, span: width }] });
const head = (values: string[]): Row => ({ kind: "head", cells: cells(values) });
const totalCells = (totals: WorkbookTotals) => TOTAL_KEYS.map(key => ({ v: totals[key], num: true }));
type Column = [label: string, path: string, numeric?: boolean];
const moneyColumns: Column[] = [["Taxable value", "taxable", true], ["IGST", "igst", true], ["CGST", "cgst", true], ["SGST", "sgst", true]];
function table(rows: Row[], title: string, values: WorkbookRecord[], columns: Column[]) {
  rows.push(band(title, columns.length), head(columns.map(([label]) => label)));
  for (const value of values) rows.push({ kind: "data", cells: columns.map(([, path, num]) => ({ v: scalar(get(value, path)), num })) });
}

function splitRows(rows: Row[], split: WorkbookRecord[]) {
  if (!split.length) return;
  table(rows, "PAYMENT SPLIT (cash / bank)", split, [["Mode", "mode"], ["Bills", "bills", true], ["Bill value", "value", true], ...moneyColumns, ["Share %", "share", true]]);
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
  const summary: Sheet = { name: "Summary", cols: [170, ...Array<number>(14).fill(112)], rows: [
    { kind: "title", cells: [{ v: `GST BILL SUMMARY · ${data.scope.toUpperCase()} · ${data.period.toUpperCase()}`, span: 15 }] },
    { kind: "band", cells: [{ v: "" }, { v: "SALES (OUTWARD SUPPLY)", span: 7 }, { v: "PURCHASES (INWARD SUPPLY)", span: 7 }] },
    head(["Firm", ...["Bills", "Taxable value", "CGST", "SGST", "IGST", "Round off", "Bill value"], ...["Bills", "Taxable value", "CGST", "SGST", "IGST", "Round off", "Bill value"]]),
    ...data.summary.map(row => ({ kind: "data" as const, cells: [{ v: row.firm }, { v: row.sales.bills ?? 0, num: true }, ...totalCells(row.sales), { v: row.purchases.bills ?? 0, num: true }, ...totalCells(row.purchases)] })),
  ], note: "Sales and purchases sit side by side and are never added together." };
  const gstr1: Sheet = { name: "GSTR-1", cols: Array<number>(12).fill(140), rows: [], note: "Amounts are in rupees. Figures come from the server; carats use CTM." };
  const gstr3b: Sheet = { name: "GSTR-3B", cols: Array<number>(12).fill(140), rows: [], note: "Amounts are in rupees. Figures come from the server; filed returns keep their recorded figures." };
  const amendments: Sheet = { name: "Amendments", cols: Array<number>(19).fill(140), rows: [] };
  const firms = data.firms.map((value, i) => {
    const rows: Row[] = [];
    for (const month of value.months) for (const side of ["sales", "purchases"] as const) {
      const section = month[side];
      rows.push(band(value.firm.name.toUpperCase(), 20), { kind: "sub", cells: [{ v: side === "sales" ? "Sales (outward supply)" : "Purchases (inward supply)", span: 20 }] }, { kind: "sub", cells: [{ v: `Month: ${month.month}`, span: 20 }] }, { kind: "sub", cells: [{ v: `GSTIN: ${value.firm.gst_number}`, span: 20 }] });
      rows.push(head([...LINE_HEAD, ...(side === "sales" ? ["GSTR-1 table", "Place of supply"] : ["Credit in", "Credit state"])]));
      for (const line of section.rows) rows.push({ kind: "data", cells: line.map((v, column) => ({ v, num: [0, 7, 8, 10, 11, 12, 13, 14, 15, 16].includes(column) })) });
      rows.push({ kind: "total", cells: [{ v: "TOTAL", span: 11 }, ...totalCells(section.totals)] });
      splitRows(rows, section.split);
      rows.push({ kind: "blank", cells: [] });
    }
    for (const entry of value.gstr1) gstr1Rows(gstr1.rows, value.firm.name, entry);
    for (const entry of value.gstr3b) gstr3bRows(gstr3b.rows, value.firm.name, entry);
    if (value.amendments.length) table(amendments.rows, value.firm.name, value.amendments.map(row => ({ ...row, too_late_words: row.too_late ? "Too late to amend" : "Within time" })), [["Corrected month", "month"], ["Bill No.", "invoice_number"], ["Change", "kind"], ["Section", "section"], ["Place of supply", "place_of_supply"], ["GST rate", "rate", true], ...["before", "after"].flatMap(side => [...moneyColumns, ["Bill value", "total", true] as Column].map(([label, key, num]): Column => [`${side === "before" ? "As filed" : "Now"} · ${label}`, `${side}.${key}`, num])), ["Tax difference", "tax_diff", true], ["Goes in", "goes_in"], ["Amendment deadline", "too_late_words"]]);
    return { name: reserved[i + 4], cols: LINE_W, rows, note: "Amounts are in rupees. One row per item; a bill's number, date, party, round off and value sit on its first row. Carats and pieces have their own unit column." };
  });
  return [summary, ...firms, gstr1, gstr3b, ...(amendments.rows.length ? [amendments] : [])];
}

export function workbookBlob(data: CaWorkbook): Promise<Blob> { return excelBlob(workbookSheets(data)); }
