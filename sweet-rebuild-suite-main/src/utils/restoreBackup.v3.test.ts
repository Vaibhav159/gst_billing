import { describe, expect, it, vi } from "vitest";
import { backupInvoiceToImportRow, restoreBackup } from "./restoreBackup";

describe("v3 backups after a rollback", () => {
  it("feeds v2 only live invoices and leaves cancelled sales in the v3 block", async () => {
    const active = {
      invoice_number: "1", invoice_date: "2026-03-01", business: 1, business_name: "Gold Shop",
      customer: 2, customer_name: "Buyer", type_of_invoice: "outward", status: "active", total_amount: "103.00",
      line_items: [{ product_name: "Silver", hsn_code: "7113", gst_tax_rate: "0.03", quantity: "1", rate: "100",
        cgst: "1.5", sgst: "1.5", igst: "0", amount: "103.00", unit: "gms" }],
    };
    const data = {
      app: "gst-billing", version: "5.0", businesses: [{ id: 1, name: "Gold Shop" }],
      customers: [{ id: 2, name: "Buyer" }], products: [], invoices: [active],
      v3: { cancelled: [{ ...active, invoice_number: "2", status: "cancelled" }] },
    };
    const businesses = new Map(data.businesses.map(row => [String(row.id), row]));
    expect(data.invoices.map(row => backupInvoiceToImportRow(row, businesses).invoiceNumber)).toEqual(["1"]);
    const api = {
      get: vi.fn(async () => ({ data: { results: [], next: null } })),
      post: vi.fn(async (_path: string, _body: unknown) => ({ data: { created: 1, skipped: 0, errors: [] } })),
    };
    const result = await restoreBackup(data, api as any);
    expect(result.invoices.created).toBe(1);
    const sent = api.post.mock.calls.find(([path]) => path === "invoices/bulk-import/");
    expect(sent?.[1]).toMatchObject({ invoices: [{ invoiceNumber: "1" }] });
    expect((sent?.[1] as any).invoices).toHaveLength(1);
  });
});
