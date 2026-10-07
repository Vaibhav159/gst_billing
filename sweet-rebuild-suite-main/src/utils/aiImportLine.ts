/**
 * What an AI-read line will be booked at, for the review screen (M19).
 *
 * The rate box rounded to one decimal, so 0.25% showed as "0.3", and wrote
 * value / 100 back, outside the slab list. Amount and Total were editable,
 * but the server recomputes every AI line from quantity x rate x (1 + r), so
 * a bill with making charges showed 1,05,000 in review and stored 1,03,000.
 */
import { aiRateChoice, percentToRate, rateToPercent } from "./gstRate";
import { round2 } from "./money";

type Line = { quantity: number; rate: number; gst_tax_rate: number | null };

/**
 * The AI's reading, with each rate as the slab it is, or unchosen (null).
 *
 * Gemini has to answer a number and answers 0 when a bill prints no per-line
 * rate (the usual jewellery bill, CGST/SGST @1.5% in its footer). Since M19 a 0
 * is booked as 0%, so a 0 the AI read went in tax-free. A 0, a missing rate and
 * one off the slab list start unchosen, as on the inward form (aiRateChoice),
 * and Create waits until a person picks (review of M19).
 */
export function fromAiReading<T extends { line_items: Pick<Line, "gst_tax_rate">[] }>(extracted: T): T {
  return {
    ...extracted,
    line_items: extracted.line_items.map((li) => {
      const slab = aiRateChoice(li.gst_tax_rate);
      return { ...li, gst_tax_rate: slab ? percentToRate(slab) : null };
    }),
  };
}

/** Lines still waiting for a rate. A picked 0% is a rate. */
export function linesWithoutRate(lines: Pick<Line, "gst_tax_rate">[]): number {
  return lines.filter((li) => li.gst_tax_rate === null || li.gst_tax_rate === undefined).length;
}

/** The slab picker's value for a line: the slab as text, or "" when none was read. */
export function rateChoice(li: Pick<Line, "gst_tax_rate">): string {
  return li.gst_tax_rate === null || li.gst_tax_rate === undefined ? "" : String(rateToPercent(li.gst_tax_rate));
}

/** A picked slab back as the stored fraction; "" stays unread. */
export function rateFromChoice(value: string): number | null {
  return value === "" ? null : percentToRate(value);
}

/**
 * A line's rate as the server books it: through the slab list, read as a
 * fraction (normalize_rate), so 0.25 is 0.25% and 3 is 3%. Taken raw, a
 * Rs 1,00,000 line at "3" showed Rs 4,00,000 (review of M19). An unread rate
 * is 3% on a sale (the server's default) and nothing on a purchase.
 */
function bookedRate(li: Line, type: "inward" | "outward"): number {
  if (li.gst_tax_rate === null || li.gst_tax_rate === undefined) return type === "inward" ? 0 : 0.03;
  return percentToRate(li.gst_tax_rate, "fraction");
}

/** The tax the server will book on a line, in paise, as build_line_items does for AI lines. */
export function bookedTax(li: Line, type: "inward" | "outward"): number {
  const net = round2((Number(li.quantity) || 0) * (Number(li.rate) || 0));
  return round2(net * bookedRate(li, type));
}

/** The amount the server will store: taxable and tax in paise. */
export function bookedAmount(li: Line, type: "inward" | "outward"): number {
  const net = round2((Number(li.quantity) || 0) * (Number(li.rate) || 0));
  return round2(net + bookedTax(li, type));
}
