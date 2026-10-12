import { queryOptions, skipToken, useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import type { FirmId } from '@/core/scope';
import type { PurchaseBinRow, PurchaseDetail, PurchaseInput, PurchasePage, PurchaseRow } from '@/core/purchases/types';
import { toCredit, toCreditMonths, toDuplicateCheck, toPurchaseBin, toPurchaseDetail, toPurchasePage, toPurchaseRead, toUsualRate } from '@/core/purchases/wire';
import { api } from './client';
import { problemOf } from './errors';

export type PurchaseQuery = { fy?: string; month?: string; start_date?: string; end_date?: string; credit_month?: string; supplier_id?: number; check?: boolean; photo?: boolean; dups?: boolean; empty?: boolean; no_hsn?: boolean; eligible?: 0; q?: string; ordering?: '-date' | 'date' | 'total' | '-total' | 'supplier'; include?: 'lines'; facets?: boolean; summary?: 0 };
export const PURCHASES_PAGE_SIZE = 40;
export function purchasesParams(firmId: FirmId, query: PurchaseQuery, page?: number, pageSize?: number): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (firmId !== 'all') params.business_id = firmId;
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === '' || value === false) continue;
    if (query.credit_month && ['fy', 'month', 'start_date', 'end_date'].includes(key)) continue;
    params[key] = value === true ? 1 : value;
  }
  if (page) params.page = page;
  if (pageSize) params.page_size = pageSize;
  return params;
}
export const purchasesKeys = {
  all: ['purchases'] as const,
  list: (firmId: FirmId | null, query: PurchaseQuery, scopeFy = query.fy) => ['purchases', 'list', firmId, query, scopeFy] as const,
  page: (firmId: FirmId | null, query: PurchaseQuery, pageSize: number) => ['purchases', 'page', firmId, query, pageSize] as const,
  one: (id: number | null) => ['purchases', 'bill', id] as const,
  creditMonths: (business: number | null, invoiceDate: string) => ['purchases', 'credit-months', business, invoiceDate] as const,
  duplicate: (args: DuplicateArgs | null) => ['purchases', 'duplicate', args] as const,
  rate: (args: UsualRateArgs | null) => ['purchases', 'rate', args] as const,
};
export function usePurchasesList(firmId: FirmId | null, query: PurchaseQuery, scopeFy = query.fy) {
  return useInfiniteQuery({
    queryKey: purchasesKeys.list(firmId, query, scopeFy), initialPageParam: 1,
    queryFn: firmId === null ? skipToken : async ({ pageParam, signal }) => toPurchasePage((await api.get('purchases/', { params: purchasesParams(firmId, pageParam === 1 ? query : { ...query, facets: false, summary: 0 }, pageParam, PURCHASES_PAGE_SIZE), signal })).data),
    getNextPageParam: (last, pages) => last.next ? pages.length + 1 : undefined,
    placeholderData: (prev, previous) => previous?.queryKey[2] === firmId && previous.queryKey[4] === scopeFy ? prev : undefined,
  });
}
export function rowsOf(data: InfiniteData<PurchasePage> | undefined): PurchaseRow[] {
  const seen = new Set<number>();
  return (data?.pages ?? []).flatMap((page) => page.results).filter((row) => { if (seen.has(row.id)) return false; seen.add(row.id); return true; });
}
export function usePurchasesPage(firmId: FirmId | null, query: PurchaseQuery, pageSize = PURCHASES_PAGE_SIZE) {
  return useQuery({ queryKey: purchasesKeys.page(firmId, query, pageSize), queryFn: firmId === null ? skipToken : async ({ signal }) => toPurchasePage((await api.get('purchases/', { params: purchasesParams(firmId, query, 1, pageSize), signal })).data) });
}
export type PurchaseOutcome = { kind: 'purchase'; purchase: PurchaseDetail } | { kind: 'deleted'; binned: PurchaseBinRow };
export function purchaseQuery(id: number | null) {
  return queryOptions({ queryKey: purchasesKeys.one(id), queryFn: id === null ? skipToken : async ({ signal }): Promise<PurchaseOutcome> => {
    try { return { kind: 'purchase', purchase: toPurchaseDetail((await api.get(`purchases/${id}/`, { signal })).data) }; }
    catch (error) {
      const p = problemOf(error), binned = p.kind === 'notfound' && p.code === 'deleted' ? (p.body as { binned?: unknown }).binned : undefined;
      if (binned) return { kind: 'deleted', binned: toPurchaseBin(binned) };
      throw error;
    }
  } });
}
export const usePurchase = (id: number | null) => useQuery(purchaseQuery(id));
export const usePurchaseDetail = (id: number | null) => useQuery({ ...purchaseQuery(id), select: (outcome: PurchaseOutcome) => outcome.kind === 'purchase' ? outcome.purchase : null });
export function useCreditMonths(business: number | null, invoiceDate: string) {
  return useQuery({ queryKey: purchasesKeys.creditMonths(business, invoiceDate), queryFn: business === null || !invoiceDate ? skipToken : async ({ signal }) => toCreditMonths((await api.get('purchases/credit-months/', { params: { business_id: business, invoice_date: invoiceDate }, signal })).data) });
}
export type DuplicateArgs = { business_id: number; supplier_id: number; invoice_number: string; invoice_date: string; exclude_id?: number };
/** The caller debounces typed input; incomplete or refused checks never claim the number is free. */
export function useCheckDuplicate(args: DuplicateArgs | null) {
  return useQuery({ queryKey: purchasesKeys.duplicate(args), retry: false, staleTime: 10_000, queryFn: !args?.invoice_number.trim() || !args.business_id || !args.supplier_id || !args.invoice_date ? skipToken : async ({ signal }) => toDuplicateCheck((await api.get('purchases/check-duplicate/', { params: args, signal })).data) });
}
export type UsualRateArgs = { product_name: string; unit: string; supplier_id?: number };
export function useUsualRate(args: UsualRateArgs | null) {
  return useQuery({ queryKey: purchasesKeys.rate(args), queryFn: !args?.product_name.trim() || !args.unit ? skipToken : async ({ signal }) => toUsualRate((await api.get('purchases/usual-rate/', { params: args, signal })).data) });
}
export function invalidatePurchases(qc: QueryClient, keep?: number): void {
  void qc.invalidateQueries({ queryKey: purchasesKeys.all, predicate: (q) => !(keep !== undefined && q.queryKey[1] === 'bill' && q.queryKey[2] === keep) });
  for (const queryKey of [['suppliers'], ['captures'], ['customers'], ['search'], ['dashboard'], ['gst'], ['catalog'], ['firms']]) void qc.invalidateQueries({ queryKey });
}
function keepPurchase(qc: QueryClient, purchase: PurchaseDetail): void {
  const outcome: PurchaseOutcome = { kind: 'purchase', purchase };
  qc.setQueryData(purchasesKeys.one(purchase.id), outcome);
  invalidatePurchases(qc, purchase.id);
}
export function useCreatePurchase() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (body: PurchaseInput) => toPurchaseDetail((await api.post('purchases/', body)).data), onSuccess: (d) => keepPurchase(qc, d) });
}
export function useUpdatePurchase() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, body }: { id: number; body: PurchaseInput }) => toPurchaseDetail((await api.put(`purchases/${id}/`, body)).data), onSuccess: (d) => keepPurchase(qc, d) });
}
export function useDeletePurchase() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, reason }: { id: number; reason: string }) => toPurchaseBin((await api.delete(`purchases/${id}/`, { data: { reason } })).data), onSuccess: (binned, { id }) => {
    const outcome: PurchaseOutcome = { kind: 'deleted', binned }; qc.setQueryData(purchasesKeys.one(id), outcome); invalidatePurchases(qc, id);
  } });
}
export function useRestorePurchase() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (binId: number) => toPurchaseDetail((await api.post(`purchases/bin/${binId}/restore/`)).data), onSuccess: (d) => keepPurchase(qc, d) });
}
/** One request per selected bill. A partial failure leaves the caller's completed IDs for an honest retry. */
export function useDeletePurchases() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ ids, reason, onEach, onMissing }: { ids: number[]; reason: string; onEach: (id: number, binned: PurchaseBinRow) => void; onMissing: (id: number) => void }) => {
    for (const id of ids) {
      let binned: PurchaseBinRow;
      try { binned = toPurchaseBin((await api.delete(`purchases/${id}/`, { data: { reason } })).data); }
      catch (error) {
        // the server's DELETE answers a plain 404 for a bill already deleted elsewhere: skip it, uncounted, and go on
        if (problemOf(error).kind !== 'notfound') throw error;
        onMissing(id);
        continue;
      }
      onEach(id, binned);
    }
  }, onSettled: () => invalidatePurchases(qc) });
}
export function useCheckPurchase() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: number): Promise<{ id: number; needs_review: boolean }> => { const { data } = await api.post(`purchases/${id}/checked/`); return { id: Number(data?.id ?? id), needs_review: Boolean(data?.needs_review) }; }, onSuccess: () => invalidatePurchases(qc) });
}
export function useMovePurchaseCredit() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, itc_month }: { id: number; itc_month: string | null }) => { const { data } = await api.put(`purchases/${id}/credit-month/`, { itc_month }); return { id, credit: toCredit(data?.credit), previous: data?.previous == null ? null : String(data.previous) }; }, onSuccess: () => invalidatePurchases(qc) });
}
export function usePurchaseFiles() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, file }: { id: number; file: File }) => { const body = new FormData(); body.append('file', file); return toPurchaseDetail((await api.post(`purchases/${id}/files/`, body)).data); }, onSuccess: (d) => keepPurchase(qc, d) });
}
export function useDeletePurchaseFile() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, fileId }: { id: number; fileId: string }) => { await api.delete(`purchases/${id}/files/${encodeURIComponent(fileId)}/`); }, onSuccess: () => invalidatePurchases(qc) });
}
/** Explicit AI action only: no timer, retry, queue, saved purchase or automatic upload here. */
export function useReadPurchase() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ files, business_id, kind = 'form' }: { files: File[]; business_id?: number; kind?: 'form' | 'photos' }) => {
    const body = new FormData(); files.forEach((file) => body.append('files', file)); if (business_id != null) body.append('business_id', String(business_id)); body.append('kind', kind);
    return toPurchaseRead((await api.post('purchases/read/', body)).data);
  }, onSuccess: () => { void qc.invalidateQueries({ queryKey: ['ai-reads'] }); } });
}
