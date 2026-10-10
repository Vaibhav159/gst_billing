import { toCustomer } from "@/core/api/customers";
import { toDraftData as readDraft } from "@/core/api/drafts";
import { wireDetail } from "@/core/sales/fixtures";
import { autoPos } from "@/core/sales/pos";
import { toBillDetail } from "@/core/sales/wire";
import {
  blankLine, fromDraftData, hasContent, lineFromProduct, linesFromBill, posCustomer, posOverrideOf, startCopy, startDraft, startEdit, startNew, startPaper, startRemake,
  stateOf, storedFor, toBillInput, toDraftData,
} from "./model";

const bill = (over: Record<string, unknown> = {}) => toBillDetail(wireDetail(over));
const ANIL = toCustomer({ id: 7, name: "Anil Gupta", state_name: "RAJASTHAN", mobile_number: "9829041122", type: "person" });
const RAMESH = toCustomer({ id: 8, name: "Ramesh Patel", state_name: "GUJARAT", gst_number: "24AAACR5055K1Z5", type: "business" });

test("a new bill starts today, number suggested, nothing paid; a link can bring the customer and the payment", () => {
  const s = startNew({ firmId: 3, firmSource: "scope", today: "2026-10-08" });
  expect(s).toMatchObject({ mode: "new", firmSource: "scope", origin: null, draftId: null, replaces: null, bookDate: false });
  expect(s.form).toMatchObject({ firmId: 3, date: "2026-10-08", number: "", numberTyped: false, paper: false, payment: null, posOverride: null, customer: null });
  expect(s.form.lines).toHaveLength(1);
  expect(startNew({ firmId: 3, firmSource: "mine", today: "2026-10-08", customer: ANIL, payment: "cash" })).toMatchObject({ origin: { kind: "prefill" }, form: { customer: { id: 7 }, payment: "cash" } });
});

test("a paper bill takes the link's number and date; without a date, this visit's last one; else the paper book's for last month", () => {
  expect(startPaper({ firmId: 3, date: "2026-09-30", number: "34", remembered: "", lastMonth: "2026-09" }))
    .toMatchObject({ firmSource: "paper", origin: { kind: "paper" }, bookDate: false, form: { paper: true, date: "2026-09-30", number: "34", numberTyped: true } });
  expect(startPaper({ firmId: 3, date: "", number: "", remembered: "2026-09-24", lastMonth: "2026-09" }))
    .toMatchObject({ bookDate: false, form: { date: "2026-09-24", number: "", numberTyped: false } });
  expect(startPaper({ firmId: 3, date: "", number: "", remembered: "", lastMonth: "2026-09" })).toMatchObject({ bookDate: true, form: { date: "2026-09-01" } });
});

test("a copy keeps the customer and items, with today's date and no payment; making a cancelled bill again keeps the payment and replaces it", () => {
  const b = bill({ payment_mode: "bank", notes: "Order 77", status: "cancelled", cancel_reason: "Wrong weight" });
  const copy = startCopy(b, "2026-10-09");
  expect(copy).toMatchObject({ firmSource: "copy", origin: { kind: "copy", number: "KGH/2026-27/31", customer: "Anil Gupta", date: "2026-10-08" }, replaces: null });
  expect(copy.form).toMatchObject({ firmId: 3, date: "2026-10-09", payment: null, notes: "", customer: { id: 7, name: "Anil Gupta", type: "person" } });
  expect(copy.form.lines.map((l) => [l.name, l.qty, l.rate, l.gst, l.unit, l.note])).toEqual([
    ["Gold Ring 22K", 12.345, "6512.500", "3", "gms", ""], ["Gold Pendant 22K", 1, "4150.000", "3", "pcs", "Peacock design"],
  ]);
  const again = startRemake(b, "2026-10-09");
  expect(again).toMatchObject({ replaces: 412, origin: { kind: "remake", number: "KGH/2026-27/31", reason: "Wrong weight" }, form: { payment: "bank", notes: "Order 77" } });
});

test("a bill being changed opens as saved; one that came in with an amount only opens as 1 × its value; one missing HSN shows its problems at once", () => {
  const s = startEdit(bill());
  expect(s).toMatchObject({ mode: "edit", firmSource: "bill", origin: null, tried: false, form: { number: "KGH/2026-27/31", numberTyped: false, date: "2026-10-08", payment: "cash" } });
  const imported = startEdit(bill({ lines: [{ id: 1, product_name: "Silver items", hsn_code: "", quantity: "0.000", unit: "gms", rate: "0.000", gst_percent: "3", taxable: "4500.00", tax: "135.00", cgst: "67.50", sgst: "67.50", igst: "0.00", amount: "4635.00", note: "" }] }));
  expect(imported).toMatchObject({ origin: { kind: "amountOnly" }, tried: true });
  expect(imported.form.lines[0]).toMatchObject({ qty: 1, unit: "nos", rate: "4500.00", amountOnly: true });
});

test("a party's state is read as the server reads it: a GSTIN's first two digits, else the state on file", () => {
  expect(stateOf("24AAACR5055K1Z5", "RAJASTHAN")).toBe("24");
  expect(stateOf("", "GUJARAT")).toBe("24");
  expect(stateOf("URP", "RAJASTHAN")).toBe("08");
  // a GSTIN whose state GST's table doesn't have reads as no state: the form asks for one
  expect(stateOf("28AAACR5055K1Z5", "ANDHRA PRADESH")).toBe("");
  expect(stateOf("", "NOWHERE")).toBe("");
  // a registered buyer whose typed state disagrees with its GSTIN is placed by the GSTIN
  const listedInRajasthan = toCustomer({ ...RAMESH, state_name: "RAJASTHAN" });
  expect(posCustomer(listedInRajasthan)).toEqual({ type: "business", gst_number: "24AAACR5055K1Z5" });
  expect(autoPos("08", posCustomer(listedInRajasthan))).toBe("24");
  expect(autoPos("08", posCustomer(ANIL))).toBe("08");
});

test("the place of supply is kept only when it isn't where the form would put it anyway", () => {
  expect(posOverrideOf("08", ANIL, "08")).toBeNull();
  expect(posOverrideOf("08", ANIL, "24")).toBe("24");
  expect(posOverrideOf("08", RAMESH, "24")).toBeNull();
  expect(posOverrideOf("08", RAMESH, "08")).toBe("08");
});

test("an unfinished bill round-trips through its data, lines with nothing on them left out", () => {
  const f = { ...startNew({ firmId: 3, firmSource: "scope", today: "2026-10-08", customer: ANIL }).form, number: "34", numberTyped: true, notes: "Order 77" };
  f.lines = [{ ...blankLine(), productId: 5, name: "Gold Ring 22K", hsn: "711319", gst: "3", unit: "gms", qty: 4.5, rate: "6500" }, blankLine()];
  const data = toDraftData(f, 412);
  expect(data).toMatchObject({ v: 1, firmId: 3, number: "34", numberTyped: true, notes: "Order 77", replaces: 412, customer: { id: 7 } });
  expect(data.lines).toEqual([{ productId: 5, name: "Gold Ring 22K", hsn: "711319", gst: "3", unit: "gms", qty: 4.5, rate: "6500", note: "", custom: false }]);
  const back = fromDraftData(readDraft(JSON.parse(JSON.stringify(data))));
  expect(back).toMatchObject({ firmId: 3, number: "34", notes: "Order 77", customer: { id: 7, name: "Anil Gupta" } });
  expect(back.lines.map(hasContent)).toEqual([true]);
  const s = startDraft({ id: "d1", business: 3, started_by: { id: 2, name: "Rakesh Soni" }, data, created_at: "2026-10-08T15:20:00+05:30", updated_at: "x", onDevice: false });
  expect(s).toMatchObject({ draftId: "d1", replaces: 412, firmSource: "draft", origin: { kind: "draft", startedBy: { name: "Rakesh Soni" }, startedAt: "2026-10-08T15:20:00+05:30" } });
});

test("a product brings its name, HSN, GST rate and unit; the rate is typed as written", () => {
  const l = lineFromProduct({ id: 5, name: "Gold Ring 22K", hsn_code: "711319", gst_percent: "3", unit: "gms", description: "", usage: 4 }, { ...blankLine(), qty: 4.5, rate: "6500" });
  expect(l).toMatchObject({ productId: 5, name: "Gold Ring 22K", hsn: "711319", gst: "3", unit: "gms", qty: 4.5, rate: "6500", custom: false });
});

test("what POST sales/ is sent: paper, replaces and the draft only on a new bill; quantities with 3 decimals", () => {
  const f = { ...startNew({ firmId: 3, firmSource: "scope", today: "2026-10-08", customer: ANIL }).form, payment: "cash" as const, notes: " Order 77 ", paper: true };
  f.lines = [{ ...blankLine(), name: "Gold Ring 22K", hsn: "711319", gst: "3", unit: "gms", qty: 4.5, rate: "6500.50", note: " Size 12 " }, blankLine()];
  expect(toBillInput(f, { mode: "new", pos: "08", number: " 34 ", draftId: "d1", replaces: null })).toEqual({
    business: 3, customer: 7, invoice_number: "34", invoice_date: "2026-10-08", payment_mode: "cash", place_of_supply: "08", notes: "Order 77", paper: true, replaces: null, draft_id: "d1",
    lines: [{ product_name: "Gold Ring 22K", hsn_code: "711319", gst_percent: "3", quantity: "4.500", unit: "gms", rate: "6500.50", note: "Size 12" }],
  });
  const edit = toBillInput({ ...f, payment: null }, { mode: "edit", pos: "08", number: "KGH/2026-27/31", draftId: null, replaces: null });
  expect(edit).not.toHaveProperty("paper");
  expect(edit).not.toHaveProperty("draft_id");
  expect(edit.payment_mode).toBe("");
});

test("a typed number is saved in the firm's format when the firm uses full numbers on that date; anything else as typed", () => {
  const next = { business: 3, fy: "2026-27", invoice_date: "2026-09-30", counter: 35, invoice_number: "KGH/2026-27/35", full_number: true };
  expect(storedFor(next, " 034 ")).toBe("KGH/2026-27/34");
  expect(storedFor(next, "MO/26/9")).toBe("MO/26/9");
  expect(storedFor({ ...next, invoice_number: "35", full_number: false }, "034")).toBe("034");
  expect(storedFor(undefined, "34")).toBe("34");
});

test("a saved bill's lines: as stored, with no product link (lines keep their names)", () => {
  expect(linesFromBill(bill().lines)[0]).toMatchObject({ productId: null, custom: false, name: "Gold Ring 22K", hsn: "711319" });
});
