import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardData, ReturnsData } from "@/core/dashboard/types";
import { renderApp } from "@/test/render";
import { PastReturnsCard, ReturnsCard } from "./ReturnsCard";
import { YearCard } from "./YearCard";

const firm = { id: 3, name: "KIRAN GOLD HOUSE", gst_number: "08ABCPK1234F1Z5" };
const returns = (stage: ReturnsData["firms"][number]["stage"] = "ready"): ReturnsData => ({
  month: "2026-09", gstr1_due: "2026-10-11", gstr3b_due: "2026-10-20",
  firms: [{ firm, stage, blockers: stage === "blocked" ? 1 : 0, purchases_to_check: 0,
    output: 13151040, cash: 9841000, credit_used: 3310040, carry_on: 0, gstr1: null, gstr3b: null }],
});
const pastRows: NonNullable<DashboardData["returns_year"]> = [
  { firm, months_filed: 12, last_gstr3b_filed_on: "2026-04-18", cash_paid: 41288000 },
  { firm: { ...firm, id: 4, name: "MEERA JEWELLERS" }, months_filed: 7, last_gstr3b_filed_on: null, cash_paid: 0 },
];
function dashboard(): DashboardData {
  const zero = { count: 0, total: 0, taxable: 0, tax: 0 };
  return {
    today: { date: "2026-10-08", count: 0, total: 0, by_payment: [], bills: [], more: 0, recent: [] },
    fy: "2026-27", current: true,
    month: { kind: "so_far", month: "2026-10", from: "2026-10-01", to: "2026-10-08", sales: zero, purchases: zero },
    last30: null,
    year: { from: "2026-04-01", to: "2026-10-08",
      months: Array.from({ length: 7 }, (_, i) => ({ month: `2026-${String(i + 4).padStart(2, "0")}`,
        sales: { count: i === 0 ? 2 : i === 6 ? 9 : 0, total: i === 0 ? 10000 : i === 6 ? 30000 : 0, tax: 0 },
        purchases: { count: i === 0 ? 1 : i === 6 ? 3 : 0, total: i === 0 ? 20000 : i === 6 ? 10000 : 0, tax: 0 } })),
      sales: { count: 11, total: 40000 }, purchases: { count: 4, total: 30000 } },
    returns_year: null, changes: [],
  };
}
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("returns", () => {
  it.each([
    ["ready", "Ready to file", "Ready", "Review and file", ""],
    ["blocked", "Blocked · 1 check fails", "After GSTR-1", "Fix the problem", "&fix=1"],
    ["gstr1", "Filed", "Ready", "File GSTR-3B", ""],
    ["filed", "Filed", "Filed", "View", ""],
    ["unlocked", "Unlocked", "Unlocked", "Review and file", ""],
  ] as const)("renders %s and its permitted action", (stage, gstr1, gstr3b, action, suffix) => {
    renderApp(<ReturnsCard returns={returns(stage)} today="2026-10-08" />);
    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent(firm.gst_number);
    expect(cells[1]).toHaveTextContent(gstr1);
    expect(cells[2]).toHaveTextContent(gstr3b);
    expect(cells[3]).toHaveTextContent("₹98,410.00");
    expect(cells[3]).toHaveTextContent("after ₹33,100.40 of credit");
    expect(within(cells[4]).getByRole("link", { name: action })).toHaveAttribute("href", `/gst?firm=3&month=2026-09${suffix}`);
  });

  it("uses the server's check count and carry-on amounts", () => {
    const data = returns();
    Object.assign(data.firms[0], { purchases_to_check: 2, cash: 0, carry_on: 143210 });
    renderApp(<ReturnsCard returns={data} today="2026-10-08" />);
    expect(screen.getByText("2 purchases to check")).toBeInTheDocument();
    expect(screen.getByText("Credit covers it · ₹1,432.10 carries on")).toBeInTheDocument();
  });

  it("gives a viewer View even for a blocked month", () => {
    renderApp(<ReturnsCard returns={returns("blocked")} today="2026-10-08" />, { me: { role: "viewer", permissions: ["view"] } });
    expect(screen.getByRole("link", { name: "View" })).toHaveAttribute("href", "/gst?firm=3&month=2026-09");
    expect(screen.queryByRole("link", { name: "Fix the problem" })).not.toBeInTheDocument();
  });

  it.each([false, true])("keeps a phone's blocked navigation role-aware: filing=%s", (files) => {
    renderApp(<ReturnsCard returns={returns("blocked")} today="2026-10-08" phone />, { me: { permissions: files ? ["view", "gst.file"] : ["view"] } });
    expect(screen.getByRole("link", { name: /KIRAN GOLD HOUSE/ })).toHaveAttribute("href", `/gst?firm=3&month=2026-09${files ? "&fix=1" : ""}`);
    expect(screen.getByText(files ? "Blocked · tap to fix" : "Blocked · the owner is fixing it")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("cash to pay")).toBeInTheDocument();
  });

  it("shows the past year's recorded filing and cash summary", () => {
    renderApp(<PastReturnsCard rows={pastRows} fy="2025-26" />);
    expect(screen.getByRole("table", { name: "FY 2025-26 returns by firm" })).toBeInTheDocument();
    expect(screen.getByText("All 12 filed and locked")).toBeInTheDocument();
    expect(screen.getByText("7 of 12 filed")).toBeInTheDocument();
    expect(screen.getByText("GSTR-3B filed 18 Apr 2026")).toBeInTheDocument();
    expect(screen.getByText("₹4,12,880.00")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "View" })[0]).toHaveAttribute("href", "/gst?firm=3&month=2026-03");
  });

  it("keeps past returns available as compact phone rows", () => {
    renderApp(<PastReturnsCard rows={pastRows} fy="2025-26" phone />);
    expect(screen.getByRole("heading", { name: "FY 2025-26 returns" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const row = screen.getByRole("link", { name: /KIRAN GOLD HOUSE/ });
    expect(row).toHaveAttribute("href", "/gst?firm=3&month=2026-03");
    expect(row).toHaveTextContent("All 12 filed and locked");
    expect(row).toHaveTextContent("GSTR-3B filed 18 Apr 2026");
    expect(row).toHaveTextContent("₹4,12,880.00");
    expect(row).toHaveTextContent("tax paid in cash");
  });
});

describe("year", () => {
  it("names every month's figures and opens that month's bills", () => {
    renderApp(<YearCard data={dashboard()} scope="All firms" />);
    const list = screen.getByRole("list", { name: "Months: open a month's sales bills" });
    expect(within(list).getAllByRole("link")).toHaveLength(7);
    expect(within(list).getByRole("link", { name: "October 2026 so far: sales ₹300.00 in 9 bills, purchases ₹100.00 in 3 bills. Open October 2026's sales bills" })).toHaveAttribute("href", "/sales?month=2026-10");
    expect(screen.getByText(/Purchases ran above sales in 1 of 2 months: bullion stock bought for later sales, not a loss/)).toBeInTheDocument();
  });

  it("uses one scale for sales and purchases and changes to bill counts by keyboard", () => {
    vi.useFakeTimers();
    renderApp(<YearCard data={dashboard()} scope="All firms" />);
    act(() => vi.advanceTimersByTime(30));
    const april = screen.getByRole("link", { name: /Open April 2026's sales bills/ });
    const bars = april.querySelectorAll<HTMLElement>("span");
    expect(parseFloat(bars[0].style.height)).toBeCloseTo(100 / 3);
    expect(parseFloat(bars[1].style.height)).toBeCloseTo(200 / 3);
    fireEvent.keyDown(screen.getByRole("radiogroup", { name: "Chart shows" }), { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Bills" })).toHaveAttribute("aria-checked", "true");
    expect(parseFloat(bars[0].style.height)).toBe(20);
    expect(parseFloat(bars[1].style.height)).toBe(10);
    expect(screen.queryByText(/Purchases ran above sales/)).not.toBeInTheDocument();
    expect(screen.getByText("The count under each month is its sales bills.")).toBeInTheDocument();
  });

  it("leaves empty months at zero height after the intro animation", () => {
    vi.useFakeTimers();
    const data = dashboard();
    data.year.months = data.year.months.map(m => ({ ...m, sales: { count: 0, total: 0, tax: 0 }, purchases: { count: 0, total: 0, tax: 0 } }));
    renderApp(<YearCard data={data} scope="All firms" />);
    act(() => vi.advanceTimersByTime(30));
    const may = screen.getByRole("link", { name: /Open May 2026's sales bills/ });
    for (const bar of may.querySelectorAll<HTMLElement>("span")) expect(bar.style.height).toBe("0%");
  });

  it.each([true, false])("shows a phone FY summary and gates the audit link: audit=%s", (audit) => {
    renderApp(<YearCard data={dashboard()} scope="Kiran" phone />, { me: { permissions: audit ? ["view", "audit.view"] : ["view"] } });
    expect(screen.getByRole("heading", { name: "FY 2026-27 so far" })).toBeInTheDocument();
    expect(screen.getByText("1 Apr to 08 Oct · Kiran")).toBeInTheDocument();
    expect(screen.getByText("Sales · 11 bills")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Month by month" })).toHaveAttribute("href", "/reports/months");
    expect(Boolean(screen.queryByRole("link", { name: "Latest changes" }))).toBe(audit);
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("labels a past FY through March on phone", () => {
    const data = dashboard();
    Object.assign(data, { current: false, fy: "2025-26" });
    data.year.to = "2026-03-31";
    renderApp(<YearCard data={data} scope="All firms" phone />);
    expect(screen.getByRole("heading", { name: "FY 2025-26" })).toBeInTheDocument();
    expect(screen.getByText("1 Apr to 31 Mar · All firms")).toBeInTheDocument();
  });
});
