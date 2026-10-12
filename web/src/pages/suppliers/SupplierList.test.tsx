import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { mount, serve, VIEWER, type Call } from "@/pages/customers/testing";
import { SupplierList } from "./Suppliers";

const supplier = { id: 21, name: "Udaipur Bullion Suppliers", gst_number: "08AACFU5521R1ZN", state_code: "08", state_name: "RAJASTHAN", city: "Udaipur", figures: { bills: 12, total: "492645.00", tax: "14348.88", credit: "14000.00", last: { id: 905, invoice_date: "2026-10-04" } } };
const summary = { suppliers: 101, bills: 120, total: "4926450.00", tax: "143488.80" };
const routes = [{ path: "/suppliers", element: <SupplierList /> }];
beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }); vi.setSystemTime(new Date("2026-10-08T10:00:00+05:30")); });
afterEach(() => { vi.useRealTimers(); (window as unknown as { __phone?: boolean }).__phone = false; });

test("list follows scope and the server summary, and opens 2B's supplier sheet", async () => {
  const calls = serve({ "GET suppliers/": { count: 101, next: "more", results: [supplier], summary } });
  mount(routes, ["/suppliers"]);
  const row = (await screen.findByText(supplier.name)).closest("tr")!;
  expect(row).toHaveTextContent("₹4,92,645.00");
  expect(row).toHaveTextContent("04 Oct 2026");
  expect(row).not.toHaveTextContent("IGST on their bills");
  expect(screen.getByRole("table", { name: "Suppliers by purchases this year" })).toHaveTextContent("₹49,26,450.00");
  expect(calls.find(c => c.url === "suppliers/")?.params).toMatchObject({ business_id: 3, fy: "2026-27" });
  fireEvent.click(screen.getByRole("button", { name: "Add supplier" }));
  expect(screen.getByRole("dialog", { name: "Add a supplier" })).toBeInTheDocument();
  expect(screen.getByLabelText("Supplier name")).toHaveValue("");
});
test("IGST follows the selected firm's state rather than Rajasthan", async () => {
  serve({ "GET firms/": { results: [{ id: 3, name: "MUMBAI GOLD", gst_number: "27AAKFS4821M1ZQ", state_name: "MAHARASHTRA" }] }, "GET suppliers/": { count: 1, results: [supplier], summary } });
  mount(routes, ["/suppliers"]);
  expect(await screen.findByText("IGST on their bills")).toBeInTheDocument();
});
test("search is debounced, empty matches explain search, and viewers have no add action", async () => {
  const calls = serve({ "GET suppliers/": (c: Call) => ({ status: 200, data: { count: c.params.q ? 0 : 1, results: c.params.q ? [] : [supplier], summary: c.params.q ? { suppliers: 0, bills: 0, total: "0", tax: "0" } : summary } }) });
  mount(routes, ["/suppliers"], { me: VIEWER });
  await screen.findByText(supplier.name);
  expect(screen.queryByRole("button", { name: "Add supplier" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search suppliers" }), { target: { value: "Delhi" } });
  expect(calls.filter(c => c.params.q)).toHaveLength(0);
  expect(await screen.findByText("No supplier matches")).toBeInTheDocument();
  expect(screen.getByText("Search by name, city, state or GSTIN.")).toBeInTheDocument();
});
test("Show more appends server pages and retains the complete summary", async () => {
  serve({ "GET suppliers/": (c: Call) => ({ status: 200, data: { count: 2, next: c.params.page === 1 ? "more" : null, results: [{ ...supplier, id: c.params.page === 1 ? 21 : 22, name: c.params.page === 1 ? supplier.name : "Second supplier" }], summary: { ...summary, suppliers: 2 } } }) });
  mount(routes, ["/suppliers"]);
  fireEvent.click(await screen.findByRole("button", { name: "Show 1 more" }));
  expect(await screen.findByText("Second supplier")).toBeInTheDocument();
  expect(screen.getByText(supplier.name)).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("button", { name: "Show 1 more" })).not.toBeInTheDocument());
});
test("phone rows port the prototype's words and firm chips", async () => {
  (window as unknown as { __phone?: boolean }).__phone = true;
  serve({ "GET suppliers/": { count: 1, results: [{ ...supplier, gst_number: "", figures: { ...supplier.figures, bills: 0, last: null } }], summary } });
  mount(routes, ["/suppliers"]);
  const row = await screen.findByRole("link", { name: /Udaipur Bullion Suppliers/ });
  expect(within(row).getByText("No bills")).toBeInTheDocument();
  expect(row).toHaveTextContent("No GSTIN · Rajasthan");
  expect(screen.getByRole("radio", { name: "All firms" })).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
test("the search input retains focus while a new search waits", async () => {
  const calls = serve({ "GET suppliers/": (c: Call) => c.params.q ? new Promise(() => {}) : { status: 200, data: { count: 1, results: [supplier], summary } } });
  mount(routes, ["/suppliers"]);
  await screen.findByText(supplier.name);
  const input = screen.getByRole("searchbox", { name: "Search suppliers" });
  input.focus();
  fireEvent.change(input, { target: { value: "Delhi" } });
  await waitFor(() => expect(calls.some(c => c.params.q === "Delhi")).toBe(true));
  expect(input).toHaveFocus();
});
