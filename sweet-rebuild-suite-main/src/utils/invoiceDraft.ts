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
  qty: number;
  rate: number;
  unit: ItemUnit;
};

/** A stored line's dropdown key. Never equal to a catalog product's id. */
export const storedLineKey = (lineId: string | number) => `line:${lineId}`;

/**
 * Quantity and rate for a line that may be amount-only: imports stored a gross
 * figure as 0 x 0 (or a weight x 0), which a form edit then saved as 0. Its
 * taxable value (amount less tax) comes back as quantity x rate, keeping the
 * weight when the rate, to 3 decimals, rounds back to the same paisa, as
 * tax_rules.unit_split does on the server; otherwise one unit at the taxable value.
 */
function qtyAndRate(qty: number, rate: number, amount: number, tax: number): { qty: number; rate: number } {
  if (qty * rate === 0 && amount > 0) {
    const taxable = round2(amount - tax);
    const perUnit = qty > 0 ? Math.round((taxable / qty) * 1000) / 1000 : 0;
    if (qty > 0 && round2(qty * perUnit) === taxable) return { qty, rate: perUnit };
    return { qty: 1, rate: taxable };
  }
  return { qty: qty || 1, rate };
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

/** The line once the user picks a product: its name, HSN, rate and unit. */
export function withProduct(
  draft: DraftLine,
  product: { id: string; name: string; hsn: string; gstRate: number; defaultUnit?: ItemUnit },
): DraftLine {
  return { ...draft, productId: product.id, productName: product.name, hsn: product.hsn, gstRate: product.gstRate,
           unit: product.defaultUnit || draft.unit };
}

/** Taxable value and tax as the form shows them, in paise. */
export function lineMoney(draft: Pick<DraftLine, "qty" | "rate" | "gstRate">): { amount: number; tax: number } {
  const amount = round2(draft.qty * draft.rate);
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
    qty: draft.qty,
    rate: draft.rate,
    unit: draft.unit,
    // GROSS (net + tax): Invoice.total_amount is the sum of the lines' amounts.
    amount: round2(net + cgst + sgst + igst),
    cgst,
    sgst,
    igst,
  };
}
