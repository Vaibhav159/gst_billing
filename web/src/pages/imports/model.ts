import { date, fyOf, inr, paiseToDecimal, qty, toPaise, UNITS } from "@/core/format";
import { checkGstin, gstinPlaceholder, hasGstin } from "@/core/ids";
import { billFigures, lineFigures, scaled } from "@/core/sales/maths";
import { slabOf, SLABS } from "@/pages/sales/form/model";
import type { PaymentMode } from "@/core/sales/types";
import type { ImportLine } from "./batch";
import { str, type BillKind, type ParsedLine, type ReadSheet } from "./columns";
export { readSheet, sheetFirm, sheetKindHint } from "./columns";

export type ParsedBill = { key: string; sheet: string; kind: BillKind; number: string; date: string; party: string; gstin: string; payment: string; rows: number[]; lines: ParsedLine[]; dates: Set<string>; parties: Set<string>; payments: Set<string>; zero?: boolean };
export type BillEdit = Partial<Omit<ParsedBill, "lines">> & { lines?: Record<number, Partial<ParsedLine>> };
export type Patch = Partial<ParsedLine> & Partial<Omit<ParsedBill, "lines">> & { line?: number };
export type ImportProblem = { field: string; detail: string; fix?: { label: string; patch: Patch } };
export type ProductHint = { name: string; hsn_code?: string; gst_percent?: string; unit?: string };
export type CheckContext = { firmId: number | null; today: string; partyId?: number; partyGstin?: string; interstate?: boolean; canSale?: boolean; canPurchase?: boolean; requireQuantityRate?: boolean; products?: ProductHint[]; usualRates?: Record<string, number> };
export const quantityRateRequired = "Enter the quantity and rate printed on the bill to import a sale or a bill between your firms.";

export function readDate(raw: string): string | null {
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  const local = /^(\d{1,2})[\s/-]([a-zA-Z]+|\d{1,2})[\s/-](\d{2}|\d{4})$/.exec(raw.trim());
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3]; }
  else if (local) { d = +local[1]; m = /^\d+$/.test(local[2]) ? +local[2] : ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(local[2].slice(0, 3).toLowerCase()) + 1; y = +local[3] + (local[3].length === 2 ? 2000 : 0); }
  else return null;
  const check = new Date(Date.UTC(y, m - 1, d));
  if (y < 2000 || y > 2099 || check.getUTCFullYear() !== y || check.getUTCMonth() + 1 !== m || check.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function groupBills(read: ReadSheet, fallback: BillKind): ParsedBill[] {
  const bills = new Map<string, ParsedBill>();
  for (const row of read.rows) {
    const kind = row.kind ?? fallback, iso = readDate(row.date), fy = iso ? fyOf(iso) : "unknown";
    const who = kind === "purchase" ? row.gstin || row.party.trim().toLowerCase() : "";
    const key = `${read.name}|${kind}|${fy}|${row.number.toUpperCase()}|${who}`;
    let bill = bills.get(key);
    if (!bill) { bill = { key, sheet: read.name, kind, number: row.number, date: row.date, party: row.party, gstin: row.gstin, payment: row.payment, rows: [], lines: [], dates: new Set(), parties: new Set(), payments: new Set() }; bills.set(key, bill); }
    bill.rows.push(row.n); bill.dates.add(row.date); bill.parties.add(row.party.trim().toLowerCase()); if (row.payment) bill.payments.add(row.payment.toLowerCase());
    const { n, item, hsn, slab, slabShown, qty, unit, price, taxable, cgst, sgst, igst, total } = row;
    bill.lines.push({ n, item, hsn, slab, slabShown, qty, unit, price, taxable, cgst, sgst, igst, total });
  }
  return [...bills.values()];
}

export function addPatch(edit: BillEdit = {}, patch: Patch = {}): BillEdit {
  const { line, ...rest } = patch;
  return line == null ? { ...edit, ...rest } : { ...edit, lines: { ...edit.lines, [line]: { ...edit.lines?.[line], ...rest } } };
}
export function withEdits(bill: ParsedBill, edit?: BillEdit): ParsedBill {
  if (!edit) return bill;
  const { lines, ...head } = edit;
  return { ...bill, ...head, dates: head.date != null ? new Set([head.date]) : bill.dates, parties: head.party != null ? new Set([head.party.trim().toLowerCase()]) : bill.parties, payments: head.payment != null ? new Set([head.payment]) : bill.payments, lines: bill.lines.map((line, i) => ({ ...line, ...lines?.[i] })) };
}
const UOM: Record<string, string> = { G: "g", GM: "g", GMS: "gms", GRM: "g", GRAM: "g", GRAMS: "g", KG: "kg", KGS: "kg", CT: "ct", CTS: "ct", CTM: "ct", CARAT: "ct", CARATS: "ct", NOS: "nos", NO: "nos", PCS: "pcs", PC: "pcs", PAIR: "pair", PRS: "pair", DOZ: "dozen", DOZEN: "dozen" };
export const importUnit = (raw: string, fallback = "gms"): string => UOM[raw.trim().toUpperCase()] ?? (raw.trim().toLowerCase() || fallback);
const knownUnit = (value: string): boolean => UNITS.some(u => importUnit(u.value) === value);
const payment = (raw: string): PaymentMode => {
  const value = raw.trim().toLowerCase();
  if (/^(cash|nakad)/.test(value)) return "cash";
  if (/udhaar|udhar|credit|due|baki/.test(value)) return "credit";
  if (/mix|part/.test(value)) return "mixed";
  return /upi|neft|rtgs|imps|bank|cheque|chq|card|online|gpay|phonepe|paytm|transfer/.test(value) ? "bank" : "";
};
// The existing slab allowlist resolves both forms: 0.25 stays 0.25%; 0.03 is 3%.
const importSlab = (raw: string | null): string => raw == null || raw.trim() === "" ? "" : slabOf(raw) || SLABS.find(slab => Math.abs(Number(slab) - Number(raw) * 100) < 1e-9) || "";
const decimal3 = (value: number): string => Number.isFinite(value) && value > 0 ? String(Number(value.toFixed(3))) : "";
const decimalOK = (raw: string): boolean => /^\d+(?:\.\d{1,3})?$/.test(raw) && Number(raw) > 0;

/** Local checks explain file mistakes; the batch dry run owns locks, duplicates and credit decisions. */
export function checkBill(bill: ParsedBill, context: CheckContext) {
  const problems: ImportProblem[] = [], warnings: ImportProblem[] = [], notes: string[] = [], lines: ImportLine[] = [];
  const problem = (field: string, detail: string, fix?: ImportProblem["fix"]) => problems.push({ field, detail, ...(fix ? { fix } : {}) });
  if (context.firmId == null) problem("business", "Choose which firm bought this.");
  if (!bill.number.trim()) problem("invoice_number", "Type the bill number printed on the supplier's bill.");
  else if (bill.number.trim().length > 50) problem("invoice_number", "Keep the bill number to 50 characters.");
  if (!bill.party.trim()) problem("supplier", "Choose the supplier, or add a new one.");
  const invoiceDate = readDate(bill.date);
  if (!invoiceDate) problem("invoice_date", bill.date ? "Type the date like 2026-09-30." : "Type the date printed on the bill, like 08 Oct 2026.");
  else if (invoiceDate > context.today) problem("invoice_date", `That's after today (${date(context.today)}). Check the date on the bill.`);
  if (bill.dates.size > 1) problem("invoice_date", "This bill has more than one date in the file. Check the dates or the bill numbers.");
  if (bill.parties.size > 1) problem("supplier", "This bill has more than one party in the file. Check the parties or the bill numbers.");
  if (bill.payments.size > 1) problem("payment_mode", "This bill has more than one way of paying in the file. Check the Paid by column.");
  const gstin = context.partyGstin ?? (gstinPlaceholder(bill.gstin) ? "" : bill.gstin.trim()), gstCheck = checkGstin(gstin);
  if (gstCheck.status === "short" || gstCheck.status === "invalid") problem("gstin", gstCheck.problem);
  if (gstCheck.status === "check") problem("gstin", "The last character of the GSTIN doesn't match. Check the GSTIN on the bill.");
  if (!bill.lines.length) problem("lines", "Add at least one item from the bill.");
  if (bill.lines.length > 200) problem("lines", "A bill can have at most 200 items.");
  bill.lines.forEach((line, i) => {
    const prefix = `lines.${i}`, product = context.products?.find(p => p.name.trim().toLowerCase() === line.item.trim().toLowerCase());
    const hsn = line.hsn || product?.hsn_code || "", unit = importUnit(line.unit, product?.unit);
    const rawSlab = str(line.slab).replace(/%$/, "");
    // Percent formatting gives a fraction (0.0025 displayed 0.25%). Bare cells give percents; never a magnitude test.
    const gst = bill.zero ? "0" : importSlab(rawSlab ? typeof line.slab === "number" && line.slabShown.includes("%") ? String(line.slab * 100) : rawSlab : product?.gst_percent ?? null);
    if (!line.item.trim()) problem(`${prefix}.product_name`, "Choose the item from the bill.");
    else if (line.item.length > 255) problem(`${prefix}.product_name`, "Keep the item's name to 255 characters.");
    if (hsn && !/^\d{4,8}$/.test(hsn)) problem(`${prefix}.hsn_code`, "Type the HSN code from the bill: 4 to 8 digits.");
    if (!gst) problem(`${prefix}.gst_percent`, "Choose the slab printed on the bill (0% if it charges no GST).");
    if (!knownUnit(unit)) problem(`${prefix}.unit`, "Pick a unit from the list.");
    const fileTax = line.dropHeads ? 0 : line.cgst + line.sgst + line.igst;
    let taxable = line.taxable, quantity = line.qty, rate = line.price;
    const amountOnly = bill.zero || !quantity || !rate, needsRate = bill.kind === "sale" || Boolean(context.requireQuantityRate);
    if (amountOnly && needsRate) problem(`${prefix}.quantity`, quantityRateRequired);
    if (bill.zero) taxable = (taxable || lineFigures({ quantity, rate, gst_percent: "0" }, false)?.taxable || Math.max(0, line.total - fileTax)) + fileTax;
    if (amountOnly && !taxable && bill.lines.length === 1 && line.total && gst) {
      const bp = scaled(gst, 2)!;
      taxable = fileTax ? line.total - fileTax : Number((BigInt(line.total) * 20000n + 10000n + bp) / (2n * (10000n + bp)));
    }
    if (amountOnly) {
      if (quantity && !decimalOK(quantity)) problem(`${prefix}.quantity`, `Type the quantity in ${unit}.`);
      if (taxable <= 0) problem(`${prefix}.taxable`, "Type the line's value from the bill.");
      lines.push({ product_name: line.item, hsn_code: hsn, gst_percent: gst, unit, note: "", amount_only: true, taxable: paiseToDecimal(taxable), ...(quantity && !bill.zero ? { quantity } : {}) });
      quantity = "1"; rate = paiseToDecimal(taxable);
    } else {
      if (!decimalOK(quantity)) problem(`${prefix}.quantity`, `Type the quantity in ${unit}.`);
      if (!decimalOK(rate)) problem(`${prefix}.rate`, "Type the rate printed on the bill.");
      lines.push({ product_name: line.item, hsn_code: hsn, gst_percent: gst, unit, note: "", quantity, rate });
    }
    const figure = lineFigures({ quantity, rate, gst_percent: gst }, Boolean(context.interstate));
    if (figure && !amountOnly && taxable > 0 && Math.abs(figure.taxable - taxable) > 1) {
      // X-58: a sale or a pair keeps its quantity and rate, so its fix is the rate that gives the taxable value, offered only when it does.
      const netRate = needsRate ? decimal3(taxable / 100 / Number(quantity)) : "";
      const exact = netRate && Math.abs((lineFigures({ quantity, rate: netRate, gst_percent: gst }, false)?.taxable ?? 0) - taxable) <= 1;
      problem(`${prefix}.taxable`, `quantity × rate (${inr(figure.taxable)}) isn't its taxable value (${inr(taxable)}). Check the Qty and Rate columns.`,
        needsRate ? exact ? { label: `Use the rate ${inr(toPaise(netRate) ?? 0)}/${unit}`, patch: { line: i, price: netRate } } : undefined : { label: `Use the taxable value, ${inr(taxable)}`, patch: { line: i, qty: "", price: "" } });
    }
    if (figure && fileTax && !bill.zero && Math.abs(figure.tax - fileTax) > 1) problem(`${prefix}.tax`, `the file's tax (${inr(fileTax)}) isn't ${gst}% of its taxable value (${inr(figure.tax)}).`, { label: `Use ${gst}% of the taxable value`, patch: { line: i, dropHeads: true } });
    if (bill.kind === "purchase" && !hasGstin(gstin) && Number(gst) > 0) problem(`${prefix}.gst_percent`, `Line ${i + 1}: the supplier has no GSTIN, so this purchase carries no input tax credit. Add the supplier's GSTIN to claim GST, or set the line to 0%.`, { label: "Book it at 0%", patch: { zero: true } });
    const usual = context.usualRates?.[`${line.item}|${unit}`], price = toPaise(rate) ?? 0;
    if (usual && price && !amountOnly) {
      const ratio = price / usual;
      if (ratio >= 5 || ratio <= 0.2) {
        const divisor = ratio >= 5 ? [10, 100, 1000].find(n => ratio / n > 0.5 && ratio / n < 2) : undefined;
        warnings.push({ field: `${prefix}.rate`, detail: `${line.item}: ${inr(price)}/${unit} is about ${ratio >= 5 ? `${Math.round(ratio)} times` : `1/${Math.round(1 / ratio)} of`} what you usually ${bill.kind === "sale" ? "charge" : "pay"} for ${line.item} (${inr(usual)}/${unit} on average).${divisor ? ` Was it the rate per ${divisor} ${unit}?` : " Check the Rate column."} It's left unticked until you check it.`, ...(divisor ? { fix: { label: `Use ${inr(Math.round(price / divisor))}/${unit}`, patch: { line: i, price: paiseToDecimal(Math.round(price / divisor)), taxable: 0, total: 0, dropHeads: true } } } : {}) });
      }
    }
    if (Number(quantity) >= 10000000 || Number(rate) >= 1000000000 || figure && figure.amount >= 100000000000) {
      // Whole milligrams give grams to 3 decimals; the rate per milligram, times 1,000 and kept to paise, is the rate per gram.
      const mg = scaled(quantity, 0), perGram = scaled(rate, 5);
      const milligrams = Number(quantity) >= 10000000 && ["g", "gms"].includes(unit) && Number(quantity) / 1000 < 10000000 && Number(rate) > 0 && mg !== null && perGram !== null;
      const correctedQuantity = mg === null ? 0 : Number(mg) / 1000, correctedRate = perGram === null ? "0" : paiseToDecimal(Number(perGram));
      // Rounding to whole milligrams or to paise can move the amount a little; then the message says so instead of "the same".
      const q = scaled(quantity, 3), r = scaled(rate, 6), exact = q !== null && r !== null ? Number((q * r + 5000000n) / 10000000n) : figure?.taxable ?? 0;
      const was = taxable > 0 ? taxable : exact, now = lineFigures({ quantity: String(correctedQuantity), rate: correctedRate, gst_percent: gst }, Boolean(context.interstate))?.taxable ?? 0;
      const sameness = Math.abs(now - was) <= 1 ? `is the same ${inr(was)}` : `comes to ${inr(now)}, about the file's ${inr(was)}`;
      const shown = `${qty(correctedQuantity, unit)} at ${inr(toPaise(correctedRate) ?? 0)}/${unit}`;
      problem(`${prefix}.quantity`, `${line.item}: this is more than a bill can hold.${milligrams ? ` It looks like milligrams in a grams column: ${shown} ${sameness}.` : " Check the Qty and Rate columns."}`,
        milligrams ? { label: `Use ${shown}`, patch: { line: i, qty: String(correctedQuantity), price: correctedRate } } : undefined);
    }
    if (!hsn) notes.push(`${line.item} has no HSN code. Add it with Edit now, or later on the bill.`);
  });
  const totals = billFigures(lines.map(l => "amount_only" in l ? { quantity: "1", rate: l.taxable, gst_percent: l.gst_percent } : l), Boolean(context.interstate));
  const printedTotals = bill.lines.map(line => line.total).filter(Boolean), distinctTotals = new Set(printedTotals);
  // A file may print the bill total on every row, or each line's own total: either reading that matches is fine.
  const summed = printedTotals.reduce((total, value) => total + value, 0), repeated = printedTotals.length > 1 && distinctTotals.size === 1 ? printedTotals[0] : 0;
  const printedTotal = repeated && Math.abs(summed - totals.total) > 1 ? repeated : summed;
  if (printedTotal && Math.abs(printedTotal - totals.total) > 1) notes.push(`The file's total ${inr(printedTotal)} differs from its lines (${inr(totals.total)}) by ${inr(Math.abs(printedTotal - totals.total))}; the lines are what's saved.`);
  const recognizedPayment = payment(bill.payment);
  if (bill.payment && !recognizedPayment) notes.push(`“${bill.payment}” isn't a way of paying the app knows; it's saved as Not recorded.`);
  const allowed = bill.kind === "sale" ? context.canSale !== false : context.canPurchase !== false;
  const state = !allowed ? "role" : problems.length ? problems.every(p => p.field === "business") ? "firm" : "fix" : warnings.length ? "check" : "ready";
  return { state, selected: state === "ready", problems, warnings, notes, lines, invoiceDate, totals, payment: recognizedPayment } as const;
}
