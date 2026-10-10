import { useState } from "react";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onlineManager } from "@tanstack/react-query";
import { __setNetState } from "@/core/api/network";
import { toCustomer, type Customer } from "@/core/api/customers";
import { GSTIN_CHECK_WARNING, PAN_PROBLEM } from "@/core/ids";
import { CustomerFixSheet, CustomerPicker, CustomerSheet, NewCustomerForm, NewCustomerSheet } from "./forBills";
import { ANIL, mount, serve, VIEWER, type Call } from "./testing";

const WALKIN = { ...ANIL, id: 1, name: "Walk-in Customer", customer_type: "walkin", type: "walkin", mobile_number: "", city: "" };
const LAST = { id: 412, invoice_number: "KGH/2026-27/31", invoice_date: "2026-10-08", total_amount: "87083.21", business: 3 };
const MEENA = { ...ANIL, id: 8, name: "Meena Jain", mobile_number: "9414126508", businesses: [4], figures: { bills: 1, total: "1.00", cancelled: 0, udhaar_bills: 0, udhaar_total: "0.00", last_bill: { ...LAST, id: 300, invoice_date: "2026-09-02" } } };
const ANIL_ROW = { ...ANIL, figures: { bills: 1, total: "1.00", cancelled: 0, udhaar_bills: 0, udhaar_total: "0.00", last_bill: LAST } };
const NONE = { count: 0, next: null, results: [] };
/** customers/: the walk-in, the firm's recent customers, or a search. */
const customers = (c: Call) => ({ status: 200, data: { count: 2, next: null,
  results: c.params.type === "walkin" ? [WALKIN] : c.params.ordering === "-last_bill" ? [ANIL_ROW, WALKIN] : String(c.params.search ?? "").toLowerCase().startsWith("j") || c.params.search === "Meena" ? [MEENA, ANIL_ROW] : [] } });

function Picker({ onNew }: { onNew: (t: string) => void }) {
  const [c, setC] = useState<Customer | null>(null);
  return <><CustomerPicker firmId={3} value={c} onPick={setC} onNew={onNew} /><p>picked: {c?.name ?? "nobody"}</p></>;
}

/**
 * A clock the test moves (Ruling 1C-4): the 250 ms pause before a search asks, and a sheet's 350 ms guard against a
 * double tap's second tap, pass when the test says; typing moves it only as far as each key needs.
 */
function handClock() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}
const pass = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const phone = (on: boolean) => { (window as unknown as { __phone?: boolean }).__phone = on; };
const list = () => screen.getByRole("listbox", { name: "Customers" });

afterEach(() => {
  vi.useRealTimers();
  phone(false);
  // (also here: a test that stops part-way never reaches its own end, and offline would hold every later test's requests)
  onlineManager.setOnline(true);
  act(() => __setNetState("online"));
});

test("the picker: empty, the walk-in record, + New customer… and the firm's recent customers; typed, its own first, the rest named by firm", async () => {
  const user = handClock();
  const onNew = vi.fn();
  const calls = serve({ "GET customers/": customers });
  mount([{ path: "/", element: <Picker onNew={onNew} /> }], ["/"]);
  const box = screen.getByRole("combobox", { name: "Customer" });
  await user.click(box);
  await waitFor(() => expect(within(list()).getAllByRole("option").map((o) => o.textContent)).toEqual([
    "Walk-in CustomerCounter sale: no name or GSTIN on the bill",
    "+ New customer…Add someone without leaving the bill",
    "Anil Gupta98290 41122 · No GSTIN · Udaipur, Rajasthan08 Oct · ₹87,083.21",
  ]));
  expect(calls.find((c) => c.params.ordering === "-last_bill")!.params).toMatchObject({ figures: 1, figures_business_id: 3, page_size: 6 });
  await user.type(box, "Meena");
  await pass(250); // typing pauses: the search asks
  await waitFor(() => expect(within(list()).getAllByRole("option")[0]).toHaveTextContent("Anil Gupta"));
  expect(within(list()).getAllByRole("option")[1]).toHaveTextContent("Meena Jain94141 26508 · No GSTIN · Udaipur, Rajasthan · usually billed by Meera");
  expect(within(list()).getAllByRole("option")[2]).toHaveTextContent("+ New customer “Meena”…Not one of these? Add them without leaving the bill");
  await user.keyboard("{ArrowDown}{Enter}");
  expect(screen.getByText("picked: Meena Jain")).toBeInTheDocument();
  expect(screen.getByText("94141 26508 · No GSTIN · Udaipur, Rajasthan")).toBeInTheDocument();
  await user.clear(box);
  await user.type(box, "Rekha");
  await pass(250);
  const add = await screen.findByRole("option", { name: /\+ New customer “Rekha”…/ });
  expect(add).toHaveTextContent("+ New customer “Rekha”…No customer matches. Add them without leaving the bill");
  await user.click(add);
  expect(onNew).toHaveBeenCalledWith("Rekha");
});

test("the New customer link beside the box takes the name typed there", async () => {
  const user = handClock();
  const onNew = vi.fn();
  serve({ "GET customers/": customers });
  mount([{ path: "/", element: <Picker onNew={onNew} /> }], ["/"]);
  await user.type(screen.getByRole("combobox", { name: "Customer" }), "Kamal Jain");
  await user.click(screen.getByRole("button", { name: "New customer" }));
  expect(onNew).toHaveBeenCalledWith("Kamal Jain");
});

test("a name typed and Enter pressed at once picks nothing until its search has answered, never + New customer; then Enter picks the first match (Ruling 1D-2)", async () => {
  const user = handClock();
  const onNew = vi.fn();
  let answer = () => {};
  const held = new Promise<void>((resolve) => { answer = resolve; });
  const calls = serve({ "GET customers/": async (c: Call) => { if (c.params.search) await held; return customers(c); } });
  mount([{ path: "/", element: <Picker onNew={onNew} /> }], ["/"]);
  const box = screen.getByRole("combobox", { name: "Customer" });
  await user.click(box);
  // one letter is too few to search
  await user.keyboard("M{Enter}");
  expect(list()).toHaveTextContent("Keep typing to search");
  await user.keyboard("eena{Enter}");
  expect(list()).toHaveTextContent("Searching…");
  expect(within(list()).queryAllByRole("option")).toEqual([]);
  await pass(250);
  await waitFor(() => expect(calls.some((c) => c.params.search === "Meena")).toBe(true));
  // asked but not answered: the arrows and Enter still have nothing to pick
  await user.keyboard("{ArrowDown}{Enter}");
  expect(onNew).not.toHaveBeenCalled();
  expect(screen.getByText("picked: nobody")).toBeInTheDocument();
  await act(async () => { answer(); });
  expect(await screen.findByRole("option", { name: /^Anil Gupta/ })).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{Enter}");
  expect(screen.getByText("picked: Anil Gupta")).toBeInTheDocument();
  expect(onNew).not.toHaveBeenCalled();
});

test("a search that fails says so in the list, and still offers to add them", async () => {
  const user = handClock();
  const onNew = vi.fn();
  serve({ "GET customers/": (c: Call) => (c.params.search ? { status: 503 } : customers(c)) });
  mount([{ path: "/", element: <Picker onNew={onNew} /> }], ["/"]);
  await user.click(screen.getByRole("combobox", { name: "Customer" }));
  await user.keyboard("Kamal");
  await pass(250);
  await waitFor(() => expect(list()).toHaveTextContent("Couldn't search: the app couldn't get through"));
  expect(within(list()).getAllByRole("option").map((o) => o.textContent)).toEqual(["+ New customer “Kamal”…Add them without leaving the bill"]);
  await user.keyboard("{Enter}");
  expect(onNew).toHaveBeenCalledWith("Kamal");
});

test("offline, the list says the search waits for the internet, and it searches once the internet is back", async () => {
  const user = handClock();
  serve({ "GET customers/": customers });
  mount([{ path: "/", element: <Picker onNew={() => {}} /> }], ["/"]);
  await user.click(screen.getByRole("combobox", { name: "Customer" }));
  await waitFor(() => expect(within(list()).getAllByRole("option")).toHaveLength(3));
  onlineManager.setOnline(false);
  act(() => __setNetState("offline"));
  await user.keyboard("Meena");
  await pass(250);
  expect(list()).toHaveTextContent("You're offline: the search runs when you're back online");
  expect(within(list()).queryAllByRole("option")).toEqual([]);
  onlineManager.setOnline(true);
  act(() => __setNetState("online"));
  expect(await screen.findByRole("option", { name: /^Meena Jain/ })).toBeInTheDocument();
});

test("a new customer from the bill: saved with the GSTIN's state, type and PAN, for every firm (no firms sent), and handed back", async () => {
  const user = handClock();
  const onSaved = vi.fn();
  const calls = serve({ "GET customers/": NONE, "POST customers/": (c: Call) => ({ status: 201, data: { ...ANIL, ...(c.data as object), id: 50 } }) });
  mount([{ path: "/", element: <NewCustomerForm initialName="Kulkarni Jewellers" homeState="RAJASTHAN" onSaved={onSaved} /> }], ["/"]);
  await user.type(screen.getByLabelText("GSTIN"), "27XTZPS7585P1ZB");
  expect(screen.getByText("Valid GSTIN · Maharashtra (27) · PAN XTZPS7585P")).toBeInTheDocument();
  expect(screen.getByLabelText("State")).toHaveValue("MAHARASHTRA");
  expect(screen.queryByLabelText("PAN")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save and use on this bill" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 50, name: "Kulkarni Jewellers" })));
  // no `businesses`: none ticked means every firm, and the server refuses an empty list (Ruling 1C-2)
  expect(calls.find((c) => c.method === "POST")!.data).toEqual({
    name: "Kulkarni Jewellers", mobile_number: "", email: "", gst_number: "27XTZPS7585P1ZB", pan_number: "XTZPS7585P", address: "", city: "", state_name: "MAHARASHTRA", customer_type: "business",
  });
  expect(await screen.findByText("Added Kulkarni Jewellers")).toBeInTheDocument();
  expect(screen.getByText("Saved to Customers and picked for this bill. Add their address: a B2B bill needs it.")).toBeInTheDocument();
});

test("a GSTIN that fails only its check character warns, saves as typed and stays B2B; its PAN is the one typed", async () => {
  const user = handClock();
  const onSaved = vi.fn();
  const calls = serve({ "GET customers/": NONE, "POST customers/": (c: Call) => ({ status: 201, data: { ...ANIL, ...(c.data as object), id: 51 } }) });
  mount([{ path: "/", element: <NewCustomerForm initialName="Shree Gems" homeState="RAJASTHAN" onSaved={onSaved} /> }], ["/"]);
  await user.type(screen.getByLabelText("GSTIN"), "27AAAAA0000A1Z5");
  expect(screen.getByText(GSTIN_CHECK_WARNING)).toBeInTheDocument();
  expect(screen.getByLabelText("GSTIN")).not.toHaveAttribute("aria-invalid");
  expect(screen.getByLabelText("State")).toHaveValue("MAHARASHTRA");
  expect(screen.getByText("Type the PAN: the app reads it only from a GSTIN that checks out.")).toBeInTheDocument();
  await user.type(screen.getByLabelText("PAN"), "aaaaa0000a");
  await user.click(screen.getByRole("button", { name: "Save and use on this bill" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 51 })));
  expect(calls.find((c) => c.method === "POST")!.data).toMatchObject({ gst_number: "27AAAAA0000A1Z5", customer_type: "business", pan_number: "AAAAA0000A", state_name: "MAHARASHTRA" });
});

test("a number another customer has is named once it's found, with Use them instead; a lost connection keeps what was typed", async () => {
  const user = handClock();
  const onSaved = vi.fn();
  const calls = serve({ "GET customers/": (c: Call) => ({ status: 200, data: { count: 1, next: null, results: c.params.search === "9414126508" ? [MEENA] : [] } }), "POST customers/": () => ({ status: 0 }) });
  mount([{ path: "/", element: <NewCustomerForm homeState="RAJASTHAN" onSaved={onSaved} /> }], ["/"]);
  await user.type(screen.getByLabelText(/Name on the bill/), "Meenu");
  await user.type(screen.getByLabelText("Mobile number"), "94141 26508");
  await pass(250); // typing pauses: the number is looked up
  expect(await screen.findByText("This number belongs to Meena Jain.")).toBeInTheDocument();
  expect(calls.filter((c) => c.params.search === "9414126508")).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Save and use on this bill" }));
  expect(screen.getByLabelText("Mobile number")).toHaveAttribute("aria-invalid", "true");
  expect(calls.some((c) => c.method === "POST")).toBe(false);
  await user.click(screen.getByRole("button", { name: "Use Meena Jain instead" }));
  expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 8 }));
  await user.clear(screen.getByLabelText("Mobile number"));
  await user.click(screen.getByRole("button", { name: "Save and use on this bill" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Not saved: the app couldn't get through");
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  expect(screen.getByLabelText(/Name on the bill/)).toHaveValue("Meenu");
});

test("a GSTIN another customer has is named once it's found, with Use them instead", async () => {
  const user = handClock();
  const onSaved = vi.fn();
  const KULKARNI = { ...ANIL, id: 9, name: "Kulkarni Jewellers", gst_number: "27XTZPS7585P1ZB", state_name: "MAHARASHTRA", type: "business" };
  const calls = serve({ "GET customers/": (c: Call) => ({ status: 200, data: { count: 1, next: null, results: c.params.search === "27XTZPS7585P1ZB" ? [KULKARNI] : [] } }) });
  mount([{ path: "/", element: <NewCustomerForm initialName="Kulkarni" homeState="RAJASTHAN" onSaved={onSaved} /> }], ["/"]);
  await user.type(screen.getByLabelText("GSTIN"), "27XTZPS7585P1ZB");
  await pass(250);
  expect(await screen.findByText("Kulkarni Jewellers already has this GSTIN.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save and use on this bill" }));
  expect(screen.getByLabelText("GSTIN")).toHaveAttribute("aria-invalid", "true");
  expect(calls.some((c) => c.method === "POST")).toBe(false);
  await user.click(screen.getByRole("button", { name: "Use Kulkarni Jewellers instead" }));
  expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }));
});

test("someone who can't add customers is told so on Save, and nothing is sent", async () => {
  const user = handClock();
  const calls = serve({ "GET customers/": NONE });
  mount([{ path: "/", element: <NewCustomerForm initialName="Rekha" homeState="RAJASTHAN" onSaved={() => {}} /> }], ["/"], { me: VIEWER });
  await user.click(screen.getByRole("button", { name: "Save and use on this bill" }));
  expect(screen.getByText("Only the owner, the accountant and counter staff can add or change customers. Ask the owner if you need it.")).toBeInTheDocument();
  expect(calls.some((c) => c.method === "POST")).toBe(false);
});

test("the desktop's new-customer sheet opens on the name typed in the customer box, ready to finish it; Back closes it", async () => {
  // jsdom has no layout, so every offsetParent is null and the sheet's focus step would see only the field focused
  // already. Here it sees what a browser does: every field in the form is on screen
  const offsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent")!;
  Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get(this: HTMLElement) { return this.isConnected ? document.body : null; } });
  try {
    const user = handClock();
    const onClose = vi.fn();
    serve({ "GET customers/": NONE });
    mount([{ path: "/", element: <NewCustomerSheet open initialName="Kamal Jain" homeState="RAJASTHAN" onClose={onClose} onSaved={() => {}} /> }], ["/"]);
    const sheet = await screen.findByRole("dialog", { name: "New customer" });
    expect(sheet).toHaveTextContent("Saved to Customers and picked for this bill. You stay on the bill.");
    const name = within(sheet).getByLabelText(/Name on the bill/);
    expect(name).toHaveValue("Kamal Jain");
    await pass(400); // past the sheet's own focus step and its guard against a double tap's second tap
    expect(name).toHaveFocus();
    await user.click(within(sheet).getByRole("button", { name: "Back" }));
    expect(onClose).toHaveBeenCalled();
  } finally {
    Object.defineProperty(HTMLElement.prototype, "offsetParent", offsetParent);
  }
});

test("the fix sheet: the PAN is checked, saved to the customer alone, and the bill hears of it", async () => {
  const user = handClock();
  const onSaved = vi.fn();
  const calls = serve({ "PATCH customers/7/": (c: Call) => ({ status: 200, data: { ...ANIL, ...(c.data as object) } }) });
  mount([{ path: "/", element: <CustomerFixSheet customer={toCustomer(ANIL)} field="pan" open onClose={() => {}} onSaved={onSaved} /> }], ["/"]);
  const sheet = await screen.findByRole("dialog", { name: "Anil Gupta's PAN" });
  expect(sheet).toHaveTextContent("Income Tax Rule 114B: a bill over ₹2,00,000 needs the buyer's PAN (or Form 60).");
  await pass(400); // past the sheet's guard against a double tap's second tap
  await user.type(within(sheet).getByLabelText("PAN"), "abcde1234");
  await user.keyboard("{Enter}");
  expect(within(sheet).getByText(PAN_PROBLEM)).toBeInTheDocument();
  await user.type(within(sheet).getByLabelText("PAN"), "f");
  await user.click(within(sheet).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ pan_number: "ABCDE1234F" })));
  expect(calls.find((c) => c.method === "PATCH")!.data).toEqual({ pan_number: "ABCDE1234F" });
  expect(await screen.findByText("Added Anil Gupta's PAN")).toBeInTheDocument();
  expect(screen.getByText("It's in Customers now; this bill shows it.")).toBeInTheDocument();
});

test("the fix sheet saves nothing for someone who can't change customers, and says who can (Ruling 1C-6)", async () => {
  const user = handClock();
  const calls = serve({ "PATCH customers/7/": (c: Call) => ({ status: 200, data: { ...ANIL, ...(c.data as object) } }) });
  mount([{ path: "/", element: <CustomerFixSheet customer={toCustomer(ANIL)} field="pan" open onClose={() => {}} /> }], ["/"], { me: VIEWER });
  const sheet = await screen.findByRole("dialog", { name: "Anil Gupta's PAN" });
  await pass(400);
  await user.type(within(sheet).getByLabelText("PAN"), "ABCDE1234F");
  await user.click(within(sheet).getByRole("button", { name: "Save" }));
  expect(within(sheet).getByText("Only the owner, the accountant and counter staff can add or change customers. Ask the owner if you need it.")).toBeInTheDocument();
  expect(calls.some((c) => c.method === "PATCH")).toBe(false);
});

test("the fix sheet keeps what's typed when the same customer is asked for again meanwhile (as when the connection comes back)", async () => {
  const user = handClock();
  serve({});
  let refetched = () => {};
  function Fix() {
    const [c, setC] = useState(() => toCustomer(ANIL));
    refetched = () => setC((x) => ({ ...x }));
    return <CustomerFixSheet customer={c} field="pan" open onClose={() => {}} />;
  }
  mount([{ path: "/", element: <Fix /> }], ["/"]);
  const sheet = await screen.findByRole("dialog", { name: "Anil Gupta's PAN" });
  await pass(400);
  await user.type(within(sheet).getByLabelText("PAN"), "ABCDE");
  act(() => refetched());
  expect(within(sheet).getByLabelText("PAN")).toHaveValue("ABCDE");
});

test("the fix sheet for an address wants the shop or house, street and area", async () => {
  const user = handClock();
  const calls = serve({ "PATCH customers/9/": (c: Call) => ({ status: 200, data: { ...ANIL, id: 9, ...(c.data as object) } }) });
  mount([{ path: "/", element: <CustomerFixSheet customer={toCustomer({ ...ANIL, id: 9, name: "Kulkarni Jewellers", address: "" })} field="address" open onClose={() => {}} /> }], ["/"]);
  const sheet = await screen.findByRole("dialog", { name: "Kulkarni Jewellers's address" });
  await pass(400);
  await user.type(within(sheet).getByLabelText("Address"), "Pune");
  await user.click(within(sheet).getByRole("button", { name: "Save" }));
  expect(within(sheet).getByText("Type the shop or house, street and area.")).toBeInTheDocument();
  await user.type(within(sheet).getByLabelText("Address"), ", 8 Laxmi Road");
  await user.click(within(sheet).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(calls.find((c) => c.method === "PATCH")!.data).toEqual({ address: "Pune, 8 Laxmi Road" }));
  expect(await screen.findByText("Added Kulkarni Jewellers's address")).toBeInTheDocument();
});

test("the phone's customer sheet opens on the list, searches, and adds a new customer without leaving the bill", async () => {
  const user = handClock();
  phone(true);
  const onPick = vi.fn();
  serve({ "GET customers/": customers });
  mount([{ path: "/", element: <CustomerSheet open onClose={() => {}} firmId={3} homeState="RAJASTHAN" value={null} onPick={onPick} /> }], ["/"]);
  const sheet = await screen.findByRole("dialog", { name: "Customer" });
  expect(await within(sheet).findByText("Walk-in Customer")).toBeInTheDocument();
  expect(await within(sheet).findByText("Recent")).toBeInTheDocument();
  await pass(400);
  await user.type(within(sheet).getByRole("searchbox", { name: "Search customers" }), "Meena");
  await pass(250);
  await user.click(await within(sheet).findByRole("button", { name: /Meena Jain/ }));
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 8 }));
  await user.click(within(sheet).getByRole("button", { name: "Add “Meena” as a new customer" }));
  expect(await screen.findByRole("dialog", { name: "New customer" })).toBeInTheDocument();
  expect(screen.getByLabelText(/Name on the bill/)).toHaveValue("Meena");
});

test("on the phone's sheet the search says it's searching, then that it failed; adding them stays open", async () => {
  const user = handClock();
  phone(true);
  let answer = () => {};
  const held = new Promise<void>((resolve) => { answer = resolve; });
  serve({ "GET customers/": async (c: Call) => { if (!c.params.search) return customers(c); await held; return { status: 503 }; } });
  mount([{ path: "/", element: <CustomerSheet open onClose={() => {}} firmId={3} homeState="RAJASTHAN" value={null} onPick={() => {}} /> }], ["/"]);
  const sheet = await screen.findByRole("dialog", { name: "Customer" });
  await pass(400);
  await user.type(within(sheet).getByRole("searchbox", { name: "Search customers" }), "Kamal");
  await pass(250);
  expect(within(sheet).getByText("Searching…")).toBeInTheDocument();
  expect(within(sheet).queryByText(/No customer matches/)).not.toBeInTheDocument();
  await act(async () => { answer(); });
  expect(await within(sheet).findByText("Couldn't search: the app couldn't get through")).toBeInTheDocument();
  expect(within(sheet).getByRole("button", { name: "Add “Kamal” as a new customer" })).toBeEnabled();
});
