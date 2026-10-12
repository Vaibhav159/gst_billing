import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderApp } from '@/test/render';
import { serve } from '@/test/server';
import { captureFixture } from '@/core/captures/fixtures';
import CaptureInbox from './CaptureInbox';

const upload = vi.hoisted(() => ({ items: [], loading: false, error: null, busy: null, add: vi.fn(), retry: vi.fn(), retryAll: vi.fn(), remove: vi.fn() }));
vi.mock('@/core/captures/useUploads', () => ({ useUploads: () => upload }));
vi.mock('@/core/scope', () => ({ useFirms: () => ({ firms: [{ id: 3, name: 'Kiran Gold House' }], loading: false, error: false }), useScope: () => ({ firmId: 3, ready: true }) }));
vi.mock('@/core/prefs', () => ({ usePrefs: () => ({ prefs: { defaultBusinessId: '3' }, ready: true }) }));
const own = captureFixture({ id: 12, captured_by: { id: 2, name: 'Counter' } });
const other = captureFixture({ id: 13, captured_by: { id: 1, name: 'Owner' } });
const pageOf = (results = [own]) => ({ results, count: results.length, counts: { reading: results.filter((r) => r.status === 'reading').length, ready: results.filter((r) => r.status === 'ready').length, failed: results.filter((r) => r.status === 'failed').length, no_firm: results.filter((r) => r.business === null).length } });
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.useRealTimers(); (window as unknown as { __phone: boolean }).__phone = false; });
it('staff can fill and discard their own capture, but cannot discard someone else’s', async () => {
  serve({ 'GET captures/': pageOf([own, other]) });
  renderApp(<CaptureInbox />, { me: { id: 2, role: 'staff', permissions: ['view', 'capture', 'purchase.create'] } });
  await screen.findAllByRole('link', { name: 'Fill in' });
  const mine = document.querySelector('[data-row="12"]') as HTMLElement;
  const theirs = document.querySelector('[data-row="13"]') as HTMLElement;
  expect(within(mine).getByRole('button', { name: 'Discard' })).toBeVisible();
  expect(within(theirs).queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
});
it('discard removes the row only after the server agrees; Undo restores it', async () => {
  let rows = [own];
  const calls = serve({ 'GET captures/': () => ({ status: 200, data: pageOf(rows) }), 'DELETE captures/12/': () => { rows = []; return { status: 200, data: { ...own, status: 'discarded' } }; }, 'POST captures/12/restore/': () => { rows = [own]; return { status: 200, data: own }; } });
  renderApp(<CaptureInbox />);
  fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 400);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard photo' }));
  await screen.findByText('Photo discarded');
  await waitFor(() => expect(document.querySelector('[data-row="12"]')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: /Undo/ }));
  await waitFor(() => expect(document.querySelector('[data-row="12"]')).not.toBeNull());
  expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  expect(calls.filter((c) => c.url === 'captures/12/restore/')).toHaveLength(1);
});
it('a refused discard stays open with the exact server words and preserves the row', async () => {
  serve({ 'GET captures/': pageOf(), 'DELETE captures/12/': () => ({ status: 403, data: { detail: "Counter took this photo. Only the owner can remove someone else's photo. Ask the owner if you need it.", needs: 'capture.discard' } }) });
  renderApp(<CaptureInbox />);
  fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 400);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard photo' }));
  expect(await screen.findByText("Counter took this photo. Only the owner can remove someone else's photo. Ask the owner if you need it.")).toBeVisible();
  expect(document.querySelector('[data-row="12"]')).not.toBeNull();
});
it('refresh is explicit, never triggered by focus, and a failed read keeps the photo', async () => {
  let capture = captureFixture({ status: 'reading', read: null });
  const calls = serve({ 'GET captures/': () => ({ status: 200, data: pageOf([capture]) }), 'POST captures/12/read/': () => ({ status: 200, data: capture }) });
  renderApp(<CaptureInbox />);
  await screen.findByText('Reading the bill…');
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(calls.filter((c) => c.method === 'GET')).toHaveLength(1);
  capture = { ...capture, status: 'failed', problem: 'The reading stopped before it finished.' };
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  expect(await screen.findByText(/The reading stopped before it finished. The photo is kept./)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Try reading again' }));
  await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1));
});
it('phone inbox asks for all firms and includes undecided captures', async () => {
  (window as unknown as { __phone: boolean }).__phone = true;
  const calls = serve({ 'GET captures/': pageOf([captureFixture({ business: null, business_name: '' })]) });
  renderApp(<CaptureInbox />);
  expect(await screen.findByText('Firm not decided')).toBeVisible();
  expect(calls[0].params).not.toHaveProperty('business_id');
});
it('viewer sees Open and the original photo but no fill, retry or discard controls', async () => {
  serve({ 'GET captures/': pageOf([captureFixture({ status: 'failed', read: null })]) });
  renderApp(<CaptureInbox />, { me: { role: 'viewer', permissions: ['view'] } });
  expect(await screen.findByRole('link', { name: 'Open' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Try reading again' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
});
it('shows an unreadable OCR date as written rather than formatting it as NaN', async () => {
  const capture = captureFixture();
  if (capture.read) capture.read.invoice_date = 'not legible';
  serve({ 'GET captures/': pageOf([capture]) });
  renderApp(<CaptureInbox />);
  expect(await screen.findByText(/dated not legible/)).toBeVisible();
  expect(document.body).not.toHaveTextContent('NaN');
});
