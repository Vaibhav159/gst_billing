import type { ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { AuthContext } from '@/core/auth/AuthProvider';
import { stubAuth, testQueryClient } from '@/test/render';
import { serve } from '@/test/server';
import { clearTokens, setTokens } from '@/core/api/client';
import { captureFixture } from './fixtures';
import { CaptureUploadHost } from './useUploads';
import type { QueuedCapture } from './store';

const mock = vi.hoisted(() => ({ make: vi.fn(), snapshot: { items: [], loading: false, error: null, busy: null } }));
vi.mock('./store', () => ({ IndexedDbCaptureStore: class {} }));
vi.mock('./queue', () => ({ createCaptureQueue: (...args: unknown[]) => {
  mock.make(...args);
  return { setUser: vi.fn().mockResolvedValue(undefined), start: () => () => {}, subscribe: () => () => {}, getSnapshot: () => mock.snapshot, add: vi.fn(), resume: vi.fn(), remove: vi.fn() };
} }));
type Bridge = { read(id: number, signal: AbortSignal | undefined, owner: number): Promise<unknown>; upload(item: QueuedCapture, signal?: AbortSignal): Promise<unknown>; changed(id: number | null): void };
const keys = [['dashboard', 3, '2026-27'], ['due-next', 3, false]] as const;
const seed = (qc: QueryClient) => keys.forEach(key => qc.setQueryData(key, {}));
const stale = (qc: QueryClient, expected: boolean) => keys.forEach(key => expect(qc.getQueryState(key)?.isInvalidated).toBe(expected));
function setup() {
  const qc = testQueryClient();
  seed(qc);
  const Providers = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}><AuthContext.Provider value={stubAuth()}>{children}</AuthContext.Provider></QueryClientProvider>;
  render(<CaptureUploadHost />, { wrapper: Providers });
  return { qc, bridge: mock.make.mock.calls.at(-1)![1] as Bridge };
}
beforeEach(() => { setTokens(`test.${btoa(JSON.stringify({ user_id: 1 }))}.test`); mock.make.mockClear(); });
afterEach(() => { cleanup(); clearTokens(); });
const queued: QueuedCapture = {
  clientId: '5d000000-0000-4000-8000-000000000001', userId: 1,
  files: [new File(['synthetic'], 'bill.png', { type: 'image/png' })], businessId: null,
  hint: '', note: '', createdAt: '2026-10-12T00:00:00Z', captureId: null, phase: 'queued', error: null,
};
test('local queue changes and stored-result lookups do not refresh dashboard figures', async () => {
  const calls = serve({ 'GET captures/12/': captureFixture() });
  const { qc, bridge } = setup();
  await act(async () => { bridge.changed(null); await bridge.read(12, undefined, 1); });
  stale(qc, false);
  expect(calls.map(call => `${call.method} ${call.url}`)).toEqual(['GET captures/12/']);
});
test('confirmed queue upload and initial read each invalidate dashboard and due-next', async () => {
  const calls = serve({
    'POST captures/': captureFixture({ status: 'reading', read: null }),
    'GET captures/12/': captureFixture({ status: 'reading', read: null }),
    'POST captures/12/read/': captureFixture(),
  });
  const { qc, bridge } = setup();
  await act(async () => { await bridge.upload(queued); });
  stale(qc, true);
  seed(qc);
  await act(async () => { await bridge.read(12, undefined, 1); });
  stale(qc, true);
  expect(calls.map(call => `${call.method} ${call.url}`)).toEqual(['POST captures/', 'GET captures/12/', 'POST captures/12/read/']);
});
test('failed upload and read leave figures fresh', async () => {
  serve({
    'POST captures/': () => ({ status: 400, data: { detail: 'Choose a photo.' } }),
    'GET captures/12/': captureFixture({ status: 'reading', read: null }),
    'POST captures/12/read/': () => ({ status: 409, data: { detail: 'Already filled.' } }),
  });
  const { qc, bridge } = setup();
  await act(async () => { await expect(bridge.upload(queued)).rejects.toBeDefined(); await expect(bridge.read(12, undefined, 1)).rejects.toBeDefined(); });
  stale(qc, false);
});
