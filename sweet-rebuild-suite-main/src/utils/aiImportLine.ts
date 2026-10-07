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
 * The amount the server will store: taxable and tax in paise, as
 * build_line_items does for AI lines. An unread rate is 3% on a sale (the
 * server's default) and nothing on a purchase.
 */
export function bookedAmount(li: Line, type: "inward" | "outward"): number {
  const net = round2((Number(li.quantity) || 0) * (Number(li.rate) || 0));
  const rate = li.gst_tax_rate ?? (type === "inward" ? 0 : 0.03);
  return round2(net + round2(net * rate));
}
