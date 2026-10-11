import { handClock, pass } from "@/test/clock";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onlineManager } from "@tanstack/react-query";
import { Route, Routes, useLocation } from "react-router";
import { __setNetState } from "@/core/api/network";
import { queryClient } from "@/core/api/query";
import type { Me } from "@/core/auth/AuthProvider";
import { refuse, salesServer, wireBin, wireDetail, wireFacets, wirePage, wireRow, type Call, type Route as ApiRoute } from "@/core/sales/fixtures";
import { ScopeProvider } from "@/core/scope";
import { renderApp } from "@/test/render";
import SalesList from "../SalesList";

// plan 1E: a send makes the bill's PDF (core/print's own tests make real ones); here a stand-in
vi.mock("@/core/print/make", async (real) => ({
  ...(await real<typeof import("@/core/print/make")>()),
  billFile: vi.fn(async () => ({ blob: new Blob(["%PDF-1.3"], { type: "application/pdf" }), name: "bill.pdf", sheets: 1 })),
}));

const MEENA = { id: 8, name: "Meena Jain", gst_number: "", mobile_number: "9414126508", type: "person" };
/** Two bills today and a cancelled one yesterday, newest first, as the server sends them. */
const ROWS = [
  wireRow({ id: 413, invoice_number: "KGH/2026-27/32", counter: 32, customer: MEENA, payment_mode: "credit", taxable: "30636.93", cgst: "459.55", sgst: "459.56", tax: "919.11", total_amount: "31556.04", created_at: "2026-10-08T12:09:00+05:30" }),
  wireRow(),
  wireRow({ id: 405, invoice_number: "KGH/2026-27/30", counter: 30, invoice_date: "2026-10-07", created_at: "2026-10-07T16:20:00+05:30", status: "cancelled", cancel_reason: "Customer returned it" }),
];
const isFacets = (c: Call) => c.params.facets === 1 && c.params.page_size === 1;
/** The list's pages (the facets are asked for apart, one bill a page). */
const lists = (calls: Call[]) => calls.filter((c) => c.url === "sales/" && !isFacets(c));
function server(rows = ROWS, over: Record<string, unknown> = {}, more: ApiRoute[] = []) {
  return salesServer([["GET", "sales/", (c) => (isFacets(c) ? { ...wirePage([]), facets: wireFacets() } : wirePage(rows, over))], ...more]);
}
function Where() { const l = useLocation(); return <p data-testid="where">{`${l.pathname}${l.search}`}</p>; }
const mount = (path = "/sales", me?: Partial<Me>) => renderApp(
  <ScopeProvider><Routes>
    <Route path="/sales" element={<><SalesList /><Where /></>} />
    <Route path="/sales/:id" element={<><p>the bill page</p><Where /></>} />
  </Routes></ScopeProvider>, { path, me });

// 08 Oct 2026 in India, as in the contract's examples; the clock still runs, so pauses and debounces work
beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }); vi.setSystemTime(new Date("2026-10-08T12:30:00+05:30")); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); queryClient.clear(); });
// plan 1E: a send downloads its PDF beside the chat; jsdom (no object URLs, no downloads) clicks nothing
beforeEach(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:pdf"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});


test("the list asks for the firm and year in view, and shows what they add up to, day by day", async () => {
  const { calls } = server();
  mount();
  expect(await screen.findByRole("heading", { level: 1, name: "Sales" })).toBeInTheDocument();
  expect(await screen.findByText("Sales bills of both firms · FY 2026-27")).toBeInTheDocument();
  expect(await screen.findByText("All firms · FY 2026-27")).toBeInTheDocument();
  expect(lists(calls)[0].params).toEqual({ fy: "2026-27", ordering: "-date", page: 1, page_size: 40 });
  expect(calls.find(isFacets)?.params).toEqual({ fy: "2026-27", facets: 1, page: 1, page_size: 1 });
  expect(screen.getByText("₹1,18,639.25")).toBeInTheDocument();
  expect(screen.getByText("Today, 08 Oct 2026").closest("tr")).toHaveTextContent("Today, 08 Oct 2026 · 2 bills · ₹1,18,639.25");
  expect(screen.getByText("Yesterday, 07 Oct 2026").closest("tr")).toHaveTextContent("Yesterday, 07 Oct 2026 · 0 bills · ₹0.00 · 1 cancelled");
  // a day row spans every column, the actions too
  expect(screen.getByText("Today, 08 Oct 2026").closest("td")!.colSpan).toBe(document.querySelectorAll("thead th").length);
  expect([...document.querySelectorAll("tr[data-row]")].map((r) => r.getAttribute("data-row"))).toEqual(["413", "412", "405"]);
  expect(screen.getByText("Showing all 2 bills · 1 cancelled bill also listed")).toBeInTheDocument();
  // the summary names the cancelled bill apart, as not counted, in one sentence
  expect(screen.getByText("Purchases are never counted here. These figures follow your search, firm, payment, status and period. 1 cancelled bill not counted.")).toBeInTheDocument();
  // the period chips come from the year's facets: the month so far, a month still to file, and the filed ones
  expect(screen.getByRole("button", { name: "October 2026: 4 bills, 1 to 8 Oct" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "September 2026: 14 bills, file by 11 Oct" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "August 2026: 19 bills, filed" })).toBeInTheDocument();
  expect(screen.getByText("Filed for both firms: April to August. Bills in those months can't be changed or deleted.")).toBeInTheDocument();
});

test("filters live in the address and ask again: a saved view and the status", async () => {
  const { calls } = server();
  mount();
  await userEvent.click(await screen.findByRole("button", { name: "Needs a check: 3 bills" }));
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/sales?month=all&status=check"));
  await waitFor(() => expect(lists(calls).at(-1)?.params).toMatchObject({ fy: "2026-27", check: 1 }));
  expect(screen.getByRole("button", { name: "Needs a check: 3 bills. Showing; press to clear" })).toHaveAttribute("aria-pressed", "true");
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Status" }), "cancelled");
  await waitFor(() => expect(lists(calls).at(-1)?.params).toMatchObject({ status: "cancelled" }));
  await userEvent.click(screen.getByRole("button", { name: /^September 2026/ }));
  await waitFor(() => expect(lists(calls).at(-1)?.params).toMatchObject({ month: "2026-09", status: "cancelled" }));
  expect(screen.getByTestId("where")).toHaveTextContent("/sales?month=2026-09&status=cancelled");
}, 15_000); // two filter rounds, each asking again: past 5 s on a busy 2-CPU machine (it passes alone)

// (the brief's one test, in two: each loads the page once fewer, so a busy machine keeps it inside the 5 s a test has)
test("a search looks through the whole year, not just the month picked, with its filters; Only narrows it back", async () => {
  const { calls } = server();
  mount("/sales?month=2026-09&status=cancelled");
  await waitFor(() => expect(lists(calls).at(-1)?.params).toMatchObject({ month: "2026-09", status: "cancelled" }));
  handClock();
  const box = screen.getByRole("searchbox", { name: /Search sales bills/ });
  for (const typed of ["a", "an", "ani", "anil"]) fireEvent.change(box, { target: { value: typed } });
  await pass(300, 2); // typing has paused: the search asks
  expect(screen.getByText(/Searching all of FY 2026-27, not just September 2026\./)).toBeInTheDocument();
  expect(lists(calls).at(-1)?.params).toMatchObject({ fy: "2026-27", q: "anil", status: "cancelled" });
  expect(lists(calls).at(-1)?.params).not.toHaveProperty("facets");
  fireEvent.click(screen.getByRole("button", { name: "Only September" }));
  await pass(0, 2);
  expect(lists(calls).at(-1)?.params).toMatchObject({ month: "2026-09", q: "anil" });
});

test("on a row, ↓ moves with the preview, Esc closes it, and Enter opens the bill", async () => {
  server(ROWS, {}, [["GET", "sales/413/", () => wireDetail({ ...ROWS[0] })], ["GET", "sales/412/", () => wireDetail()]]);
  mount();
  const first = await waitFor(() => { const r = document.querySelector<HTMLElement>('tr[data-row="413"]'); expect(r).not.toBeNull(); return r!; });
  expect(first).toHaveAttribute("tabindex", "0");
  act(() => first.focus());
  await userEvent.keyboard("{ArrowDown}");
  const pane = await screen.findByRole("complementary", { name: "Preview of bill KGH/2026-27/31" });
  await waitFor(() => expect(document.querySelector('tr[data-row="412"]')).toHaveFocus());
  expect(screen.getByTestId("where")).toHaveTextContent("bill=412");
  expect(await within(pane).findByText("12.345 gms × ₹6,512.50/gms")).toBeInTheDocument();
  expect(within(pane).getByText("Rakesh Soni · 10:42")).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("complementary")).not.toBeInTheDocument());
  await userEvent.keyboard("{Enter}");
  expect(await screen.findByText("the bill page")).toBeInTheDocument();
  expect(screen.getByTestId("where")).toHaveTextContent("/sales/412");
});

test("final review: batch Print preserves tick order, including an unticked bill picked again", async () => {
  server();
  mount();
  await screen.findByRole("checkbox", { name: "Select KGH/2026-27/31" });
  handClock();
  for (const number of [31, 30, 32, 31, 31]) fireEvent.click(screen.getByRole("checkbox", { name: `Select KGH/2026-27/${number}` }));
  fireEvent.click(screen.getByRole("button", { name: "Print 3…" }));
  await pass(0);
  expect(screen.getByTestId("where")).toHaveTextContent("/sales/batch?ids=405,413,412");
}, 15_000);

test("ticking bills says what's selected; the owner deletes them together, and Undo brings them back", async () => {
  handClock();
  let bin = 50;
  const { calls } = server(ROWS, {}, [
    ["DELETE", /^sales\/\d+\/$/, (c) => wireBin({ id: (bin += 1), original_id: Number(c.url.split("/")[1]) })],
    ["POST", /^bin\/\d+\/restore\/$/, () => wireDetail()],
  ]);
  mount(); await pass(400, 2);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select KGH/2026-27/32" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select KGH/2026-27/31" }));
  const bar = screen.getByRole("region", { name: "Selected bills" });
  expect(bar).toHaveTextContent("2 bills selected · ₹1,18,639.25");
  fireEvent.click(within(bar).getByRole("button", { name: "Delete 2 bills…" }));
  const dialog = screen.getByRole("dialog", { name: "Delete 2 sales bills?" });
  await pass(400, 2); // past the dialog's guard against the click that opened it
  fireEvent.click(within(dialog).getByRole("button", { name: "Entered twice" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete 2 bills" }));
  await pass(0, 2);
  expect(calls.filter((c) => c.method === "DELETE").map((c) => [c.url, c.body])).toEqual([["sales/413/", { reason: "Entered twice" }], ["sales/412/", { reason: "Entered twice" }]]);
  expect(screen.getByText("Deleted 2 bills")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^Undo/ }));
  await pass(0, 2);
  expect(calls.filter((c) => c.url.startsWith("bin/")).map((c) => c.url)).toEqual(["bin/51/restore/", "bin/52/restore/"]);
  expect(screen.getByText("Restored 2 bills")).toBeInTheDocument();
});

test("a search that finds nothing here says where else it found bills, and offers every year", async () => {
  const { calls } = salesServer([["GET", "sales/", (c) => ({ ...wirePage([]), ...(isFacets(c) ? { facets: wireFacets() } : c.params.facets === "elsewhere" ? { facets: { elsewhere: [{ fy: "2025-26", bills: 2 }] } } : {}) })]]);
  mount("/sales?q=zzz");
  expect(await screen.findByText("No sales bills match “zzz”")).toBeInTheDocument();
  expect(await screen.findByText(/Found 2 bills in FY 2025-26\.$/)).toBeInTheDocument();
  expect(calls.filter((c) => c.params.q === "zzz").map((c) => c.params.facets)).toEqual([undefined, "elsewhere"]);
  await userEvent.click(screen.getByRole("button", { name: "Search all years (2)" }));
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("month=years"));
  await waitFor(() => expect(calls.filter((c) => c.params.q === "zzz")).toHaveLength(3));
  expect(calls.filter((c) => c.params.facets === "elsewhere")).toHaveLength(1);
});

test("a viewer is told what they can do, and making bills isn't offered", async () => {
  server();
  mount("/sales", { role: "viewer", permissions: ["view", "reports.export"] });
  expect(await screen.findByText("Signed in as view only: you can look at, print, download and export bills. Making them is for the owner and counter staff; changing or deleting them, for the owner.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New bill" })).toBeDisabled();
});

test("a list that can't load says so, keeps the filters as picked but off, and Try again asks again", async () => {
  let down = true;
  const { calls } = salesServer([["GET", "sales/", (c) => (down ? refuse(500, {}) : isFacets(c) ? { ...wirePage([]), facets: wireFacets() } : wirePage(ROWS))]]);
  mount();
  expect(await screen.findByText("Couldn't load sales bills")).toBeInTheDocument();
  expect(screen.getByRole("searchbox", { name: /Search sales bills/ })).toBeDisabled();
  await waitFor(() => expect(calls.some(isFacets)).toBe(true));
  down = false;
  const before = calls.length;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Showing all 2 bills · 1 cancelled bill also listed")).toBeInTheDocument();
  expect(screen.getByRole("searchbox", { name: /Search sales bills/ })).toBeEnabled();
  // Try again asks again for everything the page shows: the bills, and the period chips and views (Ruling 1B-11)
  const again = calls.slice(before);
  expect(lists(again)).toHaveLength(1);
  expect(again.filter(isFacets)).toHaveLength(1);
  expect(await screen.findByRole("button", { name: "Needs a check: 3 bills" })).toBeInTheDocument();
});

test("a link's bill opens in the preview; with more than 160 bills still to come, the button steps 40 at a time", async () => {
  const summary = { of: "active", bills: 204, taxable: "0.00", cgst: "0.00", sgst: "0.00", igst: "0.00", tax: "0.00", total_amount: "0.00", average: null, cancelled: 1 };
  const eway = { eway_bill_number: "123456789012", transporter_name: "", transporter_gstin: "", vehicle_number: "RJ14AB1234", vehicle_type: "Regular", transport_mode: "Road", distance_km: 120, may_be_needed: false };
  const { calls } = server(ROWS, { count: 205, next: "/api/sales/?page=2", summary }, [["GET", "sales/413/", () => wireDetail({ ...ROWS[0], eway })]]);
  mount("/sales?bill=413");
  const pane = await screen.findByRole("complementary", { name: "Preview of bill KGH/2026-27/32" });
  expect(await within(pane).findByText("1234 5678 9012")).toBeInTheDocument();
  expect(await screen.findByText("Showing the newest 2 of 204 bills · 1 cancelled bill also listed")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Show more · 202 bills left" }));
  await waitFor(() => expect(lists(calls).map((c) => c.params.page)).toEqual([1, 2]));
});

/* ── Beyond the brief: Task 5's carry (every Send waits for the shop's message) ── */

test("the preview's Send waits for the shop's WhatsApp message, then sends the bill once however fast it's pressed", async () => {
  vi.spyOn(window, "open").mockImplementation(() => ({}) as Window); // the tab it opened (null: one the browser stopped)
  let settings: (w: unknown) => void = () => {};
  // every ask waits for the one answer, as a server's do (plan 1E: a send's PDF asks again, through the app's own client)
  const answer = new Promise((resolve) => { settings = resolve; });
  // the record answers at once: on a quick connection it lands between the two clicks of a double click, and the button
  // reads "Send again" by the second
  const { calls } = server(ROWS, {}, [
    ["GET", "sales/412/", () => wireDetail()],
    ["GET", "shop-settings/", () => answer],
    ["POST", "sales/412/sent/", () => ({ id: 412, sent: { at: "2026-10-08T12:31:00+05:30", last_at: "2026-10-08T12:31:00+05:30", count: 1, via: "whatsapp", to: "" } })],
  ]);
  mount("/sales?bill=412");
  const pane = await screen.findByRole("complementary", { name: "Preview of bill KGH/2026-27/31" });
  const send = within(pane).getByRole("button", { name: "Send" });
  expect(send).toBeDisabled();
  await act(async () => { settings({ copies: "original", show_bank: true, share_message: "", updated_at: null, updated_by: null }); });
  await waitFor(() => expect(send).toBeEnabled());
  await userEvent.dblClick(send);
  expect(window.open).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("KGH/2026-27/31 sent")).toBeInTheDocument();
  expect(calls.filter((c) => c.url === "sales/412/sent/")).toHaveLength(1);
});

/* ── Beyond the brief: the preview's own answer can fail (an error says what happened and what to do) ── */

test("a preview whose bill doesn't load says so instead of loading for ever, and Try again asks again", async () => {
  let down = true;
  const { calls } = server(ROWS, {}, [["GET", "sales/412/", () => (down ? refuse(500, {}) : wireDetail())]]);
  mount("/sales?bill=412");
  const pane = await screen.findByRole("complementary", { name: "Preview of bill KGH/2026-27/31" });
  expect(await within(pane).findByText("Couldn't load its items.")).toBeInTheDocument();
  down = false;
  await userEvent.click(within(pane).getByRole("button", { name: "Try again" }));
  expect(await within(pane).findByText("12.345 gms × ₹6,512.50/gms")).toBeInTheDocument();
  expect(calls.filter((c) => c.url === "sales/412/")).toHaveLength(2);
});

test("a link's bill that isn't in the list and doesn't load says it couldn't, not that it's gone; a bill that is gone says so", async () => {
  let down = true;
  server(ROWS, {}, [["GET", "sales/999/", () => (down ? refuse(500, {}) : refuse(404, { detail: "Not found." }))]]);
  mount("/sales?bill=999");
  const pane = await screen.findByRole("complementary", { name: "Preview of a bill" });
  expect(await within(pane).findByText("Couldn't load this bill.")).toBeInTheDocument();
  down = false;
  await userEvent.click(within(pane).getByRole("button", { name: "Try again" }));
  expect(await within(pane).findByText(/^This bill isn't here any more\./)).toBeInTheDocument();
});

/* ── Fix round 1 (the task review) ── */

/** Ticks the two bills of today and opens Delete for them, past the dialog's guard against the click that opened it. */
async function deleteBoth() {
  await pass(400, 2);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select KGH/2026-27/32" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select KGH/2026-27/31" }));
  fireEvent.click(within(screen.getByRole("region", { name: "Selected bills" })).getByRole("button", { name: "Delete 2 bills…" }));
  const dialog = screen.getByRole("dialog", { name: "Delete 2 sales bills?" });
  await pass(400, 2);
  return dialog;
}
const deletes = (calls: Call[]) => calls.filter((c) => c.method === "DELETE").map((c) => c.url);

test("a delete that stops part-way says how far it got and is then about what's left; Try again deletes only those", async () => {
  handClock();
  let bin = 50;
  let failOnce = true;
  const { calls } = server(ROWS, {}, [["DELETE", /^sales\/\d+\/$/, (c) => {
    const id = Number(c.url.split("/")[1]);
    if (id === 412 && failOnce) { failOnce = false; refuse(500, {}); }
    return wireBin({ id: (bin += 1), original_id: id });
  }]]);
  mount();
  const dialog = await deleteBoth();
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete 2 bills" }));
  await pass(0, 2);
  // 413 went and 412 didn't: never "Not deleted" while one went
  expect(within(dialog).getByText("Stopped after 1 of 2")).toBeInTheDocument();
  expect(within(dialog).getByText("The other bill is still in Sales. Try again in a minute.")).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Delete 1 sales bill?" })).toBe(dialog);
  expect(within(within(dialog).getByRole("list", { name: "Bills to delete" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("KGH/2026-27/31")]);
  expect(screen.getByText("Deleted 1 bill")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
  await pass(0, 2); await pass(170, 2);
  expect(deletes(calls)).toEqual(["sales/413/", "sales/412/", "sales/412/"]);
  // one toast for the whole delete, whose Undo brings back both
  expect(screen.getByText("Deleted 2 bills")).toBeInTheDocument();
  expect(screen.queryByText("Deleted 1 bill")).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("a bill someone deleted already counts as gone: the delete carries on to the rest and says so", async () => {
  handClock();
  const { calls } = server(ROWS, {}, [
    ["DELETE", "sales/413/", () => refuse(404, { detail: "Not found." })],
    ["DELETE", "sales/412/", () => wireBin({ id: 51, original_id: 412 })],
  ]);
  mount();
  const dialog = await deleteBoth();
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete 2 bills" }));
  await pass(0, 2); await pass(170, 2);
  expect(deletes(calls)).toEqual(["sales/413/", "sales/412/"]);
  expect(screen.getByText("Deleted 1 bill")).toBeInTheDocument();
  expect(screen.getByText("It's in the Audit log, where it can be restored. 1 bill was deleted already.")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("bills deleted together ask for the list and the period chips once afterwards; their Undo too, carrying on past a bin row that has gone", async () => {
  handClock();
  let bin = 50;
  const { calls } = server(ROWS, {}, [
    ["DELETE", /^sales\/\d+\/$/, (c) => wireBin({ id: (bin += 1), original_id: Number(c.url.split("/")[1]) })],
    ["POST", /^bin\/\d+\/restore\/$/, (c) => (c.url === "bin/52/restore/" ? refuse(404, { detail: "That deleted bill isn't in the bin any more." }) : wireDetail())],
  ]);
  mount(); await pass(400, 2);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all 2 bills and 1 cancelled bill shown" }));
  fireEvent.click(within(screen.getByRole("region", { name: "Selected bills" })).getByRole("button", { name: "Delete 2 bills and 1 cancelled bill…" }));
  const dialog = screen.getByRole("dialog", { name: "Delete 2 sales bills and 1 cancelled bill?" });
  await pass(400, 2);
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete 2 bills and 1 cancelled bill" }));
  await pass(0, 2);
  expect(screen.getByText("Deleted 2 bills and 1 cancelled bill")).toBeInTheDocument();
  const from = calls.findIndex((c) => c.method === "DELETE");
  expect(deletes(calls)).toHaveLength(3);
  expect(lists(calls.slice(from))).toHaveLength(1);
  expect(calls.slice(from).filter(isFacets)).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: /^Undo/ }));
  await pass(0, 2);
  expect(screen.getByText("Restored 2 bills")).toBeInTheDocument();
  expect(screen.getByText("Back in Sales and in the GST figures. 1 bill wasn't in the bin any more.")).toBeInTheDocument();
  expect(calls.filter((c) => c.url.startsWith("bin/")).map((c) => c.url)).toEqual(["bin/51/restore/", "bin/52/restore/", "bin/53/restore/"]);
  const back = calls.findIndex((c) => c.url.startsWith("bin/"));
  expect(lists(calls.slice(back))).toHaveLength(1);
  expect(calls.slice(back).filter(isFacets)).toHaveLength(1);
});

test("one bill sends once whichever button sends it: the row's Send then S make one chat and one record, and the row reads Sent at once", async () => {
  vi.spyOn(window, "open").mockImplementation(() => ({}) as Window); // the tab it opened (null: one the browser stopped)
  let recorded: (w: unknown) => void = () => {};
  let hold = false;
  const { calls } = salesServer([
    // the list's refresh after the record never comes back: the row reads Sent from the record's own answer
    ["GET", "sales/", (c) => (isFacets(c) ? { ...wirePage([]), facets: wireFacets() } : hold ? new Promise(() => {}) : wirePage(ROWS))],
    ["POST", "sales/412/sent/", () => new Promise((resolve) => { recorded = resolve; })],
  ]);
  mount();
  const row = await waitFor(() => { const r = document.querySelector<HTMLElement>('tr[data-row="412"]'); expect(r).not.toBeNull(); return r!; });
  const send = within(row).getByRole("button", { name: "Send KGH/2026-27/31 on WhatsApp" });
  await waitFor(() => expect(send).toBeEnabled());
  await userEvent.click(send);
  act(() => row.focus());
  await userEvent.keyboard("s");
  expect(window.open).toHaveBeenCalledTimes(1);
  hold = true;
  await act(async () => { recorded({ id: 412, sent: { at: "2026-10-08T12:31:00+05:30", last_at: "2026-10-08T12:31:00+05:30", count: 1, via: "whatsapp", to: "" } }); });
  expect(await within(row).findByRole("button", { name: "Sent at 12:31. Options for KGH/2026-27/31" })).toBeInTheDocument();
  expect(calls.filter((c) => c.url === "sales/412/sent/")).toHaveLength(1);
  expect(window.open).toHaveBeenCalledTimes(1);
});

test("a row whose bill was deleted elsewhere previews as deleted, with Open it and no Send", async () => {
  server(ROWS, {}, [["GET", "sales/412/", () => refuse(404, { detail: "This bill was deleted.", code: "deleted", binned: wireBin({ id: 11, original_id: 412, invoice_number: "KGH/2026-27/31" }) })]]);
  mount("/sales?bill=412");
  const pane = await screen.findByRole("complementary", { name: "Preview of a bill" });
  expect(await within(pane).findByText(/^This bill was deleted\./)).toBeInTheDocument();
  expect(within(pane).getByRole("link", { name: "Open it" })).toHaveAttribute("href", "/sales/412");
  expect(within(pane).queryByRole("button", { name: /^Send/ })).not.toBeInTheDocument();
});

test("an unsent paper bill's preview says On paper, with no Send to nag", async () => {
  const paper = wireRow({ id: 420, invoice_number: "KGH/2026-27/20", counter: 20, paper: true, created_at: "2026-10-08T12:00:00+05:30" });
  server([paper, ...ROWS], {}, [["GET", "sales/420/", () => wireDetail({ ...paper })]]);
  mount("/sales?bill=420");
  const pane = await screen.findByRole("complementary", { name: "Preview of bill KGH/2026-27/20" });
  expect(await within(pane).findByText("12.345 gms × ₹6,512.50/gms")).toBeInTheDocument();
  expect(within(pane).getByText("On paper")).toBeInTheDocument();
  expect(within(pane).queryByText("Not sent yet")).not.toBeInTheDocument();
  expect(within(pane).queryByText("Not yet")).not.toBeInTheDocument();
  expect(within(pane).getByText("The customer has the paper bill")).toBeInTheDocument();
  expect(within(pane).queryByRole("button", { name: /^Send/ })).not.toBeInTheDocument();
});

/* ── Fix round 2 (the re-review) ── */

test("the row's Send double-clicked sends once, even when the record lands between the two clicks", async () => {
  vi.spyOn(window, "open").mockImplementation(() => ({}) as Window); // the tab it opened (null: one the browser stopped)
  const { calls } = server(ROWS, {}, [["POST", "sales/412/sent/", () => ({ id: 412, sent: { at: "2026-10-08T12:31:00+05:30", last_at: "2026-10-08T12:31:00+05:30", count: 1, via: "whatsapp", to: "" } })]]);
  mount();
  const row = await waitFor(() => { const r = document.querySelector<HTMLElement>('tr[data-row="412"]'); expect(r).not.toBeNull(); return r!; });
  const send = within(row).getByRole("button", { name: "Send KGH/2026-27/31 on WhatsApp" });
  await waitFor(() => expect(send).toBeEnabled());
  await userEvent.dblClick(send);
  expect(window.open).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("KGH/2026-27/31 sent")).toBeInTheDocument();
  expect(calls.filter((c) => c.url === "sales/412/sent/")).toHaveLength(1);
});

test("an Undo pressed while a stopped delete still shows puts those bills back in its count; Try again then deletes them all, once", async () => {
  handClock();
  let bin = 50;
  let failOnce = true;
  const { calls } = server(ROWS, {}, [
    ["DELETE", /^sales\/\d+\/$/, (c) => {
      const id = Number(c.url.split("/")[1]);
      if (id === 412 && failOnce) { failOnce = false; refuse(500, {}); }
      return wireBin({ id: (bin += 1), original_id: id });
    }],
    ["POST", /^bin\/\d+\/restore\/$/, () => wireDetail()],
  ]);
  mount();
  await pass(400, 2); // the page is ready, past its guard against the click that opened it
  fireEvent.click(screen.getByRole("checkbox", { name: "Select KGH/2026-27/32" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select KGH/2026-27/31" }));
  fireEvent.click(within(screen.getByRole("region", { name: "Selected bills" })).getByRole("button", { name: "Delete 2 bills…" }));
  const dialog = screen.getByRole("dialog", { name: "Delete 2 sales bills?" });
  await pass(400, 2); // past the dialog's 350 ms guard
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete 2 bills" }));
  await pass(0, 2);
  expect(within(dialog).getByText("Stopped after 1 of 2")).toBeInTheDocument();
  // the first try's toast sits above the dialog: its Undo brings 413 back while the dialog still shows
  fireEvent.click(screen.getByRole("button", { name: /^Undo/ }));
  await pass(0, 2);
  expect(screen.getByText("Restored 1 bill")).toBeInTheDocument();
  // nothing of this delete is deleted now: the dialog is about both bills again, and says so
  expect(within(dialog).getByText("Nothing was deleted. Try again in a minute.")).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Delete 2 sales bills?" })).toBe(dialog);
  fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
  await pass(0, 2);
  expect(deletes(calls)).toEqual(["sales/413/", "sales/412/", "sales/413/", "sales/412/"]);
  expect(screen.getByText("Deleted 2 bills")).toBeInTheDocument();
  await pass(170, 2); // the dialog and the old Undo finish closing on the hand clock
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  // its Undo is for the two bills in the bin now, and both come back
  fireEvent.click(screen.getByRole("button", { name: /^Undo/ }));
  await pass(0, 2);
  const restored = screen.getByText("Restored 2 bills").parentElement!;
  expect(restored).toHaveTextContent("Back in Sales and in the GST figures.");
  expect(restored).not.toHaveTextContent("in the bin");
  expect(calls.filter((c) => c.url.startsWith("bin/")).map((c) => c.url)).toEqual(["bin/51/restore/", "bin/52/restore/", "bin/53/restore/"]);
});

/* ── 1B Task 11, commit A: the customer box's search (Ruling 1B-18), and v2's GST drill links ── */

/** The customer box's list (its own id: a role query would walk the whole table each time). */
function customerList() {
  const list = document.getElementById("sl-customer-list");
  if (!list) throw new Error("The customer box's list isn't open");
  expect(list).toHaveAttribute("role", "listbox");
  expect(list).toHaveAccessibleName("Customers");
  return list;
}

afterEach(() => { act(() => { __setNetState("online"); onlineManager.setOnline(true); }); });

test("the customer box says it's searching until the answer for what's typed has come, and that no customer matches only then; a pick shows their bills", async () => {
  let answer: (rows: unknown[]) => void = () => {};
  const { calls } = server(ROWS, {}, [
    ["GET", "customers/", () => new Promise((r) => { answer = (rows) => r({ count: rows.length, next: null, previous: null, results: rows }); })],
    ["GET", "customers/8/", () => ({ ...MEENA })],
  ]);
  mount();
  await screen.findByText("All firms · FY 2026-27");
  handClock();
  const box = screen.getByRole("combobox", { name: "Show one customer's bills" });
  const status = () => {
    expect(box).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("sl-customer-list")).not.toBeInTheDocument();
    const live = document.getElementById("sl-customer-status")!;
    expect(live).toHaveAttribute("role", "status");
    return live;
  };
  fireEvent.change(box, { target: { value: "m" } });
  expect(status()).toHaveTextContent("Keep typing to search");
  fireEvent.change(box, { target: { value: "meenaz" } });
  // typing hasn't paused: nothing is asked yet, and nothing is said of a search not made
  expect(status()).toHaveTextContent("Searching…");
  await pass(250, 2);
  expect(calls.filter((c) => c.url === "customers/").map((c) => c.params.search)).toEqual(["meenaz"]);
  // asked, not answered yet
  expect(status()).toHaveTextContent("Searching…");
  expect(status()).not.toHaveTextContent(/No customer matches/);
  await act(async () => { answer([]); });
  await pass(0, 2);
  expect(status()).toHaveTextContent("No customer matches “meenaz”");
  // a letter less: that answer was for "meenaz", so nothing is said of "meena" until it has been searched for
  fireEvent.change(box, { target: { value: "meena" } });
  expect(status()).toHaveTextContent("Searching…");
  expect(status()).not.toHaveTextContent(/No customer matches/);
  await pass(250, 2);
  await act(async () => { answer([{ ...MEENA, city: "Jaipur", state_name: "RAJASTHAN", figures: { bills: 6 } }]); });
  await pass(0, 2);
  fireEvent.click(within(customerList()).getByRole("option", { name: /^Meena Jain.*6 bills$/ }));
  await pass(0, 2);
  expect(screen.getByTestId("where")).toHaveTextContent("customer=8");
  expect(lists(calls).at(-1)?.params).toMatchObject({ customer_id: 8 });
});

test("the customer box says when its search failed, and when it waits for the internet: never that no customer matches", async () => {
  server(ROWS, {}, [["GET", "customers/", () => refuse(500, {})]]);
  mount();
  await screen.findByText("All firms · FY 2026-27");
  handClock();
  const box = screen.getByRole("combobox", { name: "Show one customer's bills" });
  const status = () => {
    expect(box).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("sl-customer-list")).not.toBeInTheDocument();
    const live = document.getElementById("sl-customer-status")!;
    expect(live).toHaveAttribute("role", "status");
    return live;
  };
  fireEvent.change(box, { target: { value: "kamal" } });
  await pass(250, 2);
  expect(status()).toHaveTextContent("Couldn't search: the app couldn't get through");
  expect(status()).not.toHaveTextContent(/No customer matches/);
  act(() => { onlineManager.setOnline(false); __setNetState("offline"); });
  fireEvent.change(box, { target: { value: "rekha" } });
  await pass(250, 2);
  expect(status()).toHaveTextContent("You're offline: the search runs when you're back online");
  expect(status()).not.toHaveTextContent(/No customer matches/);
});

test("v2's GST drill links name the firm as business_id: the list opens on that firm, with the link's rate or segment and dates", async () => {
  const { calls } = server();
  // GSTSummary's rate-wise breakdown
  const view = mount("/sales?gst_rate=3&start_date=2026-04-01&end_date=2026-06-30&business_id=2&type=outward");
  await waitFor(() => expect(lists(calls).at(-1)?.params).toMatchObject({ business_id: 2, gst_rate: "3", start_date: "2026-04-01", end_date: "2026-06-30" }));
  expect(screen.getByRole("combobox", { name: "Firm (same as the top bar)" })).toHaveValue("2");
  // the firm is the app's, not the list's: the address keeps the list's words and drops v2's firm
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/sales?gst_rate=3&start_date=2026-04-01&end_date=2026-06-30&type=outward"));
  view.unmount();
  localStorage.clear();
  // its quarter's checks, by segment
  const before = calls.length;
  mount("/sales?type=outward&start_date=2026-07-01&end_date=2026-09-30&segment=b2b&business_id=3");
  await waitFor(() => expect(lists(calls.slice(before)).at(-1)?.params).toMatchObject({ business_id: 3, segment: "b2b", start_date: "2026-07-01", end_date: "2026-09-30" }));
  await waitFor(() => expect(screen.getByTestId("where")).not.toHaveTextContent("business_id"));
});
