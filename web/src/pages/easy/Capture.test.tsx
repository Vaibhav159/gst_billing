// X-40: run only after 2C and 6B are real production modules; no virtual predecessor implementation.
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StrictMode, type ReactNode } from 'react';
import { captureKeys } from '@/core/api/captures';
import { todayIST } from '@/core/format';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { clearTokens, setTokens } from '@/core/api/client';
import type { QueuedCapture } from '@/core/captures/store';
import { renderApp } from '@/test/render';
import { serve } from '@/test/server';
import { captureFixture } from '@/core/captures/fixtures';
import { __setNetState } from '@/core/api/network';
import Capture from './Capture';
import type { CaptureSummary } from '@/core/captures/types';

const uploaded = vi.hoisted(() => ({ add: vi.fn(), retry: vi.fn(), remove: vi.fn(), items: [] as QueuedCapture[], loading: false, error: null, busy: null }));
vi.mock('@/core/captures/useUploads', () => ({ useUploads: () => uploaded }));
const choice = vi.hoisted(() => ({ firmId: 3 as number | null, firm: { id: 3, name: 'KIRAN GOLD HOUSE' } as { id: number; name: string } | null, loading: false, error: false }));
vi.mock('./state', () => ({ useEasyFirm: () => choice }));
vi.mock('./parts', () => ({ EasyPage: ({ children, title }: { children: ReactNode; title: string }) => <main><h1>{title}</h1>{children}</main> }));
const row: CaptureSummary = { id: 12, status: 'ready', supplier: 'Rajasthan Silver Traders', number: 'RST/112', total: '48210.00', problem: '', pages: 1, who: { id: 1, name: 'Kailash' }, when: '2026-10-12T16:48:00+05:30' };
const list = (rows: CaptureSummary[]) => ({ count: rows.length, results: rows, next: null, previous: null });
const token = (id: number) => `test.${btoa(JSON.stringify({ user_id: id }))}.test`;
beforeEach(() => { setTokens(token(1)); Object.assign(uploaded, { items: [], loading: false, busy: null, error: null }); Object.assign(choice, { firmId: 3, firm: { id: 3, name: 'KIRAN GOLD HOUSE' }, loading: false, error: false }); vi.clearAllMocks(); uploaded.add.mockResolvedValue(undefined); uploaded.retry.mockResolvedValue(undefined); uploaded.remove.mockResolvedValue(undefined); Object.assign(window, { __phone: true }); __setNetState('online'); });
afterEach(() => { clearTokens(); vi.useRealTimers(); __setNetState('online'); });

it('uses the narrow list; an image or full reading is requested only on Open', async () => {
  const calls = serve({ 'GET captures/': list([row]), 'GET captures/12/': captureFixture() });
  renderApp(<Capture />);
  expect(await screen.findByText('₹48,210.00')).toHaveClass('text-amber');
  expect(calls).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /^Open Rajasthan/ }));
  await screen.findByRole('dialog');
  await waitFor(() => expect(calls.filter(call => call.url === 'captures/12/')).toHaveLength(1));
});
it('counter staff can fill ready captures, remove their own, and cannot remove another person’s', async () => {
  serve({ 'GET captures/': list([row, { ...row, id: 13, supplier: 'Other supplier', who: { id: 2, name: 'Rakesh' } }]) });
  renderApp(<Capture />, { me: { id: 1, role: 'staff', permissions: ['view', 'capture', 'purchase.create'] } });
  expect(await screen.findByRole('button', { name: 'Fill them in now in the full view' })).toBeVisible();
  expect(screen.getByRole('button', { name: /^Remove Rajasthan/ })).toBeVisible();
  expect(screen.queryByRole('button', { name: /^Remove Other supplier/ })).toBeNull();
});
it('viewer sees the list and original but no write actions', async () => {
  const calls = serve({ 'GET captures/': list([row]) });
  renderApp(<Capture />, { me: { role: 'viewer', permissions: ['view'] } });
  await screen.findByText('Rajasthan Silver Traders');
  expect(screen.getByLabelText('Take a photo')).toBeDisabled();
  expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Fill them in now in the full view' })).toBeNull();
  expect(calls.every(call => call.method === 'GET')).toBe(true);
});
it('DELETE succeeds before the row disappears, and Undo calls restore', async () => {
  let rows = [row];
  let finish!: () => void;
  const calls = serve({
    'GET captures/': () => ({ status: 200, data: list(rows) }),
    'DELETE captures/12/': () => new Promise(resolve => { finish = () => { rows = []; resolve({ status: 200, data: captureFixture({ status: 'discarded' }) }); }; }),
    'POST captures/12/restore/': () => { rows = [row]; return { status: 200, data: captureFixture() }; },
  });
  renderApp(<Capture />);
  fireEvent.click(await screen.findByRole('button', { name: /^Remove Rajasthan/ }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(screen.getByText('Rajasthan Silver Traders')).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => finish());
  await screen.findByText('Photo removed');
  expect(screen.queryByText('Rajasthan Silver Traders', { exact: true })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await screen.findByText('Rajasthan Silver Traders', { exact: true });
  expect(calls.filter(call => call.url === 'captures/12/restore/')).toHaveLength(1);
});
it('a refused own-photo DELETE preserves the row and server words', async () => {
  serve({ 'GET captures/': list([row]), 'DELETE captures/12/': () => ({ status: 409, data: { detail: 'Someone filled this photo in already.' } }) });
  renderApp(<Capture />);
  fireEvent.click(await screen.findByRole('button', { name: /^Remove Rajasthan/ }));
  await screen.findByText('Someone filled this photo in already.');
  expect(screen.getByText('Rajasthan Silver Traders', { exact: true })).toBeVisible();
});
it('the owner is asked before removing another person’s photo', async () => {
  const calls = serve({ 'GET captures/': list([{ ...row, who: { id: 2, name: 'Rakesh' } }]) });
  renderApp(<Capture />);
  fireEvent.click(await screen.findByRole('button', { name: /^Remove Rajasthan/ }));
  expect(await screen.findByRole('dialog', { name: 'Remove this photo?' })).toBeVisible();
  expect(screen.getByText(/Rakesh took this photo/)).toBeVisible();
  expect(calls.some(call => call.method === 'DELETE')).toBe(false);
});
it('reuses one shared queued upload for multiple pages of one bill', async () => {
  serve({ 'GET captures/': list([]) });
  renderApp(<Capture />);
  await screen.findByText('No photos today');
  const files = [new File(['synthetic one'], 'one.pdf', { type: 'application/pdf' }), new File(['synthetic two'], 'two.pdf', { type: 'application/pdf' })];
  fireEvent.change(screen.getByLabelText('Choose from gallery or WhatsApp'), { target: { files } });
  await waitFor(() => expect(uploaded.add).toHaveBeenCalledExactlyOnceWith(files, { businessId: 3, hint: '', note: '', asPages: true }));
});
it('refuses an oversized whole bill before any upload or discard', async () => {
  const calls = serve({ 'GET captures/': list([row]) });
  renderApp(<Capture />);
  await screen.findByText('Rajasthan Silver Traders');
  const a = new File(['a'], 'a.pdf', { type: 'application/pdf' });
  const b = new File(['b'], 'b.pdf', { type: 'application/pdf' });
  Object.defineProperty(a, 'size', { value: 13 * 1048576 }); Object.defineProperty(b, 'size', { value: 13 * 1048576 });
  fireEvent.change(screen.getByLabelText('Choose from gallery or WhatsApp'), { target: { files: [a, b] } });
  await screen.findByText('These pages come to 26.0 MB. One bill can send at most 24 MB; take fewer or smaller pages.');
  expect(uploaded.add).not.toHaveBeenCalled();
  expect(calls.some(call => call.method !== 'GET')).toBe(false);
});
it('restarts an interrupted initial reading explicitly and does not read again once ready', async () => {
  let rows = [{ ...row, status: 'reading' as const, supplier: '', total: null } as CaptureSummary];
  const calls = serve({ 'GET captures/': () => ({ status: 200, data: list(rows) }), 'GET captures/12/': () => ({ status: 200, data: captureFixture({ status: rows[0].status, read: rows[0].status === 'reading' ? null : captureFixture().read }) }), 'POST captures/12/read/': () => { rows = [row]; return { status: 200, data: captureFixture() }; } });
  renderApp(<Capture />);
  await screen.findByText('Rajasthan Silver Traders');
  expect(calls.filter(call => call.method === 'POST' && call.url.endsWith('/read/'))).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Check again' })).not.toHaveAttribute('aria-busy', 'true'));
  expect(calls.filter(call => call.method === 'POST' && call.url.endsWith('/read/'))).toHaveLength(1);
});
it('a 30-second slow-reading message and a minute idle issue no request', async () => {
  vi.useFakeTimers();
  const calls = serve({ 'GET captures/': list([{ ...row, status: 'reading', supplier: '', total: null }]) });
  renderApp(<Capture />, { me: { role: 'viewer', permissions: ['view'] } });
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  const before = calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(30_001); });
  expect(screen.getByText('Taking longer than usual. You can take the next photo.')).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(calls).toHaveLength(before);
});
it('an unreadable file keeps its failure state and Take it again discards before a new queued upload', async () => {
  let rows: CaptureSummary[] = [{ ...row, status: 'failed', problem: 'The photo is too blurred to read the numbers.' }];
  let finish!: () => void;
  const calls = serve({ 'GET captures/': () => ({ status: 200, data: list(rows) }), 'DELETE captures/12/': () => new Promise(resolve => { finish = () => { rows = []; resolve({ status: 200, data: captureFixture({ status: 'discarded' }) }); }; }) });
  renderApp(<Capture />);
  await screen.findByText("Couldn't read this photo: the photo is too blurred to read the numbers. The photo is kept.");
  const file = new File(['synthetic replacement'], 'replacement.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByLabelText('Take it again'), { target: { files: [file] } });
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(uploaded.add).not.toHaveBeenCalled();
  await act(async () => finish());
  await waitFor(() => expect(uploaded.add).toHaveBeenCalledExactlyOnceWith([file], { businessId: 3, hint: '', note: '', asPages: true }));
  expect(calls.filter(call => call.method === 'DELETE')).toHaveLength(1);
});
it('a replacement storage refusal retains the pages and retries without discarding twice', async () => {
  const rows: CaptureSummary[] = [{ ...row, status: 'failed', problem: 'The photo is too blurred to read the numbers.' }];
  const calls = serve({ 'GET captures/': list(rows), 'DELETE captures/12/': captureFixture({ status: 'discarded' }) });
  uploaded.add.mockRejectedValueOnce(new Error("This browser couldn't keep the files. Keep this page open and try again."));
  renderApp(<Capture />);
  await screen.findByLabelText('Take it again');
  const file = new File(['synthetic replacement'], 'replacement.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByLabelText('Take it again'), { target: { files: [file] } });
  await screen.findByText("This browser couldn't keep the files. Keep this page open and try again.");
  expect(screen.getByText('replacement.pdf')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(uploaded.add).toHaveBeenCalledTimes(2));
  expect(calls.filter(call => call.method === 'DELETE')).toHaveLength(1);
});

it.each([
  [true, "The firms couldn't load. Try again when the internet is back."],
  [false, "No firm to bill from yet. The owner adds firms in Records."],
] as const)('an unresolved firm shows its settled state and never reads all captures: %s', async (error, words) => {
  Object.assign(choice, { firmId: null, firm: null, error, loading: false });
  const calls = serve({});
  renderApp(<Capture />);
  expect(await screen.findByText(words)).toBeVisible();
  expect(calls).toHaveLength(0);
  expect(screen.queryByText('No photos today')).toBeNull();
});

it('refuses a replacement whose full multipart request exceeds 24 MB before discarding', async () => {
  const calls = serve({ 'GET captures/': list([{ ...row, status: 'failed' }]), 'DELETE captures/12/': captureFixture({ status: 'discarded' }) });
  renderApp(<Capture />);
  await screen.findByLabelText('Take it again');
  const files = ['one.pdf', 'two.pdf'].map(name => new File([new Uint8Array(12 * 1048576 - 512)], name, { type: 'application/pdf' }));
  fireEvent.change(screen.getByLabelText('Take it again'), { target: { files } });
  await screen.findByText('These pages come to 24.1 MB. One bill can send at most 24 MB; take fewer or smaller pages.');
  expect(calls.some(call => call.method === 'DELETE')).toBe(false);
  expect(uploaded.add).not.toHaveBeenCalled();
});
it('leaves a stored receipt with a read failure to the shared queue retry action', async () => {
  const photo = { ...row, status: 'reading' as const };
  uploaded.items = [{ clientId: 'queued-photo', userId: 1, businessId: 3, hint: '', note: '',
    files: [new File(['synthetic'], 'kept.pdf', { type: 'application/pdf' })], createdAt: row.when,
    phase: 'uploaded', captureId: 12, error: 'The reader did not answer.' }];
  const calls = serve({ 'GET captures/': list([photo]), 'GET captures/12/': captureFixture() });
  renderApp(<Capture />);
  await screen.findByText('Reading the bill…');
  await act(async () => {});
  expect(screen.getByText('The reader did not answer.')).toBeVisible();
  expect(calls.map(call => call.url)).toEqual(['captures/']);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(uploaded.retry).toHaveBeenCalledExactlyOnceWith('queued-photo'));
});
it('waits for durable receipts to load before inspecting interrupted reads', async () => {
  uploaded.loading = true;
  const calls = serve({ 'GET captures/': list([{ ...row, status: 'reading' }]), 'GET captures/12/': captureFixture() });
  renderApp(<Capture />);
  await screen.findByText('Reading the bill…');
  expect(calls.map(call => call.url)).toEqual(['captures/']);
});
it('stops an initial read when another tab changes the signed-in person during inspection', async () => {
  let finish!: (reply: { status: number; data: unknown }) => void;
  const calls = serve({
    'GET captures/': list([{ ...row, status: 'reading' }]),
    'GET captures/12/': () => new Promise(resolve => { finish = resolve; }),
    'POST captures/12/read/': captureFixture(),
  });
  renderApp(<Capture />);
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  setTokens(token(2));
  await act(async () => { finish({ status: 200, data: captureFixture({ status: 'reading', read: null }) }); });
  expect(calls.some(call => call.method === 'POST')).toBe(false);
});
it('stops an initial read when its page unmounts during inspection', async () => {
  let finish!: (reply: { status: number; data: unknown }) => void;
  const calls = serve({
    'GET captures/': list([{ ...row, status: 'reading' }]),
    'GET captures/12/': () => new Promise(resolve => { finish = resolve; }),
    'POST captures/12/read/': captureFixture(),
  });
  const app = renderApp(<Capture />);
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  app.unmount();
  await act(async () => { finish({ status: 200, data: captureFixture({ status: 'reading', read: null }) }); });
  expect(calls.some(call => call.method === 'POST')).toBe(false);
});
it('refreshes dashboard, due-next and the meter after resuming an initial read', async () => {
  let client!: QueryClient;
  function Grab() { client = useQueryClient(); return null; }
  let finish!: (reply: { status: number; data: unknown }) => void;
  let rows = [{ ...row, status: 'reading' as const }] as CaptureSummary[];
  serve({
    'GET captures/': () => ({ status: 200, data: list(rows) }),
    'GET captures/12/': captureFixture({ status: 'reading', read: null }),
    'POST captures/12/read/': () => new Promise(resolve => { finish = resolve; }),
  });
  renderApp(<><Grab /><Capture /></>);
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  for (const key of [['dashboard'], ['due-next'], ['ai-reads']]) client.setQueryData(key, {});
  rows = [row];
  await act(async () => { finish({ status: 200, data: captureFixture() }); });
  await waitFor(() => expect(client.getQueryState(['ai-reads'])?.isInvalidated).toBe(true));
  expect(client.getQueryState(['dashboard'])?.isInvalidated).toBe(true);
  expect(client.getQueryState(['due-next'])?.isInvalidated).toBe(true);
});

it('removes a missing uploaded receipt only from this phone instead of offering an ineffective retry', async () => {
  const calls = serve({ 'GET captures/': list([]) });
  uploaded.items = [{ clientId: 'missing-photo', userId: 1, businessId: 3, hint: '', note: '',
    files: [new File(['synthetic'], 'kept.pdf', { type: 'application/pdf' })], createdAt: row.when,
    phase: 'uploaded', captureId: 12, missing: true, error: 'This photo is no longer in the inbox. Remove this saved upload from this device.' }];
  renderApp(<Capture />);
  await screen.findByText('No photos today');
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Remove from this phone' }));
  await waitFor(() => expect(uploaded.remove).toHaveBeenCalledExactlyOnceWith('missing-photo'));
  expect(calls.every(call => call.method === 'GET')).toBe(true);
});

it('resumes a cached initial reading after StrictMode repeats the mount effects', async () => {
  const reading = { ...row, status: 'reading' as const, supplier: '', total: null };
  let rows: CaptureSummary[] = [reading];
  const calls = serve({
    'GET captures/': () => ({ status: 200, data: list(rows) }),
    'GET captures/12/': captureFixture({ status: 'reading', read: null }),
    'POST captures/12/read/': () => { rows = [row]; return { status: 200, data: captureFixture() }; },
  });
  function Cached() {
    const client = useQueryClient();
    client.setQueryData(captureKeys.summary(3, todayIST(), 1, 'waiting'), list([reading]));
    return <StrictMode><Capture /></StrictMode>;
  }
  renderApp(<Cached />);
  await screen.findByText('Read · photo taken at 16:48');
  expect(calls.filter(call => call.method === 'POST')).toHaveLength(1);
});
