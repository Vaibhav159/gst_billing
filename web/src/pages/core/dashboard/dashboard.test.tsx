import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Action } from "@/core/auth/permissions";
import { useLocation } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { wireDashboard, wireDue } from "@/core/dashboard/fixtures";
import { dashboardKeys, dueNextKeys } from "@/core/api/dashboard";
import { refuse, salesServer } from "@/core/sales/fixtures";
import { ScopeProvider } from "@/core/scope";
import { renderApp } from "@/test/render";
import { handClock, pass } from "@/test/clock";
import Dashboard from "../Dashboard";
function Tools() {
  const qc = useQueryClient(), where = useLocation();
  return <><output aria-label="Location">{where.pathname}</output><button onClick={() => { void qc.invalidateQueries({ queryKey: dashboardKeys.all }); void qc.invalidateQueries({ queryKey: dueNextKeys.all }); }}>Refresh fixture</button></>;
}
function show(path = "/", me = { permissions: "*" as "*" | Action[] }) {
  return renderApp(<ScopeProvider><Tools /><Dashboard rates={<div>Rates from 5C</div>} /></ScopeProvider>, { path, me });
}
beforeEach(() => { localStorage.clear(); Object.assign(window, { __phone: false }); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T11:00:00+05:30")); });
afterEach(() => vi.useRealTimers());
test("desktop opens its independent cards and makes only one scoped figures and rich due request", async () => {
  const { calls } = salesServer([["GET", "dashboard/", () => wireDashboard()], ["GET", "due-next/", () => wireDue()]]); show("/?firm=3&fy=2025-26");
  expect(await screen.findByRole("region", { name: "Today's sales" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Due next" })).toBeVisible(); expect(screen.getByText("Rates from 5C")).toBeVisible();
  expect(calls.filter(c => c.url === "dashboard/").map(c => c.params)).toEqual([{ business_id: 3, fy: "2025-26" }]);
  expect(calls.filter(c => c.url === "due-next/").map(c => c.params)).toEqual([{ business_id: 3 }]);
});
test("unknown and malformed deep links preserve the valid existing scope", async () => {
  localStorage.setItem("gst3.scope.1", "3");
  const { calls } = salesServer([["GET", "dashboard/", () => wireDashboard()], ["GET", "due-next/", () => wireDue()]]); show("/?firm=NaN&fy=garbage");
  await screen.findByRole("region", { name: "Today's sales" });
  expect(calls.find(c => c.url === "dashboard/")?.params).toEqual({ business_id: 3, fy: "2026-27" });
});
test("slow first paint is a skeleton, never false zero figures", async () => {
  handClock(new Date("2026-10-08T11:00:00+05:30"));
  salesServer([["GET", "dashboard/", () => new Promise(() => {})], ["GET", "due-next/", () => wireDue()]]); show(); await pass();
  expect(screen.getByLabelText("Loading today's figures")).toHaveAttribute("aria-busy", "true"); expect(screen.queryByText(/₹0/)).not.toBeInTheDocument();
  await pass(1401); expect(screen.getByText("Still loading today's figures…")).toBeVisible();
});
test("due errors stay in Due next and returns while today's figures remain", async () => {
  salesServer([["GET", "dashboard/", () => wireDashboard()], ["GET", "due-next/", () => refuse(503, { detail: "Unavailable" })]]); show();
  await screen.findByRole("region", { name: "Today's sales" });
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(2));
  expect(screen.getByText("Rates from 5C")).toBeVisible();
});
test("failed refetch retains visible figures and reports the stale answer", async () => {
  let fail = false;
  salesServer([["GET", "dashboard/", () => fail ? refuse(503, {}) : wireDashboard()], ["GET", "due-next/", () => wireDue()]]); show();
  await screen.findByRole("region", { name: "Today's sales" }); fail = true; fireEvent.click(screen.getByRole("button", { name: "Refresh fixture" }));
  expect(await screen.findByText("Couldn't refresh today's figures")).toBeVisible(); expect(screen.getByRole("region", { name: "Today's sales" })).toBeVisible();
});
test("phone keeps header Search, firm chips, action bar and FY links", async () => {
  Object.assign(window, { __phone: true });
  salesServer([["GET", "dashboard/", () => wireDashboard()], ["GET", "due-next/", () => wireDue()]]); show();
  expect(await screen.findByText("Sales today")).toBeVisible(); expect(screen.getByRole("radiogroup", { name: "Firm" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Financial year 2026-27" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Bright screen for sunlight" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Capture" })).toHaveAttribute("href", "/capture"); expect(screen.getByRole("link", { name: "New bill" })).toBeVisible();
  expect(screen.getByRole("link", { name: /Month by month/ })).toHaveAttribute("href", "/reports/months");
});
test("viewer gets reading cards, no create/capture actions or changes", async () => {
  salesServer([["GET", "dashboard/", () => ({ ...wireDashboard(), changes: null })], ["GET", "due-next/", () => ({ ...wireDue(), items: [] })]]); show("/", { permissions: ["view"] });
  expect(await screen.findByText("Nothing for you to do here")).toBeVisible(); expect(screen.queryByRole("link", { name: "New bill" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Latest changes" })).not.toBeInTheDocument(); expect(screen.getByRole("link", { name: "View" })).toBeVisible();
});
test("a failed firm read never redirects to setup or fetches figures for a guessed firm", async () => {
  const { calls } = salesServer([["GET", "businesses/", () => refuse(503, {})]]); show();
  expect(await screen.findByRole("button", { name: "Try again" })).toBeVisible(); expect(screen.getByLabelText("Location")).toHaveTextContent("/");
  expect(calls.some(c => c.url === "dashboard/" || c.url === "due-next/")).toBe(false);
});
test("before 4C's setup gate, no firms retains the existing placeholder and reads no figures", async () => {
  const { calls } = salesServer([["GET", "businesses/", () => ({ results: [] })]]); show();
  expect(await screen.findByText("Dashboard comes in part 5")).toBeVisible(); expect(calls.some(c => c.url === "dashboard/")).toBe(false);
});
test("the phone's firm chips scope both queries, and last30 toggle reads nothing", async () => {
  Object.assign(window, { __phone: true });
  const { calls } = salesServer([["GET", "dashboard/", () => wireDashboard()], ["GET", "due-next/", () => wireDue()]]); show(); await screen.findByText("Sales today");
  fireEvent.click(screen.getByRole("radio", { name: "Kiran" }));
  await waitFor(() => expect(calls.filter(c => c.url === "dashboard/").at(-1)?.params.business_id).toBe(3));
  await screen.findByText("Sales today"); const count = calls.length;
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Period" })).getByRole("radio", { name: "Last 30 days" }));
  await act(async () => {}); expect(calls).toHaveLength(count);
});
test("offline refresh keeps the last figures and the existing offline words", async () => {
  let fail = false;
  salesServer([["GET", "dashboard/", () => fail ? refuse(0, {}) : wireDashboard()], ["GET", "due-next/", () => wireDue()]]);
  show(); await screen.findByRole("region", { name: "Today's sales" });
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  try {
    fail = true; fireEvent.click(screen.getByRole("button", { name: "Refresh fixture" }));
    expect(await screen.findByText("You're offline, so this is what was last loaded. It refreshes when you're back online.")).toBeVisible();
    expect(screen.getByRole("region", { name: "Today's sales" })).toBeVisible();
  } finally { online.mockRestore(); }
});
test("past FY keeps today's bills and due facts beside March and recorded annual cash", async () => {
  const data = wireDashboard(); data.current = false; data.fy = "2025-26";
  data.month = { ...data.month, kind: "last_of_fy", month: "2026-03", from: "2026-03-01", to: "2026-03-31" };
  data.returns_year = [{ firm: { id: 3, name: "KIRAN GOLD HOUSE", gst_number: "", state_name: "" }, months_filed: 12, last_gstr3b_filed_on: "2026-04-18", cash_paid: "412880.00" }];
  salesServer([["GET", "dashboard/", () => ({ ...data, last30: null })], ["GET", "due-next/", () => ({ ...wireDue(), returns: null })]]);
  show("/?fy=2025-26");
  expect(await screen.findByRole("heading", { name: "March 2026" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Today's sales" })).toHaveTextContent("Anil Gupta");
  expect(screen.getByRole("region", { name: "FY 2025-26 returns" })).toHaveTextContent("₹4,12,880.00");
  expect(screen.getByRole("region", { name: "Due next" })).toHaveTextContent("Pay ₹98,410.00 GSTR-3B tax in cash");
  expect(screen.queryByRole("radiogroup", { name: "Period" })).not.toBeInTheDocument();
});
