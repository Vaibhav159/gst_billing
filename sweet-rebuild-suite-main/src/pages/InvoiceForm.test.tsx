/**
 * The invoice form itself, not just its helpers (review of H17 and M20).
 *
 * invoiceDraft and localDate are tested on their own; these check the form
 * uses them, so putting back the old wiring fails a test.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InvoiceForm from "./InvoiceForm";
import QuickCustomerModal from "@/components/QuickCustomerModal";

const { update, stored, phone } = vi.hoisted(() => ({
  phone: { on: false },
  update: vi.fn().mockResolvedValue({}),
  // A 0.25% ruby whose line id (7) is also a catalog product's id.
  stored: {
    id: 9, business: 1, customer: 5, invoice_number: "H17-1", invoice_date: "2026-03-31",
    type_of_invoice: "outward", payment_mode: "cash", is_igst_applicable: false, financial_year: "2025-26",
    customer_name: "LOCAL BUYER", business_name: "KIRAN GOLD HOUSE",
    line_items: [{
      id: 7, product_name: "Ruby (Cut)", hsn_code: "710391", gst_tax_rate: "0.0025", quantity: "2.000",
      rate: "20000.000", amount: "40100.000", cgst: "50.000", sgst: "50.000", igst: "0.000", unit: "ct",
    }],
  },
}));

vi.mock("@/hooks/useDataStore", () => ({
  useInvoices: () => ({ create: vi.fn(), update }),
  useBusinesses: () => ({ items: [{ id: "1", name: "KIRAN GOLD HOUSE", gst_number: "08AAGPL3375F1ZO", state_name: "RAJASTHAN" }] }),
  useCustomers: () => ({ items: [{ id: "5", name: "LOCAL BUYER", gst_number: "", state_name: "RAJASTHAN" }] }),
  // The catalog product that shares the line's id.
  useProducts: () => ({ items: [{ id: "7", name: "Gold Ornaments 22K", hsn: "711319", gstRate: 3, defaultUnit: "gms" }] }),
  generateId: (prefix: string) => `${prefix}1`,
}));

vi.mock("@/utils/api", () => ({
  default: {
    get: vi.fn((url: string) => Promise.resolve({ data: url.startsWith("invoices/9/") ? stored : url.startsWith("filed-periods") ? [] : {} })),
    post: vi.fn(),
  },
}));

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => phone.on }));

function renderEdit() {
  return render(
    <MemoryRouter initialEntries={["/billing/invoice/edit/9"]}>
      <Routes><Route path="/billing/invoice/edit/:id" element={<InvoiceForm mode="edit" />} /></Routes>
    </MemoryRouter>,
  );
}

describe("InvoiceForm, editing a stored invoice", () => {
  it("saves each line's own name, HSN and rate, not the catalog product sharing its id (H17)", async () => {
    renderEdit();
    await waitFor(() => expect(screen.getByDisplayValue("H17-1")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: /Update Invoice/ })[0]);
    fireEvent.click(await screen.findByRole("button", { name: /Confirm & Save/ }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1].items).toEqual([
      expect.objectContaining({ productName: "Ruby (Cut)", hsn: "710391", gstRate: 0.25, amount: 40100, cgst: 50, sgst: 50 }),
    ]);
  });

  it("won't review or save a figure it can't read, such as a rate of 10,5 (M2)", async () => {
    renderEdit();
    await waitFor(() => expect(screen.getByDisplayValue("H17-1")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("textbox", { name: "Rate, line 1" }), { target: { value: "10,5" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Update Invoice/ })[0]);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("button", { name: /Confirm & Save/ })).toBeNull();
    expect(update).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      items: [expect.objectContaining({ rate: 105 })],
    }));
  });

  it("doesn't call 31 March outside its FY (M20)", async () => {
    renderEdit();
    await waitFor(() => expect(screen.getByDisplayValue("H17-1")).toBeInTheDocument());
    expect(screen.queryByText(/outside FY/i)).toBeNull();
  });
});

describe("typing a line's quantity and rate (UX7)", () => {
  // The inputs held numbers and began at "1" and "0": typing "10.5" into a
  // fresh quantity came out "10.51", a rate "06543.21", and clearing a field
  // put the 0 back.
  function renderCreate() {
    return render(
      <MemoryRouter initialEntries={["/billing/invoice/add"]}>
        <Routes><Route path="/billing/invoice/add" element={<InvoiceForm mode="create" />} /></Routes>
      </MemoryRouter>,
    );
  }
  const lineInputs = (container: HTMLElement) => [...container.querySelectorAll<HTMLInputElement>("tbody tr input")];
  // One change per keystroke, each adding to what the field holds, as typing does.
  const typeInto = (input: HTMLInputElement, text: string) => {
    for (const ch of text) fireEvent.change(input, { target: { value: input.value + ch } });
  };

  it("a fresh quantity is empty and takes 10.5 as typed", () => {
    const { container } = renderCreate();
    const [qty] = lineInputs(container);
    expect(qty.value).toBe("");
    typeInto(qty, "10.5");
    expect(qty.value).toBe("10.5");
  });

  it("a rate takes 6543.21 as typed, and stays empty once cleared", () => {
    const { container } = renderCreate();
    const [, rate] = lineInputs(container);
    typeInto(rate, "6543.21");
    expect(rate.value).toBe("6543.21");
    fireEvent.change(rate, { target: { value: "" } });
    expect(rate.value).toBe("");
  });

  it("works the line's amount out from the typed figures", () => {
    const { container } = renderCreate();
    const [qty, rate] = lineInputs(container);
    typeInto(qty, "10.5");
    typeInto(rate, "1000");
    expect(container.querySelector("tbody tr")).toHaveTextContent("₹10,500");
  });

  it("keeps 10,5 as typed and says to use a point, instead of reading 105 (M2)", () => {
    const { container } = renderCreate();
    const [, rate] = lineInputs(container);
    typeInto(rate, "10,5");
    expect(rate.value).toBe("10,5");
    expect(rate).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/use a point for decimals/i)).toBeInTheDocument();
  });

  it("takes 1,23,456 with its grouping commas (M2)", () => {
    const { container } = renderCreate();
    const [qty, rate] = lineInputs(container);
    typeInto(qty, "1");
    typeInto(rate, "1,23,456");
    expect(rate.value).toBe("1,23,456");
    expect(rate).not.toHaveAttribute("aria-invalid", "true");
    expect(container.querySelector("tbody tr")).toHaveTextContent("₹1,23,456");
  });

  it("asks for a number pad, not the text keyboard", () => {
    const { container } = renderCreate();
    for (const input of lineInputs(container)) expect(input).toHaveAttribute("inputmode", "decimal");
  });
});

describe("Quick Add Customer's mobile number (UX7)", () => {
  it("opens the phone's number pad", () => {
    render(<QuickCustomerModal open onClose={() => {}} onCreated={() => {}} />);
    const mobile = screen.getByPlaceholderText("10-digit (optional)");
    expect(mobile).toHaveAttribute("type", "tel");
    expect(mobile).toHaveAttribute("inputmode", "numeric");
  });
});

describe("InvoiceForm on a phone (UX4)", () => {
  // The page root animates in with a transform, and a transformed ancestor
  // is the containing block for position: fixed: the "fixed" bar sat at the
  // foot of a 1,726 px page and the unsaved-changes card at top −108 px.
  // Both now render at <body>, outside the routed page.
  beforeEach(() => { phone.on = true; });
  afterEach(() => { phone.on = false; });

  it("puts its action bar outside the page, and the bar's Update still submits the form", async () => {
    const { container } = renderEdit();
    await waitFor(() => expect(screen.getByDisplayValue("H17-1")).toBeInTheDocument());
    const submit = screen.getByRole("button", { name: /^Update$/ });
    expect(container.contains(submit)).toBe(false);
    fireEvent.click(submit);
    expect(await screen.findByRole("button", { name: /Confirm & Save/ })).toBeInTheDocument();
  });

  it("opens the unsaved-changes dialog outside the page", async () => {
    const { container } = renderEdit();
    await waitFor(() => expect(screen.getByDisplayValue("H17-1")).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue("H17-1"), { target: { value: "H17-1A" } });
    fireEvent.click(screen.getAllByRole("button", { name: /^Cancel$/ }).at(-1)!);
    const dialog = await screen.findByRole("dialog", { name: "Unsaved changes" });
    expect(container.contains(dialog)).toBe(false);
  });
});
