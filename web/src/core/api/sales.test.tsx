import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { onlineManager, QueryClientProvider } from "@tanstack/react-query";
import { refuse, salesServer, wireBin, wireDetail, wireFacets, wirePage, wireRow } from "@/core/sales/fixtures";
import type { BillInput } from "@/core/sales/types";
import { toBinRow, toSalesPage } from "@/core/sales/wire";
import type { FirmId } from "@/core/scope";
import { testQueryClient } from "@/test/render";
import { problemOf } from "./errors";
import {
  billQuery, cachedBillNumber, rowsOf, SALES_PAGE_SIZE, salesKeys, salesParams, shopSettingsQuery, useBill, useBillDetail, useBin, useCancelBill, useCheckNumber,
  useCreateBill, useDeleteBill, useFixHeads, useMoveBill, useNextNumber, usePaperBook, useRecordSent, useRenumberBill, useRestoreBill, useSalesFacets,
  useSalesList, useSalesPage, useSaveEway, useSaveShopSettings, useShopSettings, useTodaysBills, useUpdateBill, type SalesQuery,
} from "./sales";

/** A new cache with the app's defaults (saves never retry or queue), as renderApp's; a failed read isn't tried again. */
function setup() {
  const qc = testQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}

// India's clock reads 11:00 on 8 Oct 2026, the contract's day, in every test: no test waits on real time (Ruling 1B-10)
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T11:00:00+05:30"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A bill as the form sends it (contract §2.3). */
const INPUT: BillInput = {
  business: 3, customer: 7, invoice_number: "31", invoice_date: "2026-10-08", payment_mode: "cash", place_of_supply: null, notes: "", paper: false,
  lines: [{ product_name: "Gold Ring 22K", hsn_code: "711319", gst_percent: "3", quantity: "12.345", unit: "gms", rate: "6512.500", note: "" }],
};

test("a list waits for the firm, then asks for that firm's bills, 40 at a time, and the next page on demand", async () => {
  const { calls } = salesServer([["GET", "sales/", ({ params }) => wirePage([wireRow({ id: Number(params.page) * 100 })], { count: 41, next: params.page === 1 ? "/api/sales/?page=2" : null })]]);
  const { wrapper } = setup();
  const { result, rerender } = renderHook((p: { firm: FirmId | null }) => useSalesList(p.firm, { fy: "2026-27", ordering: "-date" }), { wrapper, initialProps: { firm: null as FirmId | null } });
  await act(async () => {});
  expect(calls.filter((c) => c.url === "sales/")).toHaveLength(0);
  rerender({ firm: 3 });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(calls.find((c) => c.url === "sales/")?.params).toEqual({ business_id: 3, fy: "2026-27", ordering: "-date", page: 1, page_size: 40 });
  // read now, as a screen reads them while it draws: TanStack redraws only for what has been read
  expect(rowsOf(result.current.data).map((r) => r.id)).toEqual([100]);
  expect(result.current.hasNextPage).toBe(true);
  await act(async () => { await result.current.fetchNextPage(); });
  expect(calls.filter((c) => c.url === "sales/").map((c) => c.params.page)).toEqual([1, 2]);
  await waitFor(() => expect(rowsOf(result.current.data).map((r) => r.id)).toEqual([100, 200]));
  expect(result.current.hasNextPage).toBe(false);
});

test("a list that can't ask yet asks nothing, even when the page tries again: never every firm's bills", async () => {
  const { calls } = salesServer([["GET", "sales/", () => wirePage([wireRow()])]]);
  const { qc, wrapper } = setup();
  // every firm's bills are in the cache already: a list that isn't ready must not show them as its own
  qc.setQueryData(salesKeys.list("all", {}), { pages: [toSalesPage(wirePage([wireRow()]))], pageParams: [1] });
  const list = renderHook(() => useSalesList(null, {}), { wrapper });
  renderHook(() => useSalesFacets(null, "2026-27"), { wrapper });
  renderHook(() => useSalesPage(null, { customer_id: 7 }), { wrapper });
  const waiting = [salesKeys.list(null, {}), salesKeys.facets(null, "2026-27"), salesKeys.page(null, { customer_id: 7 }, SALES_PAGE_SIZE)];
  // a page's Try again goes through the client, which passes over a query that can't ask yet, even one it names. (A
  // hook's own refetch() wouldn't ask either, but it would end the list in an error, "Missing queryFn".)
  await act(async () => {
    for (const queryKey of waiting) await qc.refetchQueries({ queryKey });
    await qc.invalidateQueries({ queryKey: salesKeys.all });
  });
  expect(calls).toHaveLength(0);
  expect(list.result.current.data).toBeUndefined();
  // still waiting for the firm, not failed (the cache's own state: a hook redraws only for what its screen has read)
  for (const key of waiting) expect(qc.getQueryState(key)).toMatchObject({ status: "pending", fetchStatus: "idle", error: null });
});

test("another filter keeps the list on screen until its answer comes; a new firm or year never shows the last one's bills and money", async () => {
  let hold = false;
  const held: (() => void)[] = [];
  const { calls } = salesServer([["GET", "sales/", ({ params }) => {
    const page = wirePage([wireRow({ id: Number(params.business_id) })]);
    return hold ? new Promise((resolve) => held.push(() => resolve(page))) : page;
  }]]);
  const { wrapper } = setup();
  const { result, rerender } = renderHook((p: { firm: FirmId; query: SalesQuery }) => useSalesList(p.firm, p.query), {
    wrapper, initialProps: { firm: 3 as FirmId, query: { fy: "2026-27" } as SalesQuery },
  });
  await waitFor(() => expect(rowsOf(result.current.data).map((r) => r.id)).toEqual([3]));
  hold = true;
  rerender({ firm: 3, query: { fy: "2026-27", status: "cancelled" } });
  expect(result.current.isPlaceholderData).toBe(true);
  expect(rowsOf(result.current.data).map((r) => r.id)).toEqual([3]);
  rerender({ firm: 2, query: { fy: "2026-27" } });
  expect(result.current.data).toBeUndefined();
  rerender({ firm: 3, query: { fy: "2025-26" } });
  expect(result.current.data).toBeUndefined();
  // its own answer comes in place of the wait
  await waitFor(() => expect(calls.some((c) => c.params.fy === "2025-26")).toBe(true));
  await act(async () => { held.forEach((release) => release()); });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.isPlaceholderData).toBe(false);
  expect(rowsOf(result.current.data).map((r) => r.id)).toEqual([3]);
});

test("all firms leaves the firm out; a flag goes as 1, paper as 1 or 0, and nothing for what isn't set", () => {
  expect(salesParams("all", { status: "cancelled", unsent: true, check: false, paper: false, q: "", customer_id: 7, segment: "b2cs" }, 2, 40))
    .toEqual({ status: "cancelled", unsent: 1, paper: 0, customer_id: 7, segment: "b2cs", page: 2, page_size: 40 });
});

test("money comes in paise; a page answered without its summary reads as empty, never a crash", async () => {
  salesServer([["GET", "sales/", () => ({ results: [wireRow()] })]]);
  const { wrapper } = setup();
  const { result } = renderHook(() => useSalesList("all", {}), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  const page = result.current.data!.pages[0];
  expect(page.results[0]).toMatchObject({ total_amount: 8708321, taxable: 8454681, customer: { name: "Anil Gupta", type: "person" }, sent: null });
  expect(page.summary).toMatchObject({ bills: 0, total_amount: 0, average: null });
  expect(page.count).toBe(1);
});

test("facets come with a list's first page only, or on their own for a firm and year with one bill", async () => {
  const { calls } = salesServer([["GET", "sales/", ({ params }) => ({
    ...wirePage([wireRow({ id: Number(params.page) })], { count: 41, next: params.page === 1 ? "/api/sales/?page=2" : null }), ...(params.facets ? { facets: wireFacets() } : {}),
  })]]);
  const { wrapper } = setup();
  const list = renderHook(() => useSalesList(3, { fy: "2026-27", facets: true }), { wrapper });
  await waitFor(() => expect(list.result.current.data?.pages[0].facets?.views).toEqual({ unsent_today: 2, credit_month: 5, check: 3, cash: 1 }));
  await act(async () => { await list.result.current.fetchNextPage(); });
  expect(calls.map((c) => [c.params.page, c.params.facets])).toEqual([[1, 1], [2, undefined]]);
  const facets = renderHook(() => useSalesFacets(3, "2026-27"), { wrapper });
  await waitFor(() => expect(facets.result.current.data?.months).toHaveLength(7));
  expect(calls[2].params).toEqual({ business_id: 3, fy: "2026-27", facets: 1, page: 1, page_size: 1 });
  expect(facets.result.current.data?.months[0]).toEqual({ month: "2026-04", bills: 31, locked: true });
});

test("a deleted bill's page is its bin row, not an error; a bill that was never there is an error", async () => {
  salesServer([
    ["GET", "sales/205/", () => refuse(404, { detail: "This bill was deleted.", code: "deleted", binned: wireBin() })],
    ["GET", "sales/999/", () => refuse(404, { detail: "No Invoice matches the given query." })],
    ["GET", "sales/412/", () => wireDetail()],
  ]);
  const { wrapper } = setup();
  const deleted = renderHook(() => useBill(205), { wrapper });
  await waitFor(() => expect(deleted.result.current.data).toMatchObject({ kind: "deleted", binned: { id: 4, original_id: 205, total_amount: 4500000, deleted_by: { name: "Kailash Mehta" } } }));
  const missing = renderHook(() => useBill(999), { wrapper });
  await waitFor(() => expect(missing.result.current.isError).toBe(true));
  expect(problemOf(missing.result.current.error).kind).toBe("notfound");
  const bill = renderHook(() => useBill(412), { wrapper });
  // the total stays exact to the paisa: nothing rounds it to the rupee (Ruling 1B-12)
  await waitFor(() => expect(bill.result.current.data).toMatchObject({ kind: "bill", bill: { total_amount: 8708321, lines: [{ taxable: 8039681, rate: "6512.500" }, { taxable: 415000 }] } }));
});

test("a bill and the shop's settings asked for outside a screen (print, a send's PDF) are the screen's own queries", async () => {
  const SETTINGS = { copies: "all", show_bank: true, share_message: "Namaste {customer}, your bill {number} for {total} from {firm} is attached.", updated_at: null, updated_by: null };
  const { calls } = salesServer([
    ["GET", "sales/412/", () => wireDetail()],
    ["GET", "shop-settings/", () => SETTINGS],
    ["PUT", "shop-settings/", ({ body }) => ({ ...SETTINGS, ...(body as object), updated_at: "2026-10-08T11:00:00+05:30", updated_by: { id: 1, name: "Kailash Mehta" } })],
  ]);
  const { qc, wrapper } = setup();
  expect(await qc.fetchQuery(billQuery(412))).toMatchObject({ kind: "bill", bill: { id: 412 } });
  await qc.ensureQueryData(shopSettingsQuery);
  // the screens find them at once, from the same cache entries
  expect(renderHook(() => useBill(412), { wrapper }).result.current.data).toMatchObject({ kind: "bill", bill: { invoice_number: "KGH/2026-27/31" } });
  expect(renderHook(() => useBillDetail(412), { wrapper }).result.current.data).toMatchObject({ id: 412, total_amount: 8708321 });
  const settings = renderHook(() => useShopSettings(), { wrapper });
  expect(settings.result.current.data).toMatchObject({ copies: "all", show_bank: true });
  // kept 5 minutes: opening the settings again doesn't ask again
  expect(calls.filter((c) => c.url === "shop-settings/")).toHaveLength(1);
  // a save sends only what changed, and every screen has the answer without asking
  const save = renderHook(() => useSaveShopSettings(), { wrapper });
  await act(async () => { await save.result.current.mutateAsync({ show_bank: false }); });
  expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ show_bank: false });
  await waitFor(() => expect(settings.result.current.data).toMatchObject({ show_bank: false, updated_by: { name: "Kailash Mehta" } }));
  expect(calls.filter((c) => c.method === "GET" && c.url === "shop-settings/")).toHaveLength(1);
});

test("a new bill's own answer goes straight to its page, which doesn't ask again; every other bill, the bin, customers and search do", async () => {
  const { calls } = salesServer([["POST", "sales/", () => wireDetail()], ["GET", "sales/412/", () => wireDetail()], ["GET", "sales/", () => wirePage([wireRow()])]]);
  const { qc, wrapper } = setup();
  // the bill's page and a list are open, and the bin, customers and search have answers on this device
  const bill = renderHook(() => useBill(412), { wrapper });
  const list = renderHook(() => useSalesList(3, {}), { wrapper });
  await waitFor(() => expect(bill.result.current.isSuccess && list.result.current.isSuccess).toBe(true));
  const others = [["bin", "list", {}], ["customers", "count"], ["search", "kgh"]];
  for (const key of others) qc.setQueryData(key, {});
  const { result } = renderHook(() => useCreateBill(), { wrapper });
  await act(async () => { await result.current.mutateAsync(INPUT); });
  expect(calls.find((c) => c.method === "POST")?.body).toEqual(INPUT);
  expect(qc.getQueryData(salesKeys.one(412))).toMatchObject({ kind: "bill", bill: { id: 412, invoice_number: "KGH/2026-27/31", total_amount: 8708321 } });
  await waitFor(() => expect(calls.filter((c) => c.method === "GET" && c.url === "sales/")).toHaveLength(2));
  expect(calls.filter((c) => c.url === "sales/412/")).toHaveLength(1);
  expect(qc.getQueryState(salesKeys.one(412))?.isInvalidated).toBe(false);
  for (const key of others) expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
});

test("cancel posts the reason; afterwards bills, the bin, customers and search ask again", async () => {
  const { calls } = salesServer([["POST", "sales/412/cancel/", () => ({ id: 412, invoice_number: "KGH/2026-27/31", status: "cancelled", cancel_reason: "Customer returned it",
    cancelled_at: "2026-10-08T15:02:11+05:30", cancelled_by: { id: 1, name: "Kailash Mehta" } })]]);
  const { qc, wrapper } = setup();
  const spy = vi.spyOn(qc, "invalidateQueries");
  const { result } = renderHook(() => useCancelBill(), { wrapper });
  let done: unknown;
  await act(async () => { done = await result.current.mutateAsync({ id: 412, reason: "Customer returned it" }); });
  expect(calls.find((c) => c.url === "sales/412/cancel/")?.body).toEqual({ reason: "Customer returned it" });
  expect(done).toMatchObject({ status: "cancelled", cancelled_by: { name: "Kailash Mehta" } });
  expect(spy.mock.calls.map(([f]) => f?.queryKey)).toEqual([["sales"], ["bin"], ["customers"], ["search"]]);
});

test("delete sends its reason in the body and answers the bin row that Undo restores; a closed month keeps the server's code and words", async () => {
  const { calls } = salesServer([
    ["DELETE", "sales/205/", () => wireBin()],
    ["DELETE", "sales/206/", () => refuse(409, { detail: "September 2026 is filed and locked for KIRAN GOLD HOUSE, so its bills can't be deleted. Have the owner unlock September 2026 in GST returns first.", code: "month_closed", locked_period: { id: 7, business: 3, year: 2026, month: 9 } })],
  ]);
  const { wrapper } = setup();
  const { result } = renderHook(() => useDeleteBill(), { wrapper });
  let bin: unknown;
  await act(async () => { bin = await result.current.mutateAsync({ id: 205, reason: "Entered twice" }); });
  expect(calls.find((c) => c.method === "DELETE")?.body).toEqual({ reason: "Entered twice" });
  expect(bin).toMatchObject({ id: 4, original_id: 205 });
  let failed: unknown;
  await act(async () => { await result.current.mutateAsync({ id: 206, reason: "" }).catch((e: unknown) => { failed = e; }); });
  expect(problemOf(failed)).toMatchObject({ kind: "conflict", code: "month_closed", message: expect.stringContaining("so its bills can't be deleted") });
});

test("changes go to the contract's addresses: change a bill, restore one, renumber, move, e-way details and tax heads", async () => {
  const { calls } = salesServer([
    ["PUT", "sales/412/", ({ body }) => wireDetail({ notes: (body as BillInput).notes })],
    ["POST", "bin/4/restore/", () => wireDetail({ id: 205, invoice_number: "KGH/2026-27/27" })],
    ["POST", "sales/412/renumber/", () => ({ id: 412, invoice_number: "KGH/2026-27/34", previous: "KGH/2026-27/31" })],
    ["POST", "sales/412/move/", () => ({ id: 412, business: 2, invoice_number: "MO/2026-27/31", previous: { business: 3, invoice_number: "KGH/2026-27/31" } })],
    ["PUT", "sales/412/eway/", ({ body }) => wireDetail({ eway: { ...(wireDetail().eway as object), ...(body as object) } })],
    ["POST", "sales/412/fix-heads/", () => wireDetail()],
  ]);
  const { qc, wrapper } = setup();
  const hooks = renderHook(() => ({ update: useUpdateBill(), restore: useRestoreBill(), renumber: useRenumberBill(), move: useMoveBill(), eway: useSaveEway(), heads: useFixHeads() }), { wrapper });
  const eway = { eway_bill_number: "123456789012", vehicle_number: "RJ14AB1234", distance_km: 120 };
  const out: Record<string, unknown> = {};
  await act(async () => {
    const h = hooks.result.current;
    out.update = await h.update.mutateAsync({ id: 412, body: { ...INPUT, notes: "Hallmarked" } });
    out.restore = await h.restore.mutateAsync(4);
    out.renumber = await h.renumber.mutateAsync({ id: 412, invoice_number: "34" });
    out.move = await h.move.mutateAsync({ id: 412, business: 2, invoice_number: "31" });
    out.eway = await h.eway.mutateAsync({ id: 412, eway });
    out.heads = await h.heads.mutateAsync(412);
  });
  expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
    ["PUT", "sales/412/", { ...INPUT, notes: "Hallmarked" }],
    ["POST", "bin/4/restore/", undefined],
    ["POST", "sales/412/renumber/", { invoice_number: "34" }],
    ["POST", "sales/412/move/", { business: 2, invoice_number: "31" }],
    ["PUT", "sales/412/eway/", eway],
    ["POST", "sales/412/fix-heads/", undefined],
  ]);
  expect(out.update).toMatchObject({ id: 412, notes: "Hallmarked" });
  // a restored bill is back under its own id, and its page shows it at once
  expect(qc.getQueryData(salesKeys.one(205))).toMatchObject({ kind: "bill", bill: { invoice_number: "KGH/2026-27/27" } });
  expect(out.renumber).toEqual({ id: 412, invoice_number: "KGH/2026-27/34", previous: "KGH/2026-27/31" });
  expect(out.move).toEqual({ id: 412, business: 2, invoice_number: "MO/2026-27/31", previous: { business: 3, invoice_number: "KGH/2026-27/31" } });
  expect(out.eway).toMatchObject({ eway: { ...eway, transport_mode: "Road", vehicle_type: "Regular" } });
  expect(out.heads).toMatchObject({ id: 412, total_amount: 8708321 });
});

test("a write made offline goes at once and fails at once, as the app's client says: no retry, no queue", async () => {
  const { calls } = salesServer([["POST", "sales/412/cancel/", () => refuse(0, null)]]);
  const { wrapper } = setup();
  onlineManager.setOnline(false);
  try {
    const { result } = renderHook(() => useCancelBill(), { wrapper });
    let failed: unknown;
    await act(async () => { await result.current.mutateAsync({ id: 412, reason: "Customer returned it" }).catch((e: unknown) => { failed = e; }); });
    expect(calls).toHaveLength(1);
    expect(problemOf(failed).kind).toBe("unreachable");
  } finally {
    onlineManager.setOnline(true);
  }
});

test("today's bills ask for today's three newest; a send is recorded with how and where it went", async () => {
  const { calls } = salesServer([
    ["GET", "sales/", () => wirePage([wireRow()])],
    ["POST", "sales/412/sent/", ({ body }) => ({ id: 412, sent: { at: "2026-10-08T12:09:00+05:30", last_at: "2026-10-08T12:09:00+05:30", count: 1, via: (body as { via: string }).via, to: "9829041122" } })],
  ]);
  const { wrapper } = setup();
  const today = renderHook(() => useTodaysBills(true), { wrapper });
  await waitFor(() => expect(today.result.current.data).toHaveLength(1));
  expect(calls.find((c) => c.url === "sales/")?.params).toEqual({ start_date: "2026-10-08", end_date: "2026-10-08", page_size: 3 });
  const sent = renderHook(() => useRecordSent(), { wrapper });
  let r: unknown;
  await act(async () => { r = await sent.result.current.mutateAsync({ id: 412, via: "whatsapp", to: "9829041122" }); });
  expect(calls.find((c) => c.url === "sales/412/sent/")?.body).toEqual({ via: "whatsapp", to: "9829041122" });
  expect(r).toEqual({ id: 412, sent: { at: "2026-10-08T12:09:00+05:30", last_at: "2026-10-08T12:09:00+05:30", count: 1, via: "whatsapp", to: "9829041122" } });
});

test("the next number and a number check ask with the firm and the date; an empty number isn't checked", async () => {
  const { calls } = salesServer([
    ["GET", "sales/next-number/", () => ({ business: 3, fy: "2026-27", invoice_date: "2026-09-30", counter: 35, invoice_number: "KGH/2026-27/35", full_number: true })],
    ["GET", "sales/check-number/", () => ({ invoice_number: "KGH/2026-27/34", counter: 34, code: "number_taken", problem: "KGH/2026-27/34 is already used.", bill: null, binned: null, note: "", same_counter: null, next: { counter: 35, invoice_number: "KGH/2026-27/35" } })],
  ]);
  const { wrapper } = setup();
  const next = renderHook(() => useNextNumber(3, "2026-09-30"), { wrapper });
  await waitFor(() => expect(next.result.current.data).toMatchObject({ counter: 35, invoice_number: "KGH/2026-27/35", full_number: true }));
  expect(calls.find((c) => c.url === "sales/next-number/")?.params).toEqual({ business_id: 3, invoice_date: "2026-09-30" });
  const empty = renderHook(() => useCheckNumber({ business: 3, invoice_date: "2026-09-30", invoice_number: "  " }), { wrapper });
  await act(async () => {});
  expect(empty.result.current.fetchStatus).toBe("idle");
  const check = renderHook(() => useCheckNumber({ business: 3, invoice_date: "2026-09-30", invoice_number: " 34 ", exclude_id: 412 }), { wrapper });
  await waitFor(() => expect(check.result.current.data).toMatchObject({ code: "number_taken", next: { invoice_number: "KGH/2026-27/35" } }));
  expect(calls.find((c) => c.url === "sales/check-number/")?.params).toEqual({ business_id: 3, invoice_date: "2026-09-30", invoice_number: "34", exclude_id: 412 });
});

test("one page of bills, the bin and a month's paper book ask with their own params, and wait for what they need", async () => {
  const { calls } = salesServer([
    ["GET", "sales/", () => wirePage([wireRow()])],
    ["GET", "bin/", () => ({ count: 1, next: null, previous: null, results: [wireBin()] })],
    ["GET", "sales/paper-book/", ({ params }) => ({ business: params.business_id, month: params.month, fy: "2026-27", bills: [], next: { counter: 34, invoice_number: "KGH/2026-27/34", invoice_date: "2026-09-30" } })],
  ]);
  const { wrapper } = setup();
  const off = renderHook(() => useSalesPage("all", { customer_id: 9 }, 6, false), { wrapper });
  const page = renderHook(() => useSalesPage("all", { customer_id: 7, ordering: "-date" }, 6), { wrapper });
  await waitFor(() => expect(page.result.current.data?.results).toHaveLength(1));
  expect(off.result.current.fetchStatus).toBe("idle");
  const bin = renderHook(() => useBin({ business_id: 3, q: "27" }), { wrapper });
  await waitFor(() => expect(bin.result.current.data?.results[0]).toMatchObject({ id: 4, original_id: 205, total_amount: 4500000 }));
  const none = renderHook(() => usePaperBook(3, null), { wrapper });
  const book = renderHook(() => usePaperBook(3, "2026-09"), { wrapper });
  await waitFor(() => expect(book.result.current.data).toMatchObject({ month: "2026-09", next: { invoice_number: "KGH/2026-27/34" } }));
  expect(none.result.current.fetchStatus).toBe("idle");
  expect(calls.map((c) => [c.url, c.params])).toEqual([
    ["sales/", { customer_id: 7, ordering: "-date", page: 1, page_size: 6 }],
    ["bin/", { business_id: 3, q: "27" }],
    ["sales/paper-book/", { business_id: 3, month: "2026-09" }],
  ]);
});

test("a bill already in a list names its page before its own answer comes (record titles set early)", () => {
  const { qc } = setup();
  qc.setQueryData(["sales", "list", "all", {}], { pages: [toSalesPage(wirePage([wireRow({ id: 77, invoice_number: "KGH/2026-27/77" })]))], pageParams: [1] });
  qc.setQueryData(["search", "kgh"], { customers: [], invoices: [{ id: 88, invoice_number: "KGH/2026-27/88" }], products: [] });
  qc.setQueryData(salesKeys.one(205), { kind: "deleted", binned: toBinRow(wireBin()) });
  expect(cachedBillNumber(qc, 77)).toBe("KGH/2026-27/77");
  expect(cachedBillNumber(qc, 88)).toBe("KGH/2026-27/88");
  expect(cachedBillNumber(qc, 205)).toBe("KGH/2026-27/27");
  expect(cachedBillNumber(qc, 78)).toBeNull();
});
