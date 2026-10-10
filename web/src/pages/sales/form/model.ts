// The bill form's state and where a bill starts from (PROTO pages/sales/useBillForm.js): a new bill at the counter, a
// paper bill, a copy of a bill, a cancelled bill made again, an unfinished bill picked up, or a bill being changed. And
// what it becomes: the body POST and PUT sales/ take, and the unfinished bill a draft keeps. Paper first (the owner's
// answer, 10 Oct 2026): the number is always the paper bill's, typed or the suggested next one confirmed.
import { toCustomer, type Customer } from "@/core/api/customers";
import type { DraftData, DraftLine, UnfinishedBill } from "@/core/api/drafts";
import { paiseToDecimal, unitDecimals } from "@/core/format";
import { GST_STATES, hasGstin, stateCodeOf } from "@/core/ids";
import { autoPos } from "@/core/sales/pos";
import type { BillDetail, BillInput, CustomerOnBill, Line, PaymentMode, Person } from "@/core/sales/types";
import type { SaleProduct } from "./products";

/** A line as it's being typed. qty: a number (its unit's decimals); rate: rupees as typed, up to 3 decimals ("6512.50"). */
export type FormLine = DraftLine & {
  key: string;
  /** Typed starting with "." (".5"): worth a word, "Weight typed as .5 g: 0.500 g. Is that right?" */
  dotQty?: boolean;
  /** Came in with an amount only (an import): opened as 1 × its value. */
  amountOnly?: boolean;
};

export type FormState = {
  firmId: number | null;
  customer: Customer | null;
  /** ISO, or "" while what's typed isn't a date. */
  date: string;
  /** The number field's text: the paper bill's number as typed, or the suggestion while numberTyped is false. */
  number: string;
  /** False: the number follows the suggestion (the next free number, or the paper book's next); true: typed. */
  numberTyped: boolean;
  /** Copied in later from the paper bill book: no send nag, and its own number and date. */
  paper: boolean;
  /** null: where the form would put it anyway (autoPos); "": delivered to another state, not chosen yet. */
  posOverride: string | null;
  /** null: not picked yet (asked in the review). "" is "Not recorded", kept on an older bill. */
  payment: PaymentMode | null;
  notes: string;
  lines: FormLine[];
};

/** Where a bill came from, for the banner above the form. */
export type Origin =
  | { kind: "paper" }
  | { kind: "draft"; startedBy: Person; startedAt: string }
  | { kind: "missing-draft" }
  | { kind: "copy"; number: string; customer: string; date: string }
  | { kind: "remake"; number: string; reason: string }
  | { kind: "amountOnly" }
  | { kind: "prefill" }
  | null;

/** Which firm the bill starts in, for the hint under Firm. */
export type FirmSource = "scope" | "mine" | "first" | "paper" | "draft" | "copy" | "bill";

export type Start = {
  mode: "new" | "edit";
  form: FormState;
  origin: Origin;
  firmSource: FirmSource;
  /** The unfinished bill this is (?draft=), or null until the form first keeps one. */
  draftId: string | null;
  /** The cancelled bill this one makes again (?remake=). */
  replaces: number | null;
  /** Editing: the bill as saved. */
  bill: BillDetail | null;
  /** A paper bill opened without a date: it takes the paper book's next date once that's known. */
  bookDate: boolean;
  /** Editing a bill that came in missing something: its problems show at once. */
  tried: boolean;
};

let seq = 0;
export const newKey = () => `l${(seq += 1)}${Math.random().toString(36).slice(2, 5)}`;
export function blankLine(): FormLine {
  return { key: newKey(), productId: null, name: "", hsn: "", gst: null, unit: "gms", qty: null, rate: "", note: "", custom: false };
}
/** A line with something on it: a product picked, a one-off item, or a line from a saved bill. */
export const hasContent = (l: Pick<FormLine, "productId" | "name">) => Boolean(l.productId || l.name.trim());

/** A product picked on a line: its name, HSN, GST rate and unit. The rate is typed as written (making included). */
export function lineFromProduct(p: SaleProduct, prev: FormLine): FormLine {
  return { ...prev, productId: p.id, name: p.name, hsn: p.hsn_code, gst: p.gst_percent, unit: p.unit, note: prev.note || p.description.slice(0, 60), custom: false, amountOnly: false };
}

/** A saved bill's lines as form lines. A line that came in with an amount only opens as 1 × its value (PROTO useBillForm.js:39-46). */
export function linesFromBill(lines: Line[]): FormLine[] {
  return lines.map((l) => {
    const base: FormLine = { key: newKey(), productId: null, name: l.product_name, hsn: l.hsn_code, gst: l.gst_percent || null, unit: l.unit || "gms", qty: Number(l.quantity) || null, rate: l.rate, note: l.note, custom: false };
    if (!Number(l.quantity) && !Number(l.rate) && l.taxable > 0) {
      return { ...base, qty: 1, unit: unitDecimals(l.unit) === 0 ? l.unit : "nos", rate: paiseToDecimal(l.taxable), amountOnly: true };
    }
    return base;
  });
}

/**
 * The bill's customer as the form holds a customer, for a bill being changed or copied: 1C's reader, which keeps the
 * server's type and pan as they are. A bill doesn't carry the stored customer_type, so it reads "" (worked out).
 */
export const customerFromBill = (c: CustomerOnBill): Customer => toCustomer(c);

/**
 * A party's GST state as the server reads it (billing/tax_rules.py state_code): a GSTIN's first two digits, else the
 * state on file. A registered buyer whose typed state disagrees with its GSTIN is placed by its GSTIN. "" when the code
 * isn't one GST's table has (an old "28" GSTIN, imported "00…"): the server refuses such a place of supply, so the form
 * asks for the state rather than guess.
 */
export function stateOf(gstin: string | null | undefined, stateName: string | null | undefined): string {
  const code = hasGstin(gstin) ? (gstin ?? "").trim().slice(0, 2) : stateCodeOf(stateName);
  return GST_STATES[code] ? code : "";
}
/** What autoPos and taxType read of a customer: its type and GSTIN (1B's rules read no stored state). */
export const posCustomer = (c: Customer | null) => (c ? { type: c.type, gst_number: c.gst_number } : null);

/** A saved place of supply as the form's override: null when it's where the form would put it anyway. */
export function posOverrideOf(firmState: string, customer: Customer | null, placeOfSupply: string): string | null {
  return placeOfSupply && placeOfSupply !== autoPos(firmState, posCustomer(customer)) ? placeOfSupply : null;
}

const blankForm = (firmId: number | null, date: string): FormState => ({
  firmId, customer: null, date, number: "", numberTyped: false, paper: false, posOverride: null, payment: null, notes: "", lines: [blankLine()],
});
const base = (form: FormState, more: Partial<Start> = {}): Start => ({
  mode: "new", form, origin: null, firmSource: "scope", draftId: null, replaces: null, bill: null, bookDate: false, tried: false, ...more,
});

/** A new bill at the counter: today, the next number suggested, nothing paid yet. A link can pick the customer and the payment. */
export function startNew({ firmId, firmSource, today, customer = null, payment = null }: { firmId: number | null; firmSource: FirmSource; today: string; customer?: Customer | null; payment?: PaymentMode | null }): Start {
  return base({ ...blankForm(firmId, today), customer, payment }, { firmSource, origin: customer || payment ? { kind: "prefill" } : null });
}

/**
 * A bill copied from the paper bill book (?paper=1&firm=&date=&number=): its own number and date. Without a date it takes
 * the date this firm's last paper bill had this visit, else the paper book's next date for last month (bookDate).
 */
export function startPaper({ firmId, date, number, remembered, lastMonth }: { firmId: number | null; date: string; number: string; remembered: string; lastMonth: string }): Start {
  const day = date || remembered;
  const form: FormState = { ...blankForm(firmId, day || `${lastMonth}-01`), paper: true, number, numberTyped: Boolean(number) };
  return base(form, { firmSource: "paper", origin: { kind: "paper" }, bookDate: !day });
}

/** Duplicate (?from=): the customer, place of supply and items; today's date, the next number, and no payment yet. */
export function startCopy(bill: BillDetail, today: string): Start {
  const customer = customerFromBill(bill.customer);
  const lines = linesFromBill(bill.lines);
  return base({ ...blankForm(bill.business, today), customer, posOverride: posOverrideOf(bill.firm.state_code, customer, bill.place_of_supply), lines: lines.length ? lines : [blankLine()] }, {
    firmSource: "copy", origin: { kind: "copy", number: bill.invoice_number, customer: bill.customer.name, date: bill.invoice_date },
  });
}

/** Make a cancelled bill again (?remake=): the same firm, customer, place of supply, payment, note and items; it replaces the cancelled one. */
export function startRemake(bill: BillDetail, today: string): Start {
  const s = startCopy(bill, today);
  return { ...s, form: { ...s.form, payment: bill.payment_mode || null, notes: bill.notes }, replaces: bill.id, origin: { kind: "remake", number: bill.invoice_number, reason: bill.cancel_reason } };
}

/** Changing a saved bill: everything as saved; the number kept unless it's renumbered or the bill moves. */
export function startEdit(bill: BillDetail): Start {
  const customer = customerFromBill(bill.customer);
  const lines = linesFromBill(bill.lines);
  const form: FormState = {
    firmId: bill.business, customer, date: bill.invoice_date, number: bill.invoice_number, numberTyped: false, paper: bill.paper,
    posOverride: posOverrideOf(bill.firm.state_code, customer, bill.place_of_supply), payment: bill.payment_mode, notes: bill.notes, lines: lines.length ? lines : [blankLine()],
  };
  return base(form, {
    mode: "edit", firmSource: "bill", bill, origin: lines.some((l) => l.amountOnly) ? { kind: "amountOnly" } : null,
    tried: !bill.lines.length || bill.lines.some((l) => !l.hsn_code),
  });
}

/** An unfinished bill picked up (?draft=), whoever started it. */
export function startDraft(d: UnfinishedBill): Start {
  return base(fromDraftData(d.data), {
    firmSource: "draft", draftId: d.id, replaces: d.data.replaces, origin: { kind: "draft", startedBy: d.started_by, startedAt: d.created_at },
  });
}

/** An unfinished bill's data as the form's state. */
export function fromDraftData(d: DraftData): FormState {
  const lines = d.lines.map((l): FormLine => ({ ...l, key: newKey() }));
  return {
    firmId: d.firmId, customer: d.customer, date: d.date, number: d.number, numberTyped: d.numberTyped, paper: d.paper, posOverride: d.posOverride,
    payment: d.payment, notes: d.notes, lines: lines.length ? lines : [blankLine()],
  };
}
/** The form's state as an unfinished bill keeps it (lines with something on them only). */
export function toDraftData(f: FormState, replaces: number | null): DraftData {
  return {
    v: 1, firmId: f.firmId, customer: f.customer, date: f.date, number: f.number, numberTyped: f.numberTyped, paper: f.paper, posOverride: f.posOverride,
    payment: f.payment, notes: f.notes, replaces,
    lines: f.lines.filter(hasContent).map(({ productId, name, hsn, gst, unit, qty, rate, note, custom }) => ({ productId, name, hsn, gst, unit, qty, rate, note, custom })),
  };
}

/** A quantity as the API takes it: 3 decimals ("4.500"). */
export const qtyText = (n: number | null) => (n == null ? "" : n.toFixed(3));

/** What POST or PUT sales/ is sent. pos: the place of supply as a code; number: the paper bill's number as typed. */
export function toBillInput(f: FormState, { mode, pos, number, draftId, replaces }: { mode: "new" | "edit"; pos: string; number: string; draftId: string | null; replaces: number | null }): BillInput {
  return {
    business: f.firmId as number, customer: (f.customer as Customer).id, invoice_number: number.trim(), invoice_date: f.date, payment_mode: f.payment ?? "",
    place_of_supply: pos, notes: f.notes.trim(),
    ...(mode === "new" ? { paper: f.paper, replaces, draft_id: draftId } : {}),
    lines: f.lines.filter(hasContent).map((l) => ({ product_name: l.name.trim(), hsn_code: l.hsn, gst_percent: l.gst ?? "", quantity: qtyText(l.qty), unit: l.unit, rate: l.rate, note: l.note.trim() })),
  };
}

/**
 * What a typed number is saved as, by the firm's next-number answer (contract §2.11): 1B's storedFor, its one home
 * (Ruling 1B-15), named here too so the form's files import it from the model.
 */
export { storedFor } from "@/core/sales/numbers";

/** The GST rates, the jeweller's two first (PROTO sales/parts.jsx:1039-1040), with what each is for. */
const SLAB_HINT: Record<string, string> = { "3": "gold, silver, jewellery", "0.25": "cut and polished diamonds", "0.1": "goods to exporters", "1.5": "rough diamonds", "5": "job work", "18": "services, packing", "0": "exempt" };
export const SLABS = ["3", "0.25", "0", "0.1", "1", "1.5", "5", "12", "18", "28", "40"] as const;
export const SLAB_OPTIONS = SLABS.map((p) => ({ value: p, label: `${p}%${SLAB_HINT[p] ? ` · ${SLAB_HINT[p]}` : ""}` }));
