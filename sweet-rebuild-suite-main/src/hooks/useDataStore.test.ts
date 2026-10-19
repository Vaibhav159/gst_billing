import { describe, it, expect } from "vitest";
import { buildInvoiceParams, mapDjangoInvoice } from "./useDataStore";

describe("mapDjangoInvoice — the server's total, to the paisa (A15)", () => {
  const base: any = { id: 1, invoice_number: "7", invoice_date: "2026-04-01", customer_name: "A BUYER", line_items: [], total_tax: "0" };

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

describe("mapDjangoInvoice — the AI-import scan (M8)", () => {
  const base: any = { id: 1, invoice_number: "7", invoice_date: "2026-04-01", total_amount: "100", line_items: [] };

  it("links the signed URLs the API sends, which production serves", () => {
    const inv = mapDjangoInvoice({
      ...base,
      source_file_url: "/api/media/invoice_sources/2026/10/bill.heic?s=abc",
      source_preview_url: "/api/media/invoice_sources/2026/10/previews/bill.jpg?s=def",
    });
    expect(inv.sourceFile).toBe("/api/media/invoice_sources/2026/10/bill.heic?s=abc");
    expect(inv.sourcePreview).toBe("/api/media/invoice_sources/2026/10/previews/bill.jpg?s=def");
  });

  it("shows no scan when the invoice has none", () => {
    const inv = mapDjangoInvoice({ ...base, source_file_url: null, source_preview_url: null });
    expect([inv.sourceFile, inv.sourcePreview]).toEqual([null, null]);
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

  // The GST page's drill-down opens the list with ?start_date&end_date and sets FY and month to "all". The summary
  // cards asked for those dates; the list and its exports dropped them and showed every period's invoices.
  it("asks for a drill-down's dates, which win over FY and month", () => {
    const p = buildInvoiceParams({
      fyFilter: "all", monthFilter: "all", gstRate: "3", startDate: "2026-09-01", endDate: "2026-09-30",
    });
    expect(p.get("start_date")).toBe("2026-09-01");
    expect(p.get("end_date")).toBe("2026-09-30");
    expect(p.get("gst_rate")).toBe("3");
  });

  it("keeps the FY and month range when there's no drill-down", () => {
    const p = buildInvoiceParams({ fyFilter: "2026-27", monthFilter: "9" });
    expect(p.get("start_date")).toBe("2026-09-01");
    expect(p.get("end_date")).toBe("2026-09-30");
  });

  it("ignores half a drill-down range, as the summary cards do", () => {
    const p = buildInvoiceParams({ fyFilter: "all", monthFilter: "all", startDate: "2026-09-01" });
    expect(p.has("start_date")).toBe(false);
    expect(p.has("end_date")).toBe(false);
  });
});
