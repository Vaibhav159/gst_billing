import { act, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { refuse } from "@/core/sales/fixtures";
import { markFresh } from "@/core/sales/fresh";
import { ACCOUNTANT, fakeToday, formServer, mountForm, SavedElsewhere, wireBook } from "../form/testing";
import { rememberPaperDate } from "../form/paperDates";
import PaperBookPage from "./PaperBook";

// whole flows through the form, a step at a time: a busy runner takes longer than vitest's 5 s for one
vi.setConfig({ testTimeout: 20_000 });

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); (window as unknown as { __phone?: boolean }).__phone = false; });

const where = (router: { state: { location: { pathname: string; search: string } } }) => router.state.location.pathname + router.state.location.search;
const row = (id: number, counter: number, day: string, customer: string, total: string, over: Record<string, unknown> = {}) =>
  ({ id, invoice_number: `KGH/2026-27/${counter}`, counter, invoice_date: day, customer_name: customer, total_amount: total, status: "active", paper: true, sent: false, ...over });
/** KIRAN's September: 17 to 20 and 24 entered, 19 cancelled, 20 on two bills, 21 deleted, 22 and 23 not entered yet. */
const SEPTEMBER = wireBook({
  bills: [
    row(380, 17, "2026-09-02", "Hemant Dave", "45210.00"),
    row(381, 18, "2026-09-03", "Anil Gupta", "87083.21", { paper: false, sent: true }),
    row(205, 19, "2026-09-04", "Suresh Jain", "12000.00", { status: "cancelled" }),
    row(382, 20, "2026-09-05", "Lalit Jain", "30500.00"),
    row(383, 20, "2026-09-05", "Ramesh Patel", "9150.00", { paper: false }),
    row(384, 24, "2026-09-29", "Hemant Dave", "61250.50"),
  ],
  entered: 6, runs: [[17, 20], [24, 24]], missing: [22, 23], missing_count: 2, twice: [20], after: [], after_months: [],
  explained: [
    { counter: 19, kind: "cancelled", id: 205, invoice_number: "KGH/2026-27/19", reason: "Customer returned the piece the same day" },
    { counter: 21, kind: "deleted", bin_id: 4, invoice_number: "KGH/2026-27/21", reason: "Entered twice by mistake", deleted_at: "2026-10-03T18:40:00+05:30" },
  ],
  next: { counter: 22, invoice_number: "KGH/2026-27/22", invoice_date: "2026-09-05" },
});
/** The paper book in the app's routes, with the real form beside it (mountForm's stand-in for /sales/paper comes after it). */
const mountBook = (path: string, opts: Parameters<typeof mountForm>[1] = {}) => mountForm(path, { ...opts, routes: [{ path: "/sales/paper", element: <PaperBookPage /> }, ...(opts.routes ?? [])] });
/** Enter bill's reason while the book asks again, worded as the app's other waits are ("Getting the shop's WhatsApp message"). */
const GETTING = "Getting the paper book's next number";
/** Its reason once that refresh has failed: the stale note's Try again brings the number. */
const TRY_AGAIN = "Try again to get the paper book's next number.";

test("last month's run for the firm: what's entered, why numbers are missing, what's not entered yet, GSTR-1, and each bill's state in words", async () => {
  fakeToday();
  formServer([["GET", "sales/paper-book/", () => SEPTEMBER]]);
  markFresh(384);
  const { router } = mountBook("/sales/paper");
  expect(await screen.findByText("6 bills entered · numbers 17 to 20, 24")).toBeInTheDocument();
  // the address names the firm and month, so Back and a shared link come back here
  expect(where(router)).toBe("/sales/paper?firm=3&month=2026-09");
  expect(screen.getByLabelText("Firm")).toHaveValue("3");
  expect(screen.getByLabelText("Month")).toHaveValue("2026-09");
  expect(screen.getByRole("option", { name: "September 2026 · last month" })).toBeInTheDocument();
  const facts = screen.getByRole("list", { name: "What's in September" });
  expect(facts).toHaveTextContent("19: cancelled (Customer returned the piece the same day)");
  expect(within(facts).getByRole("link", { name: "19" })).toHaveAttribute("href", "/sales/205");
  expect(facts).toHaveTextContent("21: deleted 03 Oct (Entered twice by mistake)");
  expect(facts).toHaveTextContent("20 is on two bills: give one a new number before filing.");
  // each of them, by its own bill: the Sales list's dups=1 matches whole numbers across the year, so it could show neither.
  // Each link names its number, date and customer, so two on one number and customer don't share a name (Ruling 1D-13)
  expect(within(facts).getByRole("link", { name: "KGH/2026-27/20 · 05 Sep · Lalit Jain" })).toHaveAttribute("href", "/sales/382");
  expect(within(facts).getByRole("link", { name: "KGH/2026-27/20 · 05 Sep · Ramesh Patel" })).toHaveAttribute("href", "/sales/383");
  expect(within(facts).getByText("20 is on two bills: give one a new number before filing.").closest("li")).toHaveClass("text-neg");
  expect(facts).toHaveTextContent("Not entered yet: 22, 23");
  expect(screen.getByText("September's GSTR-1 is due 11 Oct (in 3 days): enter the rest before filing.")).toHaveClass("text-neg");
  expect(screen.getByText("Opens the bill with KGH/2026-27/22 and 05 Sep 2026 filled in. After each save, Next paper bill keeps the firm and date.")).toBeInTheDocument();
  const table = screen.getByRole("table", { name: "September's bills for KIRAN GOLD HOUSE, in number order" });
  const states = within(table).getAllByRole("row").slice(1).map((r) => [within(r).getAllByRole("cell")[0].textContent, within(r).getAllByRole("cell")[4].textContent]);
  expect(states).toEqual([
    ["KGH/2026-27/17", "On paper"], ["KGH/2026-27/18", "Sent"], ["KGH/2026-27/19", "Cancelled"],
    ["KGH/2026-27/20", "On paper"], ["KGH/2026-27/20", "Not sent"], ["KGH/2026-27/24", "On paper"],
  ]);
  // said in words, never a button that nags: the customer has the paper bill
  expect(within(table).queryByRole("button")).not.toBeInTheDocument();
  // the bill just saved flashes once
  expect(within(table).getByRole("link", { name: "KGH/2026-27/24" }).closest("tr")).toHaveClass("anim-flash");
});

test("Enter bill opens the form on the next paper bill, with this session's last paper date in that month", async () => {
  const user = fakeToday();
  formServer();
  rememberPaperDate(3, "2026-09-30");
  const { router } = mountBook("/sales/paper?firm=3&month=2026-09");
  expect(await screen.findByText("13 bills entered · numbers 17 to 29")).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "What's in September" })).toHaveTextContent("No number in between is missing.30 to 33 are October's bills, so the next free number is 34. Type the number written on the paper bill if it's different.");
  await user.click(screen.getByRole("button", { name: "Enter bill 34" }));
  await waitFor(() => expect(where(router)).toBe("/sales/new?paper=1&firm=3&date=2026-09-30&number=34"));
  expect(await screen.findByLabelText("Number on the paper bill")).toHaveValue("34");
  expect(screen.getByLabelText("Date on the paper bill")).toHaveValue("30 Sep 2026");
});

test("picking another firm or month follows the address, and each firm has its own book", async () => {
  const user = fakeToday();
  formServer();
  const { router } = mountBook("/sales/paper?firm=3&month=2026-09");
  await screen.findByText("13 bills entered · numbers 17 to 29");
  await user.selectOptions(screen.getByLabelText("Firm"), "2");
  await waitFor(() => expect(where(router)).toBe("/sales/paper?firm=2&month=2026-09"));
  expect(await screen.findByText("No bill entered yet for September")).toBeInTheDocument();
  expect(screen.getByText("No September bills for MEERA ORNAMENTS yet")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Enter bill 9" })).toBeEnabled();
  await user.selectOptions(screen.getByLabelText("Month"), "2026-10");
  await waitFor(() => expect(where(router)).toBe("/sales/paper?firm=2&month=2026-10"));
  expect(screen.getByLabelText("Month")).toHaveDisplayValue("October 2026 · this month");
  // a month the book doesn't offer, or a firm that isn't there, falls back to last month and the first firm
  act(() => { void router.navigate("/sales/paper?firm=99&month=2025-01"); });
  await waitFor(() => expect(where(router)).toBe("/sales/paper?firm=3&month=2026-09"));
});

test.each([false, true])("a GSTR-1-locked month explains GSTR-1A before GSTR-3B and prevents adding bills (phone %s)", async (phone) => {
  fakeToday();
  (window as unknown as { __phone?: boolean }).__phone = phone;
  formServer([["GET", "sales/paper-book/", () => wireBook({ locked: true })]]);
  mountBook("/sales/paper?firm=3&month=2026-09");
  expect(await screen.findByText("September's GSTR-1 is filed")).toBeInTheDocument();
  expect(screen.getByText("This bill's month has its GSTR-1 filed, so its bills can't change. A correction goes in GSTR-1A, before GSTR-3B; unlock the month in GST returns first (owner only).")).toBeInTheDocument();
  expect(screen.queryByText(/A bill found later goes into next month's return/)).not.toBeInTheDocument();
  const enter = screen.getByRole("button", { name: "Enter bill 34" });
  expect(enter).toBeDisabled();
  expect(enter).toHaveAttribute("title", "September 2026 is filed for KIRAN GOLD HOUSE, so no bill can be added until the owner unlocks it in GST returns.");
  expect(screen.queryByText(/GSTR-1 is due/)).not.toBeInTheDocument();
});

test("someone who can't make bills sees the book, and is told who can enter them", async () => {
  fakeToday();
  formServer();
  mountBook("/sales/paper?firm=3&month=2026-09", { me: ACCOUNTANT });
  await screen.findByText("13 bills entered · numbers 17 to 29");
  expect(screen.getByRole("button", { name: "Enter bill 34" })).toBeDisabled();
  expect(screen.getByText(/^Only the owner and counter staff can make bills/)).toBeInTheDocument();
});

test("a month that fails to load says so and keeps the pickers, so another can be picked; Try again asks again through the client (Ruling 1B-11)", async () => {
  const user = fakeToday();
  let down = true;
  formServer([["GET", "sales/paper-book/", () => (down ? refuse(500, {}) : wireBook())]]);
  const asked = vi.spyOn(QueryClient.prototype, "refetchQueries");
  mountBook("/sales/paper?firm=3&month=2026-09");
  expect(await screen.findByText(/Couldn't load the month's bills/)).toBeInTheDocument();
  expect(screen.getByLabelText("Month")).toBeEnabled();
  expect(screen.queryByRole("button", { name: /^Enter bill/ })).not.toBeInTheDocument();
  down = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("13 bills entered · numbers 17 to 29")).toBeInTheDocument();
  expect(asked).toHaveBeenCalledWith({ queryKey: ["sales", "paper-book", 3, "2026-09"] });
});

test("after a bill is saved, Enter bill waits for the book's fresh answer and never offers the number just saved; a refresh that fails keeps it waiting, and Try again brings it (T7 review)", async () => {
  const user = fakeToday();
  let answer: () => unknown = () => wireBook();
  let held: Promise<void> | null = null;
  formServer([["GET", "sales/paper-book/", async () => { await held; return answer(); }]]);
  const { router } = mountBook("/sales/paper?firm=3&month=2026-09", { routes: [{ path: "/elsewhere", element: <SavedElsewhere /> }] });
  expect(await screen.findByRole("button", { name: "Enter bill 34" })).toBeEnabled();
  // bill 34 is saved on the form: every bill query is told to ask again
  await act(async () => { await router.navigate("/elsewhere"); });
  await user.click(screen.getByRole("button", { name: "Save a bill" }));
  // back on the book with its fresh answer on its way: the last answer shows, but Enter bill names no number until it
  // comes, nor in its name, and says it's getting one (T7 re-review)
  let land = () => {};
  held = new Promise<void>((r) => { land = r; });
  answer = () => wireBook({ runs: [[17, 29], [34, 34]], entered: 14, next: { counter: 35, invoice_number: "KGH/2026-27/35", invoice_date: "2026-09-30" } });
  await act(async () => { await router.navigate("/sales/paper?firm=3&month=2026-09"); });
  const waiting = await screen.findByRole("button", { name: "Enter bill" });
  expect(waiting).toBeDisabled();
  expect(waiting).toHaveAttribute("aria-busy", "true");
  expect(waiting).toHaveTextContent(/^Enter bill$/);
  expect(waiting).toHaveAttribute("title", GETTING);
  expect(screen.getByText(GETTING)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Enter bill \d/ })).not.toBeInTheDocument();
  await act(async () => { land(); await vi.advanceTimersByTimeAsync(50); });
  expect(await screen.findByRole("button", { name: "Enter bill 35" })).toBeEnabled();
  // another bill saved, and the book's answer fails: what it last said stays, said so; Enter bill still names no number,
  // and its reason points at the note's Try again rather than saying it waits
  await act(async () => { await router.navigate("/elsewhere"); });
  await user.click(screen.getByRole("button", { name: "Save a bill" }));
  held = null;
  answer = () => refuse(500, {});
  await act(async () => { await router.navigate("/sales/paper?firm=3&month=2026-09"); });
  expect(await screen.findByText("Couldn't refresh the month's bills")).toBeInTheDocument();
  const failed = screen.getByRole("button", { name: "Enter bill" });
  expect(failed).toBeDisabled();
  expect(failed).not.toHaveAttribute("aria-busy");
  expect(failed).toHaveAttribute("title", TRY_AGAIN);
  expect(screen.getByText(TRY_AGAIN)).toBeInTheDocument();
  expect(screen.queryByText(GETTING)).not.toBeInTheDocument();
  answer = () => wireBook({ runs: [[17, 29], [34, 35]], entered: 15, next: { counter: 36, invoice_number: "KGH/2026-27/36", invoice_date: "2026-09-30" } });
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("button", { name: "Enter bill 36" })).toBeEnabled();
});

test("on a phone, Enter bill waits in the action bar the same way, its reason under the card (T7 re-review)", async () => {
  const user = fakeToday();
  (window as unknown as { __phone?: boolean }).__phone = true;
  let held: Promise<void> | null = null;
  formServer([["GET", "sales/paper-book/", async () => { await held; return wireBook({ next: { counter: 35, invoice_number: "KGH/2026-27/35", invoice_date: "2026-09-30" } }); }]]);
  const { router } = mountBook("/sales/paper?firm=3&month=2026-09", { routes: [{ path: "/elsewhere", element: <SavedElsewhere /> }] });
  expect(await screen.findByRole("button", { name: "Enter bill 35" })).toBeEnabled();
  await act(async () => { await router.navigate("/elsewhere"); });
  await user.click(screen.getByRole("button", { name: "Save a bill" }));
  let land = () => {};
  held = new Promise<void>((r) => { land = r; });
  await act(async () => { await router.navigate("/sales/paper?firm=3&month=2026-09"); });
  const waiting = await screen.findByRole("button", { name: "Enter bill" });
  expect(waiting).toBeDisabled();
  expect(waiting).toHaveAttribute("aria-busy", "true");
  expect(screen.getByText(GETTING)).toBeInTheDocument();
  await act(async () => { land(); await vi.advanceTimersByTimeAsync(50); });
  expect(await screen.findByRole("button", { name: "Enter bill 35" })).toBeEnabled();
  expect(screen.queryByText(GETTING)).not.toBeInTheDocument();
});

test("on a phone, Enter bill is the action bar's and the bills are a list", async () => {
  fakeToday();
  (window as unknown as { __phone?: boolean }).__phone = true;
  formServer([["GET", "sales/paper-book/", () => SEPTEMBER]]);
  mountBook("/sales/paper?firm=3&month=2026-09");
  const list = await screen.findByRole("list", { name: "September's bills" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(6);
  expect(within(list).getAllByRole("listitem")[2]).toHaveTextContent("KGH/2026-27/1904 Sep · Suresh Jain₹12,000.00Cancelled");
  expect(screen.getByRole("button", { name: "Enter bill 22" })).toBeEnabled();
  expect(screen.getByText("Kiran · September 2026")).toBeInTheDocument();
});

/* ── The server's book as it comes (Rulings 1A-29, 1D-3; 1A Task 6's re-review) ── */

test("a month whose bills are all outside the span (odd-shaped numbers) says how many, never \"numbers\" with nothing after", async () => {
  fakeToday();
  formServer([["GET", "sales/paper-book/", () => wireBook({
    bills: [row(390, 18, "2026-09-03", "Anil Gupta", "8000.00", { invoice_number: "KGH-18" }), row(391, 0, "2026-09-04", "Lalit Jain", "9000.00", { invoice_number: "PAPER", counter: null })],
    entered: 2, runs: [], missing: [], missing_count: 0, after: [], after_months: [], next: { counter: 34, invoice_number: "KGH/2026-27/34", invoice_date: "2026-09-04" },
  })]]);
  mountBook("/sales/paper?firm=3&month=2026-09");
  // the whole line: nothing follows the count
  expect(await screen.findByText("2 bills entered")).toBeInTheDocument();
  expect(screen.getByRole("table", { name: "September's bills for KIRAN GOLD HOUSE, in number order" })).toHaveTextContent("KGH-18");
});

test("past the 500 numbers the book lists, it says how many aren't entered yet; two cancelled bills on one number are each explained (Ruling 1D-3)", async () => {
  fakeToday();
  const errors = vi.spyOn(console, "error");
  const first = Array.from({ length: 500 }, (_, i) => 30 + i);
  formServer([["GET", "sales/paper-book/", () => wireBook({
    bills: [row(205, 19, "2026-09-04", "Suresh Jain", "12000.00", { status: "cancelled" }), row(206, 19, "2026-09-05", "Lalit Jain", "9000.00", { status: "cancelled", invoice_number: "KGH-19" })],
    entered: 2, runs: [[17, 19], [1263, 1263]], twice: [19], missing: first, missing_count: 1234, after: [], after_months: [],
    explained: [
      { counter: 19, kind: "cancelled", id: 205, invoice_number: "KGH/2026-27/19", reason: "Wrong weight" },
      { counter: 19, kind: "cancelled", id: 206, invoice_number: "KGH-19", reason: "" },
    ],
    next: { counter: 30, invoice_number: "KGH/2026-27/30", invoice_date: "2026-09-05" },
  })]]);
  mountBook("/sales/paper?firm=3&month=2026-09");
  const facts = await screen.findByRole("list", { name: "What's in September" });
  expect(facts).toHaveTextContent("Not entered yet: 1,234 numbers. The first 500 are 30 to 529.");
  expect(facts).toHaveTextContent("19: cancelled (Wrong weight)");
  expect(facts).toHaveTextContent("19: cancelled, no reason was given");
  expect(within(facts).getAllByRole("link", { name: "19" }).map((a) => a.getAttribute("href"))).toEqual(["/sales/205", "/sales/206"]);
  // both on 19 are cancelled, and a cancelled bill keeps its number: said, with nothing to do (Ruling 1D-13)
  const kept = within(facts).getByText("19 is on two cancelled bills: they keep their numbers.").closest("li") as HTMLElement;
  expect(kept).toHaveClass("text-fg2");
  expect(within(kept).getByRole("link", { name: "KGH/2026-27/19 · 04 Sep · Suresh Jain · cancelled" })).toHaveAttribute("href", "/sales/205");
  expect(within(kept).getByRole("link", { name: "KGH-19 · 05 Sep · Lalit Jain · cancelled" })).toHaveAttribute("href", "/sales/206");
  // each line of the list is keyed by its own bill, so React never meets two with one key
  expect(errors).not.toHaveBeenCalled();
});

test("a number on an active bill and a cancelled one: the active one gets a new number, and its link says which is which (Ruling 1D-13)", async () => {
  fakeToday();
  formServer([["GET", "sales/paper-book/", () => wireBook({
    bills: [row(382, 20, "2026-09-05", "Lalit Jain", "30500.00"), row(386, 20, "2026-09-07", "Lalit Jain", "30500.00", { status: "cancelled", invoice_number: "KGH-20" })],
    entered: 2, runs: [[17, 20]], twice: [20], after: [], after_months: [],
    explained: [{ counter: 20, kind: "cancelled", id: 386, invoice_number: "KGH-20", reason: "Typed twice" }],
    next: { counter: 21, invoice_number: "KGH/2026-27/21", invoice_date: "2026-09-07" },
  })]]);
  mountBook("/sales/paper?firm=3&month=2026-09");
  const facts = await screen.findByRole("list", { name: "What's in September" });
  const twice = within(facts).getByText("20 is on two bills: give the active one a new number before filing.").closest("li") as HTMLElement;
  expect(twice).toHaveClass("text-neg");
  expect(within(twice).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
    ["KGH/2026-27/20 · 05 Sep · Lalit Jain", "/sales/382"], ["KGH-20 · 07 Sep · Lalit Jain · cancelled", "/sales/386"],
  ]);
});

test("the month is asked for once per firm and month picked: never again on a timer, nor on coming back to the window (Neon's free plan)", async () => {
  // a refetchInterval runs on setInterval: faked too, so one would fire as the clock moves
  const user = fakeToday({ intervals: true });
  const { calls } = formServer();
  mountBook("/sales/paper?firm=3&month=2026-09");
  await screen.findByText("13 bills entered · numbers 17 to 29");
  const asks = () => calls.filter((c) => c.url === "sales/paper-book/").map((c) => `${c.params.business_id} ${c.params.month}`);
  expect(asks()).toEqual(["3 2026-09"]);
  // ten minutes on, long past the 30 s an answer counts as fresh; then the window comes back into view, as TanStack hears it
  await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
  act(() => { window.dispatchEvent(new Event("visibilitychange")); });
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(asks()).toEqual(["3 2026-09"]);
  await user.selectOptions(screen.getByLabelText("Month"), "2026-08");
  await screen.findByRole("list", { name: "What's in August" });
  expect(asks()).toEqual(["3 2026-09", "3 2026-08"]);
});

test.each([
  ["has no firm yet", () => ({ results: [] }), "No firm yet", "Each firm has its own bill book. The owner adds firms in Records."],
  ["can't load its firms", () => refuse(500, {}), "The firms couldn't load", "Each firm has its own bill book, so the page waits for the list of firms. Try again when the internet is back."],
] as const)("a shop that %s is told so, and nothing is asked of the paper book", async (_, firms, title, words) => {
  fakeToday();
  const { calls } = formServer([["GET", "businesses/", firms]]);
  mountBook("/sales/paper");
  expect(await screen.findByText(title)).toBeInTheDocument();
  expect(screen.getByText(words)).toBeInTheDocument();
  expect(calls.some((c) => c.url === "sales/paper-book/")).toBe(false);
});
