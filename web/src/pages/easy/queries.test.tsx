import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { api } from "@/core/api/client";
import { __resetDrafts, useDiscardDraft, useKeepDraft } from "@/core/api/drafts";
import { AuthContext } from "@/core/auth/AuthProvider";
import { __resetDeviceDrafts, keepOnDevice, keptDraft } from "@/core/deviceDrafts";
import { refuse, wirePage, wireRow } from "@/core/sales/fixtures";
import { stubAuth, testQueryClient } from "@/test/render";
import { EASY_TODAY, easyCustomer, easyDraft, easyServer } from "./fixtures";
import {
  fetchEasyUnsent, useEasyBills, useEasyCustomerSearch, useEasyCustomers, useEasyMonth,
  useEasyProducts, useEasyRecentCustomers, useEasyToday, useEasyUnfinishedBills,
} from "./queries";

function setup() {
  const qc = testQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}><AuthContext.Provider value={stubAuth()}>{children}</AuthContext.Provider></QueryClientProvider>;
  return { qc, wrapper };
}
beforeEach(() => { __resetDeviceDrafts(); __resetDrafts(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

test("Home reads 50 today and one this month, preserving the whole-period summaries in paise", async () => {
  const { calls } = easyServer([["GET", "sales/", () => wirePage([wireRow()], { summary: { bills: 73, tax: "111.25", total_amount: "222.50" } })]]);
  const { result } = renderHook(() => ({ day: useEasyToday(3, EASY_TODAY), month: useEasyMonth(3, EASY_TODAY) }), { wrapper: setup().wrapper });
  await waitFor(() => expect(result.current.month.isSuccess && result.current.day.isSuccess).toBe(true));
  expect(calls.filter((c) => c.url === "sales/").map((c) => c.params)).toEqual([
    { business_id: 3, start_date: EASY_TODAY, end_date: EASY_TODAY, ordering: "-date", page: 1, page_size: 50 },
    { business_id: 3, month: "2026-10", page: 1, page_size: 1 },
  ]);
  expect(result.current.day.data?.summary).toMatchObject({ bills: 73, tax: 11125, total_amount: 22250 });
});

test.each([
  ["today", { start_date: "2026-03-31", end_date: "2026-03-31" }],
  ["month", { month: "2026-03" }],
  ["year", { fy: "2025-26" }],
] as const)("Bills %s keeps March 31 and asks for 40", async (when, params) => {
  const { calls } = easyServer();
  const { result } = renderHook(() => useEasyBills(3, { when }, "2026-03-31"), { wrapper: setup().wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(calls[0].params).toEqual({ business_id: 3, ...params, ordering: "-date", page: 1, page_size: 40 });
});

test("bill search preserves leading zeros and optionally includes last FY, through today", async () => {
  const { calls } = easyServer();
  const { result, rerender } = renderHook(({ lastYear }) => useEasyBills(3, { when: "month", q: "031", lastYear }, EASY_TODAY), { wrapper: setup().wrapper, initialProps: { lastYear: false } });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(calls[0].params).toEqual({ business_id: 3, q: "031", start_date: "2026-04-01", end_date: EASY_TODAY, ordering: "-date", page: 1, page_size: 40 });
  rerender({ lastYear: true });
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1].params.start_date).toBe("2025-04-01");
});

test("every Easy read waits for a firm, including customer search and products, even on invalidation", async () => {
  const { calls } = easyServer();
  const { qc, wrapper } = setup();
  renderHook(() => {
    useEasyToday(null); useEasyMonth(null); useEasyBills(null, { when: "today" });
    useEasyRecentCustomers(null); useEasyCustomerSearch(null, "Anil"); useEasyCustomers(null);
    useEasyUnfinishedBills(null); useEasyProducts(null);
  }, { wrapper });
  await act(async () => { await qc.refetchQueries(); await qc.invalidateQueries(); });
  expect(calls).toEqual([]);
  expect(await fetchEasyUnsent(null, EASY_TODAY)).toEqual([]);
  expect(calls).toEqual([]);
});

test("recent customers ask for seven with this firm's FY figures, then show six without the walk-in", async () => {
  const customers = [easyCustomer({ id: 9, type: "walkin" }), ...Array.from({ length: 6 }, (_, i) => easyCustomer({ id: i + 20 }))];
  const { calls } = easyServer([["GET", "customers/", () => ({ results: customers })]]);
  const { result } = renderHook(() => useEasyRecentCustomers(3, EASY_TODAY), { wrapper: setup().wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(calls[0].params).toEqual({ figures: 1, figures_business_id: 3, start_date: "2026-04-01", end_date: EASY_TODAY, ordering: "-last_bill", page_size: 7 });
  expect(result.current.data?.map((c) => c.id)).toEqual([20, 21, 22, 23, 24, 25]);
});

test("customer search waits for two characters and 300 ms, normalizes a mobile and scopes its 12 rows", async () => {
  vi.useFakeTimers();
  const { calls } = easyServer();
  const { rerender } = renderHook(({ q }) => useEasyCustomerSearch(3, q, EASY_TODAY), { wrapper: setup().wrapper, initialProps: { q: "" } });
  rerender({ q: "A" });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(calls).toEqual([]);
  rerender({ q: "+91 98290 41122" });
  await act(async () => { await vi.advanceTimersByTimeAsync(299); });
  expect(calls).toEqual([]);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(calls[0].params).toEqual({ figures: 1, figures_business_id: 3, start_date: "2026-04-01", end_date: EASY_TODAY, search: "9829041122", page_size: 12 });
});

test("Customers loads 40 more only on action, and a firm change never shows the old figures", async () => {
  const { calls } = easyServer([["GET", "customers/", (c) => c.params.figures_business_id === 2 ? new Promise(() => {}) : ({ count: 41, next: c.params.page === 1 ? "next" : null, results: [easyCustomer({ id: Number(c.params.page) })] })]]);
  const { result, rerender } = renderHook(({ firm }) => useEasyCustomers(firm, "Anil", EASY_TODAY), { wrapper: setup().wrapper, initialProps: { firm: 3 } });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(calls[0].params).toEqual({ figures: 1, figures_business_id: 3, start_date: "2026-04-01", end_date: EASY_TODAY, ordering: "-last_bill", search: "Anil", page_size: 40, page: 1 });
  await act(async () => { await result.current.fetchNextPage(); });
  expect(calls.map((c) => c.params.page)).toEqual([1, 2]);
  rerender({ firm: 2 });
  expect(result.current.data).toBeUndefined();
});

test("unfinished bills scope server and device rows, and discard/Undo update the scoped cache", async () => {
  const draft = easyDraft();
  const other = easyDraft({ id: "other", business: 2 });
  keepOnDevice({ ...other, synced: false });
  const { calls } = easyServer([
    ["GET", "drafts/", () => ({ results: [draft] })],
    ["DELETE", `drafts/${draft.id}/`, () => refuse(0, null)],
    ["PUT", `drafts/${draft.id}/`, () => draft],
  ]);
  const { result } = renderHook(() => ({ list: useEasyUnfinishedBills(3), discard: useDiscardDraft(), keep: useKeepDraft() }), { wrapper: setup().wrapper });
  await waitFor(() => expect(result.current.list.answered).toBe(true));
  expect(calls[0].params).toEqual({ business_id: 3 });
  expect(result.current.list.bills.map((d) => d.id)).toEqual([draft.id]);
  await act(async () => { await result.current.discard(draft.id); });
  expect(result.current.list.bills).toEqual([]);
  expect(keptDraft(draft.id)?.gone).toBe(true);
  await act(async () => { await result.current.keep(draft.id, 3, draft.data); });
  expect(result.current.list.bills.map((d) => d.id)).toEqual([draft.id]);
  expect(keptDraft("other")?.gone).not.toBe(true);
});

test("Send the bills gathers every unsent page before sending, dropping duplicate and invalid-mobile rows", async () => {
  const make = (id: number) => wireRow({ id, invoice_date: EASY_TODAY });
  const rows = Array.from({ length: 57 }, (_, i) => make(i + 1));
  rows[1] = wireRow({ id: 2, customer: { id: 9, type: "walkin", mobile_number: "" } });
  rows[2] = wireRow({ id: 3, customer: { id: 10, mobile_number: "1234567890" } });
  const { calls } = easyServer([["GET", "sales/", (c) => {
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    const page = Number(c.params.page);
    return wirePage(page === 1 ? rows.slice(0, 50) : [rows[49], ...rows.slice(50)], { next: page === 1 ? "next" : null });
  }]]);
  const snapshot = await fetchEasyUnsent(3, EASY_TODAY);
  expect(snapshot).toHaveLength(55);
  expect(snapshot.at(-1)?.id).toBe(57);
  expect(calls.map((c) => c.params)).toEqual([1, 2].map((page) => ({ business_id: 3, start_date: EASY_TODAY, end_date: EASY_TODAY, unsent: 1, page_size: 50, page })));
  for (const bill of snapshot) await api.post(`sales/${bill.id}/sent/`, { via: "whatsapp" });
  expect(calls.slice(0, 2).every((c) => c.method === "GET")).toBe(true);
});

test("idle Easy queries neither poll nor refresh on window focus", async () => {
  const { calls } = easyServer();
  const { result } = renderHook(() => useEasyToday(3, EASY_TODAY), { wrapper: setup().wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  vi.useFakeTimers();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); window.dispatchEvent(new Event("focus")); });
  expect(calls).toHaveLength(1);
});
