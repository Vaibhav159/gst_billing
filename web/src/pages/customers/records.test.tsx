import { act, fireEvent, screen, within } from "@testing-library/react";
import { handClock, pass } from "@/test/clock";
import { ANIL, mount, NO_BILLS, serve, type Call } from "./testing";
import CustomerForm from "./CustomerForm";
import CustomerPage from "./CustomerPage";
import { CustomerDuplicates } from "./CustomerDuplicates";

const GST = "27XTZPS7585P1ZB";
const registry = { gstin: GST, status: "found", lookup: "provider", reason: "", state_code: "27", state_name: "MAHARASHTRA", pan: "XTZPS7585P",
  registry: { legal_name: "Kulkarni Jewellers Limited", trade_name: "Kulkarni Jewellers", address: "21 Demo Road", city: "Mumbai", pin_code: "400001", registered_on: "2021-03-15", active: true, status_text: "Active", taxpayer_type: "Regular", constitution: "Company" }, on_file: { customers: [], firms: [] } };
const base = { "GET customers/": { results: [], count: 0, next: null }, "GET customers/7/": ANIL,
  "GET customers/7/statement/": NO_BILLS, "GET sales/": { results: [] }, [`GET registry/${GST}/`]: registry };
const routes = [{ path: "/customers/new", element: <CustomerForm /> }, { path: "/customers/:id/edit", element: <CustomerForm /> },
  { path: "/customers/:id", element: <CustomerPage /> }, { path: "/customers", element: <p>Customers list</p> }];
beforeEach(() => handClock());
afterEach(() => vi.useRealTimers());

test("the registry fills only empty fields, with an explicit choice for another registered name", async () => {
  serve(base); mount(routes, ["/customers/new"]); await pass(400);
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "My buyer" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Address" }), { target: { value: "Typed address" } });
  fireEvent.change(screen.getByLabelText("GSTIN"), { target: { value: GST } }); await pass(400);
  expect(screen.getByLabelText(/^Name/)).toHaveValue("My buyer");
  expect(screen.getByRole("textbox", { name: "Address" })).toHaveValue("Typed address");
  expect(screen.getByLabelText("City")).toHaveValue("Mumbai");
  fireEvent.click(screen.getByRole("button", { name: "Use Kulkarni Jewellers" }));
  expect(screen.getByLabelText(/^Name/)).toHaveValue("Kulkarni Jewellers");
});

test("a late registry answer for the previous GSTIN never fills the new form", async () => {
  let finish!: (r: { status: number; data: unknown }) => void;
  serve({ ...base, [`GET registry/${GST}/`]: () => new Promise(r => { finish = r; }) });
  mount(routes, ["/customers/new"]); await pass(400);
  fireEvent.change(screen.getByLabelText("GSTIN"), { target: { value: GST } }); await pass(400);
  fireEvent.change(screen.getByLabelText("GSTIN"), { target: { value: "" } }); await pass();
  await act(async () => finish({ status: 200, data: registry })); await pass();
  expect(screen.getByLabelText(/^Name/)).toHaveValue(""); expect(screen.getByRole("textbox", { name: "Address" })).toHaveValue("");
});

test("cancelled registrations warn without inventing a date or filling the address", async () => {
  serve({ ...base, [`GET registry/${GST}/`]: { ...registry, registry: { ...registry.registry, active: false, status_text: "Cancelled" } } });
  mount(routes, ["/customers/new"]); await pass(400);
  fireEvent.change(screen.getByLabelText("GSTIN"), { target: { value: GST } }); await pass(400);
  expect(screen.getByText(/Cancelled in the GST registry/)).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Address" })).toHaveValue("");
});

test("an unavailable registry leaves the state and PAN derived from the number", async () => {
  serve({ ...base, [`GET registry/${GST}/`]: { ...registry, status: "unknown", lookup: "unreachable", registry: null } });
  mount(routes, ["/customers/new"]); await pass(400);
  fireEvent.change(screen.getByLabelText("GSTIN"), { target: { value: GST } }); await pass(400);
  expect(screen.getByText("The GST registry didn't answer. The state and PAN come from the number itself.")).toBeInTheDocument();
  expect(screen.getByLabelText("PAN")).toHaveValue("XTZPS7585P");
});

test("duplicate groups link to a source page with the suggested kept customer", async () => {
  serve({ "GET customers/duplicates/": { groups: [{ what: "phone", value: "9829041122", customers: [ANIL, { ...ANIL, id: 31, name: "Anil G" }] }] } });
  mount([{ path: "/customers", element: <CustomerDuplicates /> }], ["/customers"]); await pass(400);
  expect(screen.getByRole("link", { name: "Review and merge" })).toHaveAttribute("href", "/customers/31?merge=7");
});

test("an existing customer's unchanged duplicate phone still offers Merge into", async () => {
  serve({ ...base, "GET customers/duplicates/": { groups: [{ what: "phone", value: ANIL.mobile_number,
    customers: [ANIL, { ...ANIL, id: 31, name: "Anil G" }] }] } });
  mount(routes, ["/customers/7/edit"]); await pass(400);
  expect(screen.getByRole("link", { name: "Merge into Anil G" })).toHaveAttribute("href", "/customers/7?merge=31");
});

test("a customer page merge link opens the dialog without choosing the suggested target", async () => {
  serve({ ...base, "GET customers/31/": { ...ANIL, id: 31, name: "Anil G" } });
  mount(routes, ["/customers/7?merge=31"]); await pass(400);
  expect(screen.getByRole("dialog", { name: "Merge Anil Gupta into another customer" })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: /Anil G/ })).not.toBeChecked();
});

test("a 204 delete resolves its exact audit entry and offers Undo after navigation", async () => {
  const calls = serve({ ...base, "DELETE customers/7/": () => ({ status: 204 }),
    "GET audit/": { results: [{ id: 9140, can: { kind: "restore" } }] },
    "POST audit/9140/restore/": { entry: {}, new_entry: {}, link: "/customers/7" } });
  const { router } = mount(routes, ["/customers/7"]); await pass(400);
  fireEvent.click(screen.getByRole("button", { name: "More" })); await pass(400);
  fireEvent.click(screen.getByText("Delete customer…")); await pass(); await pass(400);
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete customer" })); await pass();
  expect(screen.getByText("Customers list")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^Undo/ })); await pass();
  expect(calls.find(c => c.url === "audit/")?.params).toMatchObject({ entity: "customer", entity_id: 7, group: "delete", page_size: 1 });
  expect(calls.filter(c => c.method === "POST")).toMatchObject([{ url: "audit/9140/restore/" }]);
  // A finished Undo never pulls the person away from where they went since; the toast offers the way back.
  expect(router.state.location.pathname).toBe("/customers");
  fireEvent.click(screen.getByRole("button", { name: /^Open/ })); await pass();
  expect(router.state.location.pathname).toBe("/customers/7");
});

test("a slow audit lookup never holds the dialog on Deleting after the delete has succeeded", async () => {
  serve({ ...base, "DELETE customers/7/": () => ({ status: 204 }), "GET audit/": () => new Promise(() => {}) });
  mount(routes, ["/customers/7"]); await pass(400);
  fireEvent.click(screen.getByRole("button", { name: "More" })); await pass(400);
  fireEvent.click(screen.getByText("Delete customer…")); await pass(); await pass(400);
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete customer" })); await pass();
  expect(screen.getByText("Customers list")).toBeInTheDocument();
  expect(screen.getByText("Anil Gupta deleted")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Undo/ })).not.toBeInTheDocument();
});

test("a failed audit lookup cannot turn a completed delete into a retryable delete", async () => {
  const calls = serve({ ...base, "DELETE customers/7/": () => ({ status: 204 }), "GET audit/": (_c: Call) => ({ status: 500 }) });
  mount(routes, ["/customers/7"]); await pass(400);
  fireEvent.click(screen.getByRole("button", { name: "More" })); await pass(400);
  fireEvent.click(screen.getByText("Delete customer…")); await pass(); await pass(400);
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete customer" })); await pass();
  expect(screen.getByText("Customers list")).toBeInTheDocument(); expect(screen.queryByRole("button", { name: /^Undo/ })).not.toBeInTheDocument();
  expect(calls.filter(c => c.method === "DELETE")).toHaveLength(1);
});
