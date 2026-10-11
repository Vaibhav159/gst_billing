import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AuthContext, type Me } from '@/core/auth/AuthProvider';
import { RoleContext } from '@/core/auth/role';
import { stubAuth, testQueryClient } from '@/test/render';
import { serve } from '@/test/server';
import { tick } from '@/test/clock';
import { PurchaseEditor } from './PurchaseEditor';
import { blankPurchase, type PurchaseValues } from './model';
import { purchaseDetailWire, SUPPLIER } from '@/core/purchases/fixtures';
import { toPurchaseDetail } from '@/core/purchases/wire';

const valid = (): PurchaseValues => ({ ...blankPurchase(3), supplier: 21, invoice_number: 'UBS/12', invoice_date: '2026-08-07', lines: [{ product_name: 'Gold', hsn_code: '', quantity: '1', unit: 'gms', rate: '100', gst_percent: '3', note: '' }] });
function mount(initial = valid(), props: Partial<React.ComponentProps<typeof PurchaseEditor>> = {}, me?: Partial<Me>) {
  const auth = stubAuth(me);
  const router = createMemoryRouter([{ path: '/', element: <PurchaseEditor initial={initial} onSaved={() => {}} {...props} /> }]);
  return render(<QueryClientProvider client={testQueryClient()}><AuthContext.Provider value={auth}><RoleContext.Provider value={auth.me?.role ?? null}><RouterProvider router={router} /></RoleContext.Provider></AuthContext.Provider></QueryClientProvider>);
}
function server(over: Parameters<typeof serve>[0] = {}) {
  return serve({
    'GET firms/': [{ id: 3, name: 'KIRAN GOLD HOUSE', gst_number: '08AAGPL3375F1ZO', state_name: 'RAJASTHAN' }],
    'GET products/': [], 'GET suppliers/21/': { supplier: { ...SUPPLIER, address: '', pan: '', mobile_number: '', email: '', prefix: '', gstin_valid: true }, figures: {}, rates: [], bills: [] }, 'GET suppliers/': { count: 0, next: null, results: [] },
    'GET suppliers/21/memory/': { bills: 1, last: null, line: null, next_number: 'UBS/13' },
    'GET purchases/check-duplicate/': { duplicate: null, same_spelling: true },
    'GET purchases/usual-rate/': { rate: null, from: null, last: null },
    'GET purchases/credit-months/': { bill_month: '2026-08', bill_month_closed: true, default: '2026-09', options: [{ month: '2026-09', due: '2026-10-20', running: false, in_time: true }], deadline: '2027-11-30', lapsed: false },
    'POST purchases/': purchaseDetailWire(), ...over,
  });
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-10-08T10:00:00+05:30')); });
afterEach(() => vi.useRealTimers());
test('a filed bill date can save; credit month comes from the server and payload keeps default implicit', async () => {
  const calls = server(); mount();
  expect(await screen.findByText(/August 2026 is filed/)).toBeVisible();
  await tick(400); fireEvent.click(screen.getByRole('button', { name: 'Save purchase' }));
  await waitFor(() => expect(calls.some(c => c.method === 'POST' && c.url === 'purchases/')).toBe(true));
  const body = calls.find(c => c.method === 'POST')!.data;
  expect(body).toMatchObject({ invoice_date: '2026-08-07', itc_eligible: true });
  expect(body).not.toHaveProperty('itc_month');
});
test('failed save retains every field and shows nested line error', async () => {
  server({ 'POST purchases/': () => ({ status: 400, data: { lines: { 0: { rate: ['Type the rate printed on the bill.'] } } } }) }); mount();
  await screen.findByText(/August 2026 is filed/); await tick(400);
  fireEvent.click(screen.getByRole('button', { name: 'Save purchase' }));
  expect((await screen.findAllByText('Type the rate printed on the bill.')).length).toBeGreaterThan(0);
  expect(screen.getByLabelText("Supplier's bill number")).toHaveValue('UBS/12');
  expect(screen.getByLabelText('Rate per gms')).toHaveValue('100.00');
});
test('a filed credit month refusal is attached to the credit-month field and keeps the bill', async () => {
  const detail = "September 2026's GSTR-3B is filed for KIRAN GOLD HOUSE, with this bill's credit in it, so it can't be changed. Have the owner unlock September 2026 in GST returns first.";
  server({ 'POST purchases/': () => ({ status: 409, data: { code: 'month_closed', detail, locked_period: { id: null, business: 3, year: 2026, month: 9 } } }) });
  mount();
  const credit = await screen.findByLabelText('Claim the credit in');
  await tick(400);
  fireEvent.change(credit, { target: { value: '2026-09' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save purchase' }));
  await waitFor(() => expect(credit).toHaveAttribute('aria-invalid', 'true'));
  expect(credit).toHaveAccessibleDescription(expect.stringContaining(detail));
  expect(screen.getByLabelText("Supplier's bill number")).toHaveValue('UBS/12');
  expect(screen.getByLabelText('Rate per gms')).toHaveValue('100.00');
});
test('unchecked duplicate answers never say free; late lapsed credit switches off visually only', async () => {
  vi.setSystemTime(new Date('2026-12-08T10:00:00+05:30'));
  const calls = server({ 'GET purchases/check-duplicate/': { duplicate: null, unchecked: true, same_spelling: false },
    'GET purchases/credit-months/': { bill_month: '2025-04', bill_month_closed: true, default: '2026-11', options: [{ month: '2026-11', due: '2026-12-20', running: true, in_time: false }], deadline: '2026-11-30', lapsed: true } });
  mount({ ...valid(), invoice_date: '2025-04-30' });
  expect(await screen.findAllByText("Too late to claim: no return open now can carry this bill's credit.")).not.toHaveLength(0);
  expect(screen.getByRole('switch', { name: 'Claim input tax credit (ITC)' })).toBeDisabled();
  expect(screen.queryByText(/number is free/i)).not.toBeInTheDocument();
  await tick(400); fireEvent.click(screen.getByRole('button', { name: 'Save purchase' }));
  await waitFor(() => expect(calls.find(c => c.method === 'POST')).toBeDefined());
  expect(calls.find(c => c.method === 'POST')!.data).toMatchObject({ itc_eligible: true });
});
test('a failed attachment retries only the attachment, never creates the purchase again', async () => {
  let files = 0;
  const calls = server({ 'POST purchases/905/files/': () => ++files === 1 ? { status: 500 } : { status: 200, data: purchaseDetailWire() } });
  const saved = vi.fn(); mount(valid(), { onSaved: saved });
  await screen.findByText(/August 2026 is filed/);
  fireEvent.change(screen.getByLabelText('Bill photo or PDF'), { target: { files: [new File(['synthetic'], 'bill.pdf', { type: 'application/pdf' })] } });
  await tick(400); fireEvent.click(screen.getByRole('button', { name: 'Save purchase' }));
  expect(await screen.findByText('Purchase saved; its file was not attached')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Try attaching again' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(calls.filter(c => c.method === 'POST' && c.url === 'purchases/')).toHaveLength(1);
});
test('staff can create but cannot edit, and a locked credit month is read-only', async () => {
  server(); const original = toPurchaseDetail(purchaseDetailWire({ locked: true }));
  mount(valid(), { original }, { role: 'staff', permissions: ['view', 'purchase.create'] });
  expect(await screen.findByText(/GSTR-3B is filed/)).toBeVisible();
  expect(screen.getByLabelText("Supplier's bill number")).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
});
test('reading blocks keyboard saves and replacing the file; a successful read is reused', async () => {
  let answer!: (r: { status: number; data: unknown }) => void;
  const calls = server({ 'POST purchases/read/': () => new Promise(resolve => { answer = resolve; }) });
  mount(); await screen.findByText(/August 2026 is filed/); await tick(400);
  fireEvent.change(screen.getByLabelText('Bill photo or PDF'), { target: { files: [new File(['synthetic'], 'bill.pdf', { type: 'application/pdf' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'Read it for me' }));
  await waitFor(() => expect(answer).toBeTypeOf('function'));
  expect(screen.getByLabelText('Bill photo or PDF')).toBeDisabled();
  fireEvent.keyDown(window, { key: 's', ctrlKey: true });
  await tick(50);
  expect(calls.filter(c => c.method === 'POST' && c.url === 'purchases/')).toHaveLength(0);
  answer({ status: 200, data: { source: 'pdf', irn: '', supplier: { id: 21, name: 'Read supplier', gst_number: '08AACFU5521R1ZN', state_code: '08', city: '' }, buyer: { name: '', gst_number: '', business: 3 }, seller_business: null, invoice_number: 'READ/1', invoice_date: '2026-10-07', payment_mode: '', lines: [], printed_total: null, lines_total: '0.00', confidence: { supplier: 'high', gstin: 'high', bill_no: 'high', date: 'high', amounts: 'high' }, notes: [] } });
  expect(await screen.findByText('Only empty fields were filled; check the highlighted ones.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Read it for me' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Read it for me' }));
  expect(calls.filter(c => c.url === 'purchases/read/')).toHaveLength(1);
  expect(screen.getByLabelText("Supplier's bill number")).toHaveValue('UBS/12');
  fireEvent.change(screen.getByLabelText('Bill photo or PDF'), { target: { files: [new File(['synthetic'], 'same-page.pdf', { type: 'application/pdf' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'Read it for me' }));
  await tick(300);
  expect(calls.filter(c => c.url === 'purchases/read/')).toHaveLength(1);
});
test('a duplicate discovered at save offers explicit acknowledgement, reset on number change', async () => {
  const calls = server({ 'POST purchases/': () => ({ status: 409, data: { code: 'duplicate', detail: 'Already entered for KIRAN.', purchase: { id: 905, invoice_number: 'UBS/12', invoice_date: '2026-08-07', supplier_name: 'Udaipur Bullion Suppliers', total_amount: '103.00', business_name: 'KIRAN' } } }) });
  mount(); await screen.findByText(/August 2026 is filed/); await tick(400);
  fireEvent.click(screen.getByRole('button', { name: 'Save purchase' }));
  const ack = await screen.findByRole('checkbox', { name: "It's a different bill with the same number" });
  fireEvent.click(ack); fireEvent.click(screen.getByRole('button', { name: 'Save purchase' }));
  await waitFor(() => expect(calls.filter(c => c.method === 'POST')).toHaveLength(2));
  expect(calls.filter(c => c.method === 'POST')[1].data).toMatchObject({ duplicate_ok: true });
  fireEvent.change(screen.getByLabelText("Supplier's bill number"), { target: { value: 'UBS/13' } });
  expect(screen.queryByRole('checkbox', { name: "It's a different bill with the same number" })).not.toBeInTheDocument();
});

test('offline save keeps the typed bill and uses the shared failure words', async () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const calls = server({ 'POST purchases/': () => ({ status: 0 }) });
  try {
    mount(); await screen.findByText(/August 2026 is filed/); await tick(400);
    fireEvent.click(screen.getByRole('button', { name: 'Save purchase' }));
    expect(await screen.findByText("You're offline, so this wasn't saved")).toBeVisible();
    expect(screen.getByLabelText("Supplier's bill number")).toHaveValue('UBS/12');
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
  } finally { online.mockRestore(); }
});

test('a failed read has its own words and leaves the save action unchanged', async () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  server({ 'POST purchases/read/': () => ({ status: 0 }) });
  try {
    mount(); await screen.findByText(/August 2026 is filed/);
    fireEvent.change(screen.getByLabelText('Bill photo or PDF'), { target: { files: [new File(['synthetic'], 'bill.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Read it for me' }));
    expect(await screen.findByText("You're offline, so the file can't be read. Type the bill in, or try again when you're back online.")).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save purchase' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Try reading again' })).toBeEnabled();
  } finally { online.mockRestore(); }
});
test('supplier GSTIN confidence is confirmed beside the supplier, not the buyer', async () => {
  server();
  const read = { supplier: SUPPLIER, confidence: { gstin: 'medium' }, notes: [] } as unknown as React.ComponentProps<typeof PurchaseEditor>['read'];
  mount(valid(), { read }); await screen.findByText(/August 2026 is filed/);
  const group = screen.getByRole('group', { name: 'Supplier GSTIN' });
  expect(within(group).getByText(SUPPLIER.gst_number)).toBeVisible();
  fireEvent.click(within(group).getByRole('button', { name: 'Looks right' }));
  expect(screen.queryByText('Check this: read with medium confidence')).not.toBeInTheDocument();
});
test('a bill before the ledger starts offers no credit month and sends null, keeping eligibility', async () => {
  const calls = server(); mount({ ...valid(), invoice_date: '2024-03-31' });
  expect(await screen.findAllByText('This bill is before April 2025. Its credit is in the opening balance or lapsed.')).not.toHaveLength(0);
  expect(screen.queryByLabelText('Claim the credit in')).not.toBeInTheDocument();
  await tick(400); fireEvent.click(screen.getByRole('button', { name: 'Save purchase' }));
  await waitFor(() => expect(calls.some(c => c.method === 'POST')).toBe(true));
  expect(calls.find(c => c.method === 'POST')!.data).toMatchObject({ itc_month: null, itc_eligible: true });
});
test('after a filed-month refusal the months are asked again and picking another clears the error', async () => {
  const detail = "September 2026's GSTR-3B is filed for KIRAN GOLD HOUSE, with this bill's credit in it, so it can't be changed. Have the owner unlock September 2026 in GST returns first.";
  let filed = false;
  const calls = server({
    'GET purchases/credit-months/': () => ({ status: 200, data: { bill_month: '2026-08', bill_month_closed: true, default: filed ? '2026-10' : '2026-09', options: [...(filed ? [] : [{ month: '2026-09', due: '2026-10-20', running: false, in_time: true }]), { month: '2026-10', due: '2026-11-20', running: true, in_time: true }], deadline: '2027-11-30', lapsed: false } }),
    'POST purchases/': () => { filed = true; return { status: 409, data: { code: 'month_closed', detail, locked_period: { id: null, business: 3, year: 2026, month: 9 } } }; },
  });
  mount();
  const credit = await screen.findByLabelText('Claim the credit in');
  await tick(400);
  fireEvent.change(credit, { target: { value: '2026-09' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save purchase' }));
  await waitFor(() => expect(credit).toHaveAttribute('aria-invalid', 'true'));
  await waitFor(() => expect(calls.filter(c => c.url === 'purchases/credit-months/')).toHaveLength(2));
  await waitFor(() => expect(within(credit).getByRole('option', { name: /September 2026/ })).toHaveTextContent('September 2026 (not open now)'));
  fireEvent.change(credit, { target: { value: '2026-10' } });
  expect(credit).not.toHaveAttribute('aria-invalid', 'true');
});
test('an unchanged edit whose saved credit month is no longer offered still shows that month', async () => {
  server();
  const original = toPurchaseDetail(purchaseDetailWire());
  mount({ ...valid(), invoice_date: original.invoice_date }, { original });
  const credit = await screen.findByLabelText('Claim the credit in');
  expect(credit).toHaveValue('2026-10');
  expect(within(credit).getByRole('option', { selected: true })).toHaveTextContent(/October 2026/);
});
test('Ctrl+Enter confirms the amounts through the latest confirmation handler', async () => {
  server();
  const seen: number[] = [];
  function Host() {
    const [n, setN] = useState(0);
    return <><button type="button" onClick={() => setN(x => x + 1)}>Next handler</button><PurchaseEditor initial={valid()} onSaved={() => {}} confirmed={{}} onConfirm={g => { if (g === 'amounts') seen.push(n); }} /></>;
  }
  const auth = stubAuth();
  const router = createMemoryRouter([{ path: '/', element: <Host /> }]);
  render(<QueryClientProvider client={testQueryClient()}><AuthContext.Provider value={auth}><RoleContext.Provider value={auth.me?.role ?? null}><RouterProvider router={router} /></RoleContext.Provider></AuthContext.Provider></QueryClientProvider>);
  await screen.findByLabelText('Claim the credit in');
  fireEvent.click(screen.getByRole('button', { name: 'Next handler' }));
  fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
  expect(seen).toEqual([1]);
});
