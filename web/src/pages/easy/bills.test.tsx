import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Link } from "react-router";
import { useState } from "react";
import { focusManager, onlineManager, QueryClientProvider } from "@tanstack/react-query";
import { __setNetState } from "@/core/api/network";
import { renderApp, testQueryClient } from "@/test/render";
import { salesServer, wirePage, wireRow, refuse } from "@/core/sales/fixtures";
import type { BillRow } from "@/core/sales/types";
import { BillsBody, type BillsRead } from "./BillsBody";
import { useSalesList } from "@/core/api/sales";
import { fyOf, monthOf } from "@/core/format";

// Body seam only: the final page passes the real 6B useEasyBills hook. Its wiring
// is tested after 6B lands, in bills-pages.integration.test.tsx (X-40).
const reads: { firmId: number | null; filters: Parameters<BillsRead>[1]; today: string }[] = [];
const useTestBills: BillsRead = (firmId, filters, today) => {
  reads.push({ firmId, filters, today });
  const fy = fyOf(today);
  const term = filters.q?.trim();
  return useSalesList(firmId, {
    ...(term ? { q: term, start_date: `${Number(fy.slice(0, 4)) - Number(Boolean(filters.lastYear))}-04-01`, end_date: today }
      : filters.when === "today" ? { start_date: today, end_date: today }
        : filters.when === "month" ? { month: monthOf(today) } : { fy }),
    ordering: "-date",
  }, fy);
};

const rows = (bills: BillRow[]) => <ul>{bills.map((b) => <li key={b.id}><Link to={`/e/bill/${b.id}`}>{b.customer.name}</Link></li>)}</ul>;
beforeEach(() => { reads.length = 0; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T12:00:00+05:30")); });
afterEach(() => vi.useRealTimers());

test("an offline period change shows recovery instead of a placeholder skeleton, then loads on reconnect", async () => {
  const { calls } = salesServer([["GET", "sales/", ({ params }) => wirePage([wireRow({ customer: { id: 7, name: params.month ? "Month buyer" : "Today buyer", type: "person", mobile_number: "9829041122", gst_number: "" } })])]]);
  renderApp(<BillsBody useBills={useTestBills} firmId={3} renderRows={rows} />, { path: "/e/bills" });
  expect(await screen.findByRole("link", { name: "Today buyer" })).toBeInTheDocument();
  try {
    act(() => { __setNetState("offline"); onlineManager.setOnline(false); });
    fireEvent.click(screen.getByRole("radio", { name: "This month" }));
    expect(await screen.findByText("You're offline")).toBeInTheDocument();
    expect(screen.queryByText("Loading sales bills…")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Today buyer" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "This month" })).toBeChecked();
    expect(calls.filter(c => c.url === "sales/")).toHaveLength(1);
  } finally {
    act(() => { __setNetState("online"); onlineManager.setOnline(true); });
  }
  expect(await screen.findByRole("link", { name: "Month buyer" })).toBeInTheDocument();
});

test("a paused retry while hidden keeps loading without claiming the phone is offline", async () => {
  const client = testQueryClient();
  client.setQueryDefaults(["sales", "list"], { retry: 1, retryDelay: 0 });
  let attempts = 0;
  let latest: ReturnType<BillsRead> | undefined;
  const useObservedBills: BillsRead = (...args) => (latest = useTestBills(...args));
  salesServer([["GET", "sales/", ({ params }) => {
    if (!params.month) return wirePage([wireRow()]);
    return ++attempts === 1 ? refuse(500, { detail: "Temporarily unavailable" }) : wirePage([]);
  }]]);
  const view = renderApp(<QueryClientProvider client={client}><BillsBody useBills={useObservedBills} firmId={3} renderRows={rows} /></QueryClientProvider>, { path: "/e/bills" });
  try {
    await screen.findByRole("link", { name: "Anil Gupta" });
    act(() => { __setNetState("online"); focusManager.setFocused(false); });
    fireEvent.click(screen.getByRole("radio", { name: "This month" }));
    await waitFor(() => expect(latest).toMatchObject({ isPaused: true, isPlaceholderData: true }));
    expect(attempts).toBe(1);
    expect(screen.queryByText("You're offline")).not.toBeInTheDocument();
    expect(screen.getByText("Loading sales bills…")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Anil Gupta" })).not.toBeInTheDocument();
    act(() => focusManager.setFocused(true));
    expect(await screen.findByText("No bills this month yet")).toBeInTheDocument();
    expect(attempts).toBe(2);
  } finally {
    view.unmount();
    focusManager.setFocused(undefined);
    client.clear();
  }
});

test("one firm and 40 rows; whole-period summary excludes cancelled bills", async () => {
  const page = wirePage([wireRow(), wireRow({ id: 413, status: "cancelled" })]);
  page.count = 312;
  page.next = "/api/sales/?page=2";
  page.summary = { ...(page.summary as object), bills: 300, total_amount: "912345.67", cancelled: 12 };
  const { calls } = salesServer([["GET", "sales/", () => page]]);
  renderApp(<BillsBody useBills={useTestBills} firmId={3} renderRows={rows} />, { path: "/e/bills" });
  expect(await screen.findByRole("heading", { name: /Today: 300 bills/ })).toHaveTextContent("₹9,12,345.67");
  expect(reads.at(-1)).toEqual({ firmId: 3, filters: { when: "today", q: "", lastYear: false }, today: "2026-10-08" });
  expect(screen.getByText(/12 cancelled bills not counted/)).toBeInTheDocument();
  expect(screen.getByText("Showing the newest 40 of 312. Search to find older ones.")).toBeInTheDocument();
  expect(calls.filter((c) => c.url === "sales/")).toEqual([expect.objectContaining({ params: { business_id: 3, start_date: "2026-10-08", end_date: "2026-10-08", ordering: "-date", page: 1, page_size: 40 } })]);
});

test("month and FY filters use today's IST year and never the full view's year", async () => {
  const { calls } = salesServer([["GET", "sales/", () => wirePage([])]]);
  renderApp(<BillsBody useBills={useTestBills} firmId={3} renderRows={rows} />, { path: "/e/bills?when=month" });
  await screen.findByText("No bills this month yet");
  expect(calls.find((c) => c.url === "sales/")?.params).toEqual({ business_id: 3, month: "2026-10", ordering: "-date", page: 1, page_size: 40 });
  fireEvent.click(screen.getByRole("radio", { name: "This year" }));
  await screen.findByText("No bills this year yet");
  await waitFor(() => expect(calls.at(-1)?.params).toEqual({ business_id: 3, fy: "2026-27", ordering: "-date", page: 1, page_size: 40 }));
});

test.each([
  ["This month", "October so far", { month: "2026-10" }],
  ["This year", "This year", { fy: "2026-27" }],
] as const)("%s withholds the previous period's money and rows until its answer arrives", async (period, heading, filter) => {
  const todayRow = wireRow({ total_amount: "100.00" });
  const olderRow = wireRow({ id: 413, total_amount: "200.50", invoice_date: "2026-10-01", customer: { id: 8, name: "Rekha Jain", type: "person", mobile_number: "9829041123", gst_number: "" } });
  let finish!: (page: ReturnType<typeof wirePage>) => void;
  const pending = new Promise<ReturnType<typeof wirePage>>((resolve) => { finish = resolve; });
  const { calls } = salesServer([["GET", "sales/", ({ params }) => params.month || params.fy ? pending : wirePage([todayRow])]]);
  renderApp(<BillsBody useBills={useTestBills} firmId={3} renderRows={rows} />, { path: "/e/bills" });
  expect(await screen.findByRole("heading", { name: /Today: 1 bill/ })).toHaveTextContent("₹100.00");
  expect(screen.getByRole("link", { name: "Anil Gupta" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("radio", { name: period }));
  await waitFor(() => expect(calls.at(-1)?.params).toMatchObject(filter));
  expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
  expect(screen.queryByText("₹100.00")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Anil Gupta" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Rekha Jain" })).not.toBeInTheDocument();
  expect(screen.getByText("Loading sales bills…")).toBeInTheDocument();

  await act(async () => { finish(wirePage([todayRow, olderRow])); });
  expect(await screen.findByRole("heading", { name: new RegExp(`${heading}: 2 bills`) })).toHaveTextContent("₹300.50");
  expect(screen.getByRole("link", { name: "Anil Gupta" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Rekha Jain" })).toBeInTheDocument();
  expect(screen.queryByText("Loading sales bills…")).not.toBeInTheDocument();
});

test("numeric search stays as typed for server ranking and includes last FY only when ticked", async () => {
  const { calls } = salesServer([["GET", "sales/", () => wirePage([])]]);
  renderApp(<BillsBody useBills={useTestBills} firmId={3} renderRows={rows} />, { path: "/e/bills?q=031" });
  await screen.findByText("No bills for “031” this year");
  expect(reads.at(-1)?.filters).toEqual({ when: "today", q: "031", lastYear: false });
  expect(screen.queryByRole("radiogroup", { name: "Which bills" })).not.toBeInTheDocument();
  expect(calls.at(-1)?.params).toEqual({ business_id: 3, q: "031", start_date: "2026-04-01", end_date: "2026-10-08", ordering: "-date", page: 1, page_size: 40 });
  fireEvent.click(screen.getByRole("checkbox", { name: "Show last year's bills too (FY 2025-26)" }));
  await waitFor(() => expect(calls.at(-1)?.params.start_date).toBe("2025-04-01"));
  expect(await screen.findByText("No bills for “031”")).toBeInTheDocument();
});

test.each(["2027-04-01", "2027-05-31"])("last year is selected by default on %s", async (day) => {
  vi.setSystemTime(new Date(`${day}T00:01:00+05:30`));
  const { calls } = salesServer([["GET", "sales/", () => wirePage([])]]);
  renderApp(<BillsBody useBills={useTestBills} firmId={3} renderRows={rows} />, { path: "/e/bills?q=Anil" });
  expect(await screen.findByRole("checkbox", { name: "Show last year's bills too (FY 2026-27)" })).toBeChecked();
  await waitFor(() => expect(calls.at(-1)?.params).toMatchObject({ q: "Anil", start_date: "2026-04-01", end_date: day }));
});

test("31 March stays in the FY and text searches keep spaces after trimming only their edges", async () => {
  vi.setSystemTime(new Date("2027-03-31T23:59:00+05:30"));
  const { calls } = salesServer([["GET", "sales/", () => wirePage([])]]);
  renderApp(<BillsBody useBills={useTestBills} firmId={3} renderRows={rows} />, { path: "/e/bills?q=%20Anil%20Gupta%20" });
  await screen.findByText("No bills for “Anil Gupta” this year");
  expect(calls.at(-1)?.params).toMatchObject({ q: "Anil Gupta", start_date: "2026-04-01", end_date: "2027-03-31" });
});

test("waiting for a firm makes no sales request and does not invent zero figures", async () => {
  const { calls } = salesServer();
  renderApp(<BillsBody useBills={useTestBills} firmId={null} renderRows={rows} />);
  await act(async () => {});
  expect(calls.filter((c) => c.url === "sales/")).toHaveLength(0);
  expect(screen.getByText("Loading sales bills…")).toBeInTheDocument();
  expect(screen.queryByText(/0 bills/)).not.toBeInTheDocument();
});

test("load error keeps the period controls and retries the same narrow request", async () => {
  let fails = true;
  const { calls } = salesServer([["GET", "sales/", () => fails ? refuse(500, { detail: "Failed" }) : wirePage([])]]);
  renderApp(<BillsBody useBills={useTestBills} firmId={3} renderRows={rows} />);
  expect(await screen.findByText("Couldn't load the bill list")).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Today" })).toBeInTheDocument();
  fails = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("No bills yet today");
  expect(calls.filter((c) => c.url === "sales/")).toHaveLength(2);
});

test("a changed firm never shows the previous firm's rows while the next one loads", async () => {
  salesServer([["GET", "sales/", ({ params }) => params.business_id === 3 ? wirePage([wireRow()]) : new Promise(() => {})]]);
  function ChangingFirm() { const [firm, setFirm] = useState(3); return <><button onClick={() => setFirm(2)}>Change firm</button><BillsBody useBills={useTestBills} firmId={firm} renderRows={rows} /></>; }
  renderApp(<ChangingFirm />);
  await screen.findByRole("link", { name: "Anil Gupta" });
  fireEvent.click(screen.getByRole("button", { name: "Change firm" }));
  expect(screen.queryByRole("link", { name: "Anil Gupta" })).not.toBeInTheDocument();
});
