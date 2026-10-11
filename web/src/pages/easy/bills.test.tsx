import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Link } from "react-router";
import { useState } from "react";
import { renderApp } from "@/test/render";
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
