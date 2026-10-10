import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onlineManager } from "@tanstack/react-query";
import { __setNetState } from "@/core/api/network";
import CustomerPage from "./CustomerPage";
import { ANIL, FIRMS, mount, NO_BILLS, serve, STAFF, VIEWER, type Call } from "./testing";

const routes = [
  { path: "/customers", element: <p>the list</p> },
  { path: "/customers/:id", element: <CustomerPage /> },
  { path: "/customers/:id/edit", element: <p>the form</p> },
  { path: "/customers/:id/statement", element: <p>the statement</p> },
  { path: "/customers/new", element: <p>the new customer form</p> },
  { path: "/sales/:id", element: <p>the bill</p> },
];
type B = { id: number; date: string; total: string; status?: "active" | "cancelled"; paid?: string; business?: number };
const bill = ({ id, date, total, status = "active", paid = "billing", business = 3 }: B) => ({
  id, business, business_name: business === 3 ? "KIRAN GOLD HOUSE" : "MEERA ORNAMENTS", invoice_number: `KGH/${date.slice(0, 4)}/${id}`, invoice_date: date,
  payment_mode: paid === "udhaar" ? "credit" : paid === "not_recorded" ? "" : "cash", taxable: total, tax: "0.00", total_amount: total, status, cancel_reason: status === "cancelled" ? "Customer returned it" : "", paid: status === "cancelled" ? "cancelled" : paid, itax: [],
});
const BILLS = [
  bill({ id: 101, date: "2025-11-02", total: "5000.00" }),
  bill({ id: 102, date: "2026-09-10", total: "20000.00", paid: "udhaar" }),
  bill({ id: 103, date: "2026-09-20", total: "3000.00", status: "cancelled" }),
  bill({ id: 104, date: "2026-10-08", total: "87083.21" }),
];
const statement = (bills = BILLS) => ({ ...NO_BILLS, bills });
/** sales/?itax=1's answer: [bill id, number, the server's flag kind] each (contract §0.2 ItaxFlag). */
const flags = (list: [number, string, string][]) => ({ count: list.length, next: null, results: list.map(([id, number, kind]) => ({ id, invoice_number: number, invoice_date: "2026-09-10", total_amount: "250000.00", itax: [{ kind, short: "", text: "" }] })) });
const statementCalls = (calls: Call[], id = 7) => calls.filter((c) => c.url === `customers/${id}/statement/`);

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-10-08T10:00:00+05:30"));
});
afterEach(() => {
  vi.useRealTimers();
  // (also here: a test that stops part-way never reaches its own finally, and offline would hold every later test's requests)
  onlineManager.setOnline(true);
  act(() => __setNetState("online"));
  (window as unknown as { __phone?: boolean }).__phone = false;
});

test("the customer's details, and the year's figures worked out from one all-time statement in the firm picked", async () => {
  const calls = serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": statement(), "GET sales/": flags([]) });
  mount(routes, ["/customers/7"]);
  expect(await screen.findByRole("heading", { level: 1, name: "Anil Gupta" })).toBeInTheDocument();
  expect(await screen.findByText("Customer since 04 Aug 2025 · Udaipur · last bill 08 Oct 2026")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "98290 41122" })).toHaveAttribute("href", "tel:+919829041122");
  expect(screen.getByText("Rajasthan (08)")).toBeInTheDocument();
  expect(screen.getByText("Local sales: CGST + SGST")).toBeInTheDocument();
  expect(screen.getByText("KIRAN GOLD HOUSE", { selector: "span.rounded-full" })).toBeInTheDocument(); // the firm that usually bills them
  expect(statementCalls(calls)[0].params).toEqual({ business_id: 3 });
  const fy = screen.getByRole("radio", { name: /FY 2026-27/ });
  expect(fy).toHaveTextContent("1 Apr to 8 Oct 2026 · 2 bills · ₹1,07,083.21");
  expect(screen.getByRole("radio", { name: /All time/ })).toHaveTextContent("since 04 Aug 2025 · 3 bills · ₹1,12,083.21");
  expect(screen.getByText("Sales · FY 2026-27").parentElement).toHaveTextContent("₹1,07,083.21");
  expect(screen.getByText(/Billed on udhaar · FY 2026-27/).closest("div")).toHaveTextContent("₹20,000.001 bill · not a balance");
  expect(document.querySelector(".anim-bump")).toBeNull();
  await userEvent.click(screen.getByRole("radio", { name: /All time/ }));
  expect(screen.getByText("Sales · All time").parentElement).toHaveTextContent("₹1,12,083.21");
  expect(document.querySelector(".anim-bump")).not.toBeNull();
  expect(statementCalls(calls)).toHaveLength(1); // the switch asks nothing
});

test("another customer opened from here (search) starts at the year again, not at the last one's period", async () => {
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": statement(), "GET customers/30/": { ...ANIL, id: 30, name: "Rekha Soni" }, "GET customers/30/statement/": statement([]), "GET sales/": flags([]) });
  // Rekha first, so her record is on hand when she's opened again: her page shows at once, with no loading in between
  const { router } = mount(routes, ["/customers/30"]);
  await screen.findByRole("heading", { level: 1, name: "Rekha Soni" });
  await act(async () => { await router.navigate("/customers/7"); });
  await userEvent.click(await screen.findByRole("radio", { name: /All time/ }));
  expect(screen.getByRole("radio", { name: /All time/ })).toHaveAttribute("aria-checked", "true");
  await act(async () => { await router.navigate("/customers/30"); });
  expect(screen.getByRole("heading", { level: 1, name: "Rekha Soni" })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: /FY 2026-27/ })).toHaveAttribute("aria-checked", "true");
});

test("a landline on file gets no Call link and no WhatsApp, and Send says it picks the contact", async () => {
  serve({ "GET customers/7/": { ...ANIL, mobile_number: "0294 241 2345" }, "GET customers/7/statement/": statement(), "GET sales/": flags([]) });
  mount(routes, ["/customers/7"]);
  expect(await screen.findByText("0294 241 2345")).not.toHaveAttribute("href");
  expect(screen.getByText("Send opens WhatsApp to pick the contact")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "WhatsApp" })).not.toBeInTheDocument();
});

test("all time starts at the first bill when the record was made after it (bills copied in from Tally)", async () => {
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": statement([bill({ id: 90, date: "2024-06-15", total: "1000.00" }), ...BILLS]), "GET sales/": flags([]) });
  mount(routes, ["/customers/7"]);
  // the record itself is still as old as it is
  expect(await screen.findByText("Customer since 04 Aug 2025 · Udaipur · last bill 08 Oct 2026")).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: /All time/ })).toHaveTextContent("since 15 Jun 2024 · 4 bills · ₹1,13,083.21");
});

test("bills newest first, a cancelled one struck through and not counted, udhaar marked, the footer totals the rest", async () => {
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": statement(), "GET sales/": flags([]) });
  mount(routes, ["/customers/7"]);
  const table = await screen.findByRole("table", { name: "Sales bills to Anil Gupta" });
  const rows = within(table).getAllByRole("row").slice(1, -1);
  expect(rows.map((r) => within(r).getAllByRole("cell")[1].textContent)).toEqual(["KGH/2026/104", "KGH/2026/103", "KGH/2026/102"]);
  expect(within(rows[1]).getByText("Cancelled")).toHaveAttribute("title", "Cancelled: Customer returned it");
  expect(within(rows[2]).getAllByText("Udhaar")).toHaveLength(2); // paid by, and its status
  // (the cancelled-bills words are Selling's own, @/core/sales/words: Ruling 1C-8)
  expect(screen.getByText("1 Apr to 8 Oct 2026 · 2 bills · 1 cancelled bill not counted · KIRAN GOLD HOUSE")).toBeInTheDocument();
  expect(within(table).getAllByRole("row").at(-1)).toHaveTextContent("FY 2026-27 total · 2 bills");
});

test("15 bills at a time, with Show more", async () => {
  const many = Array.from({ length: 16 }, (_, i) => bill({ id: 200 + i, date: `2026-09-${String(i + 1).padStart(2, "0")}`, total: "100.00" }));
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": statement(many), "GET sales/": flags([]) });
  mount(routes, ["/customers/7"]);
  expect(await screen.findByText("Showing 15 of 16 bills")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Show 1 more" }));
  expect(screen.queryByText("Showing 15 of 16 bills")).not.toBeInTheDocument();
  expect(within(screen.getByRole("table", { name: "Sales bills to Anil Gupta" })).getAllByRole("row")).toHaveLength(18); // the head, 16 bills, the foot
});

test("a bill row that has focus opens with Enter", async () => {
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": statement(), "GET sales/": flags([]) });
  const { router } = mount(routes, ["/customers/7"]);
  const table = await screen.findByRole("table", { name: "Sales bills to Anil Gupta" });
  const row = table.querySelector<HTMLElement>('[data-row="104"]')!;
  expect(row).toHaveClass("row-focus");
  // Enter on the bill's own link inside it is the link's
  fireEvent.keyDown(within(row).getByRole("link", { name: "KGH/2026/104" }), { key: "Enter" });
  expect(router.state.location.pathname).toBe("/customers/7");
  act(() => row.focus());
  fireEvent.keyDown(row, { key: "Enter" });
  await waitFor(() => expect(router.state.location.pathname).toBe("/sales/104"));
});

test("on a phone a bill row shows its focus, and opens with Enter", async () => {
  (window as unknown as { __phone?: boolean }).__phone = true;
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": statement(), "GET sales/": flags([]) });
  const { router } = mount(routes, ["/customers/7"]);
  const row = (await screen.findByText("KGH/2026/104")).closest<HTMLElement>("[data-row]")!;
  expect(row).toHaveClass("row-focus");
  act(() => row.focus());
  fireEvent.keyDown(row, { key: "Enter" });
  await waitFor(() => expect(router.state.location.pathname).toBe("/sales/104"));
});

test("the income-tax checks on saved bills, as the server flags them: PAN needed (Add PAN opens the form on PAN), the address, cash at the limit", async () => {
  serve({
    "GET customers/7/": ANIL, "GET customers/7/statement/": statement(),
    "GET sales/": flags([[1, "KGH/2026-27/18", "pan"], [2, "KGH/2026-27/22", "pan"], [3, "MO/2026-27/7", "pan"], [4, "AJ/2026-27/3", "pan"], [3, "MO/2026-27/7", "cash_limit"], [5, "KGH/2026-27/40", "b2b_address"]]),
  });
  mount(routes, ["/customers/7"]);
  const pan = await screen.findByText("PAN needed: 4 bills over ₹2,00,000");
  expect(pan.parentElement).toHaveTextContent("KGH/2026-27/18, KGH/2026-27/22, MO/2026-27/7 and 1 more. A bill over ₹2,00,000 needs the buyer's PAN (Income Tax Rule 114B).");
  expect(screen.getByRole("link", { name: "Add PAN" })).toHaveAttribute("href", "/customers/7/edit?focus=pan");
  expect(screen.getByText("Address needed: 1 bill to a business")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Add the address" })).toHaveAttribute("href", "/customers/7/edit?focus=address");
  expect(screen.getByText("Cash at the limit: 1 bill of ₹2,00,000 or more taken in cash").parentElement).toHaveTextContent("MO/2026-27/7. Income Tax Sec 269ST doesn't allow ₹2,00,000 or more in cash for one bill. Check with your CA.");
});

test("income-tax checks that can't load say so, with Try again", async () => {
  let failing = true;
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": statement(), "GET sales/": () => (failing ? { status: 503 } : { status: 200, data: flags([[1, "KGH/2026-27/18", "pan"]]) }) });
  mount(routes, ["/customers/7"]);
  expect(await screen.findByText("Couldn't check their bills for income tax")).toBeInTheDocument();
  failing = false;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("PAN needed: 1 bill over ₹2,00,000")).toBeInTheDocument();
  expect(screen.queryByText("Couldn't check their bills for income tax")).not.toBeInTheDocument();
});

test("the walk-in record says what it is: no Edit, Add a customer, and its big bills ask for the buyer", async () => {
  const WALKIN = { ...ANIL, id: 1, name: "Walk-in Customer", customer_type: "walkin", type: "walkin", mobile_number: "", city: "" };
  serve({ "GET customers/1/": WALKIN, "GET customers/1/statement/": statement(), "GET sales/": flags([[9, "KGH/2026-27/9", "walkin_limit"]]) });
  mount(routes, ["/customers/1"]);
  expect(await screen.findByText("This record collects cash sales made without a name")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
  expect(await screen.findByText("PAN needed: 1 bill over ₹2,00,000")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Add the buyer" })).toHaveAttribute("href", "/customers/new?from=list");
  await userEvent.click(screen.getByRole("button", { name: "More" }));
  expect(await screen.findByRole("menuitem", { name: /All walk-in bills in Sales/ })).toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: /Delete customer/ })).not.toBeInTheDocument();
});

test("a firm picked shows only its bills, and Show all firms asks for every firm's", async () => {
  const calls = serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": statement(), "GET sales/": flags([]) });
  mount(routes, ["/customers/7"]);
  expect(await screen.findByText("Showing KIRAN GOLD HOUSE's bills only")).toBeInTheDocument();
  expect(screen.getByText("Sales bills only · KIRAN GOLD HOUSE · pick the period")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Show all firms" }));
  await waitFor(() => expect(statementCalls(calls).at(-1)!.params).toEqual({}));
  expect(await screen.findByText("Sales bills only · All firms · pick the period")).toBeInTheDocument();
  expect(screen.queryByText(/^Showing .* bills only$/)).not.toBeInTheDocument();
});

test("the figures wait for the firm's name, so they never show under another one", async () => {
  // the person picked Kiran on this device, so the firm is known before the list of firms comes
  localStorage.setItem("gst3.scope.1", "3");
  let firmsCome = () => {};
  const held = new Promise<void>((resolve) => { firmsCome = resolve; });
  const calls = serve({
    "GET businesses/": async () => { await held; return { status: 200, data: { results: FIRMS } }; },
    "GET customers/7/": ANIL, "GET customers/7/statement/": statement(), "GET sales/": flags([]),
  });
  mount(routes, ["/customers/7"]);
  await screen.findByText("Customer since 04 Aug 2025 · Udaipur");
  // the income-tax checks, which name no firm, have gone; the statement hasn't
  await waitFor(() => expect(calls.some((c) => c.url === "sales/")).toBe(true));
  expect(statementCalls(calls)).toHaveLength(0);
  expect(screen.queryByText(/^Showing .* bills only$|the firm picked/)).not.toBeInTheDocument();
  await act(async () => { firmsCome(); });
  expect(await screen.findByText("Showing KIRAN GOLD HOUSE's bills only")).toBeInTheDocument();
  expect(statementCalls(calls).map((c) => c.params)).toEqual([{ business_id: 3 }]);
});

test("when the list of firms can't load, the words stay neutral: one firm's bills, never “the firm picked's”", async () => {
  localStorage.setItem("gst3.scope.1", "3");
  serve({ "GET businesses/": () => ({ status: 503 }), "GET customers/7/": ANIL, "GET customers/7/statement/": statement([]), "GET sales/": flags([]) });
  mount(routes, ["/customers/7"]);
  expect(await screen.findByText("Only one firm's bills are counted. Pick All firms in the firm picker to see the rest.")).toBeInTheDocument();
  expect(screen.getByText("Showing one firm's bills only")).toBeInTheDocument();
  expect(screen.queryByText(/firm picked's/)).not.toBeInTheDocument();
  // nor anything else it can't know: the firms that usually bill them are counted, not "Any firm", and no local or inter-state
  expect(screen.queryByText("Any firm")).not.toBeInTheDocument();
  expect(screen.getByText("1 firm")).toBeInTheDocument();
  expect(screen.queryByText(/Local sales|Inter-state/)).not.toBeInTheDocument();
});

test("a GSTIN that fails its check character shows as a problem to fix, with the way to the form", async () => {
  serve({ "GET customers/7/": { ...ANIL, gst_number: "08AAAAA0000A1Z5", type: "business" }, "GET customers/7/statement/": statement([]), "GET sales/": flags([]) });
  mount(routes, ["/customers/7"]);
  expect(await screen.findByText("GSTIN · B2B bills")).toBeInTheDocument();
  expect(screen.getByText("Its last character doesn't match, so you may have mistyped one character.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Check the GSTIN" })).toHaveAttribute("href", "/customers/7/edit?focus=gstin");
});

test("on a phone too, a GSTIN that fails its check character says so, with Check the GSTIN", async () => {
  (window as unknown as { __phone?: boolean }).__phone = true;
  serve({ "GET customers/7/": { ...ANIL, gst_number: "08AAAAA0000A1Z5", type: "business" }, "GET customers/7/statement/": statement([]), "GET sales/": flags([]) });
  mount(routes, ["/customers/7"]);
  expect(await screen.findByText("Its last character doesn't match, so you may have mistyped one character.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Check the GSTIN" })).toHaveAttribute("href", "/customers/7/edit?focus=gstin");
});

test("More: Merge waits for part 4; Delete is the owner's, only with no bills, and goes back to the list", async () => {
  const calls = serve({ "GET customers/30/": { ...ANIL, id: 30, name: "Rekha Soni" }, "GET customers/30/statement/": statement([]), "GET sales/": flags([]), "DELETE customers/30/": () => ({ status: 204 }) });
  const { router } = mount(routes, ["/customers", "/customers/30"]);
  await screen.findByText("No sales bills to Rekha Soni in FY 2026-27");
  await userEvent.click(screen.getByRole("button", { name: "More" }));
  expect(await screen.findByRole("menuitem", { name: /Merge into another customer/ })).toBeDisabled();
  // the statement is the firm picked's: it can't speak for the other firms, so it says whose bills it looked at
  expect(screen.getByRole("menuitem", { name: /Delete customer/ })).toHaveTextContent("It has no bills in KIRAN GOLD HOUSE");
  await userEvent.click(screen.getByRole("menuitem", { name: /Delete customer/ }));
  const dialog = await screen.findByRole("dialog", { name: "Delete Rekha Soni?" });
  expect(dialog).toHaveTextContent("BillsNone in KIRAN GOLD HOUSE");
  expect(dialog).toHaveTextContent("It goes off the customer list and the bill form. The Audit log can bring it back.");
  act(() => { vi.advanceTimersByTime(400); }); // past the dialog's guard against a double tap's second tap
  await userEvent.click(within(dialog).getByRole("button", { name: "Delete customer" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/customers"));
  expect(calls.some((c: Call) => c.method === "DELETE" && c.url === "customers/30/")).toBe(true);
  expect(await screen.findByText("Rekha Soni deleted")).toBeInTheDocument();
});

test("with all firms picked, a customer with no bills is said to have none", async () => {
  localStorage.setItem("gst3.scope.1", "all");
  serve({ "GET customers/30/": { ...ANIL, id: 30, name: "Rekha Soni" }, "GET customers/30/statement/": statement([]), "GET sales/": flags([]) });
  mount(routes, ["/customers/30"]);
  await screen.findByText("No sales bills to Rekha Soni in FY 2026-27");
  await userEvent.click(screen.getByRole("button", { name: "More" }));
  const del = await screen.findByRole("menuitem", { name: /Delete customer/ });
  expect(del).toBeEnabled();
  expect(del).toHaveTextContent(/It has no bills$/);
});

test("Delete waits for the bills: while they load it's off and says so, never that there are none", async () => {
  let billsCome = () => {};
  const held = new Promise<void>((resolve) => { billsCome = resolve; });
  serve({
    "GET customers/30/": { ...ANIL, id: 30, name: "Rekha Soni" }, "GET sales/": flags([]),
    "GET customers/30/statement/": async () => { await held; return { status: 200, data: statement([]) }; },
  });
  mount(routes, ["/customers/30"]);
  await screen.findByText("Customer since 04 Aug 2025 · Udaipur");
  await userEvent.click(screen.getByRole("button", { name: "More" }));
  const del = await screen.findByRole("menuitem", { name: /Delete customer/ });
  expect(del).toBeDisabled();
  expect(del).toHaveTextContent("Waits for the bills to load");
  expect(del).not.toHaveTextContent(/no bills/);
  await act(async () => { billsCome(); });
  await waitFor(() => expect(screen.getByRole("menuitem", { name: /Delete customer/ })).toBeEnabled());
  expect(screen.getByRole("menuitem", { name: /Delete customer/ })).toHaveTextContent("It has no bills in KIRAN GOLD HOUSE");
});

test("a customer with bills can't be deleted, and says how many", async () => {
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": statement(), "GET sales/": flags([]) });
  mount(routes, ["/customers/7"]);
  await screen.findByRole("table");
  await userEvent.click(screen.getByRole("button", { name: "More" }));
  const del = await screen.findByRole("menuitem", { name: /Delete customer/ });
  expect(del).toBeDisabled();
  expect(del).toHaveTextContent("Has 3 bills and 1 cancelled. Merge it into the right customer instead.");
});

test("the server's refusal of a delete (bills in another firm) is said in the dialog", async () => {
  serve({ "GET customers/30/": { ...ANIL, id: 30 }, "GET customers/30/statement/": statement([]), "GET sales/": flags([]), "DELETE customers/30/": () => ({ status: 409, data: { error: "Cannot delete: 2 invoice(s) still reference this record.", protected: 2 } }) });
  mount(routes, ["/customers/30"]);
  await screen.findByText(/No sales bills to/);
  await userEvent.click(screen.getByRole("button", { name: "More" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: /Delete customer/ }));
  const dialog = await screen.findByRole("dialog");
  act(() => { vi.advanceTimersByTime(400); });
  await userEvent.click(within(dialog).getByRole("button", { name: "Delete customer" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Has 2 bills. Merge it into the right customer instead.");
});

test("a view-only person sees the checks and the bills; Edit, Add PAN and New bill are off, with who can", async () => {
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": statement(), "GET sales/": flags([[1, "KGH/2026-27/18", "pan"]]) });
  mount(routes, ["/customers/7"], { me: VIEWER });
  expect(await screen.findByText("PAN needed: 1 bill over ₹2,00,000")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Add PAN" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
  expect(screen.getByText("Only the owner, the accountant and counter staff can change customers. Ask the owner if you need it.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New bill for Anil Gupta" })).toBeDisabled();
  expect(await screen.findByRole("table", { name: "Sales bills to Anil Gupta" })).toBeInTheDocument();
});

test("offline before the customer came, the page says so rather than loading for ever", async () => {
  onlineManager.setOnline(false);
  act(() => __setNetState("offline"));
  try {
    serve({ "GET customers/7/": ANIL });
    mount(routes, ["/customers/7"]);
    expect(await screen.findByText("You're offline")).toBeInTheDocument();
    expect(screen.getByText("This customer can't load without the internet. Nothing you saved is lost; it shows again when you're back online.")).toBeInTheDocument();
  } finally {
    onlineManager.setOnline(true);
    act(() => __setNetState("online"));
  }
});

test("a customer that isn't there says so, with the way back", async () => {
  serve({ "GET customers/99/": () => ({ status: 404, data: { detail: "Not found." } }) });
  mount(routes, ["/customers/99"]);
  expect(await screen.findByRole("heading", { level: 1, name: "This customer isn't on file" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "All customers" })).toHaveAttribute("href", "/customers");
});

test("on a phone: Call, WhatsApp and Statement under the name, and New bill in the bar; counter staff can't delete", async () => {
  (window as unknown as { __phone?: boolean }).__phone = true;
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": statement([]), "GET sales/": flags([]) });
  mount(routes, ["/customers/7"], { me: STAFF });
  const contact = await screen.findByRole("group", { name: "Contact Anil Gupta" });
  expect(within(contact).getByRole("link", { name: "Call" })).toHaveAttribute("href", "tel:+919829041122");
  expect(within(contact).getByRole("link", { name: "Statement" })).toHaveAttribute("href", "/customers/7/statement");
  expect(screen.getByRole("link", { name: "New bill for Anil" })).toHaveAttribute("href", "/sales/new?customer=7");
  // the bills have loaded and there are none, so only the role keeps Delete off, and it says who can
  await screen.findByText("No sales bills in FY 2026-27");
  await userEvent.click(screen.getByRole("button", { name: "More for Anil Gupta" }));
  const more = await screen.findByRole("dialog", { name: "Anil Gupta" });
  const del = within(more).getByRole("menuitem", { name: /Delete customer/ });
  expect(del).toBeDisabled();
  expect(del).toHaveTextContent("Only the owner can delete customers. Ask the owner if you need it.");
  await waitFor(() => expect(more.contains(document.activeElement)).toBe(true));
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await userEvent.click(within(contact).getByRole("button", { name: "WhatsApp" }));
  const sheet = await screen.findByRole("dialog", { name: "WhatsApp Anil Gupta" });
  expect(within(sheet).getByRole("menuitem", { name: /Message Anil/ })).toBeInTheDocument();
  expect(within(sheet).queryByRole("menuitem", { name: /Resend/ })).not.toBeInTheDocument(); // no bill to send again
});

test("on a phone, WhatsApp's Resend names their last bill in the firm picked, and opens it to send it again", async () => {
  (window as unknown as { __phone?: boolean }).__phone = true;
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": statement(), "GET sales/": flags([]) });
  const { router } = mount(routes, ["/customers/7"], { me: STAFF });
  await screen.findByText("KGH/2026/104");
  await userEvent.click(within(screen.getByRole("group", { name: "Contact Anil Gupta" })).getByRole("button", { name: "WhatsApp" }));
  const sheet = await screen.findByRole("dialog", { name: "WhatsApp Anil Gupta" });
  const resend = within(sheet).getByRole("menuitem", { name: /Resend KGH\/2026\/104/ });
  expect(resend).toHaveTextContent("08 Oct · ₹87,083.21 · opens the bill to send it again");
  act(() => { vi.advanceTimersByTime(400); }); // past the sheet's guard against a double tap's second tap
  await userEvent.click(resend);
  await waitFor(() => expect(router.state.location.pathname).toBe("/sales/104"));
});
