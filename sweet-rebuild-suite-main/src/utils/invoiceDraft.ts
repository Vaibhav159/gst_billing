/**
 * A line as the invoice form edits it, carrying its own product (H17).
 *
 * Line items have no product link, and the form used each line's own id as
 * its "product id". Where that id matched a catalog product, saving the
 * invoice (even just to change the payment mode) rewrote the line's name, HSN
 * and rate from that product. Duplicates were saved as "Item" at 0%, and an
 * amount-only line (quantity x rate of 0) was zeroed by any edit. So each draft
 * holds the stored name, HSN and rate, and only picking a product replaces them.
 */
import { rateToPercent } from "./gstRate";
import type { ItemUnit } from "./mockData";
import { halveTax, round2 } from "./money";

export type DraftLine = {
  _key: string;
  /** The dropdown's value: a catalog product's id, or storedLineKey() for a stored line. */
  productId: string;
  productName: string;
  hsn: string;
  /** Percent, as the form shows it. */
  gstRate: number;
  /**
   * As typed (UX7). They were numbers in inputs that began at "1" and "0", so
   * typing "10.5" into a fresh quantity gave "10.51", a rate "06543.21", and
   * clearing a field put the 0 back. Read through lineQty / lineRate.
   */
  qty: string;
  rate: string;
  unit: ItemUnit;
};

/** A stored line's dropdown key. Never equal to a catalog product's id. */
export const storedLineKey = (lineId: string | number) => `line:${lineId}`;

// Commas that group digits: international (123,456) or Indian (1,23,456).
const GROUPED = /^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3})(?:\.\d*)?$/;

/**
 * Why typed text can't be read as a figure, or null (M2). A comma is only
 * ever digit grouping: "10,5" from a comma-decimal keypad is refused, not
 * read as 105.
 */
export function figureProblem(text: string | number | null | undefined): string | null {
  const s = String(text ?? "").trim();
  if (!s.includes(",") || GROUPED.test(s)) return null;
  return "Use a point for decimals (10.5); a comma only groups digits (1,23,456).";
}

/** Typed text (or a number from an older draft) as an amount; anything not above zero, or unreadable, is 0. */
export function typedNumber(text: string | number | null | undefined): number {
  if (typeof text !== "number" && figureProblem(text)) return 0;
  const n = typeof text === "number" ? text : parseFloat(String(text ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The quantity a line bills. An empty field is the 1 its placeholder shows. */
export const lineQty = (line: { qty: string | number }) => (String(line.qty ?? "").trim() === "" ? 1 : typedNumber(line.qty));
export const lineRate = (line: { rate: string | number }) => typedNumber(line.rate);

/**
 * Quantity and rate for a line that may be amount-only: imports stored a gross
 * figure as 0 x 0 (or a weight x 0), which a form edit then saved as 0. Its
 * taxable value (amount less tax) comes back as quantity x rate, keeping the
 * weight when the rate, to 3 decimals, rounds back to the same paisa, as
 * tax_rules.unit_split does on the server; otherwise one unit at the taxable value.
 */
function qtyAndRate(qty: number, rate: number, amount: number, tax: number): { qty: string; rate: string } {
  const typed = (q: number, r: number) => ({ qty: String(q), rate: String(r) });
  if (qty * rate === 0 && amount > 0) {
    const taxable = round2(amount - tax);
    const perUnit = qty > 0 ? Math.round((taxable / qty) * 1000) / 1000 : 0;
    if (qty > 0 && round2(qty * perUnit) === taxable) return typed(qty, perUnit);
    return typed(1, taxable);
  }
  return typed(qty || 1, rate);
}

type StoredLine = {
  id: string | number; product_name?: string; item_name?: string; hsn_code?: string; gst_tax_rate: unknown;
  quantity: string | number; rate: string | number; amount: string | number;
  cgst?: string | number; sgst?: string | number; igst?: string | number; unit?: string;
};

/** A line as the API returned it, for editing. */
export function draftFromStored(li: StoredLine, key: string): DraftLine {
  const tax = (Number(li.cgst) || 0) + (Number(li.sgst) || 0) + (Number(li.igst) || 0);
  return {
    _key: key,
    productId: storedLineKey(li.id),
    productName: li.product_name || li.item_name || "",
    hsn: li.hsn_code || "",
    gstRate: rateToPercent(li.gst_tax_rate),
    ...qtyAndRate(Number(li.quantity) || 0, Number(li.rate) || 0, Number(li.amount) || 0, tax),
    unit: (li.unit || "gms") as ItemUnit,
  };
}

type DuplicateItem = {
  productName?: string; hsn?: string; gstRate?: number; qty?: number; quantity?: number; rate?: number; unit?: string;
  amount?: number; cgst?: number; sgst?: number; igst?: number;
};

/** A line of the invoice being duplicated (useDataStore's mapped shape). */
export function draftFromDuplicate(it: DuplicateItem, key: string): DraftLine {
  const tax = (it.cgst || 0) + (it.sgst || 0) + (it.igst || 0);
  return {
    _key: key,
    productId: storedLineKey(key),
    productName: it.productName || "",
    hsn: it.hsn || "",
    gstRate: it.gstRate || 0,
    ...qtyAndRate(it.qty || it.quantity || 0, it.rate || 0, it.amount || 0, tax),
    unit: (it.unit || "gms") as ItemUnit,
  };
}

type CatalogProduct = { id: string; name: string; hsn: string; gstRate: number; defaultUnit?: ItemUnit };

/**
 * A line of a draft the form saved locally, back for editing. Drafts saved
 * before H17 held only each line's product id (the form looked the rest up
 * when it saved); restored as they were, they were saved as "Item", no HSN,
 * 0%. Such a line takes its product's name, HSN and rate (review of H17).
 */
export function draftFromSaved(
  saved: Omit<Partial<DraftLine>, "qty" | "rate"> & { qty?: string | number; rate?: string | number },
  catalog: CatalogProduct[],
): DraftLine {
  // Drafts saved before UX7 hold qty and rate as numbers.
  const line = { ...saved, qty: String(saved.qty ?? ""), rate: String(saved.rate ?? "") } as DraftLine;
  if (line.productName) return line;
  const product = catalog.find((p) => p.id === line.productId);
  return product ? withProduct(line, product) : line;
}

/** The line once the user picks a product: its name, HSN, rate and unit. */
export function withProduct(draft: DraftLine, product: CatalogProduct): DraftLine {
  return { ...draft, productId: product.id, productName: product.name, hsn: product.hsn, gstRate: product.gstRate,
           unit: product.defaultUnit || draft.unit };
}

/** Taxable value and tax as the form shows them, in paise. */
export function lineMoney(draft: Pick<DraftLine, "qty" | "rate" | "gstRate">): { amount: number; tax: number } {
  const amount = round2(lineQty(draft) * lineRate(draft));
  return { amount, tax: round2((amount * draft.gstRate) / 100) };
}

/** The line as the form saves it: its own name, HSN and rate; heads in whole paise. */
export function lineToSave(draft: DraftLine, isIGST: boolean) {
  const { amount: net, tax } = lineMoney(draft);
  const { cgst, sgst } = isIGST ? { cgst: 0, sgst: 0 } : halveTax(tax);
  const igst = isIGST ? tax : 0;
  return {
    productId: draft.productId,
    productName: draft.productName,
    hsn: draft.hsn,
    gstRate: draft.gstRate,
    qty: lineQty(draft),
    rate: lineRate(draft),
    unit: draft.unit,
    // GROSS (net + tax): Invoice.total_amount is the sum of the lines' amounts.
    amount: round2(net + cgst + sgst + igst),
    cgst,
    sgst,
    igst,
  };
}
