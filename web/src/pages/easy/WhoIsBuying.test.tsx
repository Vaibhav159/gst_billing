import { fireEvent, screen, within } from "@testing-library/react";
import { toCustomer, toCustomerRow } from "@/core/api/customers";
import { renderApp } from "@/test/render";
import { serve } from "@/test/server";
import { WhoIsBuying, type WhoIsBuyingProps } from "./WhoIsBuying";

const WALKIN = toCustomer({ id: 1, name: "Walk-in Customer", customer_type: "walkin" });
const ANIL = toCustomerRow({
  id: 7, name: "Anil Gupta", mobile_number: "9829041122", gst_number: "08ABCPK1234F1Z5",
  figures: { bills: 4, total: "245789.12", udhaar_total: "25000.00", last_bill: {
    id: 412, invoice_number: "KGH/2026-27/31", invoice_date: "2026-10-08", total_amount: "87083.21", business: 3,
  } },
});
const props = (extra: Partial<WhoIsBuyingProps> = {}): WhoIsBuyingProps => ({
  firmName: "KIRAN GOLD HOUSE", selected: null, recent: [ANIL], matches: null, typed: "", searchNote: "",
  loading: false, failure: "", walkin: WALKIN, canAdd: true, canCreate: true, whyCreate: "",
  maskPhone: () => "••• 41122", onType: vi.fn(), onPick: vi.fn(), onNew: vi.fn(), ...extra,
});

test("shows the step and six recent buyers with masked phones and last dates, never amounts or full numbers", () => {
  const recent = Array.from({ length: 7 }, (_, i) => ({ ...ANIL, id: i + 7, name: i ? `Buyer ${i}` : ANIL.name }));
  renderApp(<WhoIsBuying {...props({ recent: [{ ...ANIL, id: 1, type: "walkin" }, ...recent], selected: ANIL })} />);
  expect(screen.getByText("Step 1 of 2 · Who is buying")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Who is buying?" })).toBeInTheDocument();
  const list = screen.getByRole("region", { name: "Recent customers" });
  expect(within(list).getAllByRole("button")).toHaveLength(6);
  const anil = within(list).getByRole("button", { name: /Anil Gupta/ });
  expect(anil).toHaveTextContent("••• 41122 · shop");
  expect(anil).toHaveTextContent("08 Oct 2026");
  expect(anil).toHaveTextContent("(on this bill now)");
  expect(screen.queryByText("Buyer 6")).not.toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/9829041122|87,083|245789|₹|KGH\/2026-27\/31/);
});

test("picks the exact customer or walk-in object without making a request", () => {
  const calls = serve({});
  const p = props();
  renderApp(<WhoIsBuying {...p} />);
  fireEvent.click(screen.getByRole("button", { name: /Anil Gupta/ }));
  expect(p.onPick).toHaveBeenLastCalledWith(ANIL);
  fireEvent.click(screen.getByRole("button", { name: /Walk-in customer/ }));
  expect(p.onPick).toHaveBeenLastCalledWith(WALKIN);
  fireEvent.change(screen.getByRole("searchbox", { name: "Search by name or phone" }), { target: { value: "Ani" } });
  expect(p.onType).toHaveBeenCalledWith("Ani");
  expect(calls).toEqual([]);
});

test("initial loading shows six skeleton rows without clickable walk-in or customer choices", () => {
  renderApp(<WhoIsBuying {...props({ loading: true })} />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading your customers…");
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  expect(screen.queryByText(/No customers/)).not.toBeInTheDocument();
});

test("a viewer can read the list but cannot select any buyer", () => {
  const p = props({ canCreate: false, canAdd: false, whyCreate: "Your role can view bills, but can't make them." });
  renderApp(<WhoIsBuying {...p} />);
  expect(screen.getByText(p.whyCreate)).toBeInTheDocument();
  for (const button of screen.getAllByRole("button")) {
    expect(button).toBeDisabled();
    fireEvent.click(button);
  }
  expect(p.onPick).not.toHaveBeenCalled();
});

test("one typed character shows the search note, never a false no-customer result", () => {
  renderApp(<WhoIsBuying {...props({ typed: "A", searchNote: "Type at least 2 characters to search.", matches: [] })} />);
  expect(screen.getByRole("status")).toHaveTextContent("Type at least 2 characters to search.");
  expect(screen.queryByText(/No customer called/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Add .* as a new customer/ })).not.toBeInTheDocument();
});

test("shows search matches with the last-bill heading and keeps the selected customer", () => {
  const p = props({ typed: "Anil", matches: [ANIL], selected: ANIL });
  renderApp(<WhoIsBuying {...p} />);
  const results = screen.getByRole("region", { name: "Customers matching Anil" });
  expect(within(results).getByText("1 customer found")).toBeInTheDocument();
  expect(within(results).getByText("Last bill here")).toBeInTheDocument();
  fireEvent.click(within(results).getByRole("button", { name: /Anil Gupta/ }));
  expect(p.onPick).toHaveBeenCalledWith(ANIL);
  expect(screen.queryByRole("region", { name: "Recent customers" })).not.toBeInTheDocument();
});

test("no match can add the typed name and a viewer sees no add action", () => {
  const p = props({ typed: "  Rekha  ", matches: [] });
  const { unmount } = renderApp(<WhoIsBuying {...p} />);
  expect(screen.getByText("No customer called “Rekha” yet")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add “Rekha” as a new customer" }));
  expect(p.onNew).toHaveBeenCalledWith("Rekha");
  unmount();
  renderApp(<WhoIsBuying {...p} canAdd={false} />);
  expect(screen.queryByRole("button", { name: /Add .* as a new customer/ })).not.toBeInTheDocument();
});

test("shows a failure once while cached buyers remain selectable, and absence of a walk-in cannot pick null", () => {
  const failure = "You're offline. These are the customers already on this phone; make the bill now and save it when the internet is back.";
  const p = props({ failure, walkin: null });
  renderApp(<WhoIsBuying {...p} />);
  expect(screen.getByRole("status")).toHaveTextContent(failure);
  fireEvent.click(screen.getByRole("button", { name: /Anil Gupta/ }));
  expect(p.onPick).toHaveBeenCalledWith(ANIL);
  expect(screen.getByRole("button", { name: /Walk-in customer/ })).toBeDisabled();
});

test("an empty recent list names the firm and a pending search is not called empty", () => {
  const p = props({ recent: [] });
  const { unmount } = renderApp(<WhoIsBuying {...p} />);
  expect(screen.getByText("No customers have bills at KIRAN GOLD HOUSE this year yet. Search above, or add a new customer.")).toBeInTheDocument();
  unmount();
  renderApp(<WhoIsBuying {...p} typed="An" searchNote="Searching…" matches={null} />);
  expect(screen.getByRole("status")).toHaveTextContent("Searching…");
  expect(screen.queryByText(/No customer called/)).not.toBeInTheDocument();
});

test("uses the shared mask supplied by the Easy layout", () => {
  const maskPhone = vi.fn(() => "A masked phone");
  renderApp(<WhoIsBuying {...props({ maskPhone })} />);
  expect(maskPhone).toHaveBeenCalledWith(ANIL.mobile_number);
  expect(screen.getByText("A masked phone · shop")).toBeInTheDocument();
});
