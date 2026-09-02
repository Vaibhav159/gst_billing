import { describe, expect, it } from "vitest";
import { round2, halveTax, formatMoney } from "./money";

describe("round2", () => {
  it("quantizes a raw float sum to paise", () => {
    // The A8 case: a strict DecimalField rejects this outright.
    expect(10.1 + 20.2).not.toBe(30.3);
    expect(round2(10.1 + 20.2)).toBe(30.3);
  });

  it("leaves clean values alone", () => {
    for (const n of [0, 1, 100, 10300, 0.25, 16.49]) expect(round2(n)).toBe(n);
  });

  it("is idempotent", () => {
    for (const n of [10.005, 30.299999999999997, 1 / 3]) {
      expect(round2(round2(n))).toBe(round2(n));
    }
  });

  it("treats junk as zero rather than NaN", () => {
    expect(round2(NaN)).toBe(0);
    expect(round2(undefined as any)).toBe(0);
  });
});

describe("halveTax", () => {
  it("halves an even tax exactly", () => {
    expect(halveTax(300)).toEqual({ cgst: 150, sgst: 150 });
  });

  it("keeps the odd paise instead of dropping it (A8)", () => {
    const { cgst, sgst } = halveTax(16.49);
    expect(round2(cgst + sgst)).toBe(16.49);
    // what shipped: both halves rounded independently
    const naive = Math.round((16.49 / 2) * 100) / 100;
    expect(round2(naive * 2)).not.toBe(16.49);
  });

  it("the halves always sum back to the tax", () => {
    for (let paise = 0; paise <= 2000; paise++) {
      const tax = paise / 100;
      const { cgst, sgst } = halveTax(tax);
      expect(round2(cgst + sgst)).toBe(round2(tax));
    }
  });

  it("never splits more than a paisa apart", () => {
    for (let paise = 0; paise <= 500; paise++) {
      const { cgst, sgst } = halveTax(paise / 100);
      // round2 the difference too — subtracting two floats reintroduces dust.
      expect(round2(Math.abs(cgst - sgst))).toBeLessThanOrEqual(0.01);
    }
  });
});

describe("formatMoney — paise by default (E6)", () => {
  it("keeps the paise the server stored", () => {
    // formatCurrency rounds to the rupee: Rs 57,596 for an invoice saved as 57,595.50.
    expect(formatMoney(57595.5)).toBe("₹57,595.50");
    expect(formatMoney(566.05)).toBe("₹566.05");
  });
  it("uses Indian grouping", () => {
    expect(formatMoney(1234567.89)).toBe("₹12,34,567.89");
  });
  it("can be asked for whole rupees where a dashboard tile wants them", () => {
    expect(formatMoney(57595.5, { paise: false })).toBe("₹57,596");
  });
  it("treats junk as zero", () => {
    expect(formatMoney(NaN)).toBe("₹0.00");
    expect(formatMoney(undefined as unknown as number)).toBe("₹0.00");
  });
});
