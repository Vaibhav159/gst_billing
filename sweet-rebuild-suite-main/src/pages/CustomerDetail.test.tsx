/**
 * The customer page itself, not just pdfInvoices (review of H18).
 *
 * It zipped page 1 of the invoice list (at most 50, no line items) and
 * summed the same page into its cards. These check the page asks for every
 * invoice with its lines, and shows the server's totals.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import CustomerDetail from "./CustomerDetail";

const { everyInvoice, firstPage, zip } = vi.hoisted(() => {
  const invoice = (n: number) => ({
    id: String(n), invoiceNumber: String(n), invoice_date: "2026-05-10", customerId: "5", type: "OUTWARD",
    total: 1030, items: [{ productId: "line:1", productName: "Silver", qty: 1, rate: 1000, amount: 1030 }],
  });
  return {
    everyInvoice: Array.from({ length: 55 }, (_, i) => invoice(i + 1)),
    firstPage: Array.from({ length: 50 }, (_, i) => ({ ...invoice(i + 1), items: [] })),
    zip: vi.fn(() => Promise.resolve({ blob: new Blob(["zip"]), written: 55, failed: [] as string[] })),
  };
});

vi.mock("@/hooks/useDataStore", () => ({
  useCustomer: () => ({ item: { id: "5", name: "LOCAL BUYER", gst_number: "", state_name: "RAJASTHAN" }, isLoading: false }),
  useCustomers: () => ({ remove: vi.fn() }),
  useBusinesses: () => ({ items: [] }),
  useInvoices: () => ({ items: firstPage, totalCount: 55 }),
}));
vi.mock("@/hooks/usePermission", () => ({ usePermission: () => ({ canDelete: false }) }));
vi.mock("@/utils/api", () => ({
  default: { get: vi.fn(() => Promise.resolve({ data: { outward_total: "56650", inward_total: "0" } })) },
}));
vi.mock("@/utils/pdfInvoices", () => ({ customerInvoicesForPdf: vi.fn(() => Promise.resolve(everyInvoice)) }));
vi.mock("@/utils/generateBulkPDF", () => ({ generateBulkPDFZip: zip }));

describe("CustomerDetail (H18)", () => {
  it("shows the server's totals and zips every invoice with its lines", async () => {
    Object.assign(window.URL, { createObjectURL: vi.fn(() => "blob:zip"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});  // jsdom can't download
    render(
      <MemoryRouter initialEntries={["/billing/customer/5"]}>
        <Routes><Route path="/billing/customer/:id" element={<CustomerDetail />} /></Routes>
      </MemoryRouter>,
    );
    // 55 invoices of Rs 1,030; the first page's 50 would say Rs 51,500.
    await waitFor(() => expect(screen.getAllByTitle(/56,650/).length).toBeGreaterThan(0));
    expect(screen.getByTitle("55 invoices")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Download All PDFs/ }));
    await waitFor(() => expect(zip).toHaveBeenCalled());
    const zipped = (zip.mock.calls[0] as unknown[])[0] as typeof everyInvoice;
    expect(zipped).toHaveLength(55);
    expect(zipped.every((inv) => inv.items.length > 0)).toBe(true);
  });
});
