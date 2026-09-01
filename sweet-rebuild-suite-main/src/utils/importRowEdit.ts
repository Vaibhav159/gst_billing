/**
 * Recomputing an invoice after the import-review pencil edit (audit A7).
 *
 * Pulled out of the component because it is money math, and money math that
 * cannot be tested is money math that drifts. The version this replaces had
 * three compounding faults, and together they meant that opening the editor on
 * an interstate row and saving it *unchanged* turned Rs 10,300 into Rs 10,600:
 *
 *   1. it wrote qty x rate (net) into `amount`, a field every other stage of
 *      this pipeline treats as tax-inclusive;
 *   2. it recomputed CGST/SGST unconditionally and never cleared `igst`, so an
 *      interstate row ended up carrying all three heads;
 *   3. it then summed `amount` across items into `subtotal` — mixing the edited
 *      net row with unedited gross rows — and added the full tax on top again.
 */

import { halveTax, round2 } from "./money";

export interface EditableLine {
  qty: number;
  rate: number;
  gstRate: number;
  amount: number; // tax-inclusive
  cgst: number;
  sgst: number;
  igst: number;
}

export interface EditableInvoice {
  items: EditableLine[];
  subtotal: number; // taxable value, NOT the gross
  totalCGST: number;
  totalSGST: number;
  totalIGST: number;
  total: number;
}

/** The taxable value of a line, whatever basis it arrived on. */
export function lineTaxable(line: EditableLine): number {
  return line.amount - (line.cgst || 0) - (line.sgst || 0) - (line.igst || 0);
}

/**
 * Re-file one line's tax under the direction the invoice is already on, and
 * rebuild it as a tax-inclusive amount.
 */
export function recomputeLine(line: EditableLine, interstate: boolean): EditableLine {
  const existingTaxable = round2(lineTaxable(line));
  const existingTax = round2((line.cgst || 0) + (line.sgst || 0) + (line.igst || 0));

  // Amount-only rows (the importer accepts qty/rate of 0 when the file gives a
  // taxable or total) keep the taxable value they arrived with.
  const fromQty = round2(line.qty * line.rate);
  const taxable = fromQty > 0 ? fromQty : existingTaxable;

  // A rate the sheet could not resolve is still implied by its own heads.
  // Defaulting it to 0 (or to 3, as before) rewrote money on an unchanged save.
  let gstRate = line.gstRate || 0;
  if (!gstRate && existingTaxable > 0 && existingTax > 0) {
    gstRate = round2((existingTax / existingTaxable) * 100);
  }
  const tax = round2((taxable * gstRate) / 100);

  const { cgst, sgst } = interstate ? { cgst: 0, sgst: 0 } : halveTax(tax);
  const igst = interstate ? tax : 0;

  return { ...line, gstRate, cgst, sgst, igst, amount: round2(taxable + cgst + sgst + igst) };
}

/** True when this invoice is already filed as an interstate supply. */
export function isInterstate(invoice: EditableInvoice): boolean {
  return (
    (invoice.totalIGST || 0) > 0 || invoice.items.some((i) => (i.igst || 0) > 0)
  );
}

/**
 * Apply a qty/rate edit to the first line and rebuild every total from scratch.
 * Every line is measured the same way, edited or not.
 */
export function applyRowEdit(
  invoice: EditableInvoice,
  edit: { qty: number; rate: number },
): EditableInvoice {
  const interstate = isInterstate(invoice);
  const items = invoice.items.map((line, idx) =>
    idx === 0 ? recomputeLine({ ...line, qty: edit.qty, rate: edit.rate }, interstate) : line,
  );

  const subtotal = round2(items.reduce((s, i) => s + lineTaxable(i), 0));
  const totalCGST = round2(items.reduce((s, i) => s + (i.cgst || 0), 0));
  const totalSGST = round2(items.reduce((s, i) => s + (i.sgst || 0), 0));
  const totalIGST = round2(items.reduce((s, i) => s + (i.igst || 0), 0));

  return {
    ...invoice,
    items,
    subtotal,
    totalCGST,
    totalSGST,
    totalIGST,
    total: round2(subtotal + totalCGST + totalSGST + totalIGST),
  };
}
