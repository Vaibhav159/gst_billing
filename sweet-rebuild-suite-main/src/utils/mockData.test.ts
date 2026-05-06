import { describe, it, expect } from "vitest";
import { financialYears, currentFY, formatCurrency } from "./mockData";

describe("financialYears", () => {
  it("returns an array of FY strings", () => {
    expect(Array.isArray(financialYears)).toBe(true);
    expect(financialYears.length).toBeGreaterThanOrEqual(4);
  });

  it("each FY is in YYYY-YY format", () => {
    for (const fy of financialYears) {
      expect(fy).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it("currentFY is in the list", () => {
    expect(financialYears).toContain(currentFY);
  });

  it("currentFY matches actual date", () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const expectedStart = m >= 3 ? y : y - 1;
    expect(currentFY).toBe(`${expectedStart}-${String(expectedStart + 1).slice(2)}`);
  });
});

describe("formatCurrency", () => {
  it("formats positive number in Indian format", () => {
    const result = formatCurrency(1234567);
    expect(result).toContain("12,34,567");
  });

  it("formats zero", () => {
    const result = formatCurrency(0);
    expect(result).toContain("0");
  });

  it("formats small numbers", () => {
    const result = formatCurrency(42);
    expect(result).toContain("42");
  });
});
