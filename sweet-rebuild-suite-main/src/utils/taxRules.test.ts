import { describe, it, expect } from "vitest";
import { isIntraState, stateCode } from "./taxRules";

describe("stateCode", () => {
  it("takes the first two digits of a GSTIN", () => {
    expect(stateCode("08AAGPL3375F1ZO")).toBe("08");
  });
  it("is empty when there is no usable GSTIN", () => {
    expect(stateCode("")).toBe("");
    expect(stateCode(null)).toBe("");
    expect(stateCode("0")).toBe("");
  });
});

describe("isIntraState", () => {
  it("compares GSTIN state codes when both sides have one", () => {
    expect(isIntraState("08AAECD1234K1Z2", "08AAGPL3375F1ZO")).toBe(true);
    expect(isIntraState("27AABCR1718E1ZP", "08AAGPL3375F1ZO")).toBe(false);
  });

  it("falls back to state names for an unregistered party", () => {
    expect(isIntraState("", "08AAGPL3375F1ZO", "RAJASTHAN", "RAJASTHAN")).toBe(true);
    expect(isIntraState("", "08AAGPL3375F1ZO", "KERALA", "RAJASTHAN")).toBe(false);
  });

  it("is case and whitespace insensitive on state names", () => {
    expect(isIntraState("", "08AAGPL3375F1ZO", " rajasthan ", "RAJASTHAN")).toBe(true);
  });

  it("assumes local when nothing is known", () => {
    // The old inline rule returned inter-state here, so an empty capture form
    // opened on IGST and stayed there for unregistered local suppliers.
    expect(isIntraState("", "08AAGPL3375F1ZO")).toBe(true);
    expect(isIntraState("", "")).toBe(true);
  });
});
