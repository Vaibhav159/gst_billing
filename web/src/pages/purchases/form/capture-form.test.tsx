import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AuthContext, type Me } from '@/core/auth/AuthProvider';
import { RoleContext } from '@/core/auth/role';
import { stubAuth, testQueryClient } from '@/test/render';
import { serve, type Reply } from '@/test/server';
import { tick } from '@/test/clock';
import { CREDIT_MONTHS, PURCHASE_FIRM, SUPPLIER, purchaseDetailWire } from '@/core/purchases/fixtures';
import { toPurchaseRead } from '@/core/purchases/wire';
import type { PurchaseRead, ReadGroup } from '@/core/purchases/types';
import { PurchaseCaptureForm, type PurchaseCaptureFormProps } from './PurchaseCaptureForm';

const read = (): PurchaseRead => toPurchaseRead({
  supplier: SUPPLIER, buyer: { business: 3, gst_number: '' }, seller_business: 99,
  invoice_number: 'PHOTO/12', invoice_date: '2026-08-07', payment_mode: 'bank',
  lines: [{ product_name: 'Gold', hsn_code: '7108', quantity: '1.250', unit: 'gms', rate: '100.125', gst_percent: '3', taxable: '125.16' }],
  confidence: { supplier: 'high', gstin: 'high', bill_no: 'medium', date: 'high', amounts: 'medium' }, notes: [],
});
function server(extra: Parameters<typeof serve>[0] = {}) {
  return serve({
    'GET firms/': [PURCHASE_FIRM, { ...PURCHASE_FIRM, id: 4, name: 'OTHER FIRM' }],
    'GET products/': [], 'GET suppliers/': { count: 1, results: [SUPPLIER] },
    'GET suppliers/21/': { supplier: { ...SUPPLIER, address: '', pan: '', mobile_number: '', email: '', prefix: '', gstin_valid: true }, figures: {}, rates: [], bills: [] },
    'GET suppliers/21/memory/': { bills: 0, last: null, line: null, next_number: null },
    'GET purchases/check-duplicate/': { duplicate: null, same_spelling: true },
    'GET purchases/usual-rate/': { rate: null, from: null, last: null },
    'GET purchases/credit-months/': CREDIT_MONTHS, 'POST purchases/': purchaseDetailWire(), ...extra,
  });
}
function mount(over: Partial<PurchaseCaptureFormProps> = {}, me?: Partial<Me>) {
  const events: string[] = [];
  const saved = vi.fn(() => { events.push('saved'); }); const dirty = vi.fn((v: boolean) => { events.push(`dirty:${v}`); }); const busy = vi.fn((v: boolean) => { events.push(`busy:${v}`); });
  let replace!: (read: PurchaseRead | null, accept?: boolean) => void;
  function Host() {
    const [current, setRead] = useState<PurchaseRead | null>(over.read === undefined ? read() : over.read);
    const [confirmed, setConfirmed] = useState<Partial<Record<ReadGroup, boolean>>>({});
    const [revision, setRevision] = useState(0); const [blocked, setBlocked] = useState(false); const [dirtyValue, setDirty] = useState(false);
    replace = (next, accept = false) => { setRead(next); if (accept) { setConfirmed({}); setRevision(v => v + 1); } };
    return <><output aria-label="dirty">{String(dirtyValue)}</output><button disabled={blocked} onClick={() => setConfirmed(v => ({ ...v, bill_no: true }))}>Confirm bill transcription</button>
      <PurchaseCaptureForm key={revision} captureId={71} businessId={null} read={current} confirmed={confirmed} onConfirm={group => setConfirmed(v => ({ ...v, [group]: true }))}
        onSaved={saved} onDirtyChange={v => { dirty(v); setDirty(v); }} onBusyChange={v => { busy(v); setBlocked(v); }} {...over} />
    </>;
  }
  const auth = stubAuth(me); const client = testQueryClient();
  const router = createMemoryRouter([{ path: '/', element: <Host /> }, { path: '/purchases/:id', element: <p>Saved purchase</p> }, { path: '/away', element: <p>Elsewhere</p> }]);
  const view = render(<QueryClientProvider client={client}><AuthContext.Provider value={auth}><RoleContext.Provider value={auth.me?.role ?? null}><RouterProvider router={router} /></RoleContext.Provider></AuthContext.Provider></QueryClientProvider>);
  return { ...view, router, client, saved, dirty, busy, events, replace: (r: PurchaseRead | null, accept = false) => act(() => replace(r, accept)) };
}
async function ready() { await screen.findByLabelText('Claim the credit in'); await tick(400); }
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-10-08T10:00:00+05:30')); });
afterEach(() => vi.useRealTimers());

test('capture firm wins over buyer; ready read values save once with capture identity and pending confidence', async () => {
  const calls = server(); const m = mount({ businessId: 4 }); await ready();
  expect(screen.getByLabelText('Bought by')).toHaveValue('4');
  expect(screen.getByLabelText("Supplier's bill number")).toHaveValue('PHOTO/12');
  expect(screen.getByLabelText('Quantity')).toHaveValue('1.250');
  fireEvent.click(screen.getByRole('button', { name: 'Save as purchase' }));
  await waitFor(() => expect(m.saved).toHaveBeenCalledTimes(1));
  expect(calls.find(c => c.method === 'POST')?.data).toMatchObject({ business: 4, supplier: 21, capture: 71, source: 'capture', needs_review: true, lines: [{ rate: '100.125', quantity: '1.250' }] });
  expect(m.saved.mock.calls[0]).toEqual([expect.objectContaining({ id: 905, supplier_name: SUPPLIER.name, total_amount: 49264500 })]);
  expect(calls.some(c => /read/.test(c.url))).toBe(false);
  expect(m.events.lastIndexOf('saved')).toBeLessThan(m.events.lastIndexOf('busy:false'));
});

test('matched buyer supplies firm, absent buyer requires a choice even with a seller match', async () => {
  server(); const m = mount(); await ready(); expect(screen.getByLabelText('Bought by')).toHaveValue('3');
  m.replace({ ...read(), buyer: { ...read().buyer, business: null } }, true);
  expect(screen.getByLabelText('Bought by')).toHaveValue('');
  await tick(400); fireEvent.click(screen.getByRole('button', { name: 'Save as purchase' }));
  expect(await screen.findByText('Choose which firm bought this.')).toBeVisible();
  expect(m.saved).not.toHaveBeenCalled();
});

test('transcription confirmation and amount edit share dirty state and clear pending confidence in the payload', async () => {
  const calls = server(); const m = mount(); await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm bill transcription' }));
  expect(screen.getByLabelText('dirty')).toHaveTextContent('true');
  fireEvent.change(screen.getByLabelText('Rate per gms'), { target: { value: '101.250' } });
  expect(screen.queryByText(/Saving now marks/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save as purchase' }));
  await waitFor(() => expect(m.saved).toHaveBeenCalledOnce());
  expect(calls.find(c => c.method === 'POST')?.data).toMatchObject({ needs_review: false, lines: [{ rate: '101.250' }] });
  expect(m.dirty).toHaveBeenLastCalledWith(false);
});

test('late reads and edit then revert preserve accepted values until a keyed acceptance resets them', async () => {
  server(); const m = mount(); await ready();
  const number = screen.getByLabelText("Supplier's bill number");
  fireEvent.change(number, { target: { value: 'TYPED' } }); fireEvent.change(number, { target: { value: 'PHOTO/12' } });
  expect(screen.getByLabelText('dirty')).toHaveTextContent('true');
  m.replace({ ...read(), invoice_number: 'LATE/99' });
  expect(number).toHaveValue('PHOTO/12');
  expect(screen.getAllByText('Check this: read with medium confidence')).toHaveLength(1);
  m.replace({ ...read(), invoice_number: 'LATE/99' }, true);
  expect(screen.getByLabelText("Supplier's bill number")).toHaveValue('LATE/99');
  expect(screen.getAllByText('Check this: read with medium confidence')).toHaveLength(2);
  expect(screen.getByLabelText('dirty')).toHaveTextContent('false');
});

test.each([400, 409, 0])('a %s save failure preserves values, credit and confirmations and clears busy', async status => {
  let finish!: (r: Reply) => void;
  const calls = server({ 'POST purchases/': () => new Promise<Reply>(resolve => { finish = resolve; }) });
  const m = mount(); await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm bill transcription' }));
  fireEvent.change(screen.getByLabelText('Claim the credit in'), { target: { value: '2026-10' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save as purchase' }));
  await waitFor(() => expect(m.busy).toHaveBeenLastCalledWith(true));
  expect(screen.getByRole('button', { name: 'Looks right' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Confirm bill transcription' })).toBeDisabled();
  fireEvent.keyDown(window, { key: 's', ctrlKey: true });
  expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
  await act(async () => finish({ status, data: { code: 'month_closed', detail: 'The chosen credit month is filed.', lines: { 0: { rate: ['Check this rate.'] } } } }));
  await waitFor(() => expect(m.busy).toHaveBeenLastCalledWith(false));
  expect(screen.getByLabelText("Supplier's bill number")).toHaveValue('PHOTO/12');
  expect(screen.getByLabelText('Rate per gms')).toHaveValue('100.125');
  expect(screen.getByLabelText('Claim the credit in')).toHaveValue('2026-10');
  expect(screen.getAllByText('Check this: read with medium confidence')).toHaveLength(1);
  expect(m.saved).not.toHaveBeenCalled(); expect(m.dirty).toHaveBeenLastCalledWith(true);
});

test('confirmation alone triggers one leave guard; successful callback can navigate without a prompt', async () => {
  server(); const m = mount({ onSaved: p => { void m.router.navigate(`/purchases/${p.id}?from=capture`); } }); await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm bill transcription' }));
  await act(async () => { void m.router.navigate('/away'); });
  expect(await screen.findByRole('dialog', { name: 'Leave without saving?' })).toBeVisible();
  await tick(400); fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save as purchase' }));
  expect(await screen.findByText('Saved purchase')).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('viewer and an externally busy capture cannot edit or confirm', async () => {
  server(); const m = mount({}, { role: 'viewer', permissions: [] }); await ready();
  expect(screen.queryByRole('button', { name: 'Save as purchase' })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Supplier's bill number")).toBeDisabled();
  for (const b of screen.getAllByRole('button', { name: 'Looks right' })) expect(b).toBeDisabled();
  m.unmount(); mount({ disabled: true }); await ready();
  expect(screen.getByRole('button', { name: 'Save as purchase' })).toBeDisabled();
  for (const b of screen.getAllByRole('button', { name: 'Looks right' })) expect(b).toBeDisabled();
});

test('amount-only paise decode once; null, zero and off-slab read values remain visible for correction', async () => {
  const calls = server(); const r = toPurchaseRead({ ...read(), invoice_date: null, lines: [{ product_name: 'Scrap', unit: 'gms', quantity: null, rate: null, gst_percent: '2.5', taxable: '123.45', amount_only: true }], printed_total: '0.00' });
  const m = mount({ read: r }); await tick(400);
  expect(screen.getByLabelText('Taxable value')).toHaveValue('123.45');
  fireEvent.click(screen.getByRole('button', { name: 'Save as purchase' }));
  expect(await screen.findByText('Type the date printed on the bill, like 08 Oct 2026.')).toBeVisible();
  expect(screen.getByText('Choose the slab printed on the bill (0% if it charges no GST).')).toBeVisible();
  expect(calls.some(c => c.method === 'POST')).toBe(false); m.unmount();
  mount({ read: { ...read(), lines: [{ ...read().lines[0], rate: '0', gst_percent: '0' }] } }); await ready();
  expect(screen.getByLabelText('Rate per gms')).toHaveValue('0.00'); expect(screen.getByLabelText('GST slab')).toHaveValue('0');
});

test('capture_used links the existing purchase and keeps the entered values', async () => {
  server({ 'POST purchases/': () => ({ status: 409, data: { code: 'capture_used', detail: 'This photo was filled in already, as UBS/26-27/0866.', purchase: { id: 906 } } }) });
  mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Save as purchase' }));
  expect(await screen.findByRole('link', { name: 'Open the purchase' })).toHaveAttribute('href', '/purchases/906');
  expect(screen.getByLabelText("Supplier's bill number")).toHaveValue('PHOTO/12');
});

test('removing an erroneous read line confirms amounts in the shared capture state', async () => {
  const calls = server(); const r = read();
  mount({ read: { ...r, confidence: { ...r.confidence, bill_no: 'high' }, lines: [...r.lines, { ...r.lines[0], product_name: 'Wrong extra line' }] } });
  await ready(); fireEvent.click(screen.getByRole('button', { name: 'Remove item 2' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save as purchase' }));
  await waitFor(() => expect(calls.find(c => c.method === 'POST')).toBeDefined());
  expect(calls.find(c => c.method === 'POST')?.data).toMatchObject({ needs_review: false, lines: [expect.objectContaining({ product_name: 'Gold' })] });
});

test('choosing the supplier number suggestion confirms that read field', async () => {
  const calls = server({ 'GET suppliers/21/memory/': { bills: 1, last: null, line: null, next_number: 'PHOTO/13' } });
  const r = read(); mount({ read: { ...r, invoice_number: '', confidence: { ...r.confidence, amounts: 'high' } } });
  await ready(); fireEvent.click(await screen.findByRole('button', { name: 'Use PHOTO/13' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save as purchase' }));
  await waitFor(() => expect(calls.find(c => c.method === 'POST')).toBeDefined());
  expect(calls.find(c => c.method === 'POST')?.data).toMatchObject({ needs_review: false, invoice_number: 'PHOTO/13' });
});
