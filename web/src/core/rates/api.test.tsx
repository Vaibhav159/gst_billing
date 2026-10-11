import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { testQueryClient } from '@/test/render';
import { serve } from '@/test/server';
import { pass } from '@/test/clock';
import { ratesKeys, useRates, useSetRates } from './api';
import { wireBoard, wireRates } from './testing';
import { boardOf } from './model';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); onlineManager.setOnline(true); focusManager.setFocused(undefined); });
function setup() {
  const client = testQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}
test('shared shop-wide latest and dated keys, no prior-date placeholder or blank-date request', async () => {
  const calls = serve({ 'GET rates/': ({ params }) => ({ status: 200, data: wireRates(params.date ? { in_force: null } : {}) }) });
  const { wrapper } = setup();
  const hook = renderHook(({ date }) => ({ a: useRates(date), b: useRates(date) }), { wrapper, initialProps: { date: undefined as string | null | undefined } });
  await pass(); expect(calls).toHaveLength(1); expect(hook.result.current.a.data?.latest?.quoted['gold-22K']).toBe(6512500);
  hook.rerender({ date: '2026-09-30' }); expect(hook.result.current.a.data).toBeUndefined(); await pass();
  expect(calls[1].params).toEqual({ date: '2026-09-30' }); expect(hook.result.current.a.data?.in_force).toBeNull();
  hook.rerender({ date: null }); await pass(); expect(calls).toHaveLength(2);
});
test('reads again on stale mount, never on focus or ten minutes idle', async () => {
  const calls = serve({ 'GET rates/': wireRates() }); const { wrapper } = setup();
  const one = renderHook(() => useRates(), { wrapper }); await pass(); one.unmount();
  const two = renderHook(() => useRates(), { wrapper }); await pass(); expect(calls).toHaveLength(1);
  await pass(600001); act(() => focusManager.setFocused(true)); await pass(); expect(calls).toHaveLength(1); two.unmount();
  renderHook(() => useRates(), { wrapper }); await pass(); expect(calls).toHaveLength(2);
});
test('save sends exact quote strings, refreshes active rates and marks inactive dates stale', async () => {
  const calls = serve({ 'GET rates/': wireRates(), 'POST rates/': () => ({ status: 201, data: wireBoard({ id: 42 }) }) });
  const { wrapper, client } = setup(); client.setQueryData(ratesKeys.board('2025-01-01'), wireRates());
  const hook = renderHook(() => ({ q: useRates(), save: useSetRates() }), { wrapper }); await pass();
  await act(async () => { await hook.result.current.save.mutateAsync(boardOf(wireBoard())!.quoted); }); await pass();
  expect(calls.find(c => c.method === 'POST')?.data).toEqual({ quoted: wireBoard().quoted });
  expect(calls.filter(c => c.method === 'GET')).toHaveLength(2);
  expect(client.getQueryState(ratesKeys.board('2025-01-01'))?.isInvalidated).toBe(true);
});
test('offline save fails once immediately and is never queued', async () => {
  const calls = serve({ 'POST rates/': () => ({ status: 0 }) }); const { wrapper } = setup();
  const hook = renderHook(() => useSetRates(), { wrapper }); act(() => onlineManager.setOnline(false));
  await act(async () => { await expect(hook.result.current.mutateAsync(boardOf(wireBoard())!.quoted)).rejects.toThrow(); });
  act(() => onlineManager.setOnline(true)); await pass(60000); expect(calls).toHaveLength(1);
});
