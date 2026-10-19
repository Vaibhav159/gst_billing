/**
 * Editing a bill whose customer isn't in the loaded list: the form holds a stub (name only), so the customer's
 * address, PAN and State are unknown, not blank. Only the cash warning, which needs nothing about the customer, shows.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import InvoiceForm from "./InvoiceForm";

const { stored } = vi.hoisted(() => ({
  stored: {
    id: 9, business: 1, customer: 404, invoice_number: "ST-1", invoice_date: "2026-10-12",
    type_of_invoice: "outward", payment_mode: "cash", is_igst_applicable: false, financial_year: "2026-27",
    customer_name: "FAR AWAY BUYER", business_name: "KIRAN GOLD HOUSE",
    line_items: [{
      id: 7, product_name: "Gold Ornaments 22K", hsn_code: "711319", gst_tax_rate: "0.03", quantity: "10.000",
      rate: "21000.000", amount: "210000.000", cgst: "3150.000", sgst: "3150.000", igst: "0.000", unit: "gms",
    }],
  },
}));

vi.mock("@/hooks/useDataStore", () => ({
  useInvoices: () => ({ create: vi.fn(), update: vi.fn() }),
  useBusinesses: () => ({ items: [{ id: "1", name: "KIRAN GOLD HOUSE", gst_number: "08AAGPL3375F1ZO", state_name: "RAJASTHAN" }] }),
  useCustomers: () => ({ items: [{ id: "5", name: "SOMEONE ELSE", gst_number: "", address: "", pan_number: "", state_name: "" }] }),
  useProducts: () => ({ items: [] }),
  generateId: (prefix: string) => `${prefix}1`,
}));
vi.mock("@/utils/api", () => ({
  default: {
    get: vi.fn((url: string) => Promise.resolve({ data: url.startsWith("invoices/9/") ? stored : url.startsWith("filed-periods") ? [] : {} })),
    post: vi.fn(),
  },
}));

describe("InvoiceForm, a stored bill's customer outside the loaded list", () => {
  it("shows only the cash warning", async () => {
    render(
      <MemoryRouter initialEntries={["/billing/invoice/edit/9"]}>
        <Routes><Route path="/billing/invoice/edit/:id" element={<InvoiceForm mode="edit" />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByDisplayValue("ST-1")).toBeInTheDocument());
    const panel = await screen.findByRole("note", { name: "Tax warnings" });
    expect(within(panel).getByText("Cash of ₹2,00,000 or more")).toBeInTheDocument();
    expect(within(panel).queryByText("The buyer's name and address")).toBeNull();
    expect(within(panel).queryByText("The buyer's PAN")).toBeNull();
  });
});
