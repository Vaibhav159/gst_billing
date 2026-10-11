// What the bill form says while a bill is typed (PROTO pages/sales/useBillForm.js and lib.js): the server's own words for
// a line's problems, dates typed day-first, which months can take a bill, the checks beside the total, and what an edit
// changes. Pure: the form hook gathers what the server has said (the firm's locked months, the next number, whether a
// typed number is free) and hands it in.
import type { Customer } from "@/core/api/customers";
import { addMonths, date, dateShort, fyMonths, fyOf, inr, monthLabel, monthOf, possessive, qty as qtyLabel, unitDecimals } from "@/core/format";
import { hasGstin } from "@/core/ids";
import { numberShapeProblem } from "@/core/sales/numbers";
import { stateNameOf } from "@/core/sales/pos";
import type { BillDetail, ItaxFlag, NumberCheck } from "@/core/sales/types";
import { PAY, rateText } from "@/core/sales/words";
import { hasContent, slabOf, type FormLine, type FormState } from "./model";

/* ── Units, in the server's words (billing/api/sales.py PER, WEIGHED) ── */
const PER: Record<string, string> = { gms: "gram", g: "gram", kg: "kg", ct: "carat", oz: "ounce", tola: "tola", pcs: "piece", nos: "piece", unit: "unit", mtr: "metre", ltr: "litre", ml: "ml", box: "box", pair: "pair", set: "set", dozen: "dozen" };
const MANY: Record<string, string> = { gms: "grams", g: "grams", kg: "kilograms", ct: "carats", oz: "ounces", tola: "tola", pcs: "pieces", nos: "pieces", unit: "units", mtr: "metres", ltr: "litres", ml: "millilitres", box: "boxes", pair: "pairs", set: "sets", dozen: "dozens" };
/** "gram", "piece": one unit in words, as "Type the rate per gram." says it. */
export const perWord = (unit: string) => PER[unit] ?? unit;
/** "grams", "pieces": for "Line 1 weight in grams". */
export const unitWord = (unit: string) => MANY[unit] ?? unit;
export const isWeight = (unit: string) => ["g", "gms", "kg", "ct", "tola", "oz"].includes(unit);
/** The server's words for a missing weight or quantity (contract §2.3). */
export function qtyMissing(unit: string): string {
  if (unit === "gms" || unit === "g") return "Type the weight in grams, like 12.345.";
  if (["kg", "ct", "oz", "tola"].includes(unit)) return "Type the weight, like 1.250.";
  return "Type how many pieces.";
}
export const rateMissing = (unit: string) => `Type the rate per ${perWord(unit)}.`;

/* ── Dates: typed day-first, in India's order (PROTO sales/lib.js:332-358) ── */
const MONTH_WORDS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthFromWord = (w: string) => { const i = MONTH_WORDS.indexOf(w.slice(0, 3)); return i < 0 ? null : i + 1; };
export function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
/** "8/10", "08-10-2026", "8 oct", "Oct 8", "2026-10-08", "today" -> ISO, or null. With no year, the most recent such date up to today. */
export function parseDateText(text: string, today: string): string | null {
  const t = String(text || "").trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/,/g, " ").replace(/\s+/g, " ");
  if (!t) return null;
  if (t === "today") return today;
  if (t === "yesterday") return shiftDate(today, -1);
  let y: number | null = null; let m: number | null = null; let d: number | null = null;
  let mt: RegExpMatchArray | null;
  if ((mt = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else if ((mt = t.match(/^(\d{1,2}) ?[/.-] ?(\d{1,2})(?: ?[/.-] ?(\d{2}|\d{4}))?$/))) { d = +mt[1]; m = +mt[2]; y = mt[3] ? +mt[3] : null; }
  else if ((mt = t.match(/^(\d{1,2}) ?[ ./-]? ?([a-z]{3,9})\.?(?: ?[ ./-]? ?(\d{2}|\d{4}))?$/))) { d = +mt[1]; m = monthFromWord(mt[2]); y = mt[3] ? +mt[3] : null; }
  else if ((mt = t.match(/^([a-z]{3,9})\.? ?(\d{1,2})(?: ?(\d{4}))?$/))) { m = monthFromWord(mt[1]); d = +mt[2]; y = mt[3] ? +mt[3] : null; }
  else return null;
  if (!m || m < 1 || m > 12 || !d || d < 1) return null;
  if (y != null && y < 100) y += 2000;
  if (y == null) { y = Number(today.slice(0, 4)); if (`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` > today) y -= 1; }
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Is a month closed for the firm (contract: the facets' `locked`)? */
export type Locked = (ym: string) => boolean;
/** The financial year before `fy`: "2026-27" -> "2025-26". */
export const prevFy = (fy: string) => fyOf(`${Number(fy.slice(0, 4)) - 1}-04-01`);
/** "September or October": the months a bill can go into now, last year's and this year's so far (only months whose lock is known). */
export function openMonthsText(today: string, locked: Locked, known: (ym: string) => boolean = () => true): string {
  const cur = monthOf(today);
  const fy = fyOf(today);
  const months = [...fyMonths(prevFy(fy)), ...fyMonths(fy)].filter((m) => m <= cur && known(m) && !locked(m));
  const names = months.map((m) => monthLabel(m, { long: true, year: months.some((x) => x.slice(0, 4) !== m.slice(0, 4)) }));
  if (!names.length) return "";
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}
/** What stops a bill date for this firm, in plain words; "" when it can be used (PROTO sales/lib.js:361-375). */
export function dateProblem({ iso, today, firmName, locked, paper, known }: { iso: string; today: string; firmName: string; locked: Locked; paper: boolean; known?: (ym: string) => boolean }): string {
  if (!iso) return "Type the date like 08/10/2026 or 8 Oct.";
  if (iso > today) return `This date is after today (${date(today)}). A bill can't be dated ahead.`;
  const fy = fyOf(iso);
  const last = prevFy(fyOf(today));
  if (fy !== fyOf(today) && fy !== last) return `This date is in FY ${fy}. New bills can be dated this year or last year (FY ${last}) only.`;
  const ym = monthOf(iso);
  if (locked(ym)) {
    const month = monthLabel(ym, { long: true });
    if (paper) return `${month} is filed and locked for ${firmName}, so this paper bill can't be added. The paper bill's date can't change: have the owner unlock ${monthLabel(ym, { long: true, year: false })} in GST returns first.`;
    return `${month} is filed and locked for ${firmName}, so no bill can go into it. Pick a date in ${openMonthsText(today, locked, known) || "an open month"}, or have the owner unlock ${month} in GST returns first.`;
  }
  return "";
}
/** A date that's allowed but worth a word: a bill for last year takes last year's series (PROTO sales/lib.js:377-383). */
export function dateWarning(iso: string, today: string, next: string): string {
  if (!iso || iso > today || fyOf(iso) === fyOf(today)) return "";
  const series = next ? `that year's next number, ${next}` : "that year's numbers";
  return `This date is in last year, FY ${fyOf(iso)}. The bill takes ${series}, and goes into ${monthLabel(monthOf(iso), { long: true })}'s GSTR-1, which isn't filed yet.`;
}
/** The period a date falls in, for the checks beside the total (PROTO sales/lib.js:385-395). */
export function periodCheck(iso: string, today: string, locked: Locked): string {
  const ym = monthOf(iso);
  const cur = monthOf(today);
  const name = monthLabel(ym, { long: true, year: ym.slice(0, 4) !== cur.slice(0, 4) });
  if (ym === cur) {
    const prev = fyMonths(fyOf(today)).filter((m) => m < cur).pop();
    if (prev && locked(prev)) return `${monthLabel(prev, { long: true, year: false })} is filed; this bill is in ${name}`;
    return `${name} isn't filed yet, so this bill goes into ${name}'s GSTR-1`;
  }
  return `${name} isn't filed yet (GSTR-1 due ${date(`${addMonths(ym, 1)}-11`)}), so this bill goes into it`;
}

/* ── The number: the paper bill's, typed or the next one confirmed ── */
/**
 * What's wrong with the number as typed, in the server's words (1B's numberShapeProblem); "" when its shape is fine
 * (whether it's free is the server's). With nothing typed and no next number known, the paper bill's words.
 */
export function numberProblem(text: string, next: string, stored: string): string {
  if (!text.trim() && !next) return "Type the number written on the paper bill.";
  return numberShapeProblem(text, { next, stored });
}
/**
 * The server's check of a typed number (contract §2.12), when it checked anything. An answer that checked nothing (code
 * "unchecked": no firm, or a date it can't read; its next is null) is no answer: never "free", and its words aren't the
 * number's problem (Ruling 1A-27). Until 1B reads that code through, its reader folds it into "" and the null next into
 * an empty one, so an answer without a next number reads the same.
 */
export function checkedNumber(c: NumberCheck | null): NumberCheck | null {
  const code: string = c?.code ?? "";
  return c && code !== "unchecked" && c.next?.invoice_number ? c : null;
}

/* ── Errors, under each field ── */
/** The form's problems by field: number, date, customer, pos, lines, and `${line}-hsn|gst|qty|rate` (PROTO useBillForm.js:268-279). */
export function formErrors({ f, numberError, dateError, pos }: { f: FormState; numberError: string; dateError: string; pos: string }): Record<string, string> {
  const e: Record<string, string> = {};
  if (numberError) e.number = numberError;
  if (dateError) e.date = dateError;
  if (!f.customer) e.customer = "Choose who this bill is for. Pick Walk-in customer for a counter sale.";
  const filled = f.lines.filter(hasContent);
  if (!filled.length) e.lines = "Add at least one item: pick a product, then type its weight.";
  if (pos === "") e.pos = "Choose the state the goods are delivered to.";
  for (const l of filled) for (const [k, v] of Object.entries(lineProblems(l))) e[`${l.key}-${k}`] = v;
  return e;
}
export type LineField = "hsn" | "gst" | "qty" | "rate";
/** An HSN code the server takes: 4 to 8 digits. A bill's line and an item that isn't in Products check it, each in its own words. */
export const isHsn = (hsn: string) => /^\d{4,8}$/.test(hsn);
/**
 * A GST rate the server takes: one of the 11 slabs, compared as numbers (the model's slabOf). Not one: none picked, a
 * blank (which isn't 0%), or a v2 product's rate outside the slabs (0.07 reads as "7"), which the server refuses.
 */
const isSlab = (gst: string | null) => slabOf(gst) !== "";
/** A line's own problems, in the server's words: the form marks them under the line, the phone's item sheet in itself. */
export function lineProblems(l: Pick<FormLine, "hsn" | "gst" | "qty" | "rate" | "unit">): Partial<Record<LineField, string>> {
  const e: Partial<Record<LineField, string>> = {};
  if (!isHsn(l.hsn)) e.hsn = "Type the HSN code, 4 to 8 digits (7113 for jewellery).";
  if (!isSlab(l.gst)) e.gst = "Choose the GST rate. Gold and silver jewellery is 3%; cut diamonds are 0.25%.";
  if (!(l.qty != null && l.qty > 0)) e.qty = qtyMissing(l.unit);
  if (!(Number(l.rate) > 0)) e.rate = rateMissing(l.unit);
  return e;
}
/** The order the first problem is looked for, top of the form to the bottom (a line's name and note only come from the server). */
export const errorOrder = (lines: FormLine[]) => ["firm", "number", "date", "customer", "pos", ...lines.flatMap((l) => ["product", "hsn", "gst", "qty", "rate", "note"].map((k) => `${l.key}-${k}`)), "lines", "notes"];

/** The firm's hint under Firm: where the bill's firm came from, or where an edit moves it (PROTO BillForm.jsx:196-200). */
export function firmHint({ mode, source, paper, moving, canMove }: { mode: "new" | "edit"; source: string; paper: boolean; moving: string; canMove: boolean }): string {
  if (mode === "edit") return moving || (canMove ? "A bill can move to another firm while its month is open." : "A bill stays in its firm and number series.");
  if (paper) return "The firm whose paper bill book it is";
  return ({ scope: "Follows the firm picked in the top bar", first: "Pick the firm whose bill book this is", draft: "From the unfinished bill", copy: "Same firm as the bill it comes from" } as Record<string, string>)[source] ?? "Bill number follows the firm";
}

/** Worth a word on a line: a weight typed as ".5" (PROTO useBillForm.js:286). */
export function lineWarning(l: FormLine): string {
  if (!l.dotQty || l.qty == null || !(l.qty > 0 && l.qty < 1)) return "";
  return `Weight typed as .${String(l.qty).split(".")[1] ?? ""} ${l.unit}: ${l.qty.toFixed(unitDecimals(l.unit))} ${l.unit}. Is that right?`;
}

/* ── The checks beside the total ── */
export type Check = { key: string; ok: true | false | null | "warn"; text: string; fix?: "pan" | "address" };
/** waiting: no number yet, the next one on its way (Ruling 1D-15). */
export type NumberState = "free" | "checking" | "waiting" | "unknown";
export type CheckInput = {
  mode: "new" | "edit"; paper: boolean; f: FormState; customer: Customer | null; today: string;
  /** What the number is saved as; its problem; whether the server has said it's free. */
  stored: string; numberError: string; numberState: NumberState;
  /** Editing: the number as saved, and whether the bill moves (another firm or year). */
  saved: string; moved: boolean;
  dateError: string; dateWarn: string; nextNumber: string; locked: Locked;
  pos: string; taxShort: string; taxWhy: string;
  itax: ItaxFlag[]; gstinNote: string;
  /** The same customer's bill on the same day for the same total: maybe made twice. */
  twin: { invoice_number: string; total: number } | null;
  total: number;
};
/** The checks beside the total, each ok, a problem, worth a look, or waiting (PROTO useBillForm.js:295-322). */
export function checksOf(c: CheckInput): Check[] {
  const out: Check[] = [];
  const shown = c.stored || "This number";
  if (c.mode === "edit" && !c.moved && !c.f.numberTyped) out.push({ key: "num", ok: true, text: `Keeps its number ${c.saved}` });
  // a renumber is settled once the server says the new number is free (T4 re-review)
  else if (c.mode === "edit" && !c.moved) {
    const renumber = `Renumbers ${c.saved} to ${c.stored}`;
    out.push(c.numberError ? { key: "num", ok: false, text: `${shown} can't be used` }
      : c.numberState === "free" ? { key: "num", ok: true, text: renumber }
        : { key: "num", ok: null, text: `${renumber}: ${c.numberState === "checking" ? "checking that it's free" : "checked when it saves"}` });
  }
  else if (c.numberState === "waiting") out.push({ key: "num", ok: null, text: "Getting the next number" });
  else if (c.numberError) out.push({ key: "num", ok: false, text: `${shown} can't be used` });
  else if (c.numberState === "free") out.push({ key: "num", ok: true, text: c.paper ? `${c.stored} from the paper bill is free in FY ${fyOf(c.f.date || c.today)}` : `Bill number ${c.stored} is free` });
  else out.push({ key: "num", ok: null, text: c.numberState === "checking" ? `Checking that ${c.stored} is free` : `Bill number ${c.stored}: checked when it saves` });
  const cust = c.customer;
  if (!cust) out.push({ key: "cust", ok: null, text: "Choose a customer" });
  else if (cust.type === "walkin") out.push({ key: "cust", ok: true, text: "Walk-in customer: a B2C sale, no GSTIN needed" });
  else if (hasGstin(cust.gst_number)) out.push({ key: "cust", ok: true, text: `${cust.name} has a GSTIN, so this is a B2B bill` });
  else out.push({ key: "cust", ok: true, text: `No GSTIN needed: ${cust.name} buys as a person (B2C)` });
  if (c.gstinNote) out.push({ key: "gstin", ok: "warn", text: c.gstinNote });
  if (cust && c.itax.some((x) => x.kind === "b2b_address")) out.push({ key: "addr", ok: "warn", text: `${cust.name} has no address on record. A B2B bill must show it (CGST Rule 46).`, fix: "address" });
  if (c.dateError) out.push({ key: "date", ok: false, text: c.f.date ? `${monthLabel(monthOf(c.f.date), { long: true })} can't take this bill` : "The date isn't readable yet" });
  else if (c.dateWarn) out.push({ key: "date", ok: "warn", text: c.nextNumber ? `Last year's bill: number ${c.nextNumber}` : "Last year's bill" });
  else out.push({ key: "date", ok: true, text: periodCheck(c.f.date, c.today, c.locked) });
  const filled = c.f.lines.filter(hasContent);
  // each line's own problems decide it, so a line's error and this check never disagree
  const noHsn = filled.filter((l) => lineProblems(l).hsn);
  const noSlab = filled.filter((l) => lineProblems(l).gst);
  const lineNo = (l: FormLine) => c.f.lines.indexOf(l) + 1;
  if (!filled.length) out.push({ key: "lines", ok: c.mode === "edit" ? false : null, text: c.mode === "edit" ? "This bill has no items yet" : "Add an item" });
  else if (noHsn.length) out.push({ key: "lines", ok: false, text: `${noHsn.length === 1 ? `Line ${lineNo(noHsn[0])} needs` : `${noHsn.length} lines need`} an HSN code` });
  else if (noSlab.length) out.push({ key: "lines", ok: false, text: `${noSlab.length === 1 ? `Line ${lineNo(noSlab[0])} needs` : `${noSlab.length} lines need`} a GST rate` });
  else out.push({ key: "lines", ok: true, text: `Every line has an HSN code and a GST rate (${[...new Set(filled.map((l) => `${l.gst}%`))].join(", ")})` });
  out.push(c.pos ? { key: "tax", ok: true, text: `${c.taxShort}: ${c.taxWhy}` } : { key: "tax", ok: false, text: "Choose the state the goods are delivered to" });
  const p = c.f.payment;
  out.push(p == null ? { key: "pay", ok: null, text: "How it was paid: asked when you check and save" } : p === "" ? { key: "pay", ok: "warn", text: "Paid by: not recorded (kept as it was)" } : { key: "pay", ok: true, text: `Paid by ${PAY[p]}` });
  if (c.itax.some((x) => x.kind === "cash_limit")) out.push({ key: "cash", ok: "warn", text: "Cash of ₹2,00,000 or more from one person isn't allowed (Income Tax Sec 269ST). Take part of it by UPI or bank." });
  if (cust && c.itax.some((x) => x.kind === "pan")) out.push({ key: "pan", ok: "warn", text: `Over ₹2,00,000: Income Tax Rule 114B needs ${possessive(cust.name)} PAN (or Form 60).`, fix: "pan" });
  if (c.itax.some((x) => x.kind === "walkin_limit")) out.push({ key: "walkin", ok: "warn", text: "Over ₹2,00,000: Rule 114B needs the buyer's PAN. Put the bill in their name, not Walk-in." });
  const slip = filled.find((l) => lineWarning(l));
  if (slip) out.push({ key: "slip", ok: "warn", text: `Line ${lineNo(slip)}: ${lineWarning(slip)}` });
  if (c.twin && cust) {
    const when = c.f.date === c.today ? "today" : `on ${dateShort(c.f.date)}`;
    out.push({ key: "twin", ok: "warn", text: `${cust.name} already has a bill ${when} for ${inr(c.twin.total)} (${c.twin.invoice_number}). ${c.paper ? "Copying it twice?" : "Making it twice?"}` });
  }
  return out;
}

/** The note under Paid by (PROTO BillForm.jsx:554-562). */
export function paymentNote(payment: FormState["payment"], cashOver: boolean): string {
  if (payment == null) return "Pick one; nothing is chosen for you. Check and save asks if you haven't.";
  if (payment === "credit") return "Billed on udhaar. The app doesn't record payments received, so it never shows a balance.";
  if (payment === "mixed") return "The bill shows the total; how it was split isn't recorded.";
  if (payment === "") return "This bill came in without a payment mode. Pick one if you know it.";
  if (cashOver) return "Cash of ₹2,00,000 or more from one person isn't allowed (Income Tax Sec 269ST). Choose Part cash, part UPI.";
  return "";
}

/* ── What an edit changes, for the review and the audit log (PROTO useBillForm.js:507-534) ── */
export type Change = [field: string, before: string, after: string];
/**
 * What a change to a saved bill changes, old to new. Each line pairs with the saved line it came from (its savedId),
 * never by place: a saved line no line came from is removed, and a line from none is added. The tax type and the total
 * follow from the rest, so they're listed beside a change but never alone: a v2 bill's stored total can be a paisa off
 * v3's maths with nothing changed (Ruling 1D-16).
 */
export function changesOf(bill: BillDetail, f: FormState, now: { firmName: string; number: string; pos: string; inter: boolean; total: number; customerName: string }): Change[] {
  const out: Change[] = [];
  if (f.firmId !== bill.business) out.push(["Firm", bill.business_name, now.firmName]);
  if (now.number !== bill.invoice_number) out.push(["Bill number", bill.invoice_number, now.number]);
  if (f.date !== bill.invoice_date) out.push(["Date", date(bill.invoice_date), date(f.date)]);
  if (f.customer?.id !== bill.customer.id) out.push(["Customer", bill.customer.name, now.customerName]);
  if (now.pos !== bill.place_of_supply) out.push(["Place of supply", stateNameOf(bill.place_of_supply), stateNameOf(now.pos)]);
  const tax: Change | null = now.inter !== bill.interstate ? ["Tax", bill.interstate ? "IGST" : "CGST + SGST", now.inter ? "IGST" : "CGST + SGST"] : null;
  if (tax) out.push(tax);
  if (bill.payment_mode !== (f.payment ?? "")) out.push(["Paid by", PAY[bill.payment_mode], PAY[f.payment ?? ""]]);
  const lines = f.lines.filter(hasContent);
  // each saved line pairs once: a line from none, or a second from the same one, is added
  const kept = new Set<number>();
  const added: FormLine[] = [];
  lines.forEach((b, i) => {
    const a = bill.lines.find((l) => l.id === b.savedId && !kept.has(l.id));
    if (!a) { added.push(b); return; }
    kept.add(a.id);
    if (a.product_name !== b.name) { out.push([`Line ${i + 1}`, a.product_name, b.name]); return; }
    if (Number(a.quantity) !== b.qty || a.unit !== b.unit) out.push([`${b.name} weight`, qtyLabel(Number(a.quantity), a.unit), qtyLabel(b.qty, b.unit)]);
    if (Number(a.rate) !== Number(b.rate)) out.push([`${b.name} rate`, `${rateText(a.rate)}/${a.unit}`, `${rateText(b.rate)}/${b.unit}`]);
    if (Number(a.gst_percent) !== Number(b.gst)) out.push([`${b.name} GST rate`, `${a.gst_percent}%`, `${b.gst ?? "—"}%`]);
    if (a.hsn_code !== b.hsn) out.push([`${b.name} HSN`, a.hsn_code || "Missing", b.hsn]);
    if (a.note !== b.note.trim()) out.push([`${b.name} note`, a.note || "None", b.note.trim() || "None"]);
  });
  if (added.length) out.push(["Items added", "None", added.map((l) => l.name).join(", ")]);
  const removed = bill.lines.filter((l) => !kept.has(l.id));
  if (removed.length) out.push(["Items removed", removed.map((l) => l.product_name).join(", "), "None"]);
  if (bill.notes !== f.notes.trim()) out.push(["Note", bill.notes || "None", f.notes.trim() || "None"]);
  if (out.length === (tax ? 1 : 0)) return [];
  if (bill.total_amount !== now.total) out.push(["Total", inr(bill.total_amount), inr(now.total)]);
  return out;
}
