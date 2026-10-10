// Bill maths with the server's rounding (billing/tax_rules.py to_paise and split_tax; billing/services/line_items.py):
// every figure in whole paise, half-up. A line's taxable value = paise(quantity × rate); its tax = paise(taxable × GST
// rate); CGST = paise(tax ÷ 2) and SGST = tax − CGST, or all of it IGST; amount = taxable + tax. A bill sums its lines.
// The prototype rounded each head on its own (P§2.3), up to a paisa apart: not followed (design decision 2).
// maths.vectors.json holds figures worked out with the server's own Decimal rule; maths.test.ts holds the two equal.

/** One line as the maths takes it: quantity, rate per unit and GST percent, as typed or stored ("12.345", "6512.50", "3"). */
export type MathsLine = { quantity: string | number; rate: string | number; gst_percent: string | number };
export type LineFigures = { taxable: number; cgst: number; sgst: number; igst: number; tax: number; amount: number };
export type SlabFigures = { gst_percent: string; taxable: number; cgst: number; sgst: number; igst: number; tax: number };
export type BillFigures = {
  /** Each line's figures, or null for a line whose quantity, rate or GST rate isn't a number yet. */
  lines: (LineFigures | null)[];
  taxable: number; cgst: number; sgst: number; igst: number; tax: number; total: number;
  /** Tax by slab, highest first. */
  slabs: SlabFigures[];
  payable: number; round_off: number;
  /** How many lines aren't worked out yet. */
  pending: number;
};

/** A plain non-negative decimal as a whole number of 10^-places: scaled("12.345", 3) is 12345n. More places round half-up. Null when it isn't one. */
export function scaled(v: string | number, places: number): bigint | null {
  const s = typeof v === "number" ? (Number.isFinite(v) && v >= 0 ? String(v) : "") : v.trim();
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] ?? "";
  let n = BigInt(m[1] + (frac + "0".repeat(places)).slice(0, places));
  if (frac.length > places && Number(frac[places]) >= 5) n += 1n;
  return n;
}

/** a ÷ b rounded half-up, for a ≥ 0 and b > 0. */
function halfUp(a: bigint, b: bigint): bigint {
  return (2n * a + b) / (2n * b);
}

/** A line's figures in paise, or null while its quantity, rate or GST rate isn't a number. */
export function lineFigures(l: MathsLine, interstate: boolean): LineFigures | null {
  const q = scaled(l.quantity, 3);
  const r = scaled(l.rate, 3);
  const bp = scaled(l.gst_percent, 2);
  if (q == null || r == null || bp == null) return null;
  const taxable = halfUp(q * r, 10000n); // thousandths × thousandths of a rupee are 10^-6 rupees; paise are 10^-2
  const tax = halfUp(taxable * bp, 10000n); // a percent in hundredths: 3% is 300
  const cgst = interstate ? 0n : (tax + 1n) / 2n; // paise(tax ÷ 2), half-up
  return {
    taxable: Number(taxable), cgst: Number(cgst), sgst: Number(interstate ? 0n : tax - cgst), igst: Number(interstate ? tax : 0n),
    tax: Number(tax), amount: Number(taxable + tax),
  };
}

/** The tax a taxable value (paise) carries at a GST percent, in paise; null when the percent isn't a number. */
export function taxFor(taxablePaise: number, gstPercent: string | number): number | null {
  const bp = scaled(gstPercent, 2);
  if (bp == null || !Number.isInteger(taxablePaise) || taxablePaise < 0) return null;
  return Number(halfUp(BigInt(taxablePaise) * bp, 10000n));
}

/** The total rounded to the rupee by today's rule (custom_round, billing/models.py): 50 paise and up rounds up. */
export function payableOf(totalPaise: number): number {
  const r = ((totalPaise % 100) + 100) % 100;
  return r < 50 ? totalPaise - r : totalPaise - r + 100;
}

/** payable − total: what the bill rounds by ("-0.21" is −21). */
export function roundOffOf(totalPaise: number): number {
  return payableOf(totalPaise) - totalPaise;
}

/** "3", "3.0" and 3 are one slab. */
const slabKey = (p: string | number): string => String(Number(p));

/** A bill's figures from its lines: each line, the sums, tax by slab (highest first) and the payable total. */
export function billFigures(lines: MathsLine[], interstate: boolean): BillFigures {
  const figs = lines.map((l) => lineFigures(l, interstate));
  const sum = { taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 };
  const slabs = new Map<string, SlabFigures>();
  figs.forEach((f, i) => {
    if (!f) return;
    sum.taxable += f.taxable; sum.cgst += f.cgst; sum.sgst += f.sgst; sum.igst += f.igst; sum.tax += f.tax;
    const k = slabKey(lines[i].gst_percent);
    const s = slabs.get(k) ?? { gst_percent: k, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 };
    s.taxable += f.taxable; s.cgst += f.cgst; s.sgst += f.sgst; s.igst += f.igst; s.tax += f.tax;
    slabs.set(k, s);
  });
  const total = sum.taxable + sum.tax;
  return {
    lines: figs, ...sum, total,
    slabs: [...slabs.values()].sort((a, b) => Number(b.gst_percent) - Number(a.gst_percent)),
    payable: payableOf(total), round_off: roundOffOf(total), pending: figs.filter((f) => !f).length,
  };
}

/** Lines whose stored tax isn't what their GST rate gives, by more than a paisa (imported or hand-typed tax; the server's tax_mismatch). */
export function taxSlips(lines: { taxable: number; tax: number; gst_percent: string }[]): { index: number; want: number; got: number }[] {
  const out: { index: number; want: number; got: number }[] = [];
  lines.forEach((l, index) => {
    const want = taxFor(l.taxable, l.gst_percent);
    if (want != null && Math.abs(want - l.tax) > 1) out.push({ index, want, got: l.tax });
  });
  return out;
}
