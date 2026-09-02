/**
 * Rupee arithmetic that stays at two decimals.
 *
 * JavaScript numbers cannot hold most money values exactly, so every sum has
 * to be quantized somewhere. Doing it once, at the boundary, is the difference
 * between 30.30 and 30.299999999999997 — the latter is what a raw `+=` chain
 * produces for 10.10 + 20.20, and what a strict DecimalField rejects.
 */

/** Round to paise. */
export function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Split a tax into its CGST and SGST halves without losing or inventing a
 * paisa. Rounding both halves independently makes 16.49 into 8.24 + 8.24.
 */
export function halveTax(tax: number): { cgst: number; sgst: number } {
  const cgst = round2(tax / 2);
  return { cgst, sgst: round2(tax - cgst) };
}

/**
 * Rupees for people to read. Paise are ON by default: the canonical
 * formatCurrency rounds to whole rupees, which is right for a dashboard tile
 * and wrong for a confirmation sheet, a detail page or a printed bill — the
 * "eyeball every figure" gate showed Rs 57,596 for an invoice saved as 57,595.50.
 */
export function formatMoney(n: number, opts: { paise?: boolean } = {}): string {
  const paise = opts.paise ?? true;
  return new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR",
    minimumFractionDigits: paise ? 2 : 0, maximumFractionDigits: paise ? 2 : 0,
  }).format(Number(n) || 0);
}
