/**
 * The invoice page itself.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const { phone, invoice } = vi.hoisted(() => ({
  phone: { on: false },
  invoice: {
    id: "1734", invoiceNumber: "30", invoice_date: "2026-04-01", customerId: "7", customerName: "Kavita Joshi",
    businessId: "14", businessName: "KIRAN GOLD HOUSE (SANDBOX)", type: "OUTWARD", isIGST: false,
    items: [{ productId: "line:1", productName: "Gold Chain", hsn: "711319", gstRate: 3, qty: 10, rate: 6000, unit: "gms",
      amount: 61800, cgst: 900, sgst: 900, igst: 0 }],
    subtotal: 60000, totalCGST: 900, totalSGST: 900, totalIGST: 0, totalTax: 1800, total: 61800,
    paymentMode: "cash", financialYear: "2026-27", createdAt: "", updatedAt: "", lineItemCount: 1,
  },
}));

vi.mock("@/hooks/useDataStore", () => ({
  useInvoice: () => ({ item: invoice, isLoading: false, candidates: [], refetch: vi.fn() }),
  useInvoices: () => ({ items: [] }),
  useBusiness: () => ({ item: { id: "14", name: "KIRAN GOLD HOUSE (SANDBOX)" } }),
  useCustomer: () => ({ item: { id: "7", name: "Kavita Joshi", mobile_number: "" } }),
  businessSlug: (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => phone.on }));

import InvoiceDetail from "./InvoiceDetail";

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/billing/invoice/1734"]}>
      <Routes><Route path="/billing/invoice/:id" element={<InvoiceDetail />} /></Routes>
    </MemoryRouter>,
  );
}

afterEach(() => { phone.on = false; });

describe("InvoiceDetail on a phone (UX4)", () => {
  it("puts its Edit / Print bar outside the page, which animates in with a transform", () => {
    phone.on = true;
    const { container } = renderDetail();
    const edit = screen.getByRole("link", { name: /Edit/ });
    expect(container.contains(edit)).toBe(false);
    expect(document.body.contains(edit)).toBe(true);
  });
});
