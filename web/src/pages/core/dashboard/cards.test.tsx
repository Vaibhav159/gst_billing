import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { wireDashboard } from "@/core/dashboard/fixtures";
import { toDashboard } from "@/core/dashboard/wire";
import { salesServer, wireRow } from "@/core/sales/fixtures";
import { toBillRow } from "@/core/sales/wire";
import { renderApp } from "@/test/render";
import { TodayCard } from "./TodayCard";
import { MonthCard } from "./MonthCard";
import { LatestChanges } from "./LatestChanges";

beforeEach(() => { salesServer(); });
afterEach(() => { cleanup(); vi.useRealTimers(); (window as unknown as { __phone: boolean }).__phone = false; });
const dashboard = () => toDashboard(wireDashboard());

test("desktop uses the server's totals and all 100 rows, with the server's omitted count", async () => {
  const data = dashboard();
  data.today.bills = Array.from({ length: 100 }, (_, i) => toBillRow(wireRow({ id: i + 1, invoice_number: `TEST/${i + 1}`, paper: true })));
  data.today.count = 123; data.today.more = 23; data.today.total = 12345678;
  data.today.by_payment = [{ mode: "cash", total: 234567 }, { mode: "bank", total: 12111111 }];
  renderApp(<TodayCard data={data} scope="All firms" allFirms />);
  expect(screen.getByRole("table", { name: "Today's sales bills" }).querySelectorAll("tbody tr")).toHaveLength(100);
  expect(screen.getByText("123 bills · incl. GST")).toBeInTheDocument();
  expect(screen.getByText("₹1,23,456.78", { selector: ".sr-only" })).toBeInTheDocument();
  expect(screen.getByText("Billed today:").parentElement).toHaveTextContent("Cash ₹2,345.67 · UPI ₹1,21,111.11");
  expect(screen.getByText("and 23 more").closest("a")).toHaveAttribute("href", "/sales?when=today");
  expect(await screen.findAllByText("Kiran")).toHaveLength(100);
}, 15_000);

test("phone shows five rows and a link with the true count including omitted rows", () => {
  const data = dashboard();
  data.today.bills = Array.from({ length: 100 }, (_, i) => toBillRow(wireRow({ id: i + 1, invoice_number: `TEST/${i + 1}`, paper: true })));
  data.today.count = 123; data.today.more = 23; data.today.total = 12345678;
  renderApp(<TodayCard data={data} scope="All firms" allFirms phone />);
  expect(screen.getAllByRole("listitem")).toHaveLength(5);
  expect(screen.getByRole("link", { name: "All 123 bills today · ₹1,23,456.78" })).toHaveAttribute("href", "/sales?when=today");
});

test("today's rows reuse SendCell, keep paper quiet, and offer a fix for no items", async () => {
  const data = dashboard();
  data.today.bills = [toBillRow(wireRow()), toBillRow(wireRow({ id: 413, invoice_number: "PAPER", paper: true })), toBillRow(wireRow({ id: 414, invoice_number: "EMPTY", line_count: 0 }))];
  data.today.count = 3;
  renderApp(<TodayCard data={data} scope="Kiran" allFirms={false} />);
  expect(await screen.findByRole("button", { name: "Send KGH/2026-27/31 on WhatsApp" })).toBeInTheDocument();
  expect(screen.getByText("On paper")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Send PAPER/ })).not.toBeInTheDocument();
  expect(screen.getByText("No items")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Fix it" })).toHaveAttribute("href", "/sales/414");
  expect(screen.queryByRole("button", { name: /Send EMPTY/ })).not.toBeInTheDocument();
});

test.each([false, true])("no today shows only the five recent bills, Print and Fix it (phone=%s)", (phone) => {
  const data = dashboard();
  data.today = { ...data.today, count: 0, total: 0, bills: [], by_payment: [], recent: [toBillRow(wireRow({ invoice_date: "2025-03-31", invoice_number: "OLD" })), toBillRow(wireRow({ id: 413, line_count: 0 }))] };
  renderApp(<TodayCard data={data} scope="Kiran" allFirms={false} phone={phone} />);
  expect(screen.getByText(/No bills yet today/)).toHaveTextContent("The last 2 bills:");
  expect(screen.getByRole("link", { name: "Print OLD" })).toHaveAttribute("href", "/sales/412/print");
  expect(screen.getByRole("link", { name: "Fix it" })).toHaveAttribute("href", "/sales/413");
  expect(screen.getByText("No items")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Send/ })).not.toBeInTheDocument();
  if (!phone) expect(screen.getByText("31 Mar 2025")).toBeInTheDocument();
});

test("recent bills stay hidden when today has bills, even while a past FY is selected", () => {
  const data = dashboard(); data.current = false; data.fy = "2025-26";
  data.today.recent = [toBillRow(wireRow({ id: 9, invoice_number: "OLD" }))];
  renderApp(<TodayCard data={data} scope="Kiran" allFirms={false} />);
  expect(screen.getByRole("link", { name: "KGH/2026-27/31" })).toBeInTheDocument();
  expect(screen.queryByText("OLD")).not.toBeInTheDocument();
});

test("no bills at all retains the quiet recent state and All bills link", () => {
  const data = dashboard(); data.today = { ...data.today, count: 0, total: 0, bills: [], recent: [], by_payment: [] };
  renderApp(<TodayCard data={data} scope="All firms" allFirms phone />);
  expect(screen.getByText("No bills yet today. The last 0 bills:")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "All bills" })).toHaveAttribute("href", "/sales");
});

test("month toggle uses the supplied windows without any request", () => {
  const { calls } = salesServer();
  renderApp(<MonthCard data={dashboard()} scope="Kiran" />);
  expect(screen.getByRole("heading", { name: "October so far" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /^GST on purchase bills/ })).toHaveAttribute("href", "/purchases?month=2026-10");
  expect(screen.getByText("Dated in October · opens the bills")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Last 30 days" }));
  expect(screen.getByRole("heading", { name: "Last 30 days" })).toBeInTheDocument();
  expect(screen.getByText("Sales · 30 bills")).toBeInTheDocument();
  expect(screen.getByText("Dated 9 Sep to 8 Oct 2026")).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(calls).toHaveLength(0);
});

test("the server's first day starts on last 30 days even if the browser says otherwise", () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2030-04-10T10:00:00+05:30"));
  const data = dashboard(); data.today.date = "2026-10-01";
  renderApp(<MonthCard data={data} scope="Kiran" />);
  expect(screen.getByRole("radio", { name: "Last 30 days" })).toHaveAttribute("aria-checked", "true");
});

test.each([false, true])("past FY shows its complete March and no toggle (phone=%s)", (phone) => {
  const data = dashboard(); data.current = false; data.fy = "2025-26"; data.last30 = null;
  data.month = { ...data.month, kind: "last_of_fy", month: "2026-03", from: "2026-03-01", to: "2026-03-31" };
  renderApp(<MonthCard data={data} scope="Kiran" phone={phone} />);
  expect(screen.getByRole("heading", { name: "March 2026" })).toBeInTheDocument();
  expect(screen.getByText(/The last month of FY 2025-26 · 1 to 31 Mar 2026/)).toBeInTheDocument();
  expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: phone ? "Purchase bills" : /^GST on purchase bills/ })).toHaveAttribute("href", "/purchases?month=2026-03");
});

test("phone keeps the prototype's month labels and hides bill links for 30 days", () => {
  renderApp(<MonthCard data={dashboard()} scope="Kiran" phone />);
  expect(screen.getByRole("radio", { name: "This month" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sales bills" })).toHaveAttribute("href", "/sales?month=2026-10");
  fireEvent.click(screen.getByRole("radio", { name: "Last 30 days" }));
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

test("latest changes displays server words verbatim and formats its timestamp in IST", () => {
  const data = dashboard(); data.changes = [{ id: 1, at: "2026-10-07T23:45:00Z", by: { id: 2, name: "Rakesh Soni" }, title: "Corrected supplier bill ABC", detail: "Server detail, unchanged" }];
  renderApp(<LatestChanges data={data} />);
  expect(screen.getByText("Corrected supplier bill ABC")).toBeInTheDocument();
  expect(screen.getByText("Rakesh Soni · 05:15 · Server detail, unchanged")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open the Audit log" })).toHaveAttribute("href", "/audit");
});

test("latest changes hides without audit.view even if the answer has rows", () => {
  renderApp(<LatestChanges data={dashboard()} />, { me: { role: "viewer", permissions: ["view"] } });
  expect(screen.queryByRole("heading", { name: "Latest changes" })).not.toBeInTheDocument();
});

test("latest changes hides null answers but keeps an empty authorized card", () => {
  const data = dashboard(); data.changes = null;
  const shown = renderApp(<LatestChanges data={data} />);
  expect(screen.queryByRole("heading", { name: "Latest changes" })).not.toBeInTheDocument();
  shown.unmount(); data.changes = [];
  renderApp(<LatestChanges data={data} />);
  expect(screen.getByRole("heading", { name: "Latest changes" })).toBeInTheDocument();
});
