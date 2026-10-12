import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { testQueryClient } from '@/test/render';
import { serve, type Call } from '@/test/server';
import { useTodayCaptures } from './capture-summary';
function setup() {
  const client = testQueryClient();
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
describe('shared dated summary with local paging', () => {
  it('waits for a firm and delegates the dated 50-row summary to 2C', async () => {
    const calls = serve({ 'GET captures/': { count: 0, next: null, previous: null, results: [] } });
    const { wrapper } = setup();
    const hook = renderHook(({ firm }: { firm: number | null }) => useTodayCaptures(firm, '2026-10-12'), { initialProps: { firm: null as number | null }, wrapper });
    expect(calls).toHaveLength(0);
    hook.rerender({ firm: 3 });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(calls).toEqual([expect.objectContaining({ method: 'GET', url: 'captures/', params: { business_id: 3, day: '2026-10-12', summary: 1, page_size: 50, page: 1, status: 'waiting' } })]);
  });
  it('pages only on action, resets when firm changes, and shares 2C invalidation', async () => {
    const calls = serve({ 'GET captures/': (call: Call) => ({ status: 200, data: { count: 51, next: call.params.page === 1 ? '/api/captures/?page=2' : null, previous: null, results: [] } }) });
    const { wrapper, client } = setup();
    const hook = renderHook(({ firm }) => useTodayCaptures(firm, '2026-10-12'), { initialProps: { firm: 3 }, wrapper });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(calls).toHaveLength(1);
    act(() => hook.result.current.nextPage());
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(calls.map(call => call.params.page)).toEqual([1, 2]);
    await act(async () => { await client.invalidateQueries({ queryKey: ['captures', 'list'] }); });
    expect(calls.map(call => call.params.page)).toEqual([1, 2, 2]);
    hook.rerender({ firm: 4 });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(calls[calls.length - 1]?.params).toMatchObject({ business_id: 4, page: 1 });
    expect(hook.result.current.page).toBe(1);
  });
});

it('starts at page one on every firm or day change, including returning to an earlier scope', async () => {
  const calls = serve({ 'GET captures/': { count: 51, next: null, previous: null, results: [] } });
  const { wrapper } = setup();
  const hook = renderHook(({ firm, day }) => useTodayCaptures(firm, day), { initialProps: { firm: 3, day: '2026-10-12' }, wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  act(() => hook.result.current.nextPage());
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  hook.rerender({ firm: 4, day: '2026-10-12' });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  hook.rerender({ firm: 3, day: '2026-10-12' });
  expect(hook.result.current.page).toBe(1);
  act(() => hook.result.current.nextPage());
  hook.rerender({ firm: 3, day: '2026-10-13' });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  hook.rerender({ firm: 3, day: '2026-10-12' });
  expect(hook.result.current.page).toBe(1);
  expect(calls.at(-1)?.params).toMatchObject({ business_id: 3, day: '2026-10-13', page: 1 });
});
