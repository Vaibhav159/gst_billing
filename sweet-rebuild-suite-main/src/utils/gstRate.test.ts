import { describe, it, expect } from "vitest";
import { GST_SLABS, percentToRate, rateToPercent, lineItemPercent } from "./gstRate";

// The heuristic this replaces, kept here to pin exactly where it disagreed.
const old = (raw: number) => (raw > 1 ? raw / 100 : raw);

describe("percentToRate — percent in, stored fraction out", () => {
  it("round-trips every slab", () => {
    for (const slab of GST_SLABS) {
      expect(rateToPercent(percentToRate(slab))).toBe(slab);
    }
  });

  it("stores the 0.25% diamond slab as 0.0025, not 0.25 (A1)", () => {
    expect(percentToRate(0.25)).toBe(0.0025);
    expect(old(0.25)).toBe(0.25); // what shipped: 25%
  });

  it("stores 1% as 0.01, not 1 (`1 > 1` is false)", () => {
    expect(percentToRate(1)).toBe(0.01);
    expect(old(1)).toBe(1); // what shipped: 100%
  });

  it("leaves the slabs the old heuristic got right unchanged", () => {
    for (const pct of [1.5, 3, 5, 12, 18, 28]) {
      expect(percentToRate(pct)).toBeCloseTo(old(pct), 10);
    }
  });

  it("was exactly 100x too big on the two broken slabs", () => {
    for (const pct of [0.25, 1]) {
      expect(old(pct)).toBeCloseTo(percentToRate(pct) * 100, 10);
    }
  });

  it("is idempotent — safe to feed stored values back in", () => {
    for (const slab of GST_SLABS) {
      const stored = percentToRate(slab);
      expect(percentToRate(stored)).toBe(stored);
    }
  });

  it("survives float noise (0.03 * 100 is 3.0000000000000004)", () => {
    expect(percentToRate(0.03)).toBe(0.03);
    expect(rateToPercent(0.03)).toBe(3);
    expect(percentToRate(3)).toBe(0.03);
  });

  it("accepts strings, as the API hands them back", () => {
    expect(percentToRate("0.25")).toBe(0.0025);
    expect(rateToPercent("0.0025")).toBe(0.25);
    expect(rateToPercent("0.0300")).toBe(3);
  });

  it("never emits float dust into the payload", () => {
    for (const slab of GST_SLABS) {
      const stored = percentToRate(slab);
      expect(String(stored)).not.toMatch(/000000|999999/);
    }
  });

  it("falls back to the declared shape off-slab", () => {
    expect(percentToRate(7, "percent")).toBe(0.07);
    expect(percentToRate(0.07, "fraction")).toBe(0.07);
  });

  it("treats junk as zero rather than NaN", () => {
    expect(percentToRate(undefined)).toBe(0);
    expect(percentToRate("")).toBe(0);
    expect(rateToPercent(null)).toBe(0);
  });
});

describe("rateToPercent — stored fraction in, percent out", () => {
  it("reads the stored fractions", () => {
    expect(rateToPercent(0.0025)).toBe(0.25);
    expect(rateToPercent(0.03)).toBe(3);
    expect(rateToPercent(0.18)).toBe(18);
  });

  it("heals a row written by the old heuristic", () => {
    // 25% and 100% are not GST slabs, so the intent is recoverable.
    expect(rateToPercent(0.25)).toBe(0.25);
    expect(rateToPercent(1)).toBe(1);
  });

  it("no slab is ambiguous — the property the allowlist rests on", () => {
    for (const slab of GST_SLABS) {
      if (slab === 0) continue;
      expect(GST_SLABS).not.toContain(slab * 100);
    }
  });
});

describe("lineItemPercent — resolve by key, not by magnitude", () => {
  it("reads gstRate as a percent", () => {
    expect(lineItemPercent({ gstRate: 0.25 })).toBe(0.25);
    expect(lineItemPercent({ gstRate: 3 })).toBe(3);
  });

  it("reads gst_tax_rate as a fraction", () => {
    expect(lineItemPercent({ gst_tax_rate: 0.0025 })).toBe(0.25);
    expect(lineItemPercent({ gst_tax_rate: 0.03 })).toBe(3);
  });

  it("prefers gstRate when a payload carries both", () => {
    expect(lineItemPercent({ gstRate: 3, gst_tax_rate: 0.03 })).toBe(3);
  });

  it("defaults to zero when neither is present", () => {
    expect(lineItemPercent({})).toBe(0);
  });
});
