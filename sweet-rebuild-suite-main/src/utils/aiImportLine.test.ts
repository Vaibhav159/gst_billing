import { describe, expect, it } from "vitest";
import { bookedAmount, fromAiReading, linesWithoutRate, rateChoice, rateFromChoice } from "./aiImportLine";

describe("AI import review lines (M19)", () => {
  it("shows a stored rate as its slab, not rounded to one decimal", () => {
    // The box showed 0.25% as "0.3" and wrote 0.003 back.
    expect(rateChoice({ gst_tax_rate: 0.0025 })).toBe("0.25");
    expect(rateChoice({ gst_tax_rate: 0.03 })).toBe("3");
    expect(rateChoice({ gst_tax_rate: 0 })).toBe("0");
    expect(rateChoice({ gst_tax_rate: null })).toBe("");
  });

  it("writes a picked slab back as the stored fraction", () => {
    expect(rateFromChoice("0.25")).toBe(0.0025);
    expect(rateFromChoice("3")).toBe(0.03);
    expect(rateFromChoice("0")).toBe(0);
    expect(rateFromChoice("")).toBeNull();
  });

  it("shows the amount the server will store", () => {
    // The server recomputes qty x rate x (1 + r); the amount box was editable and ignored.
    expect(bookedAmount({ quantity: 10, rate: 10000, gst_tax_rate: 0.03 }, "outward")).toBe(103000);
    expect(bookedAmount({ quantity: 1, rate: 549.67, gst_tax_rate: 0.03 }, "outward")).toBe(566.16);
    // An unread rate: 3% on a sale (the server's default), nothing on a purchase.
    expect(bookedAmount({ quantity: 1, rate: 1000, gst_tax_rate: null }, "outward")).toBe(1030);
    expect(bookedAmount({ quantity: 1, rate: 1000, gst_tax_rate: null }, "inward")).toBe(1000);
  });
});

describe("rates the AI read (review of M19)", () => {
  // Gemini has to answer a number and answers 0 when a bill prints no per-line
  // rate, the usual jewellery bill with CGST/SGST @1.5% in its footer. Since M19
  // an explicit 0 is booked as 0%, so a 0 the AI read showed as a chosen "0%"
  // and the sale went in tax-free. As on the inward form (C1), a 0, a missing
  // rate or one off the slab list starts unchosen, and a person picks.
  it("starts a 0, a missing rate and an off-slab one unchosen, and keeps a slab", () => {
    const lines = [0, 0.03, 3, 0.25, 0.07, null].map((gst_tax_rate) => ({ quantity: 1, rate: 100, gst_tax_rate }));
    expect(fromAiReading({ line_items: lines }).line_items.map((l) => l.gst_tax_rate))
      .toEqual([null, 0.03, 0.03, 0.0025, null, null]);
  });

  it("counts the lines still waiting for a rate; a picked 0% isn't one", () => {
    expect(linesWithoutRate([{ gst_tax_rate: null }, { gst_tax_rate: 0 }, { gst_tax_rate: 0.03 }])).toBe(1);
  });
});
