/**
 * The invoice form shows the tax warnings (utils/taxWarnings) beside the summary and again on the review sheet, and
 * they never stop the save: the bill may already be written on paper.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import InvoiceForm from "./InvoiceForm";

const { update, stored } = vi.hoisted(() => ({
  update: vi.fn().mockResolvedValue({}),
  // ₹2,10,000 of gold at 3%, paid in cash, to a buyer with no GSTIN, no address and no PAN.
  stored: {
    id: 9, business: 1, customer: 5, invoice_number: "TW-1", invoice_date: "2026-10-12",
    type_of_invoice: "outward", payment_mode: "cash", is_igst_applicable: false, financial_year: "2026-27",
    customer_name: "LOCAL BUYER", business_name: "KIRAN GOLD HOUSE",
    line_items: [{
      id: 7, product_name: "Gold Ornaments 22K", hsn_code: "711319", gst_tax_rate: "0.03", quantity: "10.000",
      rate: "21000.000", amount: "210000.000", cgst: "3150.000", sgst: "3150.000", igst: "0.000", unit: "gms",
    }],
  },
}));

vi.mock("@/hooks/useDataStore", () => ({
  useInvoices: () => ({ create: vi.fn(), update }),
  useBusinesses: () => ({ items: [{ id: "1", name: "KIRAN GOLD HOUSE", gst_number: "08AAGPL3375F1ZO", state_name: "RAJASTHAN" }] }),
  useCustomers: () => ({ items: [{ id: "5", name: "LOCAL BUYER", gst_number: "", address: "", pan_number: "", state_name: "RAJASTHAN" }] }),
  useProducts: () => ({ items: [{ id: "7", name: "Gold Ornaments 22K", hsn: "711319", gstRate: 3, defaultUnit: "gms" }] }),
  generateId: (prefix: string) => `${prefix}1`,
}));

vi.mock("@/utils/api", () => ({
  default: {
    get: vi.fn((url: string) => Promise.resolve({ data: url.startsWith("invoices/9/") ? stored : url.startsWith("filed-periods") ? [] : {} })),
    post: vi.fn(),
  },
}));

function renderEdit() {
  return render(
    <MemoryRouter initialEntries={["/billing/invoice/edit/9"]}>
      <Routes><Route path="/billing/invoice/edit/:id" element={<InvoiceForm mode="edit" />} /></Routes>
    </MemoryRouter>,
  );
}

const TITLES = ["The buyer's name and address", "Cash of ₹2,00,000 or more", "The buyer's PAN"];

describe("InvoiceForm's tax warnings", () => {
  it("lists them beside the summary, and on the review sheet", async () => {
    renderEdit();
    await waitFor(() => expect(screen.getByDisplayValue("TW-1")).toBeInTheDocument());
    const panel = await screen.findByRole("note", { name: "Tax warnings" });
    for (const t of TITLES) expect(within(panel).getByText(t)).toBeInTheDocument();
    expect(within(panel).getByText(/then add the address for LOCAL BUYER in Customers/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Update Invoice/ })[0]);
    const sheet = await screen.findByRole("dialog", { name: "Review invoice before saving" });
    for (const t of TITLES) expect(within(sheet).getByText(t)).toBeInTheDocument();
  });

  it("drops the cash warning when Payment is set to bank, and every warning for a purchase", async () => {
    renderEdit();
    await waitFor(() => expect(screen.getByDisplayValue("TW-1")).toBeInTheDocument());
    const panel = await screen.findByRole("note", { name: "Tax warnings" });
    fireEvent.change(screen.getByDisplayValue("Cash"), { target: { value: "bank" } });
    await waitFor(() => expect(within(panel).queryByText("Cash of ₹2,00,000 or more")).toBeNull());
    expect(within(panel).getByText("The buyer's name and address")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("Outward (Sales)"), { target: { value: "INWARD" } });
    await waitFor(() => expect(screen.queryByRole("note", { name: "Tax warnings" })).toBeNull());
  });

  it("never stops the save", async () => {
    renderEdit();
    await waitFor(() => expect(screen.getByDisplayValue("TW-1")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: /Update Invoice/ })[0]);
    fireEvent.click(await screen.findByRole("button", { name: /Confirm & Save/ }));
    await waitFor(() => expect(update).toHaveBeenCalled());
  });
});
