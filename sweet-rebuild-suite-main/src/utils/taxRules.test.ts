import { describe, it, expect } from "vitest";
import { isIntraState, stateCode, stateInfo } from "./taxRules";

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

describe("stateInfo — place of supply for unregistered parties (audit B3)", () => {
  it("reads the code off a GSTIN", () => {
    expect(stateInfo("27AAAAA0000A1Z5", "")).toEqual({ name: "Maharashtra", code: "27" });
  });
  it("derives the code from the state name when there is no GSTIN", () => {
    // The Tally template returned code "" here — precisely the B2C case where
    // a printed place of supply is legally required.
    expect(stateInfo("", "Maharashtra").code).toBe("27");
    expect(stateInfo(undefined, "RAJASTHAN").code).toBe("08");
    expect(stateInfo(null, "kerala").code).toBe("32");
  });
  it("is blank, not wrong, when neither is known", () => {
    expect(stateInfo("", "")).toEqual({ name: "", code: "" });
    expect(stateInfo("", "Atlantis").code).toBe("");
  });
  it("GSTIN wins over a stale state name", () => {
    expect(stateInfo("08ABCDE1234A1Z5", "Maharashtra").code).toBe("08");
  });
});
