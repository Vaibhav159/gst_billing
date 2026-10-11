import { fireEvent, screen, waitFor } from '@testing-library/react';
import { mount, serve } from '@/pages/customers/testing';
import PhotoEditor from './PhotoEditor';
import { row } from './fixtures';
// Run after 2B Tasks 1–2, 4–6 land: this deliberately imports the real predecessor editor.
test('the real shared PurchaseEditor reviews a purchase without creating or attaching a bill', async () => {
  const original = row(); original.read!.buyer.gst_number = '';
  original.read!.lines = [{ ...original.read!.lines[0], quantity: null, rate: null, taxable: '123.45', amount_only: true }];
  const supplier = { ...original.read!.supplier, state_name: 'RAJASTHAN' };
  const calls = serve({
    'GET suppliers/21/': { supplier },
    'GET suppliers/': { count: 1, results: [{ ...supplier, figures: {} }], summary: {} },
    'GET suppliers/21/memory/': { bills: 1, line: null, last: null, next_number: null },
    'GET purchases/check-duplicate/': { duplicate: null, same_spelling: false, unchecked: false },
    'GET purchases/usual-rate/': { rate: null, from: null, last: null },
    'GET purchases/credit-months/': { bill_month: '2026-10', bill_month_closed: false, default: '2026-10', options: [{ month: '2026-10', due: '2026-11-20', running: true, in_time: true }], deadline: '2027-11-30', lapsed: false },
    'GET products/': { results: [] },
  });
  const apply = vi.fn();
  mount([{ path: '/edit', element: <PhotoEditor row={original} onApply={apply} onClose={() => {}} /> }], ['/edit']);
  await screen.findByDisplayValue(supplier.name);
  fireEvent.change(screen.getByLabelText("Supplier's bill number"), { target: { value: '00039' } });
  fireEvent.click(screen.getByRole('button', { name: 'Use these changes' }));
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  expect(apply.mock.calls[0][0]).toMatchObject({ partyId: 21, read: { invoice_number: '00039', lines: [{ taxable: '123.45', amount_only: true }] } });
  expect(calls.every(call => call.method === 'GET')).toBe(true);
});
test('the real purchase editor requires the unread date and preserves rates without another read', async () => {
  const original = row(); original.read!.invoice_date = null; original.read!.buyer.gst_number = '';
  const supplier = { ...original.read!.supplier, state_name: 'RAJASTHAN' };
  const calls = serve({
    'GET suppliers/21/': { supplier },
    'GET suppliers/': { count: 1, results: [{ ...supplier, figures: {} }], summary: {} },
    'GET suppliers/21/memory/': { bills: 1, line: null, last: null, next_number: null },
    'GET purchases/check-duplicate/': { duplicate: null, same_spelling: false, unchecked: false },
    'GET purchases/usual-rate/': { rate: null, from: null, last: null },
    'GET purchases/credit-months/': { bill_month: '2026-10', bill_month_closed: false, default: '2026-10', options: [{ month: '2026-10', due: '2026-11-20', running: true, in_time: true }], deadline: '2027-11-30', lapsed: false },
    'GET products/': { results: [] },
  });
  const apply = vi.fn();
  mount([{ path: '/edit', element: <PhotoEditor row={original} onApply={apply} onClose={() => {}} /> }], ['/edit']);
  await screen.findByDisplayValue(supplier.name);
  expect(screen.getByLabelText('Bill date', { exact: true })).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Use these changes' }));
  expect(apply).not.toHaveBeenCalled();
  expect(screen.getByText('Type the date printed on the bill, like 08 Oct 2026.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Bill date', { exact: true }), { target: { value: '7 Oct 2026' } });
  fireEvent.click(screen.getByRole('button', { name: 'Use these changes' }));
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  const next = apply.mock.calls[0][0];
  expect(next).toMatchObject({ read: { invoice_date: '2026-10-07', lines: [{ rate: '6878.000', quantity: '42.180' }] } });
  expect(next.file).toBe(original.file);
  expect(original.read!.invoice_date).toBeNull();
  expect(calls.every(call => call.method === 'GET')).toBe(true);
});
