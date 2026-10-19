/**
 * A customer added from the invoice form's "New" button gets the tax warnings at once. The modal used to hand the form
 * only an id, name, GSTIN and state, so the form held a stub with no address or PAN and treated them as unknown. A
 * new high-value buyer without an address then went unwarned until the saved bill was reopened.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import InvoiceForm from "./InvoiceForm";

const { createCustomer } = vi.hoisted(() => ({
  createCustomer: vi.fn().mockResolvedValue({
    id: 77, name: "Ramesh Kumar", gst_number: "", pan_number: "", address: "", state_name: "RAJASTHAN", mobile_number: "",
  }),
}));

vi.mock("@/hooks/useDataStore", () => ({
  useInvoices: () => ({ create: vi.fn(), update: vi.fn() }),
  useBusinesses: () => ({ items: [{ id: "1", name: "KIRAN GOLD HOUSE", gst_number: "08AAGPL3375F1ZO", state_name: "RAJASTHAN" }] }),
  // A registered buyer, so nothing warns until the new customer is picked.
  useCustomers: () => ({
    items: [{ id: "5", name: "SHREE TRADERS", gst_number: "08AABCS1429B1Z5", address: "Udaipur", pan_number: "", state_name: "RAJASTHAN" }],
    create: createCustomer,
  }),
  useProducts: () => ({ items: [{ id: "7", name: "Gold Ornaments 22K", hsn: "711319", gstRate: 3, defaultUnit: "gms" }] }),
  generateId: (prefix: string) => `${prefix}1`,
}));

vi.mock("@/utils/api", () => ({ default: { get: vi.fn(() => Promise.resolve({ data: [] })), post: vi.fn() } }));

// ₹75,000 of gold, copied from an earlier bill.
const duplicateFrom = {
  businessId: "1", customerId: "5", type: "OUTWARD", paymentMode: "bank", isIGST: false,
  items: [{ productName: "Gold Ornaments 22K", hsn: "711319", gstRate: 3, qty: 10, rate: 7500, amount: 75000, cgst: 1125, sgst: 1125, unit: "gms" }],
};

describe("InvoiceForm, a customer added with New", () => {
  it("gets the address warning straight away", async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/billing/invoice/add", state: { duplicateFrom } }]}>
        <Routes><Route path="/billing/invoice/add" element={<InvoiceForm mode="create" />} /></Routes>
      </MemoryRouter>,
    );
    await screen.findAllByText("Gold Ornaments 22K");
    expect(screen.queryByRole("note", { name: "Tax warnings" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^New$/ }));
    fireEvent.change(await screen.findByPlaceholderText("Customer name"), { target: { value: "Ramesh Kumar" } });
    fireEvent.click(screen.getByRole("button", { name: /Create Customer/ }));
    await waitFor(() => expect(createCustomer).toHaveBeenCalled());

    const panel = await screen.findByRole("note", { name: "Tax warnings" });
    expect(within(panel).getByText("The buyer's name and address")).toBeInTheDocument();
    expect(within(panel).getByText(/add the address for Ramesh Kumar in Customers/)).toBeInTheDocument();
  });
});
