import { describe, expect, it } from "vitest";
import { bookedAmount, rateChoice, rateFromChoice } from "./aiImportLine";

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
