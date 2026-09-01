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

export function roundAmount(value: number): number {
  return Math.round(value * 100) / 100;
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
  const taxable = roundAmount(line.qty * line.rate);
  const tax = roundAmount((taxable * (line.gstRate || 0)) / 100);

  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (interstate) {
    igst = tax;
  } else {
    cgst = roundAmount(tax / 2);
    sgst = roundAmount(tax - cgst); // the odd paise lands once, not twice
  }

  return { ...line, cgst, sgst, igst, amount: roundAmount(taxable + cgst + sgst + igst) };
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

  const subtotal = roundAmount(items.reduce((s, i) => s + lineTaxable(i), 0));
  const totalCGST = roundAmount(items.reduce((s, i) => s + (i.cgst || 0), 0));
  const totalSGST = roundAmount(items.reduce((s, i) => s + (i.sgst || 0), 0));
  const totalIGST = roundAmount(items.reduce((s, i) => s + (i.igst || 0), 0));

  return {
    ...invoice,
    items,
    subtotal,
    totalCGST,
    totalSGST,
    totalIGST,
    total: roundAmount(subtotal + totalCGST + totalSGST + totalIGST),
  };
}
