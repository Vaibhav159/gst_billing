import { toCustomer } from "@/core/api/customers";
import { wireDetail } from "@/core/sales/fixtures";
import { toBillDetail } from "@/core/sales/wire";
import { blankLine, startEdit, startNew, type FormLine, type FormState } from "./model";
import type { NumberCheck } from "@/core/sales/types";
import {
  changesOf, checkedNumber, checksOf, dateProblem, dateWarning, errorOrder, firmHint, formErrors, isHsn, lineProblems, lineWarning, numberProblem, openMonthsText,
  parseDateText, paymentNote, periodCheck, qtyMissing, rateMissing, type CheckInput,
} from "./rules";

const TODAY = "2026-10-08";
const ANIL = toCustomer({ id: 7, name: "Anil Gupta", state_name: "RAJASTHAN", mobile_number: "9829041122", type: "person" });
const septemberFiled = (ym: string) => ym <= "2026-09";
const nothingFiled = () => false;

test("dates are typed day-first; without a year, the most recent such day up to today", () => {
  expect(parseDateText("8/10", TODAY)).toBe("2026-10-08");
  expect(parseDateText("08-10-2026", TODAY)).toBe("2026-10-08");
  expect(parseDateText("8 oct", TODAY)).toBe("2026-10-08");
  expect(parseDateText("Oct 8", TODAY)).toBe("2026-10-08");
  expect(parseDateText("28 Mar", TODAY)).toBe("2026-03-28");
  expect(parseDateText("9 Oct", TODAY)).toBe("2025-10-09");
  expect(parseDateText("yesterday", TODAY)).toBe("2026-10-07");
  expect(parseDateText("31/2", TODAY)).toBeNull();
  expect(parseDateText("soon", TODAY)).toBeNull();
});

test("which days can take a bill: not ahead, this year or last, and never a filed month, named", () => {
  const at = (iso: string, locked = septemberFiled, paper = false) => dateProblem({ iso, today: TODAY, firmName: "KIRAN GOLD HOUSE", locked, paper });
  expect(at("")).toBe("Type the date like 08/10/2026 or 8 Oct.");
  expect(at("2026-10-09")).toBe("This date is after today (08 Oct 2026). A bill can't be dated ahead.");
  expect(at("2025-03-31", nothingFiled)).toBe("This date is in FY 2024-25. New bills can be dated this year or last year (FY 2025-26) only.");
  expect(at("2026-09-30")).toBe("September 2026 is filed and locked for KIRAN GOLD HOUSE, so no bill can go into it. Pick a date in October, or have the owner unlock September 2026 in GST returns first.");
  expect(at("2026-09-30", septemberFiled, true)).toBe("September 2026 is filed and locked for KIRAN GOLD HOUSE, so this paper bill can't be added. The paper bill's date can't change: have the owner unlock September in GST returns first.");
  expect(at("2026-10-01")).toBe("");
  expect(openMonthsText(TODAY, (ym) => ym < "2026-09")).toBe("September or October");
  // last year's months aren't named until their locks are known
  expect(openMonthsText(TODAY, (ym) => ym >= "2026-04" && ym < "2026-09", (ym) => ym >= "2026-04")).toBe("September or October");
});

test("last year's date is worth a word; the checks say which month's return the bill goes into", () => {
  expect(dateWarning("2026-03-28", TODAY, "KGH/2025-26/412")).toBe("This date is in last year, FY 2025-26. The bill takes that year's next number, KGH/2025-26/412, and goes into March 2026's GSTR-1, which isn't filed yet.");
  expect(dateWarning("2026-10-01", TODAY, "")).toBe("");
  expect(periodCheck("2026-10-08", TODAY, nothingFiled)).toBe("October isn't filed yet, so this bill goes into October's GSTR-1");
  expect(periodCheck("2026-10-08", TODAY, septemberFiled)).toBe("September is filed; this bill is in October");
  expect(periodCheck("2026-09-30", TODAY, nothingFiled)).toBe("September isn't filed yet (GSTR-1 due 11 Oct 2026), so this bill goes into it");
});

test("a number's problems in the server's words; with nothing typed and no next number known, the paper bill's", () => {
  expect(numberProblem("", "KGH/2026-27/35", "")).toBe("Type the bill number, or use the next free one, KGH/2026-27/35.");
  expect(numberProblem("  ", "", "")).toBe("Type the number written on the paper bill.");
  expect(numberProblem("KGH 34", "KGH/2026-27/35", "KGH 34")).toBe("Use only letters, digits, \"-\" and \"/\" (GST rule 46). Spaces and other marks aren't allowed.");
  expect(numberProblem("34", "KGH/2026-27/35", "KGH/2026-27/34")).toBe("");
});

test("a line's problems are the server's words, by unit", () => {
  expect(qtyMissing("gms")).toBe("Type the weight in grams, like 12.345.");
  expect(qtyMissing("ct")).toBe("Type the weight, like 1.250.");
  expect(qtyMissing("pcs")).toBe("Type how many pieces.");
  expect(rateMissing("gms")).toBe("Type the rate per gram.");
  expect(rateMissing("nos")).toBe("Type the rate per piece.");
  expect(rateMissing("ct")).toBe("Type the rate per carat.");
});

test("an HSN code is 4 to 8 digits: one rule for a bill's line and for an item that isn't in Products, each in its own words", () => {
  for (const hsn of ["7113", "711319", "71131912"]) expect(isHsn(hsn)).toBe(true);
  for (const hsn of ["", "711", "711319123", "7113A", " 7113"]) expect(isHsn(hsn)).toBe(false);
  expect(lineProblems({ hsn: "711", gst: "3", qty: 1, rate: "1", unit: "gms" }).hsn).toBe("Type the HSN code, 4 to 8 digits (7113 for jewellery).");
});

function form(over: Partial<FormState> = {}): FormState {
  return { ...startNew({ firmId: 3, firmSource: "scope", today: TODAY }).form, ...over };
}
const ring = { ...blankLine(), key: "r", productId: 5, name: "Gold Ring 22K", hsn: "711319", gst: "3", unit: "gms", qty: 4.5, rate: "6500" };

test("the form's problems by field, each line's by its key, in the order they're looked for", () => {
  const e = formErrors({ f: form({ lines: [{ ...ring, hsn: "71", gst: null, qty: null, rate: "" }] }), numberError: "", dateError: "", pos: "" });
  expect(e).toEqual({
    customer: "Choose who this bill is for. Pick Walk-in customer for a counter sale.", pos: "Choose the state the goods are delivered to.",
    "r-hsn": "Type the HSN code, 4 to 8 digits (7113 for jewellery).", "r-gst": "Choose the GST rate. Gold and silver jewellery is 3%; cut diamonds are 0.25%.",
    "r-qty": "Type the weight in grams, like 12.345.", "r-rate": "Type the rate per gram.",
  });
  expect(formErrors({ f: form(), numberError: "x", dateError: "", pos: "08" })).toEqual({ number: "x", customer: expect.any(String), lines: "Add at least one item: pick a product, then type its weight." });
  expect(errorOrder([ring])).toEqual(["firm", "number", "date", "customer", "pos", "r-product", "r-hsn", "r-gst", "r-qty", "r-rate", "r-note", "lines", "notes"]);
});

test("a weight typed as .5 is worth a word", () => {
  expect(lineWarning({ ...ring, qty: 0.5, dotQty: true })).toBe("Weight typed as .5 gms: 0.500 gms. Is that right?");
  expect(lineWarning({ ...ring, qty: 4.5, dotQty: false })).toBe("");
});

const input = (over: Partial<CheckInput> = {}): CheckInput => ({
  mode: "new", paper: false, f: form({ customer: ANIL, lines: [ring], payment: null }), customer: ANIL, today: TODAY,
  stored: "KGH/2026-27/34", numberError: "", numberState: "free", saved: "", moved: false, dateError: "", dateWarn: "", nextNumber: "KGH/2026-27/34", locked: nothingFiled,
  pos: "08", taxShort: "Local sale · CGST + SGST", taxWhy: "sold at the counter in Rajasthan", itax: [], gstinNote: "", twin: null, total: 2410350, ...over,
});

test("the checks beside the total: number, customer, period, lines, tax type and payment", () => {
  expect(checksOf(input()).map((c) => [c.key, c.ok, c.text])).toEqual([
    ["num", true, "Bill number KGH/2026-27/34 is free"],
    ["cust", true, "No GSTIN needed: Anil Gupta buys as a person (B2C)"],
    ["date", true, "October isn't filed yet, so this bill goes into October's GSTR-1"],
    ["lines", true, "Every line has an HSN code and a GST rate (3%)"],
    ["tax", true, "Local sale · CGST + SGST: sold at the counter in Rajasthan"],
    ["pay", null, "How it was paid: asked when you check and save"],
  ]);
  expect(checksOf(input({ paper: true }))[0].text).toBe("KGH/2026-27/34 from the paper bill is free in FY 2026-27");
  expect(checksOf(input({ numberState: "checking" }))[0]).toMatchObject({ ok: null, text: "Checking that KGH/2026-27/34 is free" });
  expect(checksOf(input({ numberError: "KGH/2026-27/34 is already used…" }))[0]).toMatchObject({ ok: false, text: "KGH/2026-27/34 can't be used" });
});

test("a GST rate that isn't one of the 11 slabs (an old product's 7%) is a problem on its line and beside the total, so it can be fixed", () => {
  const gstProblem = (gst: string | null) => lineProblems({ ...ring, gst }).gst;
  for (const gst of ["7", "2.5", "", null]) expect(gstProblem(gst)).toBe("Choose the GST rate. Gold and silver jewellery is 3%; cut diamonds are 0.25%.");
  // compared as numbers, so "3.00" and "0.250" are the 3% and 0.25% slabs
  for (const gst of ["3", "0.25", "0", "40", "3.00", "0.250"]) expect(gstProblem(gst)).toBeUndefined();
  const lines = checksOf(input({ f: form({ customer: ANIL, lines: [{ ...ring, gst: "7" }] }) })).find((c) => c.key === "lines");
  expect(lines).toMatchObject({ ok: false, text: "Line 1 needs a GST rate" });
});

test("the lines check beside the total flags a line exactly when the line's own problems name its HSN code or GST rate", () => {
  const check = (...ls: Partial<FormLine>[]) => checksOf(input({ f: form({ customer: ANIL, lines: ls.map((l, i) => ({ ...ring, key: `l${i}`, ...l })) }) })).find((c) => c.key === "lines");
  for (const hsn of ["71", "7113", "711319", "71131912", "711319123", "", "7113A"]) expect(check({ hsn })?.ok === false).toBe(Boolean(lineProblems({ ...ring, hsn }).hsn));
  for (const gst of ["7", "3", "0.25", "3.00", "", null]) expect(check({ gst })?.ok === false).toBe(Boolean(lineProblems({ ...ring, gst }).gst));
  expect(check({ hsn: "71" })).toMatchObject({ ok: false, text: "Line 1 needs an HSN code" });
  expect(check({ hsn: "711319123" }, {}, { hsn: "" })).toMatchObject({ ok: false, text: "2 lines need an HSN code" });
});

test("the income-tax checks, an address for a business, and a bill maybe made twice", () => {
  const cash = { kind: "cash_limit" as const, short: "", text: "" };
  const pan = { kind: "pan" as const, short: "", text: "" };
  const addr = { kind: "b2b_address" as const, short: "", text: "" };
  const c = checksOf(input({ itax: [cash, pan, addr], f: form({ customer: ANIL, lines: [ring], payment: "cash" }), twin: { invoice_number: "KGH/2026-27/31", total: 8708321 } }));
  expect(c.filter((x) => x.ok === "warn").map((x) => [x.key, x.text, x.fix])).toEqual([
    ["addr", "Anil Gupta has no address on record. A B2B bill must show it (CGST Rule 46).", "address"],
    ["cash", "Cash of ₹2,00,000 or more from one person isn't allowed (Income Tax Sec 269ST). Take part of it by UPI or bank.", undefined],
    ["pan", "Over ₹2,00,000: Income Tax Rule 114B needs Anil Gupta's PAN (or Form 60).", "pan"],
    ["twin", "Anil Gupta already has a bill today for ₹87,083.21 (KGH/2026-27/31). Making it twice?", undefined],
  ]);
  expect(checksOf(input({ paper: true, f: form({ customer: ANIL, lines: [ring], date: "2026-09-30" }), twin: { invoice_number: "KGH/2026-27/31", total: 1 } })).pop()?.text)
    .toBe("Anil Gupta already has a bill on 30 Sep for ₹0.01 (KGH/2026-27/31). Copying it twice?");
});

test("editing: the number is kept, or renumbered", () => {
  expect(checksOf(input({ mode: "edit", saved: "KGH/2026-27/31" }))[0].text).toBe("Keeps its number KGH/2026-27/31");
  expect(checksOf(input({ mode: "edit", saved: "KGH/2026-27/31", f: form({ numberTyped: true, customer: ANIL, lines: [ring] }) }))[0].text).toBe("Renumbers KGH/2026-27/31 to KGH/2026-27/34");
});

test("the note under Paid by", () => {
  expect(paymentNote(null, false)).toBe("Pick one; nothing is chosen for you. Check and save asks if you haven't.");
  expect(paymentNote("credit", false)).toBe("Billed on udhaar. The app doesn't record payments received, so it never shows a balance.");
  expect(paymentNote("cash", true)).toBe("Cash of ₹2,00,000 or more from one person isn't allowed (Income Tax Sec 269ST). Choose Part cash, part UPI.");
  expect(paymentNote("mixed", false)).toBe("The bill shows the total; how it was split isn't recorded.");
  expect(paymentNote("", false)).toBe("This bill came in without a payment mode. Pick one if you know it.");
  expect(paymentNote("bank", false)).toBe("");
});

test("what an edit changes, old to new, for the review", () => {
  const b = toBillDetail(wireDetail());
  const s = startEdit(b);
  const f = { ...s.form, payment: "bank" as const, notes: "Order 77" };
  f.lines = [{ ...f.lines[0], qty: 12.5, rate: "6600" }];
  expect(changesOf(b, f, { firmName: "KIRAN GOLD HOUSE", number: "KGH/2026-27/31", pos: "08", inter: false, total: 8496750, customerName: "Anil Gupta" })).toEqual([
    ["Paid by", "Cash", "UPI / bank"],
    ["Gold Ring 22K weight", "12.345 gms", "12.500 gms"],
    ["Gold Ring 22K rate", "₹6,512.50/gms", "₹6,600.00/gms"],
    ["Items removed", "Gold Pendant 22K", "None"],
    ["Note", "None", "Order 77"],
    ["Total", "₹87,083.21", "₹84,967.50"],
  ]);
  expect(changesOf(b, s.form, { firmName: "KIRAN GOLD HOUSE", number: "KGH/2026-27/31", pos: "08", inter: false, total: 8708321, customerName: "Anil Gupta" })).toEqual([]);
  // a weight cleared reads as a dash
  const cleared = { ...s.form, lines: [{ ...s.form.lines[0], qty: null }, s.form.lines[1]] };
  expect(changesOf(b, cleared, { firmName: "KIRAN GOLD HOUSE", number: "KGH/2026-27/31", pos: "08", inter: false, total: 8708321, customerName: "Anil Gupta" })).toEqual([["Gold Ring 22K weight", "12.345 gms", "—"]]);
});

test("the hint under Firm says where the firm came from, or where an edit moves the bill", () => {
  expect(firmHint({ mode: "new", source: "scope", paper: false, moving: "", canMove: true })).toBe("Follows the firm picked in the top bar");
  expect(firmHint({ mode: "new", source: "first", paper: false, moving: "", canMove: true })).toBe("Pick the firm whose bill book this is");
  expect(firmHint({ mode: "new", source: "paper", paper: true, moving: "", canMove: true })).toBe("The firm whose paper bill book it is");
  expect(firmHint({ mode: "edit", source: "bill", paper: false, moving: "", canMove: true })).toBe("A bill can move to another firm while its month is open.");
  expect(firmHint({ mode: "edit", source: "bill", paper: false, moving: "Moves the bill to MEERA ORNAMENTS as MO/2026-27/9. KGH/2026-27/31 is left unused.", canMove: true }))
    .toBe("Moves the bill to MEERA ORNAMENTS as MO/2026-27/9. KGH/2026-27/31 is left unused.");
});

test("a number check that checked nothing is no answer (contract §2.12, Ruling 1A-27): unchecked, or no next number, is never free and names no problem", () => {
  const free: NumberCheck = {
    invoice_number: "KGH/2026-27/35", counter: 35, code: "", problem: "", bill: null, binned: null, note: "", same_counter: null, next: { counter: 34, invoice_number: "KGH/2026-27/34" },
  };
  const taken: NumberCheck = { ...free, code: "number_taken", problem: "KGH/2026-27/35 is already used in FY 2026-27." };
  expect(checkedNumber(free)).toBe(free);
  expect(checkedNumber(taken)).toBe(taken);
  expect(checkedNumber(null)).toBeNull();
  // an unchecked answer as 1B reads it today: its code folded to "", its null next read as an empty one
  expect(checkedNumber({ ...free, counter: null, next: { counter: 0, invoice_number: "" } })).toBeNull();
  // and once 1B reads the code through (1B Task 9): whatever its problem says, it isn't the number's
  const unchecked = { ...free, code: "unchecked", problem: "Pick the firm first.", next: null } as unknown as NumberCheck;
  expect(checkedNumber(unchecked)).toBeNull();
});
