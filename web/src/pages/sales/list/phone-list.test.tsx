import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router";
import { refuse, salesServer, wireFacets, wirePage, wireRow, type Call } from "@/core/sales/fixtures";
import { ScopeProvider } from "@/core/scope";
import { renderApp } from "@/test/render";
import SalesList from "../SalesList";

const MEENA = { id: 8, name: "Meena Jain", gst_number: "", mobile_number: "9414126508", type: "person" };
const ROWS = [
  wireRow({ id: 413, invoice_number: "KGH/2026-27/32", counter: 32, customer: MEENA, payment_mode: "credit", taxable: "30636.93", cgst: "459.55", sgst: "459.56", tax: "919.11", total_amount: "31556.04", created_at: "2026-10-08T12:09:00+05:30" }),
  wireRow(),
  wireRow({ id: 405, invoice_number: "KGH/2026-27/30", counter: 30, invoice_date: "2026-10-07", created_at: "2026-10-07T16:20:00+05:30", status: "cancelled", paper: true }),
];
const isFacets = (c: Call) => c.params.facets === 1 && c.params.page_size === 1;
const lists = (calls: Call[]) => calls.filter((c) => c.url === "sales/" && !isFacets(c));
function Where() { const l = useLocation(); return <p data-testid="where">{`${l.pathname}${l.search}`}</p>; }
const mount = (path = "/sales") => renderApp(
  <ScopeProvider><Routes>
    <Route path="/sales" element={<><SalesList /><Where /></>} />
    <Route path="/sales/:id" element={<><p>the bill page</p><Where /></>} />
  </Routes></ScopeProvider>, { path });
/** The card a bill's link sits in. */
const cardOf = (link: HTMLElement) => link.closest<HTMLElement>("[data-card]")!;

beforeEach(() => {
  localStorage.clear();
  (window as unknown as { __phone?: boolean }).__phone = true;
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-10-08T12:30:00+05:30"));
});
afterEach(() => { (window as unknown as { __phone?: boolean }).__phone = false; vi.useRealTimers(); vi.restoreAllMocks(); });

/**
 * From here the clock moves only when the test says (Ruling 1B-10), however busy the machine: the customer search's 250 ms
 * pause, the sheet's 350 ms guard and its 220 ms way out pass when the test says. Testing Library's async helpers wait on
 * timers this clock never runs, so the steps after it are fireEvent and pass() (as the desktop list's tests do).
 */
function handClock() {
  const now = Date.now();
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now });
}
/** The hand clock moves `ms` on; then what that set off reaches the screen (TanStack sends its news on a 0 ms timer). */
async function pass(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

test("a phone opens on this month: the summary, then cards by day; a card opens its bill", async () => {
  const { calls } = salesServer([["GET", "sales/", (c) => (isFacets(c) ? { ...wirePage([]), facets: wireFacets() } : wirePage(ROWS))]]);
  mount();
  expect(await screen.findByRole("heading", { level: 1, name: "Bills" })).toBeInTheDocument();
  expect(await screen.findByText("All firms · October so far, 1 to 8 Oct 2026")).toBeInTheDocument();
  expect(lists(calls)[0].params).toEqual({ month: "2026-10", ordering: "-date", page: 1, page_size: 40 });
  // to the paisa: nothing is rounded to the rupee (Ruling 1B-12)
  expect(screen.getByText("2 sales bills").closest("p")).toHaveTextContent("2 sales bills · ₹1,18,639.25 incl. GST");
  // the cancelled bill named apart, in the desktop summary's words
  expect(screen.getByText("Average bill ₹59,319.63 · 1 cancelled bill not counted")).toBeInTheDocument();
  const today = screen.getByRole("region", { name: "Today, 08 Oct 2026" });
  expect(within(today).getByText("2 bills · ₹1,18,639.25")).toBeInTheDocument();
  expect(within(today).getByRole("link", { name: "Meena Jain, KGH/2026-27/32, ₹31,556.04" })).toHaveTextContent("KGH/2026-27/32 · 12:09 · Udhaar");
  // a cancelled paper bill: no time of day, no Send
  const card = screen.getByRole("link", { name: "Anil Gupta, KGH/2026-27/30, ₹87,083.21, cancelled" });
  expect(card).toHaveTextContent("KGH/2026-27/30 · Cash");
  expect(within(cardOf(card)).queryByRole("button")).not.toBeInTheDocument();
  // its words muted, as the desktop's row has them, never the card faded: faded, its red badge and muted lines fall
  // below AA contrast in both themes (axe)
  expect(cardOf(card)).not.toHaveClass("opacity-70");
  expect(within(card).getByText("Anil Gupta")).toHaveClass("text-muted");
  // the chips run newest first, this month picked
  const chips = within(screen.getByRole("group", { name: "Period" })).getAllByRole("button");
  expect(chips.map((c) => c.textContent?.split(" ")[0])).toEqual(["Today", "Oct", "Sep", "Aug", "Jul", "Jun", "May", "Apr", "FY", "All"]);
  expect(chips[1]).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(within(today).getByRole("link", { name: /^Meena Jain/ }));
  expect(await screen.findByText("the bill page")).toBeInTheDocument();
});

test("the filter sheet picks a customer, how it was paid and the order, and says how many bills it shows", async () => {
  const { calls } = salesServer([
    ["GET", "sales/", (c) => (isFacets(c) ? { ...wirePage([]), facets: wireFacets() } : wirePage(c.params.customer_id === 8 ? [ROWS[0]] : ROWS))],
    ["GET", "customers/", (c) => {
      const results = c.params.search === "meena" ? [{ ...MEENA, city: "Jaipur", state_name: "RAJASTHAN", figures: { bills: 6 } }] : [];
      return { count: results.length, next: null, previous: null, results };
    }],
    ["GET", "customers/8/", () => ({ ...MEENA })],
  ]);
  mount();
  await userEvent.click(await screen.findByRole("button", { name: "Filter" }));
  const sheet = await screen.findByRole("dialog", { name: "Filter bills" });
  handClock();
  await pass(400); // past the sheet's guard against the tap that opened it
  const box = within(sheet).getByRole("searchbox", { name: "Show one customer's bills" });
  fireEvent.change(box, { target: { value: "meenaz" } });
  await pass(250); // typing has paused: the search asks
  expect(within(sheet).getByText("No customer matches “meenaz”.")).toBeInTheDocument();
  // a letter less: that answer was for "meenaz", so nothing is said of "meena" until it has been searched for
  fireEvent.change(box, { target: { value: "meena" } });
  expect(within(sheet).queryByText(/No customer matches/)).not.toBeInTheDocument();
  await pass(250);
  fireEvent.click(within(sheet).getByRole("button", { name: /^Meena Jain/ }));
  await pass(0);
  // the period stays as picked (this month, a phone's first view): the customer narrows it
  expect(lists(calls).at(-1)?.params).toMatchObject({ customer_id: 8, month: "2026-10" });
  expect(within(sheet).getByRole("button", { name: "Remove Meena Jain" })).toBeInTheDocument();
  fireEvent.change(within(sheet).getByRole("combobox", { name: "Paid by" }), { target: { value: "credit" } });
  fireEvent.click(within(sheet).getByRole("button", { name: "Biggest" }));
  await pass(0);
  expect(lists(calls).at(-1)?.params).toMatchObject({ customer_id: 8, payment_mode: "credit", ordering: "-total" });
  fireEvent.click(within(sheet).getByRole("button", { name: "Show 1 bill" }));
  await pass(220); // the sheet's way out
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Filter, 2 on" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Meena Jain. Remove" })).toBeInTheDocument();
  expect(screen.getByTestId("where")).toHaveTextContent("customer=8");
});

test("a card's Send waits for the shop's message and sends once on a double tap; a paper bill says On paper, with no Send to nag", async () => {
  vi.spyOn(window, "open").mockImplementation(() => null);
  const PAPER = wireRow({ id: 406, invoice_number: "KGH/2026-27/29", counter: 29, customer: MEENA, paper: true });
  let settingsIn: (s: unknown) => void = () => {};
  const { calls } = salesServer([
    ["GET", "sales/", (c) => (isFacets(c) ? { ...wirePage([]), facets: wireFacets() } : wirePage([ROWS[1], PAPER, ROWS[2]]))],
    ["GET", "shop-settings/", () => new Promise((r) => { settingsIn = r; })],
    ["POST", "sales/412/sent/", () => ({ id: 412, sent: { at: "2026-10-08T12:31:00+05:30", last_at: "2026-10-08T12:31:00+05:30", count: 1, via: "whatsapp", to: "" } })],
  ]);
  mount();
  const anil = cardOf(await screen.findByRole("link", { name: "Anil Gupta, KGH/2026-27/31, ₹87,083.21" }));
  const send = within(anil).getByRole("button", { name: "Send KGH/2026-27/31 on WhatsApp" });
  expect(send).toBeDisabled(); // until the shop's own message is in
  const paper = cardOf(screen.getByRole("link", { name: "Meena Jain, KGH/2026-27/29, ₹87,083.21" }));
  expect(within(paper).getByText("On paper")).toBeInTheDocument();
  expect(within(paper).queryByRole("button")).not.toBeInTheDocument();
  settingsIn({ copies: "original", show_bank: true, share_message: "", updated_at: null, updated_by: null });
  await waitFor(() => expect(send).toBeEnabled());
  await userEvent.dblClick(send);
  expect(window.open).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("KGH/2026-27/31 sent")).toBeInTheDocument();
  expect(calls.filter((c) => c.url === "sales/412/sent/")).toHaveLength(1);
});

test("while the bills can't load, only the picked period shows and the filters are off; Try again asks again for everything", async () => {
  let down = true;
  const { calls } = salesServer([["GET", "sales/", (c) => (isFacets(c) ? { ...wirePage([]), facets: wireFacets() } : down ? refuse(500, {}) : wirePage(ROWS))]]);
  mount();
  expect(await screen.findByText("Couldn't load sales bills")).toBeInTheDocument();
  // the period chips come from the year's facets, which did load: the one picked stays in sight, alone, as nothing can change it
  await waitFor(() => expect(within(screen.getByRole("group", { name: "Period" })).getAllByRole("button").map((c) => c.getAttribute("aria-label"))).toEqual(["October 2026: 4 bills, 1 to 8 Oct"]));
  expect(screen.getByRole("searchbox", { name: "Search sales bills" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Filter" })).toBeDisabled();
  down = false;
  const before = calls.length;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("region", { name: "Today, 08 Oct 2026" })).toBeInTheDocument();
  // Try again asks again for everything the page shows: the bills, and the period chips and views (Ruling 1B-11)
  const again = calls.slice(before);
  expect(lists(again)).toHaveLength(1);
  expect(again.filter(isFacets)).toHaveLength(1);
  expect(within(screen.getByRole("group", { name: "Period" })).getAllByRole("button")).toHaveLength(10);
  expect(screen.getByRole("button", { name: "Filter" })).toBeEnabled();
});

/* ── 1B Task 9, commit A ── */

test("a screen reader hears a card's status with it: the link's name stays the customer, number and total, and its badges describe it (Ruling 1B-17)", async () => {
  salesServer([["GET", "sales/", (c) => (isFacets(c) ? { ...wirePage([]), facets: wireFacets() } : wirePage(ROWS))]]);
  mount();
  const udhaar = await screen.findByRole("link", { name: "Meena Jain, KGH/2026-27/32, ₹31,556.04" });
  expect(udhaar).toHaveAccessibleDescription("Udhaar");
  expect(screen.getByRole("link", { name: "Anil Gupta, KGH/2026-27/30, ₹87,083.21, cancelled" })).toHaveAccessibleDescription("Cancelled");
  // a bill with nothing to say has no description
  expect(screen.getByRole("link", { name: "Anil Gupta, KGH/2026-27/31, ₹87,083.21" })).toHaveAccessibleDescription("");
});
