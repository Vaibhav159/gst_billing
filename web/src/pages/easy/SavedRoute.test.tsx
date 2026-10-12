// Shared actions stay their real implementations.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { mount, VIEWER } from '@/pages/customers/testing';
import { serve } from '@/test/server';
import { wireBin, wireDetail } from '@/core/sales/fixtures';
import { SavedRoute } from './SavedRoute';
const draw = (path = '/e/saved/412', viewer = false) => mount([
  { path: '/e/saved/:id', element: <SavedRoute /> }, { path: '/e/new', element: <h1>Who is buying?</h1> },
  { path: '/e/bill/:id/print', element: <h1>Print page</h1> },
], [path], { me: viewer ? VIEWER : undefined });
it('loads the saved server bill and composes one send and print action', async () => {
  const calls = serve({ 'GET sales/412/': wireDetail() }); const { router } = draw();
  expect(await screen.findByRole('heading', { name: 'Bill 31 saved' })).toBeVisible();
  expect(screen.getByText(/Anil Gupta ·/)).toHaveTextContent('₹87,083.21 · paid in cash');
  expect(screen.getAllByRole('button', { name: 'Send the bill' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Print' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Print' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/e/bill/412/print'));
  expect(calls.filter(c => c.method !== 'GET')).toEqual([]);
});
it('a viewer can print but cannot start or send a bill', async () => {
  serve({ 'GET sales/412/': wireDetail() }); draw('/e/saved/412', true);
  await screen.findByRole('heading', { name: 'Bill 31 saved' });
  expect(screen.getByRole('button', { name: 'Print' })).toBeVisible();
  expect(screen.getByText('Not sent yet')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Make another bill' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Send the bill' })).not.toBeInTheDocument();
});
it('an unsent paper bill leads with Print and Make another bill; the shared send waits behind a quiet button (P6-4)', async () => {
  const calls = serve({ 'GET sales/412/': wireDetail({ paper: true, invoice_date: '2026-09-30' }) }); draw();
  await screen.findByRole('heading', { name: 'Bill 31 saved' });
  expect(screen.getByRole('button', { name: 'Make another bill' })).toHaveAttribute('data-variant', 'primary');
  expect(screen.getByRole('button', { name: 'Send the bill' })).toHaveAttribute('data-variant', 'ghost');
  fireEvent.click(screen.getByRole('button', { name: 'Send the bill' }));
  expect(screen.getAllByRole('button', { name: 'Send the bill' })).toHaveLength(1);
  expect(calls.filter(c => c.method !== 'GET')).toEqual([]);
});
it('starts a fresh bill through the ordinary Easy route', async () => {
  serve({ 'GET sales/412/': wireDetail() }); const { router } = draw();
  fireEvent.click(await screen.findByRole('button', { name: 'Make another bill' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/e/new'));
  expect(router.state.location.search).toBe('');
});
it('rejects a malformed id without fetching and names a deleted bill separately', async () => {
  const calls = serve({}); const first = draw('/e/saved/nope');
  expect(screen.getByRole('heading', { name: "We can't find this bill" })).toBeVisible();
  expect(calls).toEqual([]); first.unmount();
  serve({ 'GET sales/412/': () => ({ status: 404, data: { code: 'deleted', detail: 'This bill was deleted.', binned: wireBin() } }) });
  draw(); expect(await screen.findByRole('heading', { name: 'This bill was deleted' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Send the bill' })).not.toBeInTheDocument();
});
it('waits for the record without a success header or invented zero total', () => {
  serve({ 'GET sales/412/': () => new Promise(() => {}) }); draw();
  expect(screen.queryByRole('heading', { name: /saved$/ })).not.toBeInTheDocument();
  expect(screen.queryByText('₹0.00')).not.toBeInTheDocument();
});
