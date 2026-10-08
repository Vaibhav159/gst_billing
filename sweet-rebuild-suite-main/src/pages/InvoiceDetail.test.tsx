/**
 * The invoice page itself.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { phone, perm, remove, toast, invoice, lookup } = vi.hoisted(() => ({
  lookup: { found: true },
  phone: { on: false },
  perm: { admin: true },
  remove: vi.fn(),
  toast: vi.fn(),
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
  useInvoice: () => ({ item: lookup.found ? invoice : null, isLoading: false, candidates: [], refetch: vi.fn() }),
  useInvoices: () => ({ items: [], remove }),
  useBusiness: () => ({ item: { id: "14", name: "KIRAN GOLD HOUSE (SANDBOX)" } }),
  useCustomer: () => ({ item: { id: "7", name: "Kavita Joshi", mobile_number: "" } }),
  businessSlug: (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => phone.on }));
vi.mock("@/hooks/usePermission", () => ({ usePermission: () => ({ canDelete: perm.admin }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import InvoiceDetail from "./InvoiceDetail";

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/billing/invoice/1734"]}>
      <Routes>
        <Route path="/billing/invoice/list" element={<p>INVOICE LIST</p>} />
        <Route path="/billing/invoice/:id" element={<InvoiceDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => { phone.on = false; lookup.found = true; });

describe("An invoice that can't be found (UX8)", () => {
  it("on the firm/FY/number address, says which number, firm and year it looked for", () => {
    lookup.found = false;
    render(
      <MemoryRouter initialEntries={["/billing/invoice/kiran-gold-house-sandbox/2026-27/1"]}>
        <Routes><Route path="/billing/invoice/:bizSlug/:fy/:slug" element={<InvoiceDetail />} /></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(/No invoice numbered/)).toHaveTextContent("No invoice numbered 1 for kiran-gold-house-sandbox in FY 2026-27");
    // "1" there is the invoice number, not a database id.
    expect(screen.queryByText(/Internal id/)).toBeNull();
  });

  it("on the id address, says the id doesn't exist", () => {
    lookup.found = false;
    renderDetail();
    expect(screen.getByText(/Internal id/)).toHaveTextContent("Internal id 1734 doesn't exist");
  });
});

describe("InvoiceDetail on a phone (UX4)", () => {
  it("puts its Edit / Print bar outside the page, which animates in with a transform", () => {
    phone.on = true;
    const { container } = renderDetail();
    const edit = screen.getByRole("link", { name: /Edit/ });
    expect(container.contains(edit)).toBe(false);
    expect(document.body.contains(edit)).toBe(true);
  });
});

describe.each([["the desktop header", false], ["the phone bar", true]])("Deleting an invoice from %s (UX5)", (_where, onPhone) => {
  beforeEach(() => {
    phone.on = onPhone;
    perm.admin = true;
    remove.mockReset();
    toast.mockReset();
  });

  // Radix opens a menu from the keyboard as well as the pointer; jsdom has no pointer events.
  const deleteItem = () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "More actions" }), { key: "Enter" });
    return screen.findByRole("menuitem", { name: /Delete invoice/ });
  };

  it("an admin finds Delete under ⋯, and the dialog names the invoice beyond doubt", async () => {
    renderDetail();
    fireEvent.click(await deleteItem());
    const dialog = await screen.findByRole("alertdialog");
    // "30" alone exists in all three firms.
    for (const part of ["KIRAN GOLD HOUSE (SANDBOX)", "30", "01 Apr 2026", "Kavita Joshi", "₹61,800.00"]) {
      expect(dialog).toHaveTextContent(part);
    }
    expect(dialog).toHaveTextContent(/restore it from the Audit log/i);
    expect(dialog).not.toHaveTextContent(/cannot be undone/i);
  });

  it("a viewer has no Delete", () => {
    perm.admin = false;
    renderDetail();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    expect(screen.queryByText(/Delete invoice/)).toBeNull();
  });

  it("deleting goes back to the list with a toast", async () => {
    remove.mockResolvedValue(undefined);
    renderDetail();
    fireEvent.click(await deleteItem());
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getByText("INVOICE LIST")).toBeInTheDocument());
    expect(remove).toHaveBeenCalledWith("1734");
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Invoice Deleted" }));
  });

  it("on the firm/FY/number address, acts on the record shown, not the record whose id is the number", async () => {
    remove.mockResolvedValue(undefined);
    render(
      <MemoryRouter initialEntries={["/billing/invoice/kiran-gold-house-sandbox/2026-27/30"]}>
        <Routes>
          <Route path="/billing/invoice/list" element={<p>INVOICE LIST</p>} />
          <Route path="/billing/invoice/:bizSlug/:fy/:slug" element={<InvoiceDetail />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getAllByRole("link", { name: /Edit/ })[0]).toHaveAttribute("href", "/billing/invoice/edit/1734");
    fireEvent.click(await deleteItem());
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("1734"));
  });

  it("a refusal (a filed month) shows the server's reason and stays on the invoice", async () => {
    remove.mockRejectedValue({ response: { status: 400, data: { detail: "04/2026 is filed and locked for KIRAN GOLD HOUSE (SANDBOX)." } } });
    renderDetail();
    fireEvent.click(await deleteItem());
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      description: expect.stringContaining("filed and locked"), variant: "destructive",
    })));
    expect(screen.queryByText("INVOICE LIST")).toBeNull();
  });
});
