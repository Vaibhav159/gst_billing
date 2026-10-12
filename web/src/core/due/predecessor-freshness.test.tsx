import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { afterEach, expect, test, vi } from 'vitest';
import { testQueryClient } from '@/test/render';
import { serve } from '@/test/server';
import { purchaseDetailWire, purchaseBinWire, SUPPLIER } from '@/core/purchases/fixtures';
import type { PurchaseInput } from '@/core/purchases/types';
import { useCreatePurchase, useUpdatePurchase, useDeletePurchase, useRestorePurchase, useDeletePurchases, useCheckPurchase, useMovePurchaseCredit, usePurchaseFiles, useDeletePurchaseFile, useReadPurchase } from '@/core/api/purchases';
import { useSaveSupplier } from '@/core/api/suppliers';
import { captureFixture } from '@/core/captures/fixtures';
import { useCaptureAction } from '@/core/api/captures';
import { useBatchImport, type ImportBody } from '@/pages/imports/batch';
import { useImportSession } from '@/pages/imports/session';
import { invalidateGst, useGstWrite, type GstWrite } from '@/core/api/gst';
import { useOpeningPreview, useSaveOpeningCredit, useMoveCredit } from '@/core/api/gstCredit';
import { openingWire, effectWire } from '@/core/gst/creditFixtures';

afterEach(cleanup);

const keys = [
  ['dashboard', 3, '2026-27'], ['dashboard', 'all', '2026-27'], ['dashboard', 2, '2025-26'],
  ['due-next', 3, false], ['due-next', 'all', true], ['due-next', 2, false],
] as const;
function seed(qc: QueryClient) { keys.forEach(key => qc.setQueryData(key, { fixture: true })); }
function expectStale(qc: QueryClient, stale = true) {
  for (const key of keys) expect(qc.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(stale);
}
function setup() {
  const qc = testQueryClient();
  seed(qc);
  return { qc, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> };
}
const purchase: PurchaseInput = {
  business: 3, supplier: 21, invoice_number: 'UBS/26-27/0851', invoice_date: '2026-10-08',
  payment_mode: 'bank', itc_eligible: true, itc_month: null, buyer_gstin: '', buyer_ack: false,
  lines: [{ product_name: 'Gold', hsn_code: '7108', gst_percent: '3', quantity: '1.000', unit: 'gms', rate: '6878.001', note: '' }],
};

test('every purchase write marks every dashboard and due scope stale without reading inactive scopes', async () => {
  const calls = serve({
    'POST purchases/': purchaseDetailWire(), 'PUT purchases/905/': purchaseDetailWire(),
    'DELETE purchases/905/': purchaseBinWire(), 'POST purchases/bin/4/restore/': purchaseDetailWire(),
    'POST purchases/905/checked/': { id: 905, needs_review: false },
    'PUT purchases/905/credit-month/': { id: 905, previous: '2026-09', credit: { claimed: '1.23', month: '2026-10' } },
    'POST purchases/905/files/': purchaseDetailWire(), 'DELETE purchases/905/files/src/': () => ({ status: 204 }),
  });
  const { qc, wrapper } = setup();
  const h = renderHook(() => ({
    create: useCreatePurchase(), update: useUpdatePurchase(), remove: useDeletePurchase(), restore: useRestorePurchase(),
    check: useCheckPurchase(), credit: useMovePurchaseCredit(), attach: usePurchaseFiles(), detach: useDeletePurchaseFile(),
  }), { wrapper });
  const operations: (() => Promise<unknown>)[] = [
    () => h.result.current.create.mutateAsync({ ...purchase, capture: 12, source: 'capture' }),
    () => h.result.current.update.mutateAsync({ id: 905, body: purchase }),
    () => h.result.current.remove.mutateAsync({ id: 905, reason: 'Entered twice' }),
    () => h.result.current.restore.mutateAsync(4),
    () => h.result.current.check.mutateAsync(905),
    () => h.result.current.credit.mutateAsync({ id: 905, itc_month: '2026-10' }),
    () => h.result.current.attach.mutateAsync({ id: 905, file: new File(['synthetic'], 'bill.jpg', { type: 'image/jpeg' }) }),
    () => h.result.current.detach.mutateAsync({ id: 905, fileId: 'src' }),
  ];
  for (const operation of operations) {
    seed(qc);
    await act(async () => { await operation(); });
    expectStale(qc);
  }
  expect(calls).toHaveLength(operations.length);
  expect(calls.every(call => call.method !== 'GET')).toBe(true);
});

test('a purchase refusal leaves figures fresh; AI extraction alone does too', async () => {
  serve({
    'POST purchases/': () => ({ status: 409, data: { code: 'month_closed', detail: 'Filed.' } }),
    'POST purchases/read/': { printed_total: '123.45', lines_total: '123.45', lines: [] },
  });
  const { qc, wrapper } = setup();
  const h = renderHook(() => ({ create: useCreatePurchase(), read: useReadPurchase() }), { wrapper });
  await act(async () => { await expect(h.result.current.create.mutateAsync(purchase)).rejects.toBeDefined(); });
  expectStale(qc, false);
  await act(async () => { await h.result.current.read.mutateAsync({ files: [new File(['synthetic'], 'bill.pdf', { type: 'application/pdf' })] }); });
  expectStale(qc, false);
});

test('supplier create and update use the shared purchase invalidation seam', async () => {
  const calls = serve({ 'POST suppliers/': SUPPLIER, 'PUT suppliers/21/': SUPPLIER });
  const { qc, wrapper } = setup();
  const h = renderHook(() => useSaveSupplier(), { wrapper });
  const body = { name: SUPPLIER.name, gst_number: SUPPLIER.gst_number, state_name: 'RAJASTHAN', city: 'Udaipur', address: '', mobile_number: '', pan_number: 'AACFU5521R', email: '' };
  await act(async () => { await h.result.current.mutateAsync({ body }); });
  expectStale(qc);
  seed(qc);
  await act(async () => { await h.result.current.mutateAsync({ id: 21, body }); });
  expectStale(qc);
  expect(calls).toHaveLength(2);
});

test('opening-credit previews and failed saves leave figures fresh; a committed save invalidates', async () => {
  let fail = true;
  const calls = serve({ 'PUT gst/opening-credit/': (call: import('@/test/server').Call) => {
    if (call.params.preview === 1) return { status: 200, data: effectWire };
    return fail ? { status: 400, data: { igst: ["A credit balance can't be below zero."] } } : { status: 200, data: { opening: openingWire, effect: effectWire } };
  } });
  const { qc, wrapper } = setup();
  const h = renderHook(() => ({ preview: useOpeningPreview(), save: useSaveOpeningCredit() }), { wrapper });
  const input = { business: 3, igst: 123, cgst: 950000, sgst: 950000 };
  await act(async () => { await h.result.current.preview.mutateAsync(input); });
  expectStale(qc, false);
  await act(async () => { await expect(h.result.current.save.mutateAsync(input)).rejects.toBeDefined(); });
  expectStale(qc, false);
  fail = false;
  await act(async () => { await h.result.current.save.mutateAsync(input); });
  expectStale(qc);
  expect(calls.map(call => call.params)).toEqual([{ preview: 1 }, {}, {}]);
  expect(calls[2].data).toEqual({ business: 3, igst: '1.23', cgst: '9500.00', sgst: '9500.00' });
});

test('the credit tab move uses its own real hook and refreshes both roots only on success', async () => {
  let fail = true;
  const calls = serve({ 'PUT purchases/77/credit-month/': () => fail ? { status: 409, data: { code: 'month_closed', detail: 'Filed.' } } : { status: 200, data: { id: 77, credit: {}, previous: '2026-10' } } });
  const { qc, wrapper } = setup();
  const h = renderHook(() => useMoveCredit(), { wrapper });
  await act(async () => { await expect(h.result.current.mutateAsync({ id: 77, month: '2026-09' })).rejects.toBeDefined(); });
  expectStale(qc, false);
  fail = false;
  await act(async () => { await h.result.current.mutateAsync({ id: 77, month: '2026-09' }); });
  expectStale(qc);
  expect(calls.map(call => call.data)).toEqual([{ itc_month: '2026-09' }, { itc_month: '2026-09' }]);
});

test('partial batch deletion invalidates once at settlement, including a later locked bill', async () => {
  const calls = serve({
    'DELETE purchases/1/': purchaseBinWire({ original_id: 1 }),
    'DELETE purchases/2/': () => ({ status: 409, data: { code: 'month_closed', detail: 'Filed.' } }),
  });
  const { qc, wrapper } = setup();
  const invalidated = vi.spyOn(qc, 'invalidateQueries');
  const h = renderHook(() => useDeletePurchases(), { wrapper });
  const completed: number[] = [];
  await act(async () => { await expect(h.result.current.mutateAsync({ ids: [1, 2, 3], reason: 'Entered twice', onEach: id => completed.push(id), onMissing: () => {} })).rejects.toBeDefined(); });
  expect(completed).toEqual([1]);
  expect(calls).toHaveLength(2);
  expectStale(qc);
  expect(invalidated.mock.calls.filter(([filters]) => filters?.queryKey?.[0] === 'dashboard')).toHaveLength(1);
  expect(invalidated.mock.calls.filter(([filters]) => filters?.queryKey?.[0] === 'due-next')).toHaveLength(1);
});

test.each([
  ['read', 'POST captures/12/read/'], ['discard', 'DELETE captures/12/'], ['restore', 'POST captures/12/restore/'],
] as const)('capture %s refreshes only after its confirmed response', async (action, route) => {
  let fail = true;
  const calls = serve({ [route]: () => fail ? { status: 409, data: { code: 'capture_used', detail: 'Already filled.' } } : { status: 200, data: captureFixture() } });
  const { qc, wrapper } = setup();
  const h = renderHook(() => useCaptureAction(action), { wrapper });
  await act(async () => { await expect(h.result.current.mutateAsync(12)).rejects.toBeDefined(); });
  expectStale(qc, false);
  fail = false;
  await act(async () => { await h.result.current.mutateAsync(12); });
  expectStale(qc);
  expect(calls).toHaveLength(2);
});

function importBody(kind: 'sales' | 'purchases'): ImportBody {
  return {
    file_name: 'Synthetic.csv', dry_run: false,
    bills: [{
      ref: 'row2', business: 3, invoice_number: '001', invoice_date: '2026-10-04', payment_mode: 'cash',
      ...(kind === 'sales' ? { customer: 7, paper: true as const } : { supplier: 21, itc_eligible: true, itc_month: null }),
      lines: [{ product_name: 'Gold', hsn_code: '7108', quantity: '1', rate: '100', unit: 'gms', gst_percent: '3', note: '' }],
    }],
  };
}
test.each(['sales', 'purchases'] as const)('%s imports invalidate only a committed successful transaction', async kind => {
  const body = importBody(kind);
  let status = 200;
  let result = { dry_run: true, ok: true, bills: [], totals: { bills: 1, total_amount: '103.00', credit: '3.00' } };
  const calls = serve({ [`POST ${kind}/import/`]: () => ({ status, data: result }) });
  const { qc, wrapper } = setup();
  const h = renderHook(() => useBatchImport(kind), { wrapper });
  await act(async () => { await h.result.current.mutateAsync({ ...body, dry_run: true }); });
  expectStale(qc, false);
  await act(async () => { await h.result.current.mutateAsync(body); });
  expectStale(qc, false);
  result = { ...result, dry_run: false, ok: false };
  await act(async () => { await h.result.current.mutateAsync(body); });
  expectStale(qc, false);
  status = 409;
  await act(async () => { await expect(h.result.current.mutateAsync(body)).rejects.toBeDefined(); });
  expectStale(qc, false);
  status = 200;
  result = { ...result, ok: true };
  await act(async () => { await h.result.current.mutateAsync(body); });
  expectStale(qc);
  expect(calls).toHaveLength(5);
});

test('a saved purchase batch refreshes figures even when the following sales batch fails', async () => {
  const answer = (dry_run: boolean) => ({
    dry_run, ok: true,
    bills: [{ ref: 'row2', ok: true, id: dry_run ? null : 905, problems: [], duplicate: null, credit: null }],
    totals: { bills: 1, total_amount: '103.00', credit: '3.00' },
  });
  const calls = serve({
    'POST purchases/import/': (call: import('@/test/server').Call) => ({ status: 200, data: answer((call.data as ImportBody).dry_run) }),
    'POST sales/import/': (call: import('@/test/server').Call) => (call.data as ImportBody).dry_run
      ? { status: 200, data: answer(true) }
      : { status: 400, data: { invoice_number: ['The number is taken.'] } },
  });
  const { qc, wrapper } = setup();
  const h = renderHook(() => useImportSession(), { wrapper });
  await act(async () => {
    expect(await h.result.current.check([
      { kind: 'purchases', body: importBody('purchases') },
      { kind: 'sales', body: importBody('sales') },
    ])).toBe(true);
  });
  expectStale(qc, false);
  await act(async () => { await h.result.current.importChecked(); });
  expectStale(qc);
  expect(h.result.current.reports.map(report => report.kind)).toEqual(['purchases']);
  expect(h.result.current.checked).toBeNull();
  expect(h.result.current.error).toContain('The number is taken.');
  expect(calls.map(call => [call.url, (call.data as ImportBody).dry_run])).toEqual([
    ['purchases/import/', true], ['sales/import/', true], ['purchases/import/', false], ['sales/import/', false],
  ]);
  await act(async () => { await h.result.current.importChecked(); });
  expect(calls).toHaveLength(4);
});

test('GST download refresh leaves dashboard and due-next fresh', async () => {
  const calls = serve({});
  const { qc } = setup();
  qc.setQueryData(['gst', 'download'], {});
  // GstPage calls this same helper after successful file download/share reads.
  await act(async () => { invalidateGst(qc); });
  expect(qc.getQueryState(['gst', 'download'])?.isInvalidated).toBe(true);
  expectStale(qc, false);
  expect(calls).toHaveLength(0);
});

test.each<GstWrite>([
  { method: 'post', path: 'filings/', body: { business: 3, month: '2026-09', kind: 'gstr1', filed_on: '2026-10-10' } },
  { method: 'patch', path: 'filings/7/', body: { arn: 'AA0810260345671' } },
  { method: 'delete', path: 'filings/7/', body: { reason: 'Marked the wrong month' } },
  { method: 'post', path: 'months/unlock/', body: { business: 3, month: '2026-09', reason: 'Wrong GSTIN' } },
  { method: 'post', path: 'months/relock/', body: { business: 3, month: '2026-09' } },
  { method: 'post', path: 'months/filed-before/', body: { business: 3, up_to: '2026-06' } },
])('GST $method $path refreshes only on success', async write => {
  let fail = true;
  const calls = serve({ [`${write.method.toUpperCase()} gst/${write.path}`]: () => fail ? { status: 409, data: { detail: 'Not saved.' } } : { status: 200, data: {} } });
  const { qc, wrapper } = setup();
  const h = renderHook(() => useGstWrite(), { wrapper });
  await act(async () => { await expect(h.result.current.mutateAsync(write)).rejects.toBeDefined(); });
  expectStale(qc, false);
  fail = false;
  await act(async () => { await h.result.current.mutateAsync(write); });
  expectStale(qc);
  expect(calls).toHaveLength(2);
});
