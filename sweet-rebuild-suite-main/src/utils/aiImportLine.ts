/**
 * What an AI-read line will be booked at, for the review screen (M19).
 *
 * The rate box rounded to one decimal, so 0.25% showed as "0.3", and wrote
 * value / 100 back, outside the slab list. Amount and Total were editable,
 * but the server recomputes every AI line from quantity x rate x (1 + r), so
 * a bill with making charges showed 1,05,000 in review and stored 1,03,000.
 */
import { percentToRate, rateToPercent } from "./gstRate";
import { round2 } from "./money";

type Line = { quantity: number; rate: number; gst_tax_rate: number | null };

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
