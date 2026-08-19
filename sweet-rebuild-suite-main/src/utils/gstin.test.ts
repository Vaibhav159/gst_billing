import { describe, it, expect } from "vitest";
import { gstinCheckDigit, validateGstin } from "./gstin";

// Known-real: the firm's own GSTIN and GSTN's documented example.
const REAL = ["08AAGPL3375F1ZO", "27AAPFU0939F1ZV"];

describe("validateGstin", () => {
  it("accepts known-real GSTINs", () => {
    for (const g of REAL) expect(validateGstin(g).ok, g).toBe(true);
  });
  it("accepts lowercase input", () => {
    expect(validateGstin(REAL[0].toLowerCase()).ok).toBe(true);
  });
  it("rejects a flipped check digit as a typo", () => {
    const g = REAL[0];
    const bad = g.slice(0, 14) + (g[14] === "A" ? "B" : "A");
    const r = validateGstin(bad);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/typo/);
  });
  it("rejects wrong lengths and shapes", () => {
    expect(validateGstin("").ok).toBe(false);
    expect(validateGstin("08AAGPL3375F1Z").ok).toBe(false);
    expect(validateGstin("XXAAGPL3375F1ZO").ok).toBe(false);
  });
  it("check digit matches the python implementation's vectors", () => {
    expect(gstinCheckDigit("08AAGPL3375F1Z")).toBe("O");
    expect(gstinCheckDigit("27AAPFU0939F1Z")).toBe("V");
  });
});
