import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { focusManager, QueryClientProvider } from "@tanstack/react-query";
import { wireDashboard, wireDue, wireRates } from "@/core/dashboard/fixtures";
import { toDashboard, toDueNext, toRates } from "@/core/dashboard/wire";
import { salesServer } from "@/core/sales/fixtures";
import type { FirmId } from "@/core/scope";
import { testQueryClient } from "@/test/render";
import { pass } from "@/test/clock";
import { dashboardKeys, dueNextKeys, ratesKeys, useDashboard, useDueNext, useRates,  } from "./dashboard";
function setup() {
  const qc = testQueryClient();
  return { qc, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> };
}
afterEach(() => { focusManager.setFocused(undefined); vi.useRealTimers(); });
test("dashboard maps all monetary fields to paise and 4E words through one adapter", () => {
  const w = wireDashboard();
  w.returns_year = [{ firm: { id: 3, name: "Kiran", gst_number: "", state_name: "" }, months_filed: 12, last_gstr3b_filed_on: null, cash_paid: "412880.13" }];
  const d = toDashboard(w);
  expect(d.today.total).toBe(8708321);
  expect(d.today.bills[0].total_amount).toBe(8708321);
  expect(d.today.by_payment[0].total).toBe(8708321);
  expect(d.month.sales).toEqual({ count: 1, total: 8708321, taxable: 8454681, tax: 253640 });
  expect(d.last30?.purchases.tax).toBe(253640);
  expect(d.year.months[0].purchases.total).toBe(10000000);
  expect(d.year.sales.total).toBe(8708321);
  expect(d.returns_year?.[0].cash_paid).toBe(41288013);
  expect(d.changes?.[0]).toMatchObject({ title: "Sent KGH/2026-27/31", detail: "To Anil Gupta on WhatsApp" });
});
test("permission-hidden changes, missing past returns and an absent board stay null", () => {
  expect(toDashboard({ ...wireDashboard(), changes: null }).changes).toBeNull();
  expect(toDueNext({ today: "2026-10-08", items: [], returns: null }).returns).toBeNull();
  expect(toRates({ today: "2026-10-08", rows: [], latest: null, previous: null, set_today: false }).latest).toBeNull();
});
test("due returns and filings convert money without rewording server items", () => {
  const w = wireDue();
  const d = toDueNext(w);
  expect(d.items).toEqual(w.items);
  expect(d.returns?.firms[0]).toMatchObject({ output: 13151040, cash: 9841000, credit_used: 3310040, carry_on: 0 });
});
test("rates preserve a third decimal per gram and distinguish absent from null in_force", () => {
  const d = toRates(wireRates());
  expect(d.latest?.quoted["gold-22K"]).toBe(6512501);
  expect(d.in_force?.per_gram["gold-22K"]).toBe("6512.501");
  const { in_force: _inForce, ...w } = wireRates();
  expect(toRates(w)).not.toHaveProperty("in_force");
  expect(toRates({ ...w, in_force: null }).in_force).toBeNull();
});
test("null scope cannot ask or display another scope, even when invalidated", async () => {
  const { calls } = salesServer(); const { qc, wrapper } = setup();
  qc.setQueryData(dashboardKeys.figures("all", "2026-27"), toDashboard(wireDashboard()));
  const hook = renderHook(() => ({ dashboard: useDashboard(null, "2026-27"), due: useDueNext(null) }), { wrapper });
  await act(async () => { await qc.invalidateQueries(); });
  expect(hook.result.current.dashboard.data).toBeUndefined(); expect(hook.result.current.due.data).toBeUndefined(); expect(calls).toHaveLength(0);
});
test("scope+FY changes request their own figures; due does not follow FY", async () => {
  const { calls } = salesServer([["GET", "dashboard/", () => wireDashboard()], ["GET", "due-next/", () => wireDue()]]);
  const { wrapper } = setup();
  const hook = renderHook(({ firm, fy }) => ({ d: useDashboard(firm, fy), due: useDueNext(firm, true) }), { wrapper, initialProps: { firm: "all" as FirmId, fy: "2026-27" } });
  await waitFor(() => expect(hook.result.current.d.isSuccess && hook.result.current.due.isSuccess).toBe(true));
  expect(calls.find(c => c.url === "dashboard/")?.params).toEqual({ fy: "2026-27" });
  hook.rerender({ firm: "all", fy: "2025-26" });
  await waitFor(() => expect(calls.filter(c => c.url === "dashboard/")).toHaveLength(2));
  expect(calls.filter(c => c.url === "due-next/")).toHaveLength(1);
  hook.rerender({ firm: 3, fy: "2025-26" });
  await waitFor(() => expect(calls.filter(c => c.url === "due-next/")).toHaveLength(2));
  expect(calls.at(-1)?.params).toEqual({ business_id: 3, returns: 1 });
});
test("a held new scope never displays the previous firm's figures", async () => {
  salesServer([["GET", "dashboard/", ({ params }) => params.business_id === 2 ? new Promise(() => {}) : wireDashboard()]]);
  const { wrapper } = setup();
  const h = renderHook(({ firm }) => useDashboard(firm, "2026-27"), { wrapper, initialProps: { firm: 3 } });
  await waitFor(() => expect(h.result.current.isSuccess).toBe(true)); h.rerender({ firm: 2 });
  expect(h.result.current.data).toBeUndefined();
});
test("rates are keyed by bill date and ask with date only", async () => {
  const { calls } = salesServer([["GET", "rates/", () => wireRates()]]); const { wrapper } = setup();
  const h = renderHook(() => useRates("2026-09-30"), { wrapper });
  await waitFor(() => expect(h.result.current.isSuccess).toBe(true));
  expect(calls[0].params).toEqual({ date: "2026-09-30" });
  expect(ratesKeys.board("2026-09-30")).not.toEqual(ratesKeys.board());
});
test("a lightweight opener reuses a fresh rich answer without another read", async () => {
  const { calls } = salesServer(); const { qc, wrapper } = setup();
  qc.setQueryData(dueNextKeys.one(3, true), toDueNext(wireDue()));
  const h = renderHook(() => useDueNext(3), { wrapper });
  await act(async () => {}); expect(h.result.current.data?.items).toHaveLength(1); expect(calls).toHaveLength(0);
});
test("60-second mount freshness never polls or refetches on focus over ten minutes", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"], now: new Date("2026-10-08T11:00:00+05:30") });
  const { calls } = salesServer([["GET", "dashboard/", wireDashboard], ["GET", "due-next/", wireDue], ["GET", "rates/", wireRates]]); const { wrapper } = setup();
  const read = () => ({ dashboard: useDashboard(3, "2026-27"), due: useDueNext(3, true), rates: useRates() });
  const first = renderHook(read, { wrapper }); await pass(); expect(first.result.current.dashboard.isSuccess && first.result.current.due.isSuccess && first.result.current.rates.isSuccess).toBe(true); first.unmount();
  await pass(59_000); const second = renderHook(read, { wrapper }); await pass(); expect(calls).toHaveLength(3); second.unmount();
  await pass(2_000); const third = renderHook(read, { wrapper }); await pass(); expect(calls).toHaveLength(6);
  await pass(600_000); focusManager.setFocused(false); focusManager.setFocused(true); await pass(); expect(calls).toHaveLength(6); third.unmount();
});

test("a newer rich answer wins over an existing slim answer when the bell reopens", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T11:00:00+05:30"));
  const { calls } = salesServer(); const { qc, wrapper } = setup(); const now = Date.now();
  qc.setQueryData(dueNextKeys.one(3, false), { ...toDueNext(wireDue()), items: [] }, { updatedAt: now - 61_000 });
  qc.setQueryData(dueNextKeys.one(3, true), toDueNext(wireDue()), { updatedAt: now - 41_000 });
  const h = renderHook(() => useDueNext(3), { wrapper }); await act(async () => {});
  expect(h.result.current.data?.items).toHaveLength(1); expect(calls).toHaveLength(0);
});

test("a bell opening while rich due is in flight shares its request", async () => {
  let release!: (value: unknown) => void;
  const { calls } = salesServer([["GET", "due-next/", () => new Promise(resolve => { release = resolve; })]]);
  const { wrapper } = setup();
  const rich = renderHook(() => useDueNext(3, true), { wrapper });
  await waitFor(() => expect(calls).toHaveLength(1));
  const bell = renderHook(() => useDueNext(3), { wrapper });
  await act(async () => { release(wireDue()); });
  await waitFor(() => expect(bell.result.current.isSuccess && rich.result.current.isSuccess).toBe(true));
  expect(calls).toHaveLength(1);
});

test("passive observers retain both keys without reading or becoming active", async () => {
  const { calls } = salesServer(); const { qc, wrapper } = setup();
  qc.setQueryData(dueNextKeys.one(3, true), toDueNext(wireDue()));
  renderHook(() => [useDueNext(3, false, false), useDueNext(3, true, false)], { wrapper });
  await act(async () => {});
  for (const rich of [false, true]) {
    const query = qc.getQueryCache().find({ queryKey: dueNextKeys.one(3, rich), exact: true });
    expect(query?.getObserversCount()).toBe(1); expect(query?.isActive()).toBe(false);
  }
  expect(calls).toHaveLength(0);
});

test("a passive observer cannot replace an active reader's query function", async () => {
  const { calls } = salesServer([["GET", "due-next/", wireDue], ["GET", "rates/", wireRates]]);
  const { qc, wrapper } = setup();
  const active = renderHook(() => ({ due: useDueNext(3, true), rates: useRates() }), { wrapper });
  await waitFor(() => expect(active.result.current.due.isSuccess && active.result.current.rates.isSuccess).toBe(true));
  renderHook(() => [useDueNext(3, true, false), useRates(undefined, false)], { wrapper });
  await act(async () => { await qc.invalidateQueries(); });
  await waitFor(() => expect(calls).toHaveLength(4));
  expect(active.result.current.due.isError || active.result.current.rates.isError).toBe(false);
});
