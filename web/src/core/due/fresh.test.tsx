import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider, useQuery, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "@/core/api/client";
import type { Dashboard } from "@/core/api/dashboard";
import { __resetDrafts, useDiscardDraft, useKeepDraft, type DraftData } from "@/core/api/drafts";
import { useSaveCustomer } from "@/core/api/customers";
import { useRecordSent } from "@/core/api/sales";
import { AuthContext } from "@/core/auth/AuthProvider";
import { __resetDeviceDrafts, keptDraft } from "@/core/deviceDrafts";
import { wireRow } from "@/core/sales/fixtures";
import { toBillRow } from "@/core/sales/wire";
import type { Sent } from "@/core/sales/types";
import { stubAuth, testQueryClient } from "@/test/render";
import { serve } from "@/test/server";
import { invalidateDashboard, putDashboardSent } from "./fresh";

const DASH = ["dashboard", 3, "2026-27"] as const;
const DUE = ["due-next", 3, false] as const;
const OTHER = ["dashboard", 2, "2025-26"] as const;
const SENT: Sent = { at: "2026-10-12T10:01:00+05:30", last_at: "2026-10-12T10:01:00+05:30", count: 1, to: "9829041122", via: "whatsapp" };
function dashboard(id = 412): Dashboard {
  const row = toBillRow(wireRow({ id }));
  const figures = { count: 1, total: row.total_amount, taxable: row.taxable, tax: row.tax };
  return {
    today: { date: "2026-10-08", count: 1, total: row.total_amount, by_payment: [], bills: [row], more: 0, recent: [row] },
    fy: "2026-27", current: true,
    month: { kind: "so_far", month: "2026-10", from: "2026-10-01", to: "2026-10-08", sales: figures, purchases: figures },
    last30: null,
    year: { from: "2026-04-01", to: "2026-10-08", months: [], sales: { count: 1, total: row.total_amount }, purchases: { count: 0, total: 0 } },
    returns_year: null, changes: [],
  };
}
function setup() {
  const qc = testQueryClient();
  return { qc, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}><AuthContext.Provider value={stubAuth()}>{children}</AuthContext.Provider></QueryClientProvider> };
}
function seed(qc: QueryClient) {
  for (const key of [DASH, OTHER]) qc.setQueryData(key, dashboard());
  for (const key of [DUE, ["due-next", "all", true]]) qc.setQueryData(key, { items: [] });
}
function invalidated(qc: QueryClient, value: boolean) {
  for (const key of [DASH, OTHER, DUE, ["due-next", "all", true]]) expect(qc.getQueryState(key)?.isInvalidated).toBe(value);
}
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); __resetDeviceDrafts(); __resetDrafts(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("invalidation marks every inactive scope stale without requests or cache creation", async () => {
  const calls = serve({});
  const { qc } = setup();
  seed(qc);
  qc.setQueryData(["rates"], { rate: 1 });
  invalidateDashboard(qc);
  invalidated(qc, true);
  expect(qc.getQueryState(["rates"])?.isInvalidated).toBe(false);
  expect(calls).toHaveLength(0);
  const empty = testQueryClient();
  invalidateDashboard(empty);
  expect(empty.getQueryCache().getAll()).toHaveLength(0);
});

test("invalidation refetches mounted dashboard and due-next once, leaving inactive scopes stale", async () => {
  const calls = serve({ "GET dashboard/": dashboard(), "GET due-next/": { items: [] } });
  const { qc, wrapper } = setup(); seed(qc);
  const h = renderHook(() => ({
    dashboard: useQuery({ queryKey: DASH, staleTime: Infinity, queryFn: async () => (await api.get("dashboard/")).data }),
    due: useQuery({ queryKey: DUE, staleTime: Infinity, queryFn: async () => (await api.get("due-next/")).data }),
  }), { wrapper });
  expect(calls).toHaveLength(0);
  await act(async () => { invalidateDashboard(qc); });
  await waitFor(() => expect(h.result.current.dashboard.isFetching || h.result.current.due.isFetching).toBe(false));
  expect(calls.map(call => call.url).sort()).toEqual(["dashboard/", "due-next/"]);
  expect(qc.getQueryState(OTHER)?.isInvalidated).toBe(true);
});

test("a sent patch changes matching bills and recent rows across scopes without renewing aggregate age", () => {
  const { qc } = setup();
  const old = Date.now() - 120_000;
  qc.setQueryData(DASH, dashboard(), { updatedAt: old });
  qc.setQueryData(OTHER, dashboard(999), { updatedAt: old });
  qc.setQueryData(["dashboard", "all", "2026-27"], dashboard(), { updatedAt: old });
  const unrelated = qc.getQueryData(OTHER);
  putDashboardSent(qc, 412, SENT);
  for (const key of [DASH, ["dashboard", "all", "2026-27"]]) {
    expect(qc.getQueryData<Dashboard>(key)?.today.bills[0].sent).toEqual(SENT);
    expect(qc.getQueryData<Dashboard>(key)?.today.recent[0].sent).toEqual(SENT);
    expect(qc.getQueryState(key)?.dataUpdatedAt).toBe(old);
  }
  expect(qc.getQueryData(OTHER)).toBe(unrelated);
  expect(qc.getQueryState(OTHER)?.dataUpdatedAt).toBe(old);
});

test("a sent patch preserves invalidated aggregates and creates no absent answers", async () => {
  const { qc } = setup();
  putDashboardSent(qc, 412, SENT);
  expect(qc.getQueryCache().getAll()).toHaveLength(0);
  qc.setQueryData(DASH, dashboard());
  await qc.invalidateQueries({ queryKey: DASH, refetchType: "none" });
  putDashboardSent(qc, 412, SENT);
  expect(qc.getQueryState(DASH)?.isInvalidated).toBe(true);
  const data = qc.getQueryData(DASH);
  putDashboardSent(qc, 412, null);
  expect(qc.getQueryData(DASH)).toBe(data);
});

test("a recorded send patches dashboard rows immediately and invalidates the aggregate and unsent count", async () => {
  const calls = serve({ "POST sales/412/sent/": { id: 412, sent: SENT } });
  const { qc, wrapper } = setup(); seed(qc);
  const old = Date.now() - 120_000;
  qc.setQueryData(DASH, dashboard(), { updatedAt: old });
  const h = renderHook(() => useRecordSent(), { wrapper });
  await act(async () => { await h.result.current.mutateAsync({ id: 412, via: "whatsapp" }); });
  expect(qc.getQueryData<Dashboard>(DASH)?.today.bills[0].sent).toEqual(SENT);
  expect(qc.getQueryData<Dashboard>(DASH)?.today.recent[0].sent).toEqual(SENT);
  expect(qc.getQueryState(DASH)?.dataUpdatedAt).toBe(old);
  invalidated(qc, true);
  expect(calls).toHaveLength(1);
});

test("a failed sent record leaves row, cache age and unsent aggregate unchanged", async () => {
  serve({ "POST sales/412/sent/": () => ({ status: 409, data: { detail: "This bill was deleted." } }) });
  const { qc, wrapper } = setup(); seed(qc);
  const previous = qc.getQueryData(DASH), stamp = qc.getQueryState(DASH)?.dataUpdatedAt;
  const h = renderHook(() => useRecordSent(), { wrapper });
  await act(async () => { await expect(h.result.current.mutateAsync({ id: 412, via: "whatsapp" })).rejects.toBeDefined(); });
  expect(qc.getQueryData(DASH)).toBe(previous);
  expect(qc.getQueryState(DASH)?.dataUpdatedAt).toBe(stamp);
  invalidated(qc, false);
});

test("a pre-send dashboard request cannot overwrite Sent after cancellation", async () => {
  let release: ((value: { status: number; data: Dashboard }) => void) | undefined;
  const calls = serve({
    "GET dashboard/": () => new Promise(resolve => { release = resolve; }),
    "POST sales/412/sent/": { id: 412, sent: SENT },
  });
  const { qc, wrapper } = setup(); seed(qc);
  const oldRequest = qc.fetchQuery({ queryKey: DASH, staleTime: 0, queryFn: async ({ signal }) => (await api.get("dashboard/", { signal })).data }).catch(() => undefined);
  await waitFor(() => expect(release).toBeDefined());
  const h = renderHook(() => useRecordSent(), { wrapper });
  await act(async () => { await h.result.current.mutateAsync({ id: 412, via: "whatsapp" }); });
  await act(async () => { release!({ status: 200, data: dashboard() }); await oldRequest; });
  expect(qc.getQueryData<Dashboard>(DASH)?.today.bills[0].sent).toEqual(SENT);
  expect(qc.getQueryState(DASH)?.isInvalidated).toBe(true);
  expect(calls).toHaveLength(2);
});

test("a customer mobile save refreshes figure scopes only after confirmation", async () => {
  let fail = true;
  serve({ "PATCH customers/7/": () => fail ? { status: 400, data: { mobile_number: ["Enter a mobile number."] } } : { status: 200, data: { id: 7, name: "Anil", mobile_number: "9829041122" } } });
  const { qc, wrapper } = setup(); seed(qc);
  const h = renderHook(() => useSaveCustomer(), { wrapper });
  await act(async () => { await expect(h.result.current.mutateAsync({ id: 7, body: { mobile_number: "bad" } })).rejects.toBeDefined(); });
  invalidated(qc, false);
  fail = false;
  await act(async () => { await h.result.current.mutateAsync({ id: 7, body: { mobile_number: "9829041122" } }); });
  invalidated(qc, true);
});

const ID = "5d1c2a8e-0b7f-4a8e-9c3a-1f2e3d4c5b6a";
const DATA: DraftData = { v: 1, firmId: 3, customer: null, date: "2026-10-08", number: "34", numberTyped: false, paper: false, posOverride: null, payment: null, notes: "", lines: [], replaces: null };
const draft = { id: ID, business: 3, data: DATA, started_by: null, created_at: "2026-10-08T10:00:00+05:30", updated_at: "2026-10-08T10:01:00+05:30" };

test("server draft keep and discard refresh scopes; local offline operations do not", async () => {
  let online = false;
  const calls = serve({
    [`PUT drafts/${ID}/`]: () => online ? { status: 200, data: draft } : { status: 0 },
    [`DELETE drafts/${ID}/`]: () => online ? { status: 204 } : { status: 0 },
  });
  const { qc, wrapper } = setup(); seed(qc);
  const h = renderHook(() => ({ keep: useKeepDraft(), discard: useDiscardDraft() }), { wrapper });
  await act(async () => { expect(await h.result.current.keep(ID, 3, DATA)).toEqual({ kept: "device" }); });
  expect(keptDraft(ID)?.synced).toBe(false);
  invalidated(qc, false);
  await act(async () => { await h.result.current.discard(ID); });
  invalidated(qc, false);
  online = true;
  await act(async () => { expect(await h.result.current.keep(ID, 3, DATA)).toEqual({ kept: "server" }); });
  invalidated(qc, true);
  seed(qc);
  await act(async () => { await h.result.current.discard(ID); });
  invalidated(qc, true);
  expect(calls).toHaveLength(4);
});

test("a draft confirmed already saved elsewhere refreshes scopes", async () => {
  serve({ [`PUT drafts/${ID}/`]: () => ({ status: 409, data: { code: "draft_saved", detail: "This unfinished bill was saved already." } }) });
  const { qc, wrapper } = setup(); seed(qc);
  const h = renderHook(() => useKeepDraft(), { wrapper });
  await act(async () => { await h.result.current(ID, 3, DATA); });
  invalidated(qc, true);
});
