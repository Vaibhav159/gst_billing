import { cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderApp } from '@/test/render';
import { serve } from '@/test/server';
import { captureFixture } from './fixtures';
import { clearTokens, setTokens } from '@/core/api/client';
import { CaptureUploadHost } from './useUploads';
import type { QueuedCapture } from './store';

const mock = vi.hoisted(() => ({ make: vi.fn(), user: vi.fn().mockResolvedValue(undefined), start: vi.fn(() => vi.fn()), snapshot: { items: [], loading: false, error: null, busy: null } }));
vi.mock('./store', () => ({ IndexedDbCaptureStore: class {} }));
vi.mock('./queue', () => ({ createCaptureQueue: (...args: unknown[]) => { mock.make(...args); return { setUser: mock.user, start: mock.start, subscribe: () => () => {}, getSnapshot: () => mock.snapshot, add: vi.fn(), resume: vi.fn(), remove: vi.fn() }; } }));
type Bridge = { read(id: number, signal: AbortSignal | undefined, owner: number): Promise<unknown>; upload(item: QueuedCapture, signal?: AbortSignal): Promise<unknown> };
const bridge = () => mock.make.mock.calls.at(-1)?.[1] as Bridge;
const token = (id: number) => `test.${btoa(JSON.stringify({ user_id: id }))}.test`;
beforeEach(() => { setTokens(token(1)); mock.make.mockClear(); mock.user.mockClear(); mock.start.mockClear(); });
afterEach(() => { cleanup(); clearTokens(); });
it('checks the saved capture before reading and never rereads a stored successful result', async () => {
  const capture = captureFixture();
  const calls = serve({ 'GET captures/12/': capture });
  renderApp(<CaptureUploadHost />);
  expect(await bridge().read(12, undefined, 1)).toEqual(capture);
  expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['GET captures/12/']);
});
it('a new unprocessed upload receives one synchronous read', async () => {
  const capture = captureFixture({ status: 'reading', read: null });
  const calls = serve({ 'GET captures/12/': capture, 'POST captures/12/read/': captureFixture() });
  renderApp(<CaptureUploadHost />);
  await bridge().read(12, undefined, 1);
  expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['GET captures/12/', 'POST captures/12/read/']);
});
it('a failed capture waits for the inbox retry instead of being reread on resume', async () => {
  const capture = captureFixture({ status: 'failed', read: null, problem: "This doesn't look like a bill." });
  const calls = serve({ 'GET captures/12/': capture });
  renderApp(<CaptureUploadHost />);
  await bridge().read(12, undefined, 1);
  expect(calls).toHaveLength(1);
});
it('uploads the durable UUID and metadata and stops queue identity on host unmount', async () => {
  const calls = serve({ 'POST captures/': captureFixture() });
  const app = renderApp(<CaptureUploadHost />);
  const item: QueuedCapture = { clientId: 'c001', userId: 1, files: [new File(['a'], 'bill.png', { type: 'image/png' })], businessId: null, hint: 'Solanki', note: 'Stall 9', createdAt: '2026-10-12T00:00:00Z', captureId: null, phase: 'queued', error: null };
  await bridge().upload(item);
  const body = calls[0].data as FormData;
  expect(body.get('client_id')).toBe('c001');
  expect(body.get('business_id')).toBeNull();
  expect(body.get('note')).toBe('Stall 9');
  expect(mock.user).toHaveBeenCalledWith(1);
  app.unmount();
  expect(mock.user).toHaveBeenLastCalledWith(null);
});
it('a viewer cannot resume someone else’s queued uploads', async () => {
  renderApp(<CaptureUploadHost />, { me: { id: 9, role: 'viewer', permissions: ['view'] } });
  await waitFor(() => expect(mock.user).toHaveBeenCalledWith(null));
});
it.each(['ready', 'filled', 'discarded'] as const)('reuses a 200 upload receipt in %s state without starting another read', async (status) => {
  const capture = captureFixture({ status, ...(status === 'ready' ? {} : { read: null }) });
  const calls = serve({
    'POST captures/': () => ({ status: 200, data: capture }),
    'GET captures/12/': capture,
  });
  renderApp(<CaptureUploadHost />);
  const item: QueuedCapture = { clientId: '7439a752-34d4-4c98-ae27-2f4506d91df4', userId: 1,
    files: [new File(['%PDF-1.4 synthetic bill'], 'bill.pdf', { type: 'application/pdf' })],
    businessId: null, hint: 'Solanki', note: 'Stall 9', createdAt: '2026-10-12T00:00:00Z',
    captureId: null, phase: 'queued', error: null };
  expect(await bridge().upload(item)).toEqual(capture);
  expect(await bridge().read(capture.id, undefined, 1)).toEqual(capture);
  expect((calls[0].data as FormData).get('client_id')).toBe(item.clientId);
  expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['POST captures/', 'GET captures/12/']);
});

const queued = (): QueuedCapture => ({ clientId: 'capture-owned-by-one', userId: 1,
  files: [new File(['synthetic'], 'bill.pdf', { type: 'application/pdf' })], businessId: null,
  hint: '', note: '', createdAt: '2026-10-12T00:00:00Z', captureId: null, phase: 'queued', error: null });
it.each([2, null])('does not dispatch queued files while auth still shows the previous person and stored identity is %s', async (next) => {
  const calls = serve({ 'POST captures/': captureFixture() });
  renderApp(<CaptureUploadHost />); // /me/ has not adopted the other tab's identity yet.
  const pending = bridge().upload(queued());
  if (next === null) clearTokens(); else setTokens(token(next));
  await expect(pending).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  await expect(bridge().read(12, undefined, 1)).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  expect(calls).toEqual([]);
  expect(mock.user).toHaveBeenLastCalledWith(1);
});
it('stops before dispatching a read if another tab switches user while the capture inspection is out', async () => {
  let finish!: (reply: { status: number; data: unknown }) => void;
  const calls = serve({
    'GET captures/12/': () => new Promise(resolve => { finish = resolve; }),
    'POST captures/12/read/': captureFixture(),
  });
  renderApp(<CaptureUploadHost />);
  const pending = bridge().read(12, undefined, 1);
  await waitFor(() => expect(calls).toHaveLength(1));
  setTokens(token(2));
  finish({ status: 200, data: captureFixture({ status: 'reading', read: null }) });
  await expect(pending).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  expect(calls.map(call => `${call.method} ${call.url}`)).toEqual(['GET captures/12/']);
});
it('same-user token rotation still sends the durable receipt once', async () => {
  const calls = serve({ 'POST captures/': captureFixture() });
  renderApp(<CaptureUploadHost />);
  const pending = bridge().upload(queued());
  setTokens(`rotated.${btoa(JSON.stringify({ user_id: 1 }))}.token`);
  await expect(pending).resolves.toMatchObject({ id: 12 });
  expect(calls).toHaveLength(1);
  expect((calls[0].data as FormData).get('client_id')).toBe('capture-owned-by-one');
});
