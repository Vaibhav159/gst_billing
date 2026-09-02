import { describe, expect, it } from "vitest";
import { whatsappNumber, invoiceShareText } from "./shareInvoice";

describe("whatsappNumber (audit B8)", () => {
  it("prefixes 91 to a bare 10-digit Indian mobile", () => {
    expect(whatsappNumber("98765 43210")).toBe("919876543210");
    expect(whatsappNumber("+91 98765-43210")).toBe("919876543210");
    expect(whatsappNumber("09876543210")).toBe("919876543210");
  });
  it("leaves an already-prefixed number alone", () => {
    expect(whatsappNumber("919876543210")).toBe("919876543210");
  });
  it("is empty for no number", () => {
    expect(whatsappNumber("")).toBe("");
    expect(whatsappNumber(undefined)).toBe("");
  });
});

describe("invoiceShareText", () => {
  it("carries no link — the print route is behind login", () => {
    const text = invoiceShareText({ invoiceNumber: "108", customerName: "A", total: 100, invoice_date: "2026-05-10" } as any);
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).toContain("Invoice 108");
  });
});
