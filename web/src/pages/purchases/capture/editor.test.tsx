import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AuthContext } from '@/core/auth/AuthProvider';
import { RoleContext } from '@/core/auth/role';
import { captureKeys } from '@/core/api/captures';
import { captureFixture, readFixture } from '@/core/captures/fixtures';
import { CREDIT_MONTHS, PURCHASE_FIRM, SUPPLIER, purchaseDetailWire } from '@/core/purchases/fixtures';
import { ToastProvider } from '@/core/ui';
import { stubAuth, testQueryClient } from '@/test/render';
import { serve, type Reply } from '@/test/server';
import { tick } from '@/test/clock';
import FillCapturePage from './FillCapturePage';

const read = () => readFixture({ buyer: { name: '', gst_number: '', business: 3 }, notes: [], confidence: { supplier: 'high', gstin: 'high', bill_no: 'high', date: 'medium', amounts: 'medium' } });
function server(extra: Parameters<typeof serve>[0] = {}) {
  return serve({ 'GET captures/12/': captureFixture({ read: read() }), 'GET businesses/': [PURCHASE_FIRM],
    'GET products/': [], 'GET suppliers/': { count: 1, results: [SUPPLIER] },
    'GET suppliers/21/': { supplier: { ...SUPPLIER, address: '', gstin_valid: true }, figures: {}, rates: [], bills: [] },
    'GET suppliers/21/memory/': { bills: 0, last: null, line: null, next_number: null },
    'GET purchases/check-duplicate/': { duplicate: null, same_spelling: true },
    'GET purchases/usual-rate/': { rate: null, from: null, last: null },
    'GET purchases/credit-months/': CREDIT_MONTHS, 'POST purchases/': purchaseDetailWire(), ...extra });
}
function mount() {
  const client = testQueryClient(); const auth = stubAuth();
  const router = createMemoryRouter([{ path: '/purchases/inbox/:id', element: <ToastProvider><FillCapturePage /></ToastProvider> },
    { path: '/purchases/:id', element: <p>Saved purchase</p> }, { path: '/purchases/inbox', element: <p>The inbox</p> }], { initialEntries: ['/purchases/inbox/12'] });
  render(<QueryClientProvider client={client}><AuthContext.Provider value={auth}><RoleContext.Provider value="owner"><RouterProvider router={router} /></RoleContext.Provider></AuthContext.Provider></QueryClientProvider>);
  return { client, router };
}
async function ready() { await screen.findByLabelText('Claim the credit in'); await tick(400); }
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-10-08T10:00:00+05:30')); });
afterEach(() => vi.useRealTimers());

test('actual 2B form shares photo checks and edited amounts, sends capture identity and exact rates, then navigates without a guard', async () => {
  const calls = server(); const m = mount(); await ready();
  fireEvent.click(within(screen.getByRole('group', { name: 'date' })).getByRole('button', { name: /Looks right/ }));
  fireEvent.change(screen.getByLabelText('Rate per gms'), { target: { value: '6878.125' } });
  expect(within(screen.getByRole('group', { name: 'quantities and rates' })).queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByText('Everything was read with high confidence. Glance over it and save.')).not.toBeInTheDocument();
  expect(screen.getByText('The fields read with medium confidence have been checked. Glance over it and save.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Save as purchase' }));
  expect(await screen.findByText('Saved purchase')).toBeVisible();
  expect(m.router.state.location.pathname + m.router.state.location.search).toBe('/purchases/905?from=capture');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(calls.find(c => c.method === 'POST')?.data).toMatchObject({ capture: 12, source: 'capture', needs_review: false,
    lines: [{ rate: '6878.125', quantity: '42.180' }] });
});

test('pending confidence saves Needs a check and synchronous filled refresh cannot swallow the saved callback', async () => {
  let saved = false;
  const calls = server({ 'GET captures/12/': () => ({ status: 200, data: captureFixture({ status: saved ? 'filled' : 'ready', read: read() }) }),
    'POST purchases/': () => { saved = true; return { status: 200, data: purchaseDetailWire() }; } });
  const m = mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Save as purchase' }));
  expect(await screen.findByText('Saved purchase')).toBeVisible();
  expect(m.router.state.location.search).toBe('?from=capture');
  expect(calls.find(c => c.method === 'POST')?.data).toMatchObject({ needs_review: true });
});

test.each([400, 409, 0])('save %s preserves typed values, credit and checks; competing actions and late acceptance stay disabled during write', async status => {
  let finish!: (r: Reply) => void;
  const calls = server({ 'POST purchases/': () => new Promise<Reply>(resolve => { finish = resolve; }) });
  const m = mount(); await ready();
  fireEvent.change(screen.getByLabelText("Supplier's bill number"), { target: { value: 'TYPED/7' } });
  fireEvent.change(screen.getByLabelText('Claim the credit in'), { target: { value: '2026-10' } });
  fireEvent.click(within(screen.getByRole('group', { name: 'date' })).getByRole('button', { name: /Looks right/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Save as purchase' }));
  await waitFor(() => expect(calls.filter(c => c.method === 'POST')).toHaveLength(1));
  act(() => { m.client.setQueryData(captureKeys.one(12), captureFixture({ read: { ...read(), invoice_number: 'LATE/99' } })); });
  expect(await screen.findByRole('button', { name: 'Use what was read' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Discard photo' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Check again' })).toBeDisabled();
  expect(within(screen.getByRole('group', { name: 'quantities and rates' })).queryByRole('button')).not.toBeInTheDocument();
  fireEvent.keyDown(window, { key: 's', ctrlKey: true });
  expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
  await act(async () => finish({ status, data: { code: 'month_closed', detail: 'The chosen credit month is filed.' } }));
  expect(await screen.findByRole('button', { name: 'Try saving again' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Use what was read' })).toBeEnabled();
  expect(screen.getByLabelText("Supplier's bill number")).toHaveValue('TYPED/7');
  expect(screen.getByLabelText('Claim the credit in')).toHaveValue('2026-10');
  expect(within(screen.getByRole('group', { name: 'date' })).queryByRole('button')).not.toBeInTheDocument();
});

test('capture_used retains typed values and exposes the real 2B purchase link', async () => {
  server({ 'POST purchases/': () => ({ status: 409, data: { code: 'capture_used', detail: 'This photo was filled in already.', purchase: { id: 906 } } }) });
  mount(); await ready(); fireEvent.change(screen.getByLabelText("Supplier's bill number"), { target: { value: 'TYPED' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save as purchase' }));
  expect(await screen.findByRole('link', { name: 'Open the purchase' })).toHaveAttribute('href', '/purchases/906');
  expect(screen.getByLabelText("Supplier's bill number")).toHaveValue('TYPED');
});

test('capture read is decoded once for amount-only paise and leaves absent date/slab for correction', async () => {
  const r = read(); const calls = server({ 'GET captures/12/': captureFixture({ read: { ...r, invoice_date: null, printed_total: '0.00',
    lines: [{ ...r.lines[0], quantity: null, rate: null, gst_percent: null, taxable: '123.45', amount_only: true }] } }) });
  mount(); await screen.findByLabelText('Taxable value'); await tick(400);
  expect(screen.getByLabelText('Taxable value')).toHaveValue('123.45');
  expect(screen.getByLabelText('GST slab')).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Save as purchase' }));
  expect(await screen.findByText('Type the date printed on the bill, like 08 Oct 2026.')).toBeVisible();
  expect(calls.some(c => c.method === 'POST')).toBe(false);
});
