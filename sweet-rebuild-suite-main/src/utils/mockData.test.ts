import { describe, it, expect } from "vitest";
import { financialYears, currentFY, formatCurrency, amountToWords } from "./mockData";

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

describe("amountToWords — paise carry and sign (audit B7)", () => {
  it("carries paise that round to 100 into the rupees", () => {
    // 22.996 rounds to 23.00, not "Twenty Two Rupees and One Hundred Paise"
    expect(amountToWords(22.996)).toBe("Twenty Three Rupees Only");
  });
  it("reads ordinary paise", () => {
    expect(amountToWords(23.45)).toBe("Twenty Three Rupees and Forty Five Paise Only");
  });
  it("does not print 'undefined Rupees' for a negative amount", () => {
    expect(amountToWords(-5)).toBe("Minus Five Rupees Only");
    expect(amountToWords(-0.5)).toBe("Minus Zero Rupees and Fifty Paise Only");
  });
  it("treats junk as zero", () => {
    expect(amountToWords(NaN)).toBe("Zero Rupees Only");
    expect(amountToWords(0.004)).toBe("Zero Rupees Only");
  });
});
