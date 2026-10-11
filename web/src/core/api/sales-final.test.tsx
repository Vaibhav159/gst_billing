import { handClock, pass } from "@/test/clock";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { salesServer, wireBin, wireDetail, wireFacets, wirePage, wireRow } from "@/core/sales/fixtures";
import { testQueryClient } from "@/test/render";
import { invalidateSales, salesKeys, useBill, useDeleteBill, useSalesFacets, useSalesList, type SalesQuery } from "./sales";

beforeEach(() => handClock(new Date("2026-10-08T23:58:00+05:30")));
afterEach(() => vi.useRealTimers());
function setup() {
  const qc = testQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}

test("facets stay fresh for five minutes, refresh after writes, and use India's new day", async () => {
  const { calls } = salesServer([["GET", "sales/", () => ({ ...wirePage([]), facets: wireFacets() })]]);
  const { qc, wrapper } = setup();
  const a = renderHook(() => useSalesFacets(3, "2026-27"), { wrapper });
  await pass();
  expect(a.result.current.data?.months).toHaveLength(7);
  a.unmount();
  await pass(60_000);
  const b = renderHook(() => useSalesFacets(3, "2026-27"), { wrapper });
  await pass();
  expect(calls).toHaveLength(1);
  act(() => invalidateSales(qc));
  await pass();
  expect(calls).toHaveLength(2);
  b.unmount();
  await pass(60_000);
  const c = renderHook(() => useSalesFacets(3, "2026-27"), { wrapper });
  await pass();
  expect(calls).toHaveLength(3);
  expect(qc.getQueryState(salesKeys.facets(3, "2026-27"))?.data).toBeDefined();
  c.unmount();
  await pass(5 * 60_000);
  renderHook(() => useSalesFacets(3, "2026-27"), { wrapper });
  await pass();
  expect(calls).toHaveLength(4);
});

test("show more omits the summary and retains page one's figures", async () => {
  const { calls } = salesServer([["GET", "sales/", ({ params }) => {
    const page = wirePage([wireRow({ id: Number(params.page) })], { count: 41, next: params.page === 1 ? "?page=2" : null });
    if (params.page !== 1) delete page.summary;
    return page;
  }]]);
  const { wrapper } = setup();
  const list = renderHook(() => useSalesList(3, { fy: "2026-27" }), { wrapper });
  await pass();
  const summary = list.result.current.data?.pages[0].summary;
  await act(async () => { await list.result.current.fetchNextPage(); });
  await pass();
  expect(calls.map((c) => c.params.summary)).toEqual([undefined, 0]);
  expect(list.result.current.data?.pages[0].summary).toEqual(summary);
  expect(summary?.total_amount).toBe(8708321);
});

test("FY and month chips in the same scope retain rows while the next answer loads", async () => {
  let hold = false;
  salesServer([["GET", "sales/", () => hold ? new Promise(() => {}) : wirePage([wireRow()])]]);
  const { wrapper } = setup();
  const hook = renderHook(({ query, fy }: { query: SalesQuery; fy: string }) => useSalesList(3, query, fy), {
    wrapper, initialProps: { query: { fy: "2026-27" } as SalesQuery, fy: "2026-27" },
  });
  await pass();
  hold = true;
  hook.rerender({ query: { month: "2026-09" }, fy: "2026-27" });
  expect(hook.result.current.isPlaceholderData).toBe(true);
  expect(hook.result.current.data?.pages[0].results[0].id).toBe(412);
  hook.rerender({ query: { month: "2025-09" }, fy: "2025-26" });
  expect(hook.result.current.data).toBeUndefined();
});

test("delete keeps its bin answer in the bill cache without reading the departing bill again", async () => {
  const { calls } = salesServer([["GET", "sales/412/", () => wireDetail()], ["DELETE", "sales/412/", () => wireBin({ original_id: 412 })]]);
  const { qc, wrapper } = setup();
  const bill = renderHook(() => useBill(412), { wrapper });
  const remove = renderHook(() => useDeleteBill(), { wrapper });
  await pass();
  await act(async () => { await remove.result.current.mutateAsync({ id: 412, reason: "Entered twice" }); });
  await pass();
  expect(bill.result.current.data).toMatchObject({ kind: "deleted", binned: { original_id: 412 } });
  expect(qc.getQueryState(salesKeys.one(412))?.isInvalidated).toBe(false);
  expect(calls.map((c) => c.method)).toEqual(["GET", "DELETE"]);
});
