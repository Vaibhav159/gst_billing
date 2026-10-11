import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { expect, test } from 'vitest';
import { serve } from '@/test/server';
import { testQueryClient } from '@/test/render';
import { gstKeys, useGstMonth, useGstWrite, useGstSections, getGstFile } from './gst';
function setup() { const qc = testQueryClient(); return { qc, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> }; }
test('waits for one firm, passes exact query params and separates as-filed sections', async () => {
  const calls = serve({ 'GET gst/month/': { business: 3, month: '2026-09', gstr3b: { cash: { total: '82213.68' } } }, 'GET gst/month/gstr1/': { b2b: [] } });
  const { wrapper } = setup();
  const h = renderHook(({ firm }) => useGstMonth(firm, '2026-09'), { wrapper, initialProps: { firm: null as number | null } });
  expect(calls).toHaveLength(0);
  h.rerender({ firm: 3 });
  await waitFor(() => expect(h.result.current.data?.business).toBe(3));
  expect(calls[0].params).toEqual({ business_id: 3, month: '2026-09' });
  expect(h.result.current.data?.gstr3b?.cash.total).toBe(8221368);
  const sections = renderHook(() => useGstSections(3, '2026-09', true), { wrapper });
  await waitFor(() => expect(sections.result.current.isSuccess).toBe(true));
  expect(calls[1].params).toEqual({ business_id: 3, month: '2026-09', as_filed: 1 });
  expect(gstKeys.sections(3, '2026-09', false)).not.toEqual(gstKeys.sections(3, '2026-09', true));
});
test('a write invalidates GST, sales locks, purchases, report reads without queuing', async () => {
  const { qc, wrapper } = setup();
  const calls = serve({ 'POST gst/months/unlock/': { stage: 'unlocked' } });
  for (const key of ['gst','sales','bin','purchases','reports']) qc.setQueryData([key, 'test'], {});
  const h = renderHook(() => useGstWrite(), { wrapper });
  await act(async () => { await h.result.current.mutateAsync({ method: 'post', path: 'months/unlock/', body: { business: 3, month: '2026-09', reason: 'Wrong GSTIN' } }); });
  expect(calls[0].data).toEqual({ business: 3, month: '2026-09', reason: 'Wrong GSTIN' });
  for (const key of ['gst','sales','bin','purchases','reports']) expect(qc.getQueryState([key,'test'])?.isInvalidated).toBe(true);
});
test('file response stays opaque so as-filed download never rebuilds its JSON', async () => {
  const body = new Blob(['{"fp":"092026","b2b":[]}'], { type: 'application/json' });
  const calls = serve({ 'GET gst/files/gstr1/': body });
  const file = await getGstFile(3, '2026-09', 'gstr1', true);
  expect(file).toBe(body);
  expect(calls[0].params).toEqual({ business_id: 3, month: '2026-09', as_filed: 1, via: 'download' });
});
