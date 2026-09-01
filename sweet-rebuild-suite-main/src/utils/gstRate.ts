/**
 * The one place that converts between the two shapes a GST rate travels in.
 *
 * The app stores rates as fractions (`gst_tax_rate` = 0.03) and displays them
 * as percents (`gstRate` = 3). Six copies of `raw > 1 ? raw / 100 : raw` used
 * to make that call by magnitude, which is right for 1.5/3/5/12/18/28 and
 * wrong for the two slabs at or below 1:
 *
 *   0.25%  ->  0.25 is not > 1  ->  stored as 0.25  =  25%   (100x the tax)
 *   1%     ->  1    is not > 1  ->  stored as 1     =  100%
 *
 * Resolve by the slab list instead. No legal slab is another legal slab when
 * multiplied by 100, so at most one reading of a value is legal — and since
 * 25% and 100% are not slabs at all, a row written by the old heuristic reads
 * back as the rate that was actually meant.
 *
 * Mirrors billing/tax_rules.py — keep the two slab lists in step.
 */

// 0.1% is merchant exports; 40% is the de-merit slab in force since 22 Sep 2025.
export const GST_SLABS = [0, 0.1, 0.25, 1, 1.5, 3, 5, 12, 18, 28, 40] as const;

/** The stored column is numeric(13,4), so 4dp is the full precision. */
const STORED_DP = 4;

// 0.03 * 100 is 3.0000000000000004 in IEEE-754, so slabs need a tolerance.
const EPS = 1e-9;

function matchSlab(value: number): number | null {
  for (const slab of GST_SLABS) {
    if (Math.abs(value - slab) < EPS) return slab;
  }
  return null;
}

function resolvePercent(value: unknown): number | null {
  const v = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  if (!Number.isFinite(v)) return null;
  if (v === 0) return 0;

  const asPercent = matchSlab(v);
  if (asPercent !== null) return asPercent; // already a percent: 0.25, 3, 18

  const asFraction = matchSlab(v * 100);
  if (asFraction !== null) return asFraction; // a stored fraction: 0.0025, 0.03

  return null;
}

/**
 * Percent (3) -> the fraction the API stores (0.03).
 *
 * `assume` decides only off-slab values; every legal slab is resolved by the
 * allowlist regardless. Pass the shape the call site actually receives.
 */
export function percentToRate(
  value: unknown,
  assume: "percent" | "fraction" = "percent",
): number {
  const resolved = resolvePercent(value);
  let percent = resolved;
  if (percent === null) {
    const v = typeof value === "number" ? value : parseFloat(String(value ?? ""));
    if (!Number.isFinite(v)) return 0;
    // A stored fraction can never exceed 1, so anything above 1 is a percent
    // whatever the caller assumed. Without this an off-slab 40 (the de-merit
    // slab before it was listed) came out as 4000%.
    percent = v > 1 || assume === "percent" ? v : v * 100;
  }
  const factor = 10 ** STORED_DP;
  return Math.round((percent / 100) * factor) / factor;
}

/** The stored fraction (0.0025) -> the percent people read (0.25). */
export function rateToPercent(stored: unknown): number {
  const resolved = resolvePercent(stored);
  if (resolved !== null) return resolved;
  const v = typeof stored === "number" ? stored : parseFloat(String(stored ?? ""));
  if (!Number.isFinite(v)) return 0;
  // Above 1 it cannot be a fraction: it is a percent that was stored verbatim.
  return v > 1 ? v : Math.round(v * 100 * 100) / 100;
}

/**
 * Pull the stored fraction out of a line item that may carry either field —
 * one conversion, by key. (The percent-then-fraction round trip this replaces
 * rounded twice and lost 4dp precision on the way.)
 */
export function lineItemToStoredRate(item: {
  gstRate?: unknown;
  gst_tax_rate?: unknown;
}): number {
  if (item.gstRate !== undefined && item.gstRate !== null && item.gstRate !== "") {
    return percentToRate(item.gstRate, "percent");
  }
  if (item.gst_tax_rate !== undefined && item.gst_tax_rate !== null) {
    return percentToRate(item.gst_tax_rate, "fraction");
  }
  return 0;
}

/**
 * Pull the percent out of a line item that may carry either field.
 *
 * The write paths accept both `gstRate` (percent, the UI's own shape) and
 * `gst_tax_rate` (fraction, the API's). Resolving by *which key is present*
 * is what removes the guesswork — the magnitude never had to decide this.
 */
export function lineItemPercent(item: {
  gstRate?: unknown;
  gst_tax_rate?: unknown;
}): number {
  if (item.gstRate !== undefined && item.gstRate !== null && item.gstRate !== "") {
    return rateToPercent(percentToRate(item.gstRate, "percent"));
  }
  if (item.gst_tax_rate !== undefined && item.gst_tax_rate !== null) {
    return rateToPercent(item.gst_tax_rate);
  }
  return 0;
}
