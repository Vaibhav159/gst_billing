/**
 * Test-only snapshot of the exact rateToPercent resolver dependencies in v2's
 * gstRate.ts, commit 112cacf0. No app tax helper is substituted into the oracle.
 * Body SHA-256 (inside outer braces, LF, trailing line whitespace removed):
 * matchSlab: 606037333f8b0a752c9485678c45649450c2efa6c452b0675075a117295b1bf4
 * resolvePercent: 84862c4239144b76dc95e7972f8ec1af19a29fc0251d4bdf317abc75f21f94f5
 * rateToPercent: 546c5020d09a6749133a5442028d91c9c52718295907d2deaaa008195d0a1c6d
 */
export const GST_SLABS = [0, 0.1, 0.25, 1, 1.5, 3, 5, 12, 18, 28, 40] as const;
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

export function rateToPercent(stored: unknown): number {
  const resolved = resolvePercent(stored);
  if (resolved !== null) return resolved;
  const v = typeof stored === "number" ? stored : parseFloat(String(stored ?? ""));
  if (!Number.isFinite(v)) return 0;
  // Above 1 it cannot be a fraction: it is a percent that was stored verbatim.
  return v > 1 ? v : Math.round(v * 100 * 100) / 100;
}
