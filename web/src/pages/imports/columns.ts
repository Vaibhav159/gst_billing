import { toPaise } from "@/core/format";
import type { Cell, Sheet } from "./parse";
export type BillKind = "sale" | "purchase";
export type Field = keyof typeof BILL_FIELDS;
export type Column = { i: number; heading: string; field: Field | null; sure: "sure" | "check" | "none" | "you" };
export type Table = { n: number; kind: BillKind | null; columns: Column[]; map: Partial<Record<Field, number>> };
export type ParsedLine = { n: number; item: string; hsn: string; slab: Cell; slabShown: string; qty: string; unit: string; price: string; making: number; taxable: number; cgst: number; sgst: number; igst: number; total: number; dropHeads?: boolean };
export type ParsedRow = ParsedLine & { number: string; date: string; party: string; gstin: string; payment: string; kind: BillKind | null; table: number; cont: boolean };
export type ReadSheet = { name: string; title: string; gstin: string; month: string; tables: Table[]; rows: ParsedRow[]; skipped: { n: number; text: string; why: string }[]; markers: boolean; summary: boolean };
export type ColumnOverrides = Record<number, Record<number, Field | "">>;
export const str = (value: Cell | undefined): string => value == null ? "" : value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,"0")}-${String(value.getDate()).padStart(2,"0")}` : String(value).trim();
const decimal = (value: Cell | undefined): string => str(value).replace(/[₹,\s]/g, "").replace(/^rs\.?/i, "").replace(/^-$/, "");
const paise = (value: Cell | undefined): number => toPaise(decimal(value)) ?? 0;
function dateCell(value: Cell | undefined): string {
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const d = new Date(Date.UTC(1899,11,30) + Math.floor(value)*86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
  }
  return str(value);
}
export const BILL_FIELDS = {
  sno: "Serial number", number: "Bill number", date: "Bill date", party: "Party (customer or supplier)", gstin: "Party's GSTIN",
  item: "Item", hsn: "HSN code", slab: "GST rate", qty: "Quantity (weight)", unit: "Unit", price: "Rate per unit", making: "Making charges",
  taxable: "Taxable value", cgst: "CGST", sgst: "SGST", igst: "IGST", total: "Bill total", payment: "Paid by",
};
const SURE = new Set(["s.no.", "s.no", "sr. no.", "bill no.", "bill no", "invoice no", "invoice no.", "invoice number", "voucher no.", "supplier bill no", "invoice date", "date", "bill date",
  "party name", "customer", "customer name", "supplier", "supplier name", "particulars", "gst number", "gstin", "gstin/uin", "party gstin", "customer gstin", "supplier gstin",
  "commodity", "item", "item name", "product", "description", "hsn code", "hsn", "hsn/sac", "gst rate", "gst %", "gst rate (%)", "tax rate", "qty", "quantity", "qty (gm)", "weight (g)",
  "uom", "unit", "rate", "rate (₹/gm)", "rate/g", "making", "making charges", "taxable value", "taxable value (₹)", "value", "cgst", "sgst", "igst", "cgst (₹)", "sgst (₹)", "igst (₹)",
  "central tax", "state tax", "state/ut tax", "integrated tax", "total", "total invoice value", "total invoice value (₹)", "gross total", "bill amount", "invoice amount", "payment", "paid by", "mode", "payment mode"]);
/** Which field a heading is, as today's importer reads it (with more spellings), or null. */
export function fieldOf(heading: Cell): Field | null {
  const v = str(heading).toLowerCase().replace(/\s+/g, " ");
  if (!v) return null;
  const percent = v.includes("%");
  const half = /cgst|sgst|utgst|central|state tax|state\/ut/.test(v);
  if (/^(s\.? ?no\.?|sr\.? ?no\.?|sl\.? ?no\.?|serial)\b/.test(v)) return "sno";
  if (/total tax|tax total|total gst|tax amount$/.test(v)) return null;
  if (/gstin|gst ?no\b|gst number|gst\/uin|uin/.test(v)) return "gstin";
  if (/(bill|invoice|inv|voucher|vch|doc(ument)?|ref)\.? ?(no|number|#)\b|^bill$|^invoice$|^voucher$/.test(v)) return "number";
  if (/date/.test(v)) return "date";
  if (/hsn|sac/.test(v)) return "hsn";
  if (/making|labour|wastage/.test(v)) return percent ? null : "making";
  if (/taxable|assessable|^value$|^net value|^amount before tax/.test(v)) return "taxable";
  if (!percent && !/\brate/.test(v) && /cgst|central tax/.test(v)) return "cgst";
  if (!percent && !/\brate/.test(v) && /sgst|utgst|state tax|state\/ut/.test(v)) return "sgst";
  if (!percent && !/\brate/.test(v) && /igst|integrated tax/.test(v)) return "igst";
  if (/gst rate|tax rate|^gst$|^gst slab|^slab/.test(v) || (percent && /gst|tax/.test(v) && !half && !/igst/.test(v)) || /^rate ?\(? ?% ?\)?$/.test(v)) return half ? null : "slab";
  if (/qty|quantity|weight|net wt|gross wt|wt\b/.test(v)) return "qty";
  if (!percent && (/\brate|price/.test(v))) return "price";
  if (/^uom$|^unit|units$/.test(v)) return "unit";
  if (/commodity|product|item|description|goods|stock/.test(v)) return "item";
  if (/party|customer|buyer|supplier|particulars|ledger|vendor|seller|name/.test(v)) return "party";
  if (/total|amount|grand|gross|bill value|invoice value/.test(v)) return "total";
  if (/payment|paid|mode|tender/.test(v)) return "payment";
  return null;
}
/** A row is the column headings when it names a bill, a party or an item and two more fields. */
function headingsOf(cells: Cell[]): Column[] | null {
  const cols = cells.map((c, i) => ({ i, heading: str(c), field: fieldOf(c) })).filter((c) => c.heading);
  const fields = new Set<Field | null>(cols.map((c) => c.field).filter(Boolean));
  if (fields.size < 3 || !(fields.has("number") || fields.has("party")) || !["item", "total", "taxable", "qty", "price"].some((f) => fields.has(f as Field))) return null;
  const seen = new Set<Field>();
  return cols.map((c) => {
    const field = c.field && !seen.has(c.field) ? c.field : null;
    if (field) seen.add(field);
    return { ...c, field, sure: field ? (SURE.has(c.heading.toLowerCase()) ? "sure" : "check") : "none" };
  });
}

const SECTION: Record<string, BillKind> = { "outward supply": "sale", outward: "sale", "inward supply": "purchase", inward: "purchase" };
const kindWord = (t: string): BillKind | null => (/purchase|inward/i.test(t) ? "purchase" : /sale|outward/i.test(t) ? "sale" : null);

/**
 * One sheet read into rows of bills. cols overrides a table's columns by its
 * heading row: { [headingRow]: { [colIndex]: field | "" } }.
 */
export function readSheet(sheet: Sheet, cols: ColumnOverrides = {}): ReadSheet {
  const rows = sheet.rows || [];
  const out: ReadSheet = { name: sheet.name, title: "", gstin: "", month: "", tables: [], rows: [], skipped: [], markers: false, summary: false };
  if (/^summary$/i.test(sheet.name.trim())) { out.summary = true; return out; }
  let kind: BillKind | null = null, table: Table | null = null, last: Omit<ParsedRow, "n" | "kind" | "table" | "cont"> | null = null;
  for (let i = 0; i < rows.length; i++) {
    const n = i + 1;
    const cells = (rows[i] || []).map((c) => (c instanceof Date ? str(c) : c));
    const texts = cells.map(str);
    const filled = texts.filter(Boolean);
    if (!filled.length) continue;
    const first = filled[0];
    const low = first.toLowerCase();
    if (SECTION[low] && filled.length === 1) {
      kind = SECTION[low]; out.markers = true; table = null; last = null;
      out.skipped.push({ n, text: first, why: `${kind === "sale" ? "Sales" : "Purchases"} start here` });
      continue;
    }
    const heads = headingsOf(cells);
    if (heads) {
      const fix = cols[n] || {};
      const columns: Column[] = heads.map((c) => (c.i in fix ? { ...c, field: fix[c.i] || null, sure: "you" as const } : c));
      table = { n, kind, columns, map: Object.fromEntries(columns.filter((c) => c.field).map((c) => [c.field, c.i])) };
      out.tables.push(table); last = null;
      continue;
    }
    if (!table) {
      if (/^gstin\b\s*[:\-]/i.test(first)) { out.gstin = first.replace(/^gstin\b\s*[:\-]\s*/i, "").toUpperCase(); out.skipped.push({ n, text: first, why: "The firm's GSTIN" }); continue; }
      if (/^month\b\s*[:\-]/i.test(first)) { out.month = first.replace(/^month\b\s*[:\-]\s*/i, ""); out.skipped.push({ n, text: first, why: "The month" }); continue; }
      if (!out.title && first.length > 3) { out.title = first; out.skipped.push({ n, text: first, why: "Title" }); continue; }
      out.skipped.push({ n, text: first, why: "Above the column headings" });
      continue;
    }
    if (/^(grand )?total\b|^sub ?total\b/i.test(first)) { out.skipped.push({ n, text: first, why: "A total row, not a bill" }); continue; }
    const active = table;
    const at = (f: Field): Cell => { const index = active.map[f]; return index == null ? null : cells[index] ?? null; };
    const v = {
      number: str(at("number")), date: dateCell(at("date")), party: str(at("party")), gstin: str(at("gstin")).toUpperCase(), payment: str(at("payment")),
      item: str(at("item")), hsn: str(at("hsn")).replace(/\.0+$/, ""), slab: at("slab"), slabShown: "slab" in table.map ? (sheet.shown?.[i]?.[table.map.slab!] ?? "") : "",
      qty: decimal(at("qty")), unit: str(at("unit")), price: decimal(at("price")), making: paise(at("making")),
      taxable: paise(at("taxable")), cgst: paise(at("cgst")), sgst: paise(at("sgst")), igst: paise(at("igst")), total: paise(at("total")),
    };
    const cont = !v.number && !v.party && Boolean(v.item);
    if (cont) {
      if (!last) { out.skipped.push({ n, text: v.item, why: "An item with no bill above it" }); continue; }
      Object.assign(v, { number: last.number, date: last.date, party: last.party, gstin: last.gstin, payment: v.payment || last.payment });
    }
    if (!v.number || !v.party) { out.skipped.push({ n, text: first, why: !v.number && !v.party ? "No bill number or party" : !v.number ? "No bill number" : "No party name" }); continue; }
    if (!(Number(v.qty) && Number(v.price)) && !v.total && !v.taxable) { out.skipped.push({ n, text: first, why: "No amounts on this row" }); continue; }
    last = v;
    out.rows.push({ n, kind, table: table.n, cont, ...v });
  }
  return out;
}

/** What kind of rows a sheet without "Outward/Inward" headings has, if it says. */
export function sheetKindHint(read: ReadSheet): BillKind | null {
  const fromName = kindWord(read.name) || kindWord(read.title);
  if (fromName) return fromName;
  const heads = read.tables.flatMap((t) => t.columns.map((c) => c.heading.toLowerCase()));
  if (heads.some((h) => /supplier|vendor|seller/.test(h))) return "purchase";
  if (heads.some((h) => /customer|buyer/.test(h))) return "sale";
  return null;
}

export type ImportFirm = { id: number; name: string; gst_number: string; short?: string; prefix?: string };
export function sheetFirm(firms: ImportFirm[], read: ReadSheet): { firm: ImportFirm | null; by?: string; why?: string } {
  if (read.gstin) {
    const firm = firms.find(f => f.gst_number.trim().toUpperCase() === read.gstin);
    return firm ? { firm, by: `its GSTIN row (${read.gstin})` } : { firm: null, why: `The sheet's GSTIN ${read.gstin} isn't one of your firms.` };
  }
  const words = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  for (const source of [read.title, read.name]) {
    const terms = words(source), normalized = terms.join(" ");
    const matches = firms.filter(f => normalized === words(f.name).join(" ") || (!!f.short && terms.includes(f.short.toLowerCase())) || (!!f.prefix && terms.includes(f.prefix.toLowerCase())));
    if (matches.length === 1) return { firm: matches[0], by: source === read.title ? `its title (${read.title})` : `the sheet's name (${read.name})` };
  }
  return { firm: null, why: "The sheet has no GSTIN row and its name isn't a firm's." };
}
