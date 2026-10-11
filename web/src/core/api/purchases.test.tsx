import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { testQueryClient } from '@/test/render';
import { serve, type Call } from '@/test/server';
import { OUTSIDE_CREDIT, OUTSIDE_CREDIT_MONTHS, purchaseDetailWire, purchaseBinWire, purchasePageWire, purchasesServer } from '@/core/purchases/fixtures';
import type { PurchaseInput } from '@/core/purchases/types';
import { purchasesParams, purchasesKeys, rowsOf, usePurchasesList, usePurchase, useCreatePurchase, useDeletePurchase, useRestorePurchase, useCheckPurchase, useMovePurchaseCredit, useReadPurchase, usePurchaseFiles, useDeletePurchaseFile, useCreditMonths, useCheckDuplicate, useUsualRate, useDeletePurchases } from './purchases';
const setup = () => { const qc = testQueryClient(); return { qc, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> }; };
const body: PurchaseInput = { business: 3, supplier: 21, invoice_number: 'UBS/26-27/0851', invoice_date: '2026-10-08', payment_mode: 'bank', itc_eligible: true, itc_month: null, buyer_gstin: '', buyer_ack: false, lines: [{ product_name: 'Gold', hsn_code: '7108', gst_percent: '3', quantity: '1.000', unit: 'gms', rate: '6878.001', note: '' }] };

test('credit view removes date and FY filters and retains combining filters', () => {
  expect(purchasesParams(3, { fy: '2025-26', month: '2025-09', start_date: '2025-09-01', end_date: '2025-09-30', credit_month: '2026-10', q: 'UBS', check: true, photo: false, eligible: 0, include: 'lines' }, 2, 200)).toEqual({ business_id: 3, credit_month: '2026-10', q: 'UBS', check: 1, eligible: 0, include: 'lines', page: 2, page_size: 200 });
});
test('list waits for scope, pages without repeating summaries, and deduplicates shifted rows', async () => {
  const calls = serve({ 'GET purchases/': (c: Call) => ({ status: 200, data: purchasePageWire([purchaseDetailWire()], { next: c.params.page === 1 ? 'next' : null }) }) });
  const { wrapper, qc } = setup();
  const { result, rerender } = renderHook((firm: number | null) => usePurchasesList(firm, { fy: '2026-27', facets: true }), { wrapper, initialProps: null as number | null });
  await act(async () => { await qc.refetchQueries(); });
  expect(calls).toHaveLength(0);
  rerender(3);
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  await act(async () => { await result.current.fetchNextPage(); });
  expect(calls[0].params).toMatchObject({ business_id: 3, facets: 1, page_size: 40, page: 1 });
  expect(calls[1].params).toMatchObject({ summary: 0, page: 2 });
  expect(calls[1].params).not.toHaveProperty('facets');
  expect(rowsOf(result.current.data)).toHaveLength(1);
});
test('detail handles a deleted 404 as the purchase bin and keeps ordinary 404 as failure', async () => {
  serve({ 'GET purchases/905/': () => ({ status: 404, data: { code: 'deleted', detail: 'This purchase was deleted.', binned: purchaseBinWire() } }), 'GET purchases/999/': () => ({ status: 404, data: { detail: 'No purchase matches the given query.' } }) });
  const { wrapper } = setup();
  const deleted = renderHook(() => usePurchase(905), { wrapper });
  const missing = renderHook(() => usePurchase(999), { wrapper });
  await waitFor(() => expect(deleted.result.current.data?.kind).toBe('deleted'));
  await waitFor(() => expect(missing.result.current.isError).toBe(true));
  expect(deleted.result.current.data).toMatchObject({ binned: { id: 4, original_id: 905, supplier: { id: 21 }, total_amount: 49264500 } });
});
test('create caches its answer and invalidates purchases, suppliers, captures, customer and search figures', async () => {
  const calls = serve({ 'POST purchases/': purchaseDetailWire() });
  const { wrapper, qc } = setup();
  const roots = ['purchases', 'suppliers', 'captures', 'customers', 'search', 'dashboard', 'gst'];
  roots.forEach((r) => qc.setQueryData([r, 'other'], 'old'));
  const { result } = renderHook(() => useCreatePurchase(), { wrapper });
  await act(async () => { await result.current.mutateAsync(body); });
  expect(calls[0].data).toEqual(body);
  expect(qc.getQueryData(purchasesKeys.one(905))).toMatchObject({ kind: 'purchase', purchase: { total_amount: 49264500 } });
  roots.forEach((r) => expect(qc.getQueryState([r, 'other'])?.isInvalidated).toBe(true));
});
test('delete uses bill id and restore uses bin id, then restores the cached outcome', async () => {
  const calls = serve({ 'DELETE purchases/905/': purchaseBinWire(), 'POST purchases/bin/4/restore/': purchaseDetailWire() });
  const { wrapper, qc } = setup();
  const d = renderHook(() => useDeletePurchase(), { wrapper });
  const r = renderHook(() => useRestorePurchase(), { wrapper });
  await act(async () => { await d.result.current.mutateAsync({ id: 905, reason: 'Entered twice' }); });
  expect(qc.getQueryData(purchasesKeys.one(905))).toMatchObject({ kind: 'deleted', binned: { id: 4 } });
  await act(async () => { await r.result.current.mutateAsync(4); });
  expect(calls.map((c) => c.url)).toEqual(['purchases/905/', 'purchases/bin/4/restore/']);
  expect(qc.getQueryData(purchasesKeys.one(905))).toMatchObject({ kind: 'purchase' });
});
test('check, credit move and file writes use their contract methods and convert the moved credit', async () => {
  const calls = serve({ 'POST purchases/905/checked/': { id: 905, needs_review: false }, 'PUT purchases/905/credit-month/': { id: 905, previous: '2026-09', credit: { claimed: '1.23', month: '2026-10' } }, 'POST purchases/905/files/': purchaseDetailWire(), 'DELETE purchases/905/files/src/': () => ({ status: 204 }) });
  const { wrapper } = setup();
  const checked = renderHook(() => useCheckPurchase(), { wrapper });
  const moved = renderHook(() => useMovePurchaseCredit(), { wrapper });
  const attached = renderHook(() => usePurchaseFiles(), { wrapper });
  const removed = renderHook(() => useDeletePurchaseFile(), { wrapper });
  const file = new File(['synthetic'], 'bill.jpg', { type: 'image/jpeg' });
  await act(async () => { await checked.result.current.mutateAsync(905); expect((await moved.result.current.mutateAsync({ id: 905, itc_month: '2026-10' })).credit.claimed).toBe(123); await attached.result.current.mutateAsync({ id: 905, file }); await removed.result.current.mutateAsync({ id: 905, fileId: 'src' }); });
  expect(calls[1].data).toEqual({ itc_month: '2026-10' });
  expect((calls[2].data as FormData).get('file')).toBe(file);
});
test('clearing a before-ledger credit month preserves the no-op response and null previous month', async () => {
  const calls = serve({ 'PUT purchases/905/credit-month/': { id: 905, previous: null, credit: OUTSIDE_CREDIT } });
  const { wrapper } = setup();
  const moved = renderHook(() => useMovePurchaseCredit(), { wrapper });
  await act(async () => {
    expect(await moved.result.current.mutateAsync({ id: 905, itc_month: null })).toEqual({ id: 905, previous: null, credit: { ...OUTSIDE_CREDIT, claimed: 0 } });
  });
  expect(calls[0].data).toEqual({ itc_month: null });
  expect(calls).toHaveLength(1);
});
test('before-ledger month lookup returns no choices while retaining the real bill month', async () => {
  const calls = serve({ 'GET purchases/credit-months/': OUTSIDE_CREDIT_MONTHS });
  const { wrapper } = setup();
  const credit = renderHook(() => useCreditMonths(3, '2025-03-31'), { wrapper });
  await waitFor(() => expect(credit.result.current.isSuccess).toBe(true));
  expect(credit.result.current.data).toEqual(OUTSIDE_CREDIT_MONTHS);
  expect(calls[0].params).toMatchObject({ business_id: 3, invoice_date: '2025-03-31' });
});
test('read is explicit multipart and counts AI reads without retrying or polling', async () => {
  const calls = serve({ 'POST purchases/read/': { printed_total: '123.45', lines_total: '123.46', lines: [] } });
  const { wrapper, qc } = setup(); qc.setQueryData(['ai-reads'], { used: 1 });
  const read = renderHook(() => useReadPurchase(), { wrapper });
  const file = new File(['synthetic'], 'bill.pdf', { type: 'application/pdf' });
  await act(async () => { expect((await read.result.current.mutateAsync({ files: [file], business_id: 3, kind: 'form' })).lines_total).toBe(12346); });
  const data = calls[0].data as FormData;
  expect(data.getAll('files')).toEqual([file]); expect(data.get('business_id')).toBe('3'); expect(data.get('kind')).toBe('form');
  expect(qc.getQueryState(['ai-reads'])?.isInvalidated).toBe(true); expect(calls).toHaveLength(1);
});
test('credit, duplicate and rate queries wait for complete args and never invent duplicate certainty', async () => {
  const calls = purchasesServer({ 'GET purchases/check-duplicate/': { duplicate: null, unchecked: true } });
  const { wrapper, qc } = setup();
  const waiting = renderHook(() => { useCreditMonths(null, ''); useCheckDuplicate(null); useUsualRate(null); }, { wrapper });
  await act(async () => { await qc.refetchQueries(); }); expect(calls).toHaveLength(0); waiting.unmount();
  const credit = renderHook(() => useCreditMonths(3, '2026-08-02'), { wrapper });
  const dup = renderHook(() => useCheckDuplicate({ business_id: 3, supplier_id: 21, invoice_number: 'UBS', invoice_date: '2026-08-02', exclude_id: 905 }), { wrapper });
  const rate = renderHook(() => useUsualRate({ product_name: 'Gold', unit: 'gms', supplier_id: 21 }), { wrapper });
  await waitFor(() => expect(credit.result.current.isSuccess && dup.result.current.isSuccess && rate.result.current.isSuccess).toBe(true));
  expect(dup.result.current.data?.unchecked).toBe(true);
  expect(calls.find((c) => c.url.includes('duplicate'))?.params).toMatchObject({ exclude_id: 905 });
});
test('bulk delete stops at a locked bill and preserves progress for retry', async () => {
  const calls = serve({ 'DELETE purchases/1/': purchaseBinWire({ original_id: 1 }), 'DELETE purchases/2/': () => ({ status: 409, data: { code: 'month_closed', detail: 'Filed.' } }), 'DELETE purchases/3/': purchaseBinWire({ original_id: 3 }) });
  const { wrapper } = setup(), done: number[] = [];
  const batch = renderHook(() => useDeletePurchases(), { wrapper });
  await act(async () => { await expect(batch.result.current.mutateAsync({ ids: [1, 2, 3], reason: '', onEach: (id) => done.push(id) })).rejects.toThrow(); });
  expect(done).toEqual([1]); expect(calls.map((c) => c.url)).toEqual(['purchases/1/', 'purchases/2/']);
});

test('offline writes fail immediately without a queue and conflict writes are sent only once', async () => {
  const calls = serve({ 'POST purchases/': () => ({ status: 0 }), 'DELETE purchases/905/': () => ({ status: 409, data: { code: 'month_closed', detail: 'Filed.' } }) });
  const { wrapper, qc } = setup();
  const create = renderHook(() => useCreatePurchase(), { wrapper });
  const remove = renderHook(() => useDeletePurchase(), { wrapper });
  onlineManager.setOnline(false);
  try {
    await act(async () => { await expect(create.result.current.mutateAsync(body)).rejects.toThrow('Network Error'); });
    expect(create.result.current.isPaused).toBe(false);
    expect(qc.getMutationCache().getAll()[0].options).toMatchObject({ retry: false, networkMode: 'always' });
  } finally { onlineManager.setOnline(true); }
  await act(async () => { await expect(remove.result.current.mutateAsync({ id: 905, reason: '' })).rejects.toThrow(); });
  expect(calls.map(c => c.method)).toEqual(['POST', 'DELETE']);
});
