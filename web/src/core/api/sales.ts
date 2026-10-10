// The sales/, bin/ and shop-settings/ endpoints (contract §2, §3, §5) as TanStack Query hooks, each answer read through
// core/sales/wire.ts into paise-based types. A list that follows a firm asks nothing until the firm is known (firmId !==
// null), so it never asks for every firm first (part 0 carry); a page's Try again goes through the client
// (qc.refetchQueries, invalidateQueries), which passes over a list still waiting. Writes take the app client's defaults
// (core/api/query.ts): no retry and no queue, so offline a save fails at once. After any bill write, every bill, bin,
// customer and search query asks again, except a bill whose own answer the write brought back.
import { queryOptions, skipToken, useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { todayIST } from "@/core/format";
import type { BillDetail, BillInput, BillRow, BillStatus, BinRow, EwayInput, SalesPage, Segment, Sent, ShopSettings } from "@/core/sales/types";
import {
  toBillDetail, toBinPage, toBinRow, toCancelResult, toFacets, toMoveResult, toNextNumber, toNumberCheck, toPaperBook, toRenumberResult, toSalesPage,
  toSent, toShopSettings,
} from "@/core/sales/wire";
import type { FirmId } from "@/core/scope";
import { api } from "./client";
import { problemOf } from "./errors";

export const SALES_PAGE_SIZE = 40;
export type SalesOrdering = "-date" | "date" | "number" | "-number" | "total" | "-total";
/** GET sales/'s filters (contract §2.1); every one combines with the others. */
export type SalesQuery = {
  fy?: string; month?: string; start_date?: string; end_date?: string; customer_id?: number;
  payment_mode?: "cash" | "bank" | "credit" | "mixed" | "none"; status?: BillStatus;
  unsent?: boolean; credit?: boolean; cash?: boolean; itax?: boolean; check?: boolean; paper?: boolean;
  gst_rate?: string; segment?: Segment; empty?: boolean; no_hsn?: boolean; dups?: boolean;
  number?: string; q?: string; ordering?: SalesOrdering; facets?: boolean;
};

/** A list query as the API's params: one firm (or none for all), a true flag as 1, paper as 1 or 0, nothing for what isn't set. */
export function salesParams(firmId: FirmId, query: SalesQuery, page?: number, pageSize?: number): Record<string, string | number> {
  const p: Record<string, string | number> = {};
  if (firmId !== "all") p.business_id = firmId;
  for (const [k, v] of Object.entries(query) as [keyof SalesQuery, SalesQuery[keyof SalesQuery]][]) {
    if (k === "paper") { if (typeof v === "boolean") p.paper = v ? 1 : 0; continue; }
    if (v === undefined || v === null || v === "" || v === false) continue;
    p[k] = v === true ? 1 : (v as string | number);
  }
  if (page) p.page = page;
  if (pageSize) p.page_size = pageSize;
  return p;
}

/**
 * Every bill query's key, all under one "sales" root (the bin is ["bin", …], the shop's settings ["shop-settings"]).
 * Invalidating ["sales"] refreshes every bill screen at once: 1B's writes do (invalidateSales), and so does plan 1C's
 * customer save, so a bill's PAN and address flags follow its customer.
 */
export const salesKeys = {
  all: ["sales"] as const,
  list: (firmId: FirmId | null, query: SalesQuery) => ["sales", "list", firmId, query] as const,
  facets: (firmId: FirmId | null, fy: string) => ["sales", "facets", firmId, fy] as const,
  page: (firmId: FirmId | null, query: SalesQuery, pageSize: number) => ["sales", "page", firmId, query, pageSize] as const,
  today: (day: string) => ["sales", "today", day] as const,
  one: (id: number | null) => ["sales", "bill", id] as const,
  nextNumber: (business: number | null, invoiceDate: string) => ["sales", "next-number", business, invoiceDate] as const,
  checkNumber: (args: NumberCheckArgs | null) => ["sales", "check-number", args] as const,
  paperBook: (business: number | null, month: string | null) => ["sales", "paper-book", business, month] as const,
  v2Invoice: (id: number | null) => ["sales", "v2-invoice", id] as const,
  v2Purchase: (number: string) => ["sales", "v2-purchase", number] as const,
};
// A list that can't ask yet (no firm known) has skipToken for its queryFn, and its key (null for the firm) never holds
// every firm's answer. TanStack counts it as disabled, so qc.refetchQueries and qc.invalidateQueries pass it over, and a
// page's Try again goes through them. The hook's own refetch() wouldn't ask either, but it would end the list in an
// error ("Missing queryFn") and log one, so nothing calls it. (QueryView offers Try again only after an error, which a
// list still waiting never has.)

/**
 * The bills list, 40 at a time: the summary covers the whole filtered set and comes with the first page, as do the
 * facets when asked for. While another filter is asked for, the last list stays on screen until the new one comes; a
 * new firm or year doesn't keep it, so one firm's bills and money never show under another's name.
 */
export function useSalesList(firmId: FirmId | null, query: SalesQuery) {
  return useInfiniteQuery({
    queryKey: salesKeys.list(firmId, query),
    initialPageParam: 1,
    queryFn: firmId === null ? skipToken : async ({ pageParam, signal }) => toSalesPage((await api.get("sales/", {
      params: salesParams(firmId, pageParam === 1 ? query : { ...query, facets: false }, pageParam, SALES_PAGE_SIZE), signal,
    })).data),
    getNextPageParam: (last, all) => (last.next ? all.length + 1 : undefined),
    // (after queryFn: TypeScript reads the page's type from it before it types this function's arguments)
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[2] === firmId && prevQuery.queryKey[3].fy === query.fy ? prev : undefined),
  });
}

/** Every row loaded so far, each once (a page boundary that moved between two requests can repeat one). */
export function rowsOf(data: InfiniteData<SalesPage> | undefined): BillRow[] {
  const seen = new Set<number>();
  const out: BillRow[] = [];
  for (const page of data?.pages ?? []) for (const r of page.results) if (!seen.has(r.id)) { seen.add(r.id); out.push(r); }
  return out;
}

/** The month chips and views of a firm and FY (facets ignore every other filter, so one request serves them all). */
export function useSalesFacets(firmId: FirmId | null, fy: string) {
  return useQuery({
    queryKey: salesKeys.facets(firmId, fy),
    queryFn: firmId === null ? skipToken : async ({ signal }) => toFacets((await api.get("sales/", { params: salesParams(firmId, { fy, facets: true }, 1, 1), signal })).data?.facets),
  });
}

/** One page of bills (a customer's latest, a number's bills). */
export function useSalesPage(firmId: FirmId | null, query: SalesQuery, pageSize = SALES_PAGE_SIZE, enabled = true) {
  return useQuery({
    queryKey: salesKeys.page(firmId, query, pageSize),
    enabled,
    queryFn: firmId === null ? skipToken : async ({ signal }) => toSalesPage((await api.get("sales/", { params: salesParams(firmId, query, 1, pageSize), signal })).data),
  });
}

/** Today's three newest bills, every firm, for search (Ctrl K) as it opens. Asked once per opening, kept 30 s. */
export function useTodaysBills(enabled: boolean) {
  const today = todayIST();
  return useQuery({
    queryKey: salesKeys.today(today),
    enabled, staleTime: 30_000, retry: false, networkMode: "always",
    queryFn: async ({ signal }) => toSalesPage((await api.get("sales/", { params: { start_date: today, end_date: today, page_size: 3 }, signal })).data).results,
  });
}

/** One bill, or the bin row of a deleted one (its 404 carries it, contract §2.2). Any other 404 is an error. */
export type BillOutcome = { kind: "bill"; bill: BillDetail } | { kind: "deleted"; binned: BinRow };
async function fetchBill(id: number, signal: AbortSignal): Promise<BillOutcome> {
  try {
    return { kind: "bill", bill: toBillDetail((await api.get(`sales/${id}/`, { signal })).data) };
  } catch (e) {
    const p = problemOf(e);
    const binned = p.kind === "notfound" && p.code === "deleted" ? (p.body as { binned?: unknown }).binned : undefined;
    if (binned) return { kind: "deleted", binned: toBinRow(binned) };
    throw e;
  }
}
/** useBill's query, for useQueries and queryClient.fetchQuery (plan 1E: batch print, bulk PDFs, a send's PDF). */
export function billQuery(id: number) {
  return queryOptions({ queryKey: salesKeys.one(id), queryFn: ({ signal }) => fetchBill(id, signal) });
}
export function useBill(id: number | null) {
  return useQuery({ ...billQuery(id as number), enabled: id !== null });
}
/** The same query as useBill, its data the bill itself (null for a deleted one): for the preview, the dialogs, the form and print. */
export function useBillDetail(id: number | null) {
  return useQuery({ ...billQuery(id as number), enabled: id !== null, select: (o: BillOutcome) => (o.kind === "bill" ? o.bill : null) });
}

/** Deleted bills (owner: bill.delete), newest first; q finds a number or a customer's name. */
export type BinQuery = { business_id?: number; fy?: string; q?: string; page_size?: number };
export function useBin(query: BinQuery, enabled = true) {
  return useQuery({ queryKey: ["bin", "list", query], enabled, queryFn: async ({ signal }) => toBinPage((await api.get("bin/", { params: query, signal })).data) });
}

/** The next paper number in a firm's series for a date (contract §2.11). */
export function useNextNumber(business: number | null, invoiceDate: string) {
  return useQuery({
    queryKey: salesKeys.nextNumber(business, invoiceDate),
    enabled: business !== null && invoiceDate !== "",
    queryFn: async ({ signal }) => toNextNumber((await api.get("sales/next-number/", { params: { business_id: business, invoice_date: invoiceDate }, signal })).data),
  });
}

/** Whether a typed number is free, and a soft note (contract §2.12). The caller debounces what it passes; an empty number isn't asked about. */
export type NumberCheckArgs = { business: number; invoice_date: string; invoice_number: string; exclude_id?: number };
export function useCheckNumber(args: NumberCheckArgs | null) {
  return useQuery({
    queryKey: salesKeys.checkNumber(args),
    enabled: args !== null && args.invoice_number.trim() !== "",
    retry: false, staleTime: 10_000,
    queryFn: async ({ signal }) => {
      const a = args as NumberCheckArgs;
      const params = { business_id: a.business, invoice_date: a.invoice_date, invoice_number: a.invoice_number.trim(), ...(a.exclude_id ? { exclude_id: a.exclude_id } : {}) };
      return toNumberCheck((await api.get("sales/check-number/", { params, signal })).data);
    },
  });
}

/** A firm's month as the paper book sees it (contract §2.13): the saved panel's next number, and 1D's paper book. */
export function usePaperBook(business: number | null, month: string | null) {
  return useQuery({
    queryKey: salesKeys.paperBook(business, month),
    enabled: business !== null && Boolean(month),
    queryFn: async ({ signal }) => toPaperBook((await api.get("sales/paper-book/", { params: { business_id: business, month }, signal })).data),
  });
}

/** useShopSettings' query, for queryClient.ensureQueryData outside React (plan 1E: a send's PDF reads show_bank). Kept 5 minutes. */
export const shopSettingsQuery = queryOptions({
  queryKey: ["shop-settings"], staleTime: 5 * 60_000, queryFn: async ({ signal }) => toShopSettings((await api.get("shop-settings/", { signal })).data),
});
/** The shop's settings: default copies, bank details on the bill, the share message (contract §5). */
export function useShopSettings() {
  return useQuery(shopSettingsQuery);
}

/**
 * After any bill write: every bill list and bill, the bin, customers' figures and search results ask again. keep: the
 * bill whose own answer the write brought back (keepBill), already in place, so its page doesn't ask for it again (as
 * plan 1C's customer save keeps its customer).
 */
export function invalidateSales(qc: QueryClient, keep?: number): void {
  void qc.invalidateQueries({ queryKey: salesKeys.all, predicate: (q) => !(keep !== undefined && q.queryKey[1] === "bill" && q.queryKey[2] === keep) });
  for (const queryKey of [["bin"], ["customers"], ["search"]]) void qc.invalidateQueries({ queryKey });
}

/** A write that answers with the bill: its page shows that answer at once, and everything else asks again. */
function keepBill(qc: QueryClient, d: BillDetail) {
  // typed first: TanStack 5.104's setQueryData<T>() with an object literal reads the union's other member wrongly
  const o: BillOutcome = { kind: "bill", bill: d };
  qc.setQueryData(billQuery(d.id).queryKey, o);
  invalidateSales(qc, d.id);
}

export function useSaveShopSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Pick<ShopSettings, "copies" | "show_bank" | "share_message">>) => toShopSettings((await api.put("shop-settings/", patch)).data),
    onSuccess: (s) => qc.setQueryData(shopSettingsQuery.queryKey, s),
  });
}

export function useCreateBill() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (body: BillInput) => toBillDetail((await api.post("sales/", body)).data), onSuccess: (d) => keepBill(qc, d) });
}
export function useUpdateBill() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, body }: { id: number; body: BillInput }) => toBillDetail((await api.put(`sales/${id}/`, body)).data), onSuccess: (d) => keepBill(qc, d) });
}
export function useCancelBill() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, reason }: { id: number; reason: string }) => toCancelResult((await api.post(`sales/${id}/cancel/`, { reason })).data), onSuccess: () => invalidateSales(qc) });
}
/** To the bin: the answer is the bin row, whose id Undo and Restore use. */
export function useDeleteBill() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, reason }: { id: number; reason: string }) => toBinRow((await api.delete(`sales/${id}/`, { data: { reason } })).data), onSuccess: () => invalidateSales(qc) });
}
/** Back from the bin under the bill's own id (binId is the bin row's id). */
export function useRestoreBill() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (binId: number) => toBillDetail((await api.post(`bin/${binId}/restore/`)).data), onSuccess: (d) => keepBill(qc, d) });
}
export function useRenumberBill() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, invoice_number }: { id: number; invoice_number: string }) => toRenumberResult((await api.post(`sales/${id}/renumber/`, { invoice_number })).data), onSuccess: () => invalidateSales(qc) });
}
export function useMoveBill() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, business, invoice_number }: { id: number; business: number; invoice_number: string }) => toMoveResult((await api.post(`sales/${id}/move/`, { business, invoice_number })).data), onSuccess: () => invalidateSales(qc) });
}
export function useSaveEway() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, eway }: { id: number; eway: EwayInput }) => toBillDetail((await api.put(`sales/${id}/eway/`, eway)).data), onSuccess: (d) => keepBill(qc, d) });
}
export function useFixHeads() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: number) => toBillDetail((await api.post(`sales/${id}/fix-heads/`)).data), onSuccess: (d) => keepBill(qc, d) });
}
export type SendVia = "whatsapp" | "share";
/** Records a send: how, and the number typed for this bill ("" for the customer's own). */
export function useRecordSent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, via, to = "" }: { id: number; via: SendVia; to?: string }): Promise<{ id: number; sent: Sent | null }> => {
      const d = (await api.post(`sales/${id}/sent/`, { via, to })).data;
      return { id: Number(d?.id ?? id), sent: toSent(d?.sent) };
    },
    onSuccess: () => invalidateSales(qc),
  });
}

/** The bills a cached answer holds: a list's pages, a page's results, or today's array. */
function rowsIn(data: unknown): { id: number; invoice_number: string }[] {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data)) return data.filter((r): r is BillRow => Boolean(r && typeof r === "object" && "invoice_number" in r));
  const d = data as { pages?: SalesPage[]; results?: BillRow[] };
  if (Array.isArray(d.pages)) return d.pages.flatMap((p) => p.results ?? []);
  return Array.isArray(d.results) ? d.results : [];
}

/** The number of a bill already in a list, today's bills or a search on this device, so its page can name it before its own answer comes (part 0 carry: record titles set early). */
export function cachedBillNumber(qc: QueryClient, id: number): string | null {
  const own = qc.getQueryData(billQuery(id).queryKey);
  if (own) return own.kind === "bill" ? own.bill.invoice_number : own.binned.invoice_number;
  for (const [, data] of qc.getQueriesData<unknown>({ queryKey: salesKeys.all })) {
    const hit = rowsIn(data).find((r) => r.id === id);
    if (hit) return hit.invoice_number;
  }
  for (const [, data] of qc.getQueriesData<unknown>({ queryKey: ["search"] })) {
    const d = data as { invoices?: { id: number; invoice_number: string }[]; customers?: { recent_invoices?: { id: number; invoice_number: string }[] }[] } | undefined;
    const hit = [...(d?.invoices ?? []), ...(d?.customers ?? []).flatMap((c) => c.recent_invoices ?? [])].find((r) => r.id === id);
    if (hit) return hit.invoice_number;
  }
  return null;
}
