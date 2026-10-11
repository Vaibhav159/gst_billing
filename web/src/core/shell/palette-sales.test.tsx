import { useState } from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import { Route, Routes, useLocation } from "react-router";
import { api } from "@/core/api/client";
import { __setNetState } from "@/core/api/network";
import type { Me } from "@/core/auth/AuthProvider";
import { wireBin, wirePage, wireRow } from "@/core/sales/fixtures";
import { renderApp } from "@/test/render";
import { Palette } from "./Palette";

type Answer = (config: InternalAxiosRequestConfig) => ReturnType<AxiosAdapter>;
const answer = (config: InternalAxiosRequestConfig, data: unknown) => Promise.resolve({ status: 200, statusText: "", headers: {}, config, data });
/** No reply at all: the network failed. */
const noReply: Answer = (config) => Promise.reject(new AxiosError("Network Error", "ERR_NETWORK", config));
const quick = (id: number, invoice_number: string, invoice_date: string, extra: Record<string, unknown> = {}) =>
  ({ id, invoice_number, invoice_date, total_amount: "1000.00", type_of_invoice: "outward", customer_name: "Meena Jain", status: "active", paper: false, business_id: 3, ...extra });
const TODAY = [wireRow({ id: 413, invoice_number: "KGH/2026-27/32", customer: { id: 8, name: "Meena Jain", gst_number: "", mobile_number: "", type: "person" }, total_amount: "31556.04", created_at: "2026-10-08T12:09:00+05:30" }), wireRow()];
/** A quick search that finds bills by number, or Anil. */
const quickSearch: Answer = (config) => {
  const q = (config.params as { q: string }).q;
  if (q === "anil") return answer(config, { customers: [{ id: 7, name: "Anil Gupta", mobile_number: "9829041122", gst_number: "", state_name: "RAJASTHAN", recent_invoices: [] }], invoices: [], products: [] });
  return answer(config, { customers: [], products: [], invoices: [
    quick(1, "KGH/2026-27/131", "2026-10-07"), quick(2, "KGH/2026-27/31", "2026-09-01", { status: "cancelled" }), quick(3, "KGH/2026-27/310", "2026-10-08"),
  ] });
};
/** The bin: KGH/2026-27/27 for "27". */
const theBin: Answer = (config) => answer(config, { count: 1, next: null, previous: null, results: (config.params as { q: string }).q === "27" ? [wireBin()] : [] });
let asked: string[] = [];
/** The app's server: today's bills, a quick search that finds bills by number or Anil, the bin, and one firm (each can be swapped). */
function serve({ today = TODAY, search = quickSearch, bin = theBin }: { today?: Record<string, unknown>[]; search?: Answer; bin?: Answer } = {}) {
  asked = [];
  api.defaults.adapter = ((config) => {
    const url = String(config.url);
    asked.push(`${url}?${new URLSearchParams(config.params as Record<string, string>).toString()}`);
    if (url.startsWith("businesses/")) return answer(config, { results: [{ id: 3, name: "KIRAN GOLD HOUSE", gst_number: "08ABCPK1234F1Z5", state_name: "RAJASTHAN" }] });
    if (url === "sales/") return answer(config, wirePage(today));
    if (url === "bin/") return bin(config);
    if (url.startsWith("search/quick/")) return search(config);
    return answer(config, { results: [] });
  }) as AxiosAdapter;
}
function Where() { const l = useLocation(); return <p data-testid="where">{`${l.pathname}${l.search}`}</p>; }
const mount = (me?: Partial<Me>) => renderApp(<><Routes><Route path="*" element={<Palette open onClose={() => {}} />} /></Routes><Where /></>, { path: "/", me });

/**
 * India's 12:30 on 8 Oct 2026, on a clock that moves only when the test says (Ruling 1B-10), however busy the machine:
 * the search's 250 ms pause and the dialog's 350 ms guard pass when the test says, and no step waits on real time.
 * Testing Library's async helpers wait on timers this clock never runs, so the steps are fireEvent and pass().
 */
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: new Date("2026-10-08T12:30:00+05:30") });
  serve();
});
afterEach(() => { vi.useRealTimers(); act(() => { __setNetState("online"); onlineManager.setOnline(true); }); });
/** The clock moves `ms` on; then what that set off reaches the screen (TanStack sends its news on a 0 ms timer). */
async function pass(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}
/** What's typed in the box; then typing pauses (250 ms), so the search asks and its answer shows. */
async function type(text: string) {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: text } });
  await pass(250);
}
const headings = () => [...document.querySelectorAll("#palette-list .caps")].map((h) => h.textContent);
const bins = () => asked.filter((a) => a.startsWith("bin/"));

test("opened empty, search lists today's newest bills after the actions, asked once", async () => {
  mount();
  await pass(0);
  expect(screen.getByRole("option", { name: "KGH/2026-27/32 Meena Jain · 12:09 · ₹31,556.04" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "KGH/2026-27/31 Anil Gupta · 10:42 · ₹87,083.21" })).toBeInTheDocument();
  expect(headings()).toEqual(["Actions", "Today's bills", "Pages"]);
  expect(asked.filter((a) => a.startsWith("sales/"))).toEqual(["sales/?start_date=2026-10-08&end_date=2026-10-08&page_size=3"]);
});

test("a bare number puts that bill first, a cancelled one says so; deleted bills are found for the owner and open to restore", async () => {
  mount();
  await pass(0);
  await type("31");
  const bills = screen.getAllByRole("option").filter((o) => /^KGH/.test(o.textContent ?? ""));
  expect(bills.map((o) => o.textContent?.split("Meena")[0])).toEqual(["KGH/2026-27/31", "KGH/2026-27/310", "KGH/2026-27/131"]);
  expect(bills[0]).toHaveTextContent("Meena Jain · 01 Sep 2026 · ₹1,000.00 · cancelled");
  await type("27");
  const gone = screen.getByRole("option", { name: "KGH/2026-27/27 deleted 03 Oct · Walk-in Customer · open it to restore" });
  expect(gone.querySelector("svg")).toHaveClass("text-neg");
  expect(asked).toContain("bin/?q=27&page_size=3");
  await pass(400); // past the dialog's guard against the tap that opened it
  fireEvent.click(gone);
  await pass(0);
  expect(screen.getByTestId("where")).toHaveTextContent("/sales/205");
}, 15_000); // two searches and many role queries: past 5 s on a busy 2-CPU machine

test("someone who can't delete bills isn't searched for deleted ones", async () => {
  mount({ role: "staff", permissions: ["view", "bill.create", "bill.send", "customer.edit"] });
  await pass(0);
  await type("27");
  expect(screen.getByRole("option", { name: /^KGH\/2026-27\/310 / })).toBeInTheDocument();
  // the search has answered, and the clock moves on: a request for deleted bills would have gone by now
  await pass(1_000);
  expect(bins()).toEqual([]);
  expect(headings()).not.toContain("Deleted bills");
});

test("words go straight to a list: “udhaar sep”, and “new anil” asks for Anil and offers his new bill", async () => {
  mount();
  await pass(0);
  const box = screen.getByRole("combobox");
  fireEvent.change(box, { target: { value: "udhaar sep" } });
  expect(screen.getAllByRole("option")[0]).toHaveTextContent("Sales bills · September 2026 · paid by udhaar");
  expect(headings()[0]).toBe("Go straight to");
  await type("new anil");
  expect(screen.getByRole("option", { name: "New bill for Anil Gupta" })).toBeInTheDocument();
  expect(asked.filter((a) => a.startsWith("search/"))).toContain("search/quick/?q=anil");
  fireEvent.keyDown(box, { key: "Enter" });
  await pass(0);
  expect(screen.getByTestId("where")).toHaveTextContent("/sales/new?customer=7");
}, 15_000); // as above

/* ── Beyond the brief: Neon's free plan, one request per term for the owner, paper and cancelled bills, and the deleted bills' timing ── */

test("today's bills are asked once as search opens and kept 30 s: never on a timer, nor as the box is cleared; an opening after 30 s asks again", async () => {
  function Openable() {
    const [open, setOpen] = useState(true);
    return <><button type="button" onClick={() => setOpen(true)}>Open search</button><Palette open={open} onClose={() => setOpen(false)} /></>;
  }
  renderApp(<Openable />, { path: "/" });
  await pass(0);
  const todays = () => asked.filter((a) => a.startsWith("sales/"));
  const close = async () => { fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" }); await pass(400); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); };
  const open = async () => { fireEvent.click(screen.getByRole("button", { name: "Open search" })); await pass(0); };
  expect(todays()).toHaveLength(1);
  // closed and opened again within 30 s: what was asked stands
  await close();
  await open();
  expect(screen.getByRole("option", { name: /^KGH\/2026-27\/32 Meena Jain/ })).toBeInTheDocument();
  expect(todays()).toHaveLength(1);
  // open for a minute, then typing and clearing the box: nothing more is asked (the database is Neon's free plan)
  await pass(60_000);
  await type("me");
  await type("");
  expect(screen.getByRole("option", { name: /^KGH\/2026-27\/32 Meena Jain/ })).toBeInTheDocument();
  expect(todays()).toHaveLength(1);
  // the next opening, past 30 s: asked again
  await close();
  await open();
  expect(todays()).toHaveLength(2);
}, 15_000); // two openings and many role queries: past 5 s on a busy 2-CPU machine

test("the owner's deleted bills are asked for once typing pauses, once per term", async () => {
  mount();
  await pass(0);
  const box = screen.getByRole("combobox");
  for (const t of ["2", "20", "202", "2026"]) { fireEvent.change(box, { target: { value: t } }); await pass(100); }
  expect(bins()).toEqual([]);
  await pass(150);
  expect(bins()).toEqual(["bin/?q=2026&page_size=3"]);
  await type("27");
  await type("2026");
  expect(bins()).toEqual(["bin/?q=2026&page_size=3", "bin/?q=27&page_size=3"]);
});

test("a paper bill among today's says so in place of its time, and a cancelled one says so", async () => {
  serve({ today: [wireRow({ id: 420, invoice_number: "KGH/2026-27/34", paper: true, created_at: "2026-10-08T12:20:00+05:30" }), wireRow({ status: "cancelled" })] });
  mount();
  await pass(0);
  expect(screen.getByRole("option", { name: "KGH/2026-27/34 Anil Gupta · paper bill · ₹87,083.21" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "KGH/2026-27/31 Anil Gupta · 10:42 · ₹87,083.21 · cancelled" })).toBeInTheDocument();
});

test("deleted bills come with the search's records, never after them; deleted bills that can't be read are left out", async () => {
  let binIn: (data: unknown) => void = () => {};
  serve({ bin: (config) => new Promise((resolve) => { binIn = (data) => { void resolve({ status: 200, statusText: "", headers: {}, config, data }); }; }) });
  mount();
  await pass(0);
  await type("27");
  // the records are in, the deleted bills not yet: nothing shows until both are
  expect(asked.filter((a) => a.startsWith("search/"))).toEqual(["search/quick/?q=27"]);
  expect(screen.getByRole("status")).toHaveTextContent("Searching…");
  expect(screen.queryByRole("option", { name: /^KGH\/2026-27\/310/ })).not.toBeInTheDocument();
  await act(async () => { binIn({ count: 1, next: null, previous: null, results: [wireBin()] }); });
  await pass(0);
  expect(screen.getByRole("option", { name: /^KGH\/2026-27\/310/ })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /^KGH\/2026-27\/27 deleted/ })).toBeInTheDocument();
  // the bin can't be read: the records show without it
  serve({ bin: noReply });
  await type("2026");
  expect(screen.getByRole("option", { name: /^KGH\/2026-27\/310/ })).toBeInTheDocument();
  expect(headings()).not.toContain("Deleted bills");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
}, 15_000); // two searches, a held answer and many role queries: past 5 s on a busy 2-CPU machine

test("Try again asks through the client for the search and, when they failed too, the deleted bills: both come back together", async () => {
  let down = true;
  let binIn = () => {};
  serve({
    search: (config) => (down ? noReply(config) : quickSearch(config)),
    bin: (config) => (down ? noReply(config) : new Promise((resolve) => { binIn = () => { void resolve(theBin(config)); }; })),
  });
  mount();
  await pass(0);
  await type("27");
  expect(screen.getByRole("status")).toHaveTextContent("The app couldn't reach the shop's records just now, so customers, bills and products weren't searched.");
  down = false;
  await pass(400); // past the dialog's guard against the tap that opened it
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await pass(0);
  // the search has answered, the deleted bills not yet: the records wait for them
  expect(screen.getByRole("status")).toHaveTextContent("Searching…");
  expect(screen.queryByRole("option", { name: /^KGH\/2026-27\/310/ })).not.toBeInTheDocument();
  await act(async () => { binIn(); });
  await pass(0);
  expect(screen.getByRole("option", { name: /^KGH\/2026-27\/310/ })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /^KGH\/2026-27\/27 deleted/ })).toBeInTheDocument();
  expect(asked.filter((a) => a.startsWith("search/"))).toEqual(["search/quick/?q=27", "search/quick/?q=27"]);
  expect(bins()).toEqual(["bin/?q=27&page_size=3", "bin/?q=27&page_size=3"]);
}, 15_000); // as above

test("a customer whose name starts like a month (Mayank) is found and opened by Enter, not May's bills", async () => {
  serve({ search: (config) => answer(config, { customers: [{ id: 9, name: "Mayank Soni", mobile_number: "9414000001", gst_number: "", state_name: "RAJASTHAN", recent_invoices: [] }], invoices: [], products: [] }) });
  mount();
  await pass(0);
  await type("mayank");
  expect(headings()[0]).toBe("Customers");
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  await pass(0);
  expect(screen.getByTestId("where")).toHaveTextContent("/customers/9");
});

/* ── Review fix 1 ── */

test("a plain number that is a bill's own number puts that bill before customers whose phone holds the digits, so Enter opens the bill", async () => {
  serve({ search: (config) => answer(config, {
    customers: [{ id: 5, name: "Bharat Soni", mobile_number: "9831012345", gst_number: "", state_name: "RAJASTHAN", recent_invoices: [] }],
    invoices: [quick(99, "31", "2026-09-02", { paper: true }), quick(1, "KGH/2026-27/131", "2026-10-07")], products: [],
  }) });
  mount();
  await pass(0);
  // no bill has the number typed: customers come first, as before
  await type("9831");
  expect(headings()).toEqual(["Customers", "Sales bills"]);
  // a paper bill numbered as typed: it comes first, ahead of the customer whose phone holds 31
  await type("31");
  expect(headings()).toEqual(["Sales bills", "Customers"]);
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["31Meena Jain · 02 Sep 2026 · ₹1,000.00", "KGH/2026-27/131Meena Jain · 07 Oct 2026 · ₹1,000.00", "Bharat Soni98310 12345"]);
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  await pass(0);
  expect(screen.getByTestId("where")).toHaveTextContent("/sales/99");
});
