import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { AuthContext, type Me } from '@/core/auth/AuthProvider';
import { RoleContext } from '@/core/auth/role';
import { captureKeys } from '@/core/api/captures';
import { captureFixture, readFixture } from '@/core/captures/fixtures';
import type { Capture } from '@/core/captures/types';
import { CREDIT_MONTHS, PURCHASE_FIRM, SUPPLIER } from '@/core/purchases/fixtures';
import { ToastProvider } from '@/core/ui';
import { stubAuth, testQueryClient } from '@/test/render';
import { serve, type Reply } from '@/test/server';
import { tick } from '@/test/clock';
import FillCapturePage from './FillCapturePage';

const reading = () => captureFixture({ status: 'reading', read: null });
const read = () => readFixture({ buyer: { name: '', gst_number: '', business: 3 }, notes: [] });
const readyCapture = () => captureFixture({ read: read() });
function server(capture = readyCapture(), extra: Parameters<typeof serve>[0] = {}) {
  return serve({
    'GET captures/12/': capture, 'GET businesses/': [PURCHASE_FIRM], 'GET products/': [],
    'GET suppliers/': { count: 1, results: [SUPPLIER] },
    'GET suppliers/21/': { supplier: { ...SUPPLIER, address: '', gstin_valid: true }, figures: {}, rates: [], bills: [] },
    'GET suppliers/21/memory/': { bills: 0, last: null, line: null, next_number: null },
    'GET purchases/check-duplicate/': { duplicate: null, same_spelling: true },
    'GET purchases/usual-rate/': { rate: null, from: null, last: null },
    'GET purchases/credit-months/': CREDIT_MONTHS, ...extra,
  });
}
function mount(me?: Partial<Me>, path = '/purchases/inbox/12') {
  const client = testQueryClient(); const auth = stubAuth(me);
  const router = createMemoryRouter([{ element: <ToastProvider><Outlet /></ToastProvider>, children: [
    { path: '/purchases/inbox/:id', element: <FillCapturePage /> },
    { path: '/purchases/inbox', element: <p>The inbox</p> }, { path: '/purchases/:id', element: <p>Saved purchase</p> },
  ] }], { initialEntries: [path] });
  const view = render(<QueryClientProvider client={client}><AuthContext.Provider value={auth}><RoleContext.Provider value={auth.me?.role ?? null}><RouterProvider router={router} /></RoleContext.Provider></AuthContext.Provider></QueryClientProvider>);
  return { ...view, client, router, replace: (capture: Capture) => act(() => { client.setQueryData(captureKeys.one(12), capture); }) };
}
async function ready() { await screen.findByLabelText("Supplier's bill number"); await tick(400); }
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-10-08T10:00:00+05:30')); });
afterEach(() => { vi.useRealTimers(); (window as unknown as { __phone: boolean }).__phone = false; });

test('opens the real original and saved reading without rereading, and focuses transcription without changing zoom', async () => {
  const calls = server(); mount(); await ready();
  expect(screen.getByLabelText("Supplier's bill number")).toHaveValue(read().invoice_number);
  expect(screen.getByRole('img', { name: /Photo of/ })).toHaveAttribute('src', '/media/synthetic.jpg');
  expect(screen.getByRole('link', { name: 'Open original' })).toHaveAttribute('href', '/media/synthetic.jpg');
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  fireEvent.focus(screen.getByLabelText("Supplier's bill number"));
  expect(screen.getByRole('group', { name: 'bill number' })).toHaveAttribute('data-focused', 'true');
  expect(screen.getByText('150%')).toBeVisible();
  await tick(30_000); expect(calls.filter(c => /captures\/12\//.test(c.url))).toHaveLength(1);
  expect(calls.some(c => c.method === 'POST')).toBe(false);
});

test('a pristine late reading fills the actual form, including the matched buying firm', async () => {
  server(reading()); const m = mount(); await ready();
  expect(screen.getByLabelText("Supplier's bill number")).toHaveValue('');
  m.replace(captureFixture({ business: null, read: read() }));
  await waitFor(() => expect(screen.getByLabelText("Supplier's bill number")).toHaveValue(read().invoice_number));
  expect(screen.getByLabelText('Bought by')).toHaveValue('3');
  expect(screen.queryByRole('button', { name: 'Use what was read' })).not.toBeInTheDocument();
});

test('typing before a late read preserves values until explicit acceptance', async () => {
  server(reading()); const m = mount(); await ready();
  fireEvent.change(screen.getByLabelText("Supplier's bill number"), { target: { value: 'MY/12' } });
  m.replace(readyCapture());
  expect(await screen.findByText('The bill has been read')).toBeVisible();
  expect(screen.getByLabelText("Supplier's bill number")).toHaveValue('MY/12');
  fireEvent.click(screen.getByRole('button', { name: 'Use what was read' }));
  expect(screen.getByLabelText("Supplier's bill number")).toHaveValue(read().invoice_number);
  expect(within(screen.getByRole('group', { name: 'date' })).getByRole('button', { name: /Looks right/ })).toBeEnabled();
});

test('confirmation alone is dirty; ordinary refresh preserves it and a new reading waits for acceptance', async () => {
  server(); const m = mount(); await ready();
  fireEvent.click(within(screen.getByRole('group', { name: 'date' })).getByRole('button', { name: /Looks right/ }));
  m.replace({ ...readyCapture(), note: 'Refreshed note' });
  expect(within(screen.getByRole('group', { name: 'date' })).queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Use what was read' })).not.toBeInTheDocument();
  m.replace(captureFixture({ read: { ...read(), invoice_number: 'LATE/99' } }));
  expect(await screen.findByRole('button', { name: 'Use what was read' })).toBeEnabled();
  expect(screen.getByLabelText("Supplier's bill number")).toHaveValue(read().invoice_number);
  await act(async () => { void m.router.navigate('/purchases/inbox'); });
  expect(screen.getAllByRole('dialog', { name: 'Leave without saving?' })).toHaveLength(1);
  await tick(400); fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
  fireEvent.click(screen.getByRole('button', { name: 'Use what was read' }));
  expect(screen.getByLabelText("Supplier's bill number")).toHaveValue('LATE/99');
  expect(within(screen.getByRole('group', { name: 'date' })).getByRole('button', { name: /Looks right/ })).toBeEnabled();
});

test('reading checks only GET on demand; failed read retries only after an explicit press', async () => {
  let get = 0; let finish!: (r: Reply) => void;
  const failed = captureFixture({ status: 'failed', read: null, problem: 'Photo too blurred.' });
  const calls = server(reading(), { 'GET captures/12/': () => ({ status: 200, data: ++get === 1 ? reading() : failed }),
    'POST captures/12/read/': () => new Promise<Reply>(resolve => { finish = resolve; }) });
  mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  const retry = await screen.findByRole('button', { name: 'Try reading again' });
  expect(calls.some(c => c.method === 'POST')).toBe(false); fireEvent.click(retry);
  await waitFor(() => expect(calls.filter(c => c.method === 'POST')).toHaveLength(1));
  expect(screen.getByLabelText("Supplier's bill number")).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Discard photo' })).toBeDisabled();
  await act(async () => finish({ status: 200, data: readyCapture() }));
  await waitFor(() => expect(screen.getByLabelText("Supplier's bill number")).toHaveValue(read().invoice_number));
});

test('viewer sees originals and reading but cannot edit, confirm, save or discard', async () => {
  server(); mount({ role: 'viewer', permissions: ['view'] }); await ready();
  expect(screen.getByRole('link', { name: 'Open original' })).toBeVisible();
  expect(screen.getByLabelText("Supplier's bill number")).toBeDisabled();
  expect(within(screen.getByRole('group', { name: 'date' })).queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save as purchase' })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Discard photo' })).not.toBeInTheDocument());
});

test.each(['filled', 'discarded'] as const)('%s capture is unavailable; an existing purchase has a direct link', async status => {
  server(captureFixture({ status, purchase: status === 'filled' ? { id: 905, invoice_number: 'P/1', invoice_date: '2026-10-07', supplier_name: 'Supplier', total_amount: '10.00', business_name: 'Firm' } : null }));
  mount(); expect(await screen.findByText("This photo isn't in the inbox any more")).toBeVisible();
  expect(screen.queryByLabelText("Supplier's bill number")).not.toBeInTheDocument();
  if (status === 'filled') expect(screen.getByRole('link', { name: 'Open the purchase' })).toHaveAttribute('href', '/purchases/905');
});

test.each(['12', 'not-an-id'])('missing capture %s gives the unavailable screen', async id => {
  const calls = server(readyCapture(), { 'GET captures/12/': () => ({ status: 404, data: { detail: 'Not found.' } }) });
  mount(undefined, `/purchases/inbox/${id}`);
  expect(await screen.findByText("This photo isn't in the inbox any more")).toBeVisible();
  if (id !== '12') expect(calls).toHaveLength(0);
});

test('discard after typing uses immediate DELETE, leaves without another guard and offers restore Undo', async () => {
  const calls = server(readyCapture(), { 'DELETE captures/12/': captureFixture({ status: 'discarded' }), 'POST captures/12/restore/': readyCapture() });
  mount(); await ready(); fireEvent.change(screen.getByLabelText("Supplier's bill number"), { target: { value: 'TYPED' } });
  fireEvent.click(screen.getByRole('button', { name: 'Discard photo' }));
  const dialog = await screen.findByRole('dialog', { name: 'Discard this photo?' });
  await tick(400); fireEvent.click(within(dialog).getByRole('button', { name: 'Discard photo' }));
  expect(await screen.findByText('The inbox')).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Undo/ }));
  await waitFor(() => expect(calls.filter(c => c.method === 'POST')).toEqual([expect.objectContaining({ url: 'captures/12/restore/' })]));
  expect(calls.filter(c => c.method === 'DELETE')).toHaveLength(1);
});

test('staff may discard their own capture but not another person’s', async () => {
  server(); const m = mount({ id: 1, role: 'staff', permissions: ['purchase.create', 'capture'] }); await ready();
  expect(screen.getByRole('button', { name: 'Discard photo' })).toBeEnabled();
  m.replace(captureFixture({ captured_by: { id: 2, name: 'Someone else' } }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Discard photo' })).not.toBeInTheDocument());
});

test('a removed capturing user is labelled someone and does not give staff discard permission', async () => {
  server(captureFixture({ read: read(), captured_by: null }));
  mount({ id: 1, role: 'staff', permissions: ['purchase.create', 'capture'] }); await ready();
  expect(screen.getAllByText(/captured .* by someone/).length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: 'Discard photo' })).not.toBeInTheDocument();
});

test('phone fill keeps the real PDF page selector and IRN without a verification claim', async () => {
  (window as unknown as { __phone: boolean }).__phone = true;
  server(captureFixture({ pdf: true, read: { ...read(), source: 'e-invoice', irn: 'abc123' },
    pages: [1, 2].map(page => ({ page, kind: 'pdf', url: '/media/original.pdf', preview_url: `/media/page-${page}.png`, size: 1234 })) }));
  mount(); await ready();
  expect(screen.getByRole('heading', { name: 'Fill in' })).toBeVisible();
  expect(screen.getByText('IRN abc123')).toBeVisible();
  expect(screen.queryByText(/verified|signed QR|they.re exact/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: 'Page 2' }));
  expect(screen.getByRole('img', { name: /Photo of/ })).toHaveAttribute('src', '/media/page-2.png');
  expect(screen.getByRole('link', { name: 'Open original' })).toHaveAttribute('href', '/media/original.pdf');
});

test('all-high e-invoice read reports the IRN without claiming QR extraction or verification', async () => {
  const irn = 'a'.repeat(64);
  server(captureFixture({ read: { ...read(), source: 'e-invoice', irn,
    confidence: { supplier: 'high', gstin: 'high', bill_no: 'high', date: 'high', amounts: 'high' } } }));
  mount(); await ready();
  expect(screen.getByText(`IRN ${irn}`)).toBeVisible();
  expect(screen.getAllByText('From the e-invoice')).toHaveLength(2);
  expect(screen.queryByText(/QR|verified|signed|they.re exact/i)).not.toBeInTheDocument();
});

test('an originally all-high photo read keeps the high-confidence wording', async () => {
  server(captureFixture({ read: { ...read(), confidence: { supplier: 'high', gstin: 'high', bill_no: 'high', date: 'high', amounts: 'high' } } }));
  mount(); await ready();
  expect(screen.getByText('Everything was read with high confidence. Glance over it and save.')).toBeVisible();
});

test('a successful status GET clears a lost read response error; a still-failed capture keeps the error', async () => {
  const failed = captureFixture({ status: 'failed', read: null, problem: 'Photo too blurred.' });
  let gets = 0;
  const calls = server(failed, { 'GET captures/12/': () => ({ status: 200, data: ++gets < 3 ? failed : readyCapture() }),
    'POST captures/12/read/': () => ({ status: 0 }) });
  mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Try reading again' }));
  const problem = "The app couldn't get through";
  expect(await screen.findByText(problem)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  await waitFor(() => expect(gets).toBe(2));
  expect(screen.getByText(problem)).toBeVisible();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  await waitFor(() => expect(screen.getByLabelText("Supplier's bill number")).toHaveValue(read().invoice_number));
  expect(screen.queryByText(problem)).not.toBeInTheDocument();
  expect(calls.filter(c => c.method === 'POST')).toEqual([expect.objectContaining({ url: 'captures/12/read/' })]);
  expect(gets).toBe(3);
});
