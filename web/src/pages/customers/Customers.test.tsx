import { StrictMode } from "react";
import { act, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onlineManager } from "@tanstack/react-query";
import { __setNetState } from "@/core/api/network";
import Customers from "./Customers";
import { customersCsv } from "./exportCsv";
import { markSaved, useJustSaved } from "./lib";
import { ANIL, FIRMS, mount, serve, VIEWER, type Call } from "./testing";

const routes = [
  { path: "/customers", element: <Customers /> },
  { path: "/customers/new", element: <p>the form</p> },
  { path: "/customers/:id", element: <p>the customer page</p> },
  { path: "/customers/:id/statement", element: <p>the statement</p> },
  { path: "/sales/:id", element: <p>the bill</p> },
  { path: "/sales/new", element: <p>the bill form</p> },
];
const FIG = { bills: 14, total: "87083.21", cancelled: 1, udhaar_bills: 2, udhaar_total: "12000.00", last_bill: { id: 412, invoice_number: "KGH/2026-27/31", invoice_date: "2026-10-08", total_amount: "87083.21", business: 3 } };
const ROWS = [
  { ...ANIL, figures: FIG },
  { ...ANIL, id: 9, name: "Kulkarni Jewellers", gst_number: "27XTZPS7585P1ZB", state_name: "MAHARASHTRA", type: "business", mobile_number: "", figures: { ...FIG, bills: 0, total: "0.00", udhaar_bills: 0, udhaar_total: "0.00", last_bill: null } },
  { ...ANIL, id: 1, name: "Walk-in Customer", customer_type: "walkin", type: "walkin", mobile_number: "", figures: { ...FIG, udhaar_bills: 0 } },
];
const SUMMARY = { customers: 3, bills: 28, total: "174166.42", cancelled: 1, udhaar_bills: 2, udhaar_total: "12000.00" };
/** customers/: the count on its own (page_size 1), else the list's page `page` of `count` (ids moved on by 100 a page). */
function list(count = 3, rows: typeof ROWS = ROWS) {
  return (c: Call) => {
    const page = Number(c.params.page ?? 1);
    return c.params.page_size === 1 ? { status: 200, data: { count: 29, next: null, results: [] } }
      : { status: 200, data: { count, next: page * 20 < count ? "more" : null, results: rows.map((r) => ({ ...r, id: r.id + 100 * (page - 1) })), summary: { ...SUMMARY, customers: count } } };
  };
}
const searches = (calls: Call[]) => calls.filter((c) => c.params.search).map((c) => c.params.search);

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

/**
 * For a test that waits on the list's own timer (the 250 ms pause before a search asks): from here the clock moves only
 * when the test says, however long the typing takes on a busy machine. Testing Library's async helpers (userEvent,
 * findBy, waitFor) wait on a 0 ms timer that this clock never runs, so the steps after it are synchronous.
 */
function handClock() {
  const now = Date.now();
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now });
}
/** Types `text` a key at a time with no time between the keys: each key a change of its own, as a quick typist's are. */
function typeQuickly(box: HTMLElement, text: string) {
  for (let i = 1; i <= text.length; i++) fireEvent.change(box, { target: { value: text.slice(0, i) } });
}
/** The hand clock moves `ms` on; then what that set off reaches the screen (TanStack sends its news on a 0 ms timer). */
async function pass(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}
/** Catches what Export hands the browser: the files it makes, and the click that would download each. */
function catchDownloads() {
  const files: Blob[] = [];
  Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => { files.push(b); return "blob:x"; }), revokeObjectURL: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  return { files, click };
}
const textOf = (b: Blob) => new Promise<string>((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsText(b); });

test("the list names its period and firm, and each row its sales, bills, last bill and udhaar; the summary counts the matches", async () => {
  const calls = serve({ "GET customers/": list() });
  mount(routes, ["/customers"]);
  expect(await screen.findByText("29 customers · sales figures for FY 2026-27 (1 Apr to 8 Oct 2026), KIRAN GOLD HOUSE")).toBeInTheDocument();
  const table = screen.getByRole("table", { name: "Customers" });
  const anil = within(table).getByText("Anil Gupta").closest("tr")!;
  expect(anil).toHaveTextContent("98290 41122");
  expect(anil).toHaveTextContent("₹87,083.21");
  expect(anil).toHaveTextContent("08 Oct 2026KGH/2026-27/31");
  expect(anil).toHaveTextContent("₹12,000.002 bills");
  expect(anil).not.toHaveTextContent("IGST");
  const kulkarni = within(table).getByText("Kulkarni Jewellers").closest("tr")!;
  expect(kulkarni).toHaveTextContent("No bills");
  expect(kulkarni).toHaveTextContent("No bills yet");
  expect(kulkarni).toHaveTextContent("Maharashtra · IGST on bills");
  expect(within(table).getByText("Cash sales without a name")).toBeInTheDocument();
  expect(screen.getByText("3 of 29 customers match")).toBeInTheDocument();
  // (the cancelled-bills words are Selling's own, @/core/sales/words: Ruling 1C-8)
  expect(screen.getByText(/Their sales · FY 2026-27 · KIRAN GOLD HOUSE:/)).toHaveTextContent("₹1,74,166.42 in 28 bills · 1 cancelled bill not counted · billed on udhaar: 2 bills, ₹12,000.00");
  expect(calls.find((c) => c.params.figures === 1)!.params).toMatchObject({ figures_business_id: 3, start_date: "2026-04-01", end_date: "2026-10-08", ordering: "-last_bill", page: 1, page_size: 20 });
});

test("a customer in the firm's own state isn't marked IGST, however the state was written", async () => {
  serve({ "GET customers/": list(1, [{ ...ANIL, state_name: "Rajasthan", figures: FIG }]) });
  mount(routes, ["/customers"]);
  const anil = (await screen.findByText("Anil Gupta")).closest("tr")!;
  expect(anil).toHaveTextContent("Rajasthan");
  expect(anil).not.toHaveTextContent("IGST");
});

test("search asks once typing pauses, a phone typed in groups as its digits; with no match it offers to add them", async () => {
  const calls = serve({ "GET customers/": (c: Call) => (c.params.search ? { status: 200, data: { count: 0, next: null, results: [], summary: { ...SUMMARY, customers: 0, bills: 0, total: "0.00" } } } : list()(c)) });
  mount(routes, ["/customers"]);
  await screen.findByText("3 of 29 customers match");
  const box = screen.getByRole("searchbox", { name: "Search customers (press /)" });
  handClock();
  typeQuickly(box, "98290 41122");
  // nothing is asked while the number is being typed, nor before the pause is over
  await pass(249);
  expect(searches(calls)).toEqual([]);
  // and the rows on screen aren't said to match it before it's asked
  expect(screen.queryByText(/matching “/)).not.toBeInTheDocument();
  await pass(1);
  expect(searches(calls)).toEqual(["9829041122"]);
  expect(screen.getByText("No customer matches “98290 41122”")).toBeInTheDocument();
  expect(screen.getByText(/· matching “98290 41122”/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Add “98290 41122” as a customer" })).toHaveAttribute("href", "/customers/new?from=list&phone=98290%2041122");
  fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
  // until the list comes back the answer on screen is still the search's: it never reads as a shop with no customers
  expect(screen.queryByText("No customers yet")).not.toBeInTheDocument();
  expect(screen.getByText("No customer matches “98290 41122”")).toBeInTheDocument();
  await pass(250);
  expect(screen.getByText("Anil Gupta")).toBeInTheDocument();
  expect(searches(calls)).toEqual(["9829041122"]);
});

test("a search that can't get through keeps the search box and what was typed, says so with Try again, and clearing it brings the list back", async () => {
  const calls = serve({ "GET customers/": (c: Call) => (c.params.search ? { status: 503 } : list()(c)) });
  mount(routes, ["/customers"]);
  await screen.findByText("3 of 29 customers match");
  const box = screen.getByRole("searchbox", { name: "Search customers (press /)" });
  act(() => box.focus());
  handClock();
  typeQuickly(box, "Kul");
  await pass(250);
  expect(screen.getByText("Couldn't load customers")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  // the toolbar is the same one, so the box keeps what was typed and its focus, and the filters stay too
  expect(screen.getByRole("searchbox", { name: "Search customers (press /)" })).toBe(box);
  expect(box).toHaveValue("Kul");
  expect(box).toHaveFocus();
  expect(screen.getByRole("radio", { name: "No GSTIN" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  await pass(250);
  expect(screen.getByText("Anil Gupta")).toBeInTheDocument();
  expect(screen.queryByText("Couldn't load customers")).not.toBeInTheDocument();
  expect(searches(calls)).toEqual(["Kul"]);
});

test("filters go to the server and are named in the summary, with Clear", async () => {
  const calls = serve({ "GET customers/": list() });
  mount(routes, ["/customers"]);
  await userEvent.click(await screen.findByRole("radio", { name: "No GSTIN" }));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "State" }), "RAJASTHAN");
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Usually billed by" }), "4");
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "sales");
  await waitFor(() => expect(calls.at(-1)!.params).toMatchObject({ has_gstin: 0, state_name: "RAJASTHAN", business_id: 4, ordering: "-sales" }));
  expect(screen.getByText(/No GSTIN, Rajasthan, Usually billed by Meera/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Clear" }));
  await waitFor(() => expect(calls.at(-1)!.params.has_gstin).toBeUndefined());
});

test("clearing filters that matched no one never reads as a shop with no customers while the list comes back", async () => {
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  serve({
    "GET customers/": async (c: Call) => {
      if (c.params.has_gstin === 0) return { status: 200, data: { count: 0, next: null, results: [], summary: { ...SUMMARY, customers: 0, bills: 0, total: "0.00" } } };
      // the list in an order not asked for before: its answer takes a moment
      if (c.params.ordering === "name") await held;
      return list()(c);
    },
  });
  mount(routes, ["/customers"]);
  await userEvent.click(await screen.findByRole("radio", { name: "No GSTIN" }));
  expect(await screen.findByText("No customers match these filters")).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "name");
  await userEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
  expect(screen.queryByText("No customers yet")).not.toBeInTheDocument();
  await act(async () => { release(); });
  expect(await screen.findByText("Anil Gupta")).toBeInTheDocument();
});

test("20 at a time: Show more asks for the next page", async () => {
  const calls = serve({ "GET customers/": list(21) });
  mount(routes, ["/customers"]);
  expect(await screen.findByText("Showing 3 of 21 customers")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Show 18 more" }));
  await waitFor(() => expect(calls.filter((c) => c.params.figures === 1).map((c) => c.params.page)).toEqual([1, 2]));
});

test("a Show more that fails says so where it was pressed, and Try again asks for that page again; the rows and the header stay", async () => {
  let fails = 1;
  const calls = serve({ "GET customers/": (c: Call) => (Number(c.params.page) === 2 && fails-- > 0 ? { status: 503 } : list(21)(c)) });
  mount(routes, ["/customers"]);
  await userEvent.click(await screen.findByRole("button", { name: "Show 18 more" }));
  expect(await screen.findByText("The next 18 didn't load: the app couldn't get through.")).toBeInTheDocument();
  // it isn't a failed refresh: the rows on screen are as they were
  expect(screen.queryByText("Couldn't refresh customers")).not.toBeInTheDocument();
  expect(screen.getByText("Anil Gupta")).toBeInTheDocument();
  expect(screen.getByText(/^29 customers · sales figures for FY 2026-27/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Export 21 customers" })).toBeEnabled();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.getAllByText("Anil Gupta")).toHaveLength(2));
  expect(calls.filter((c) => c.params.figures === 1).map((c) => c.params.page)).toEqual([1, 2, 2]);
  expect(screen.queryByText(/didn't load/)).not.toBeInTheDocument();
});

test("a refresh that fails keeps the rows where they are, focus included, and says why with Try again", async () => {
  let failing = false;
  serve({ "GET customers/": (c: Call) => (failing && c.params.figures === 1 ? { status: 503 } : list()(c)) });
  mount(routes, ["/customers"]);
  await screen.findByText("3 of 29 customers match");
  const table = screen.getByRole("table", { name: "Customers" });
  const anil = within(table).getByRole("link", { name: "Anil Gupta" });
  act(() => anil.focus());
  // back from a dropped connection, TanStack asks for the list again, and this time the server can't answer
  failing = true;
  act(() => { onlineManager.setOnline(false); });
  act(() => { onlineManager.setOnline(true); });
  expect(await screen.findByText("Couldn't refresh customers")).toBeInTheDocument();
  expect(screen.getByRole("table", { name: "Customers" })).toBe(table);
  expect(anil).toHaveFocus();
  failing = false;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByText("Couldn't refresh customers")).not.toBeInTheDocument());
  expect(screen.getByRole("table", { name: "Customers" })).toBe(table);
});

test("a customer who comes again on the next page shows once, and Show more goes once there's no next page", async () => {
  const kulkarni = ROWS[1];
  serve({
    "GET customers/": (c: Call) => (c.params.page_size === 1 ? list()(c)
      : Number(c.params.page) === 2 ? { status: 200, data: { count: 21, next: null, results: [kulkarni, { ...ANIL, id: 30, name: "Rekha Soni", figures: FIG }], summary: SUMMARY } }
        : list(21)(c)),
  });
  mount(routes, ["/customers"]);
  await userEvent.click(await screen.findByRole("button", { name: "Show 18 more" }));
  expect(await screen.findByText("Rekha Soni")).toBeInTheDocument();
  expect(screen.getAllByText("Kulkarni Jewellers")).toHaveLength(1);
  // 4 shown of the 21 the first page counted, but the server has no next page: nothing to show more of
  expect(screen.queryByRole("button", { name: /^Show \d+ more$/ })).not.toBeInTheDocument();
});

test("when the list of firms can't load, the figures never say “All firms” for one firm's money, and Export waits", async () => {
  localStorage.setItem("gst3.scope.1", "3");
  serve({ "GET businesses/": () => ({ status: 503 }), "GET customers/": list() });
  mount(routes, ["/customers"]);
  expect(await screen.findByText("29 customers · sales figures for FY 2026-27 (1 Apr to 8 Oct 2026), the firm picked")).toBeInTheDocument();
  expect(screen.getByText(/Their sales · FY 2026-27 · the firm picked:/)).toBeInTheDocument();
  expect(screen.queryByText(/All firms/)).not.toBeInTheDocument();
  const exp = screen.getByRole("button", { name: "Export 3 customers" });
  expect(exp).toBeDisabled();
  expect(exp).toHaveAttribute("title", "The firms didn't load. Reload the page to export.");
});

test("a row that has focus opens with Enter; Enter on a control inside it is that control's", async () => {
  const { router } = (serve({ "GET customers/": list() }), mount(routes, ["/customers"]));
  const row = (await screen.findByText("Anil Gupta")).closest("tr")!;
  fireEvent.keyDown(within(row).getByLabelText("Actions for Anil Gupta"), { key: "Enter" });
  expect(router.state.location.pathname).toBe("/customers");
  act(() => row.focus());
  fireEvent.keyDown(row, { key: "Enter" });
  await waitFor(() => expect(router.state.location.pathname).toBe("/customers/7"));
});

test("on a phone a row shows its focus, and opens with Enter", async () => {
  (window as unknown as { __phone?: boolean }).__phone = true;
  const { router } = (serve({ "GET customers/": list() }), mount(routes, ["/customers"]));
  const row = (await screen.findByText("Anil Gupta")).closest<HTMLElement>("[data-row]")!;
  expect(row).toHaveClass("row-focus");
  act(() => row.focus());
  fireEvent.keyDown(row, { key: "Enter" });
  await waitFor(() => expect(router.state.location.pathname).toBe("/customers/7"));
});

test("a shop with no customers yet is told so, with Add customer", async () => {
  serve({ "GET customers/": { count: 0, next: null, results: [], summary: { ...SUMMARY, customers: 0, bills: 0, total: "0.00", cancelled: 0, udhaar_bills: 0, udhaar_total: "0.00" } } });
  mount(routes, ["/customers"]);
  expect(await screen.findByText("No customers yet")).toBeInTheDocument();
  expect(screen.getByText("Everyone you bill lists here. A name and phone are enough to start.")).toBeInTheDocument();
  const add = screen.getAllByRole("link", { name: "Add customer" });
  expect(add).toHaveLength(2);
  add.forEach((a) => expect(a).toHaveAttribute("href", "/customers/new?from=list"));
});

test("the figures wait for the firm's name, so they never show under another one", async () => {
  // the person picked Kiran on this device, so the firm is known before the list of firms comes
  localStorage.setItem("gst3.scope.1", "3");
  let firmsCome = () => {};
  const held = new Promise<void>((resolve) => { firmsCome = resolve; });
  const calls = serve({ "GET businesses/": async () => { await held; return { status: 200, data: { results: FIRMS } }; }, "GET customers/": list() });
  mount(routes, ["/customers"]);
  // the count, which doesn't wait for anything, has gone; the figures haven't
  await waitFor(() => expect(calls.some((c) => c.params.page_size === 1)).toBe(true));
  expect(calls.some((c) => c.params.figures === 1)).toBe(false);
  expect(screen.queryByText(/All firms/)).not.toBeInTheDocument();
  await act(async () => { firmsCome(); });
  expect(await screen.findByText(/Their sales · FY 2026-27 · KIRAN GOLD HOUSE:/)).toBeInTheDocument();
  expect(calls.find((c) => c.params.figures === 1)!.params.figures_business_id).toBe(3);
});

test("a customer just added comes first and flashes, though the order puts them further down", async () => {
  markSaved("customer", 30);
  serve({ "GET customers/": list(), "GET customers/30/": { ...ANIL, id: 30, name: "Rekha Soni", mobile_number: "9876543210" } });
  mount(routes, ["/customers"]);
  const first = await screen.findByText("Rekha Soni");
  const row = first.closest("tr")!;
  expect(row).toHaveClass("anim-flash");
  expect(row).toHaveTextContent("No bills yet");
  expect(screen.getAllByRole("row")[1]).toBe(row);
});

test("a saved customer is read once per visit, React's StrictMode double render included", () => {
  markSaved("customer", 77);
  expect(renderHook(() => useJustSaved("customer"), { wrapper: StrictMode }).result.current).toBe(77);
  expect(renderHook(() => useJustSaved("customer")).result.current).toBeNull();
});

test("each row's ⋯: Resend opens the last bill, Message, New bill and Statement", async () => {
  const { router } = (serve({ "GET customers/": list() }), mount(routes, ["/customers"]));
  await userEvent.click(await screen.findByRole("button", { name: "Actions for Anil Gupta" }));
  expect(await screen.findByRole("menuitem", { name: /Resend KGH\/2026-27\/31/ })).toHaveTextContent("08 Oct · ₹87,083.21 · opens the bill to send it again");
  expect(screen.getByRole("menuitem", { name: /Message Anil/ })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: /New bill for Anil/ })).toBeEnabled();
  const chat = { opener: {} as unknown };
  const open = vi.spyOn(window, "open").mockReturnValue(chat as Window);
  try {
    await userEvent.click(screen.getByRole("menuitem", { name: /Message Anil/ }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://wa.me/919829041122", "_blank"));
    expect(chat.opener).toBeNull();
  } finally {
    open.mockRestore();
  }
  // (by label and text from here: role queries over the whole page are slow in jsdom)
  for (const [item, to] of [["Resend KGH/2026-27/31", "/sales/412"], ["New bill for Anil", "/sales/new?customer=7"], ["Statement", "/customers/7/statement"]] as const) {
    await userEvent.click(await screen.findByLabelText("Actions for Anil Gupta"));
    await userEvent.click(await screen.findByText(item));
    await waitFor(() => expect(router.state.location.pathname + router.state.location.search).toBe(to));
    await act(async () => { await router.navigate(-1); });
  }
});

test("a view-only person's ⋯: Resend and New bill are off, each saying who can; Message and Statement stay", async () => {
  serve({ "GET customers/": list() });
  mount(routes, ["/customers"], { me: VIEWER });
  await userEvent.click(await screen.findByLabelText("Actions for Anil Gupta"));
  const resend = await screen.findByRole("menuitem", { name: /Resend KGH\/2026-27\/31/ });
  expect(resend).toBeDisabled();
  expect(resend).toHaveTextContent("Only the owner and counter staff can send bills. Ask the owner if you need it.");
  const newBill = screen.getByRole("menuitem", { name: /New bill for Anil/ });
  expect(newBill).toBeDisabled();
  expect(newBill).toHaveTextContent("Only the owner and counter staff can make bills. Ask the owner if you need it.");
  expect(screen.getByRole("menuitem", { name: /Message Anil/ })).toBeEnabled();
  expect(screen.getByRole("menuitem", { name: /Statement/ })).toBeEnabled();
});

test("Call and WhatsApp only for an Indian mobile number: none for no number or a landline", async () => {
  serve({ "GET customers/": list(2, [{ ...ANIL, mobile_number: "", figures: FIG }, { ...ANIL, id: 9, name: "Kulkarni Jewellers", mobile_number: "0294 241 2345", figures: FIG }]) });
  mount(routes, ["/customers"]);
  for (const name of ["Anil Gupta", "Kulkarni Jewellers"]) {
    await userEvent.click(await screen.findByLabelText(`Actions for ${name}`));
    expect(await screen.findByRole("menuitem", { name: /Statement/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Message|Resend/ })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  }
});

test("offline before the list came, it says so, with no count and nothing to export", async () => {
  // as after the browser's "offline" event: TanStack holds the request, and the app knows it's offline
  onlineManager.setOnline(false);
  act(() => __setNetState("offline"));
  try {
    serve({ "GET customers/": list() });
    mount(routes, ["/customers"]);
    expect(await screen.findByText("You're offline")).toBeInTheDocument();
    expect(screen.getByText("Waiting for the internet")).toBeInTheDocument();
    expect(screen.queryByText(/29 customers/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  } finally {
    onlineManager.setOnline(true);
    act(() => __setNetState("online"));
  }
});

test("offline, a new search keeps the rows already showing, says they're from before, and asks once the internet is back", async () => {
  const calls = serve({ "GET customers/": list() });
  mount(routes, ["/customers"]);
  await screen.findByText("3 of 29 customers match");
  const box = screen.getByRole("searchbox", { name: "Search customers (press /)" });
  handClock();
  onlineManager.setOnline(false);
  act(() => __setNetState("offline"));
  try {
    typeQuickly(box, "Kul");
    await pass(250);
    expect(screen.getByText("Couldn't refresh customers")).toBeInTheDocument();
    expect(screen.getByText("You're offline, so this is what was last loaded. It refreshes when you're back online.")).toBeInTheDocument();
    expect(screen.getByText("Anil Gupta")).toBeInTheDocument();
    expect(box).toHaveValue("Kul");
  } finally {
    onlineManager.setOnline(true);
    act(() => __setNetState("online"));
  }
  await pass(0);
  expect(searches(calls)).toEqual(["Kul"]);
  expect(screen.queryByText("Couldn't refresh customers")).not.toBeInTheDocument();
});

test("a view-only person can look and export; adding is off, with who can", async () => {
  serve({ "GET customers/": list() });
  mount(routes, ["/customers"], { me: VIEWER });
  expect(await screen.findByText("Only the owner, the accountant and counter staff can add or change customers. Ask the owner if you need it.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add customer" })).toBeDisabled();
  expect(await screen.findByRole("button", { name: "Export 3 customers" })).toBeEnabled();
  expect(screen.queryByRole("link", { name: "Import" })).not.toBeInTheDocument();
});

test("Export downloads every customer the filters match, as CSV, and says what's in it", async () => {
  const { files, click } = catchDownloads();
  try {
    const calls = serve({ "GET customers/": list() });
    mount(routes, ["/customers"]);
    await userEvent.click(await screen.findByRole("button", { name: "Export 3 customers" }));
    expect(await screen.findByText("Downloaded Customers_2026-10-08.csv")).toBeInTheDocument();
    expect(screen.getByText("3 customers · name, phone, GSTIN, state, address, firms, and sales for FY 2026-27, KIRAN GOLD HOUSE.")).toBeInTheDocument();
    expect(calls.find((c) => c.params.page_size === 1000)!.params).toMatchObject({ figures: 1, figures_business_id: 3, page: 1 });
    expect(click).toHaveBeenCalledTimes(1);
    expect(files[0].type).toBe("text/csv;charset=utf-8");
    // the file names the firm its figures are for, as the list does
    expect((await textOf(files[0])).split("\r\n")[0]).toContain(",Sales FY 2026-27 · KIRAN GOLD HOUSE (₹),");
  } finally {
    click.mockRestore();
  }
});

test("an export that can't get through says so, and downloads nothing", async () => {
  const { click } = catchDownloads();
  try {
    serve({ "GET customers/": (c: Call) => (c.params.page_size === 1000 ? { status: 0 } : list()(c)) });
    mount(routes, ["/customers"]);
    await userEvent.click(await screen.findByRole("button", { name: "Export 3 customers" }));
    expect(await screen.findByText("Not exported: the app couldn't get through")).toBeInTheDocument();
    expect(screen.getByText("The file didn't download. Try again in a minute.")).toBeInTheDocument();
    expect(click).not.toHaveBeenCalled();
  } finally {
    click.mockRestore();
  }
});

test("the CSV holds what the list shows, quoted where it must be", () => {
  const csv = customersCsv([{ ...ANIL, name: "Gupta, Anil", type: "person", customer_type: "", businesses: [3, 4], pan: "", figures: { bills: 14, total: 8708321, cancelled: 1, udhaar_bills: 2, udhaar_total: 1200000, last_bill: { id: 412, invoice_number: "KGH/2026-27/31", invoice_date: "2026-10-08", total_amount: 8708321, business: 3 } } }],
    FIRMS.map((f) => ({ id: f.id, name: f.name, short: f.name.split(" ")[0], gstin: f.gst_number, state: f.state_name })), "FY 2026-27");
  expect(csv.startsWith("\ufeff")).toBe(true);
  const [head, row] = csv.slice(1).split("\r\n");
  expect(head).toBe("Name,Mobile,Email,GSTIN,PAN,Type,Address,City,State,Usual firms,Sales FY 2026-27 (₹),Bills,Billed on udhaar (₹),Udhaar bills,Last bill,Last bill date");
  expect(row).toBe('"Gupta, Anil",9829041122,,,,Person,15 Demo Road,Udaipur,Rajasthan,KIRAN GOLD HOUSE; MEERA ORNAMENTS,87083.21,14,12000.00,2,KGH/2026-27/31,2026-10-08');
});

test("a cell that starts like a formula gets a ' in front, so a spreadsheet shows it and never runs it", () => {
  const csv = customersCsv([{
    ...ANIL, name: '=HYPERLINK("http://x.example","Anil")', mobile_number: "+91 98290 41122", email: "@anil", gst_number: "\r=1+1", address: "-2 Demo Road", city: "\tUdaipur", type: "person", customer_type: "", businesses: [], pan: "",
    figures: { bills: 1, total: 100, cancelled: 0, udhaar_bills: 0, udhaar_total: 0, last_bill: { id: 5, invoice_number: "=1+1", invoice_date: "2026-10-08", total_amount: 100, business: 3 } },
  }], [], "FY 2026-27");
  const row = csv.slice(1).split("\r\n")[1];
  // (a carriage return first: a ' in front, then quoted, as it holds a line break)
  expect(row).toBe(`"'=HYPERLINK(""http://x.example"",""Anil"")",'+91 98290 41122,'@anil,"'\r=1+1",,Person,'-2 Demo Road,'\tUdaipur,Rajasthan,,1.00,1,0.00,0,'=1+1,2026-10-08`);
});

test("on a phone: firm chips, a Filters sheet whose picks show as chips, and Add customer in the bar", async () => {
  (window as unknown as { __phone?: boolean }).__phone = true;
  const calls = serve({ "GET customers/": list() });
  mount(routes, ["/customers"]);
  expect(await screen.findByRole("radio", { name: "Kiran" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("link", { name: "Add customer" })).toHaveAttribute("href", "/customers/new?from=list");
  await userEvent.click(screen.getByRole("button", { name: "Filters" }));
  const sheet = await screen.findByRole("dialog", { name: "Filter customers" });
  act(() => { vi.advanceTimersByTime(400); }); // past the sheet's guard against a double tap's second tap
  await userEvent.click(within(sheet).getByRole("radio", { name: "No GSTIN" }));
  await waitFor(() => expect(calls.at(-1)!.params.has_gstin).toBe(0));
  await userEvent.click(within(sheet).getByRole("button", { name: "Show 3 customers" }));
  expect(await screen.findByRole("button", { name: "Remove filter: No GSTIN" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("radio", { name: "All firms" }));
  await waitFor(() => expect(calls.at(-1)!.params.figures_business_id).toBeUndefined());
});
