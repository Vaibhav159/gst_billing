import { describe, it, expect } from "vitest";
import { buildInvoiceParams, mapDjangoInvoice } from "./useDataStore";

describe("mapDjangoInvoice — the server's total, to the paisa (A15)", () => {
  const base = { id: 1, invoice_number: "7", invoice_date: "2026-04-01", customer_name: "A BUYER", line_items: [], total_tax: "0" };

  it("does not round 566.05 to 566 and invent a round-off", () => {
    const inv = mapDjangoInvoice({ ...base, total_amount: "566.05" });
    expect(inv.total).toBe(566.05);
    expect(inv.roundedOff).toBeUndefined();
  });

  it("does not round 566.50 up to 567", () => {
    expect(mapDjangoInvoice({ ...base, total_amount: "566.50" }).total).toBe(566.5);
  });

  it("a statement of 100 invoices sums to what the books hold", () => {
    // 50p per invoice: the old mapping drifted a hundred-invoice statement by Rs 50.
    const totals = Array.from({ length: 100 }, (_, i) => 100 + i + 0.5);
    const sum = totals.reduce((s, t) => s + mapDjangoInvoice({ ...base, total_amount: String(t) }).total, 0);
    expect(sum).toBeCloseTo(totals.reduce((s, t) => s + t, 0), 2);
  });
});

describe("buildInvoiceParams — one query builder for the list and the exports (A16)", () => {
  it("ignores 'all' and empty filters", () => {
    const p = buildInvoiceParams({ businessId: "all", customerId: "all", search: "" } as any);
    expect(p.has("business_id")).toBe(false);
    expect(p.has("customer_id")).toBe(false);
    expect(p.has("search")).toBe(false);
  });

  it("maps the filters the list uses", () => {
    const p = buildInvoiceParams({ search: "ram", businessId: "3", customerId: "9", typeFilter: "Outward" } as any);
    expect(p.get("search")).toBe("ram");
    expect(p.get("business_id")).toBe("3");
    expect(p.get("customer_id")).toBe("9");
    expect(p.get("type_of_invoice")).toBe("outward");
  });
});
