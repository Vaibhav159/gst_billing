import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { serve } from '@/test/server';
import { testQueryClient } from '@/test/render';
import { captureFixture } from '@/core/captures/fixtures';
import { captureProblem, uploadCapture, readCapture, useCaptures, useCaptureAction, useAiReads, useCaptureSummary, useCaptureInboxPreview, captureKeys } from './captures';

function setup() {
  const client = testQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}
test('scope waits; all firms omits business_id, specific scope includes undecided server rows', async () => {
  const row = captureFixture({ business: null });
  const calls = serve({ 'GET captures/': { results: [row], count: 1, counts: { reading: 0, ready: 1, failed: 0, no_firm: 1 } } });
  const { wrapper } = setup();
  const hook = renderHook(({ firm }: { firm: number | 'all' | null }) => useCaptures(firm), { initialProps: { firm: null as number | 'all' | null }, wrapper });
  expect(calls).toHaveLength(0);
  hook.rerender({ firm: 3 });
  await waitFor(() => expect(hook.result.current.data?.count).toBe(1));
  expect(calls[0].params).toEqual({ business_id: 3, status: 'waiting' });
  hook.rerender({ firm: 'all' });
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1].params).toEqual({ status: 'waiting' });
});
test('multipart preserves all pages and retry identity and read is explicit', async () => {
  const row = captureFixture({ status: 'reading', read: null });
  const calls = serve({ 'POST captures/': row, 'POST captures/12/read/': captureFixture() });
  const files = [new File(['a'], 'a.jpg', { type: 'image/jpeg' }), new File(['b'], 'b.pdf', { type: 'application/pdf' })];
  expect((await uploadCapture({ client_id: 'same-uuid', files, hint: 'Gold', note: 'counter', business_id: 3 })).id).toBe(12);
  const body = calls[0].data as FormData;
  expect(body.getAll('files')).toHaveLength(2);
  expect(body.get('client_id')).toBe('same-uuid');
  expect(body.get('business_id')).toBe('3');
  expect(calls).toHaveLength(1);
  expect((await readCapture(12)).status).toBe('ready');
});
test('a PDF is not automatically an e-invoice and failed reads remain capture data', async () => {
  serve({ 'POST captures/12/read/': captureFixture({ pdf: true, status: 'failed', read: null, problem: "The reader didn't answer in time." }) });
  const row = await readCapture(12);
  expect(row.read).toBeNull();
  expect(row.status).toBe('failed');
});
test.each([['read', 'POST captures/12/read/'], ['discard', 'DELETE captures/12/'], ['restore', 'POST captures/12/restore/']] as const)('%s updates capture detail and invalidates list and meter', async (action, route) => {
  const row = captureFixture();
  serve({ [route]: row });
  const { client, wrapper } = setup();
  const invalidated = vi.spyOn(client, 'invalidateQueries');
  const hook = renderHook(() => useCaptureAction(action), { wrapper });
  await act(async () => { await hook.result.current.mutateAsync(12); });
  expect(client.getQueryData(captureKeys.one(12))).toEqual(row);
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ['captures', 'list'] });
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ['ai-reads'] });
});
test('capture_used keeps the server words and purchase link', async () => {
  const detail = 'This photo was filled in already, as UBS/26-27/0866.';
  serve({ 'POST captures/12/read/': () => ({ status: 409, data: { code: 'capture_used', detail, purchase: { id: 905 } } }) });
  const failure = await readCapture(12).catch(e => e);
  expect(captureProblem(failure)).toMatchObject({ code: 'capture_used', message: detail, body: { purchase: { id: 905 } } });
});
test('no focus or interval refresh and usage has no cap', async () => {
  const calls = serve({ 'GET ai-reads/': { month: '2026-10', used: 1501 } });
  const { wrapper, client } = setup();
  const hook = renderHook(() => useAiReads(), { wrapper });
  await waitFor(() => expect(hook.result.current.data).toEqual({ month: '2026-10', used: 1501 }));
  expect(client.getDefaultOptions().queries?.refetchInterval).toBeFalsy();
  expect(client.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false);
  window.dispatchEvent(new Event('focus'));
  expect(calls).toHaveLength(1);
});

test('X-18 summary waits for scope and keeps its narrow paged shape separate from full captures', async () => {
  const row = { id: 12, status: 'ready', supplier: 'Udaipur Bullion Suppliers', number: 'UBS/26-27/0866',
    total: '298817.00', problem: '', pages: 2, who: captureFixture().captured_by, when: '2026-10-08T14:21:09+05:30' };
  const answer = { count: 51, next: '/api/captures/?day=2026-10-08&summary=1&page=2', previous: null, results: [row] };
  const calls = serve({ 'GET captures/': answer });
  const { wrapper, client } = setup();
  const hook = renderHook(({ firm, page }: { firm: number | 'all' | null; page: number }) =>
    useCaptureSummary(firm, '2026-10-08', page, 'waiting'), { initialProps: { firm: null as number | 'all' | null, page: 1 }, wrapper });
  expect(calls).toHaveLength(0);
  hook.rerender({ firm: 3, page: 1 });
  await waitFor(() => expect(hook.result.current.data).toEqual(answer));
  expect(calls[0].params).toEqual({ business_id: 3, day: '2026-10-08', summary: 1, page: 1, page_size: 50, status: 'waiting' });
  expect(client.getQueryData(captureKeys.list(3, 'waiting'))).toBeUndefined();
  expect(hook.result.current.data?.results[0].pages).toBe(2);
  expect(hook.result.current.data?.results[0]).not.toHaveProperty('read');
  hook.rerender({ firm: 'all', page: 2 });
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1].params).toEqual({ day: '2026-10-08', summary: 1, page: 2, page_size: 50, status: 'waiting' });
});
test('X-30 refuses a complete multipart request over 24 MB before any HTTP request', async () => {
  const calls = serve({ 'POST captures/': captureFixture() });
  const files = [new File([new Uint8Array(20 * 1024 * 1024)], 'front.pdf', { type: 'application/pdf' }),
    new File([new Uint8Array(4 * 1024 * 1024)], 'back.pdf', { type: 'application/pdf' })];
  await expect(uploadCapture({ files, client_id: '7439a752-34d4-4c98-ae27-2f4506d91df4', note: 'All pages' }))
    .rejects.toThrow('These pages come to 24.0 MB. One bill can send at most 24 MB; take fewer or smaller pages.');
  expect(calls).toHaveLength(0);
});

test('X-40 preserves 2B useCaptureInboxPreview and its enabled flag in the shared API home', async () => {
  const answer = { count: 1, results: [captureFixture({ business: null })], counts: { reading: 0, ready: 1, failed: 0, no_firm: 1 } };
  const calls = serve({ 'GET captures/': answer });
  const { wrapper } = setup();
  const hook = renderHook(({ enabled }) => useCaptureInboxPreview(3, enabled), { initialProps: { enabled: false }, wrapper });
  expect(calls).toHaveLength(0);
  hook.rerender({ enabled: true });
  await waitFor(() => expect(hook.result.current.data?.count).toBe(1));
  expect(calls[0].params).toEqual({ business_id: 3, status: 'waiting' });
});


test.each([2, null])('durable capture requests belong to their queued owner when the current token names %s', async current => {
  const { clearTokens, setTokens } = await import('./client');
  const calls = serve({ 'POST captures/': captureFixture() });
  if (current === null) clearTokens(); else setTokens(`test.${btoa(JSON.stringify({ user_id: current }))}.test`);
  try {
    await expect(uploadCapture({ client_id: '7439a752-34d4-4c98-ae27-2f4506d91df4',
      files: [new File(['synthetic'], 'bill.pdf', { type: 'application/pdf' })] }, undefined, 1))
      .rejects.toMatchObject({ code: 'ERR_CANCELED' });
    expect(calls).toEqual([]);
  } finally { clearTokens(); }
});
