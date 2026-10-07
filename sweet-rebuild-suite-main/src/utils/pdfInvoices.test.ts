import { beforeEach, describe, expect, it, vi } from "vitest";

// Two pages of results, as the API pages them.
const get = vi.fn();
vi.mock("@/utils/api", () => ({ default: { get: (url: string) => get(url) } }));

import { customerInvoicesForPdf, fyInvoicesForPdf } from "./pdfInvoices";

const row = (id: number) => ({ id, invoice_number: String(id), invoice_date: "2026-05-01", total_amount: "103",
  line_items: [{ id: id * 10, product_name: "Gold", hsn_code: "711319", gst_tax_rate: "0.03", quantity: "1", rate: "100",
                 amount: "103", cgst: "1.5", sgst: "1.5", igst: "0" }] });

describe("PDF downloads read every invoice, with its lines (H18)", () => {
  beforeEach(() => {
    get.mockReset();
    get.mockImplementation((url: string) => Promise.resolve({ data: url.includes("page=2")
      ? { results: [row(3)], next: null }
      : { results: [row(1), row(2)], next: "http://testserver/api/invoices/?page=2" } }));
  });

  it("Download All asks for line items and follows every page", async () => {
    // It zipped page 1 of the invoice list: 50 invoices at most, no line items.
    const invoices = await customerInvoicesForPdf("42");
    expect(invoices.map((i) => i.invoiceNumber)).toEqual(["1", "2", "3"]);
    expect(invoices.every((i) => i.items.length === 1)).toBe(true);
    const first = new URL(get.mock.calls[0][0], "http://x/api/");
    expect(first.searchParams.get("customer_id")).toBe("42");
    expect(first.searchParams.get("include_items")).toBe("true");
  });

  it("Bulk PDF reads the FY page by page instead of one 1,000-row request", async () => {
    const invoices = await fyInvoicesForPdf("2025-26", "6", "OUTWARD");
    expect(invoices).toHaveLength(3);
    const first = new URL(get.mock.calls[0][0], "http://x/api/");
    expect(Object.fromEntries(first.searchParams)).toMatchObject({
      business_id: "6", type_of_invoice: "outward", start_date: "2025-04-01", end_date: "2026-03-31", include_items: "true",
    });
  });
});
