import { describe, it, expect, vi } from "vitest";
import { restoreBackup, backupInvoiceToImportRow } from "./restoreBackup";

function fakeApi(existing: Record<string, string[]>, bulk = { created: 0, skipped: 0, errors: [] as string[] }) {
  const posts: { url: string; body: any }[] = [];
  const api = {
    get: vi.fn(async (url: string) => {
      const key = url.split("?")[0];
      return { data: { results: (existing[key] || []).map((name) => ({ name })), next: null } };
    }),
    post: vi.fn(async (url: string, body: any) => {
      posts.push({ url, body });
      return { data: url.includes("bulk-import") ? bulk : { id: posts.length } };
    }),
  };
  return { api: api as any, posts };
}

const backup = {
  businesses: [{ id: "b1", name: "LODHA JEWELLERS", gst_number: "08ABCDE1234A1Z5" }, { id: "b2", name: "Existing Biz" }],
  products: [{ name: "Diamond", hsn: "7102", gstRate: 0.25 }, { name: "existing product" }],
  customers: [{ name: "New Buyer", state_name: "RAJASTHAN" }, { name: "EXISTING CUSTOMER" }],
  invoices: [{
    invoiceNumber: "1", invoice_date: "2026-04-01", customerName: "New Buyer", businessId: "b1", type: "OUTWARD", total: 10025,
    items: [{ productName: "Diamond", hsn: "7102", gstRate: 0.25, qty: 1, rate: 10000, cgst: 12.5, sgst: 12.5, amount: 10025 }],
  }],
};

describe("restoreBackup — through the API, with the server's counts (E1)", () => {
  it("creates only what is missing, matching names case-insensitively", async () => {
    const { api, posts } = fakeApi(
      { "businesses/": ["existing biz"], "products/": ["Existing Product"], "customers/": ["existing customer"] },
      { created: 1, skipped: 0, errors: [] },
    );
    const report = await restoreBackup(backup, api);
    expect([report.businesses, report.products, report.customers]).toEqual([1, 1, 1]);
    const created = posts.filter((p) => !p.url.includes("bulk-import")).map((p) => [p.url, p.body.name]);
    expect(created).toEqual([["businesses/", "LODHA JEWELLERS"], ["products/", "Diamond"], ["customers/", "New Buyer"]]);
    expect(report.invoices).toEqual({ created: 1, skipped: 0, errors: [] });
  });

  it("posts a product's rate as the stored fraction, not the percent", async () => {
    const { api, posts } = fakeApi({});
    await restoreBackup({ products: [{ name: "Diamond", gstRate: 0.25 }] }, api);
    expect(posts[0].body.gst_tax_rate).toBe(0.0025);
  });

  it("sends invoices through bulk-import in chunks and sums what the server says", async () => {
    const invoices = Array.from({ length: 250 }, (_, i) => ({ ...backup.invoices[0], invoiceNumber: String(i + 1) }));
    const { api, posts } = fakeApi({}, { created: 90, skipped: 10, errors: ["Row 3: bad"] });
    const report = await restoreBackup({ businesses: backup.businesses, invoices }, api);
    const bulk = posts.filter((p) => p.url === "invoices/bulk-import/");
    expect(bulk.map((p) => p.body.invoices.length)).toEqual([100, 100, 50]);
    expect(report.invoices).toEqual({ created: 270, skipped: 30, errors: ["Row 3: bad", "Row 3: bad", "Row 3: bad"] });
  });

  it("never writes the gst_data_* localStorage keys the old restore used", async () => {
    const { api } = fakeApi({});
    await restoreBackup(backup, api);
    expect(Object.keys(localStorage).filter((k) => k.startsWith("gst_data_"))).toEqual([]);
  });
});

describe("backupInvoiceToImportRow", () => {
  it("carries the firm from the backup's business list and the lines as stored", () => {
    const row = backupInvoiceToImportRow(backup.invoices[0], new Map(backup.businesses.map((b) => [b.id, b])));
    expect(row.firmName).toBe("LODHA JEWELLERS");
    expect(row.firmGSTIN).toBe("08ABCDE1234A1Z5");
    expect(row.customerName).toBe("New Buyer");
    expect(row.items[0]).toMatchObject({ productName: "Diamond", gstRate: 0.25, cgst: 12.5, sgst: 12.5, igst: 0, amount: 10025 });
  });
});
