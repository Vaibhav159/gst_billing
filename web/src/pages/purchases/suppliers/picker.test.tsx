import { useState } from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '@/test/render';
import { serve, type Call } from '@/test/server';
import { tick } from '@/test/clock';
import type { SupplierRef } from '@/core/purchases/types';
import { SupplierPicker } from './SupplierPicker';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-10-08T10:00:00+05:30'));
});
afterEach(() => vi.useRealTimers());
const row = (id: number, name = `Supplier ${id}`) => ({ id, name, gst_number: '', state_code: '08', state_name: 'RAJASTHAN', city: 'Udaipur', figures: { bills: 1, total: '100.00', tax: '3.00', credit: '3.00', last: null } });
const page = (from: number, count: number, next: boolean) => ({ count: 150, next: next ? 'more' : null, previous: null, results: Array.from({ length: count }, (_, i) => row(from + i)) });
const detail = (id: number, name: string) => ({ supplier: { ...row(id, name), address: '', pan: '', mobile_number: '', email: '', gstin_valid: null, prefix: '' }, figures: row(id).figures, rates: [], bills: [] });
const list = () => screen.getByRole('listbox', { name: 'Suppliers' });
const opened = async () => within(await screen.findByRole('listbox', { name: 'Suppliers' }));

test('the supplier list loads beyond the first 100', async () => {
  const calls = serve({ 'GET suppliers/': (c: Call) => ({ status: 200, data: c.params.page === 1 ? page(1, 100, true) : page(101, 50, false) }) });
  renderApp(<SupplierPicker value={null} onChange={() => {}} />);
  fireEvent.focus(screen.getByRole('combobox'));
  expect(await (await opened()).findByRole('option', { name: /Supplier 100\b/ })).toBeInTheDocument();
  expect(within(list()).queryByRole('option', { name: /Supplier 101\b/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show more suppliers' }));
  fireEvent.focus(screen.getByRole('combobox'));
  expect(await (await opened()).findByRole('option', { name: /Supplier 150\b/ })).toBeInTheDocument();
  expect(calls.filter(c => c.url === 'suppliers/').map(c => [c.params.page, c.params.page_size])).toEqual([[1, 100], [2, 100]]);
  expect(screen.queryByRole('button', { name: 'Show more suppliers' })).not.toBeInTheDocument();
});

test('picking a supplier hands it over and shows its name without fetching its detail', async () => {
  const calls = serve({ 'GET suppliers/': page(1, 3, false) });
  const picked = vi.fn();
  function Host() { const [v, setV] = useState<number | null>(null); return <SupplierPicker value={v} onChange={(s: SupplierRef) => { picked(s); setV(s.id); }} />; }
  renderApp(<Host />);
  fireEvent.focus(screen.getByRole('combobox'));
  fireEvent.click(await (await opened()).findByRole('option', { name: /Supplier 2\b/ }));
  expect(picked).toHaveBeenCalledWith(expect.objectContaining({ id: 2, name: 'Supplier 2' }));
  expect(screen.getByRole('combobox')).toHaveValue('Supplier 2');
  await tick(50);
  expect(calls.some(c => c.url.startsWith('suppliers/2'))).toBe(false);
});

test('a supplier set by the form after typing replaces the typed text', async () => {
  serve({ 'GET suppliers/': page(1, 3, false), 'GET suppliers/42/': detail(42, 'Read supplier') });
  let fill!: (id: number) => void;
  function Host() { const [v, setV] = useState<number | null>(null); fill = setV; return <SupplierPicker value={v} onChange={(s: SupplierRef) => setV(s.id)} />; }
  renderApp(<Host />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Hira' } });
  act(() => fill(42));
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('Read supplier'));
});

test('adding a supplier is offered only to people who may edit suppliers', async () => {
  serve({ 'GET suppliers/': page(1, 2, false) });
  renderApp(<SupplierPicker value={null} onChange={() => {}} />, { me: { role: 'viewer', permissions: ['view'] } });
  fireEvent.focus(screen.getByRole('combobox'));
  expect(await (await opened()).findByRole('option', { name: /Supplier 1\b/ })).toBeInTheDocument();
  expect(within(list()).queryByRole('option', { name: 'Add a supplier' })).not.toBeInTheDocument();
});

test('the add option opens the supplier sheet with the typed name', async () => {
  serve({ 'GET suppliers/': page(1, 2, false) });
  renderApp(<SupplierPicker value={null} onChange={() => {}} />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'New refiner' } });
  await tick(400);
  fireEvent.click(await (await opened()).findByRole('option', { name: 'Add a supplier' }));
  expect(await screen.findByLabelText('Supplier name')).toHaveValue('New refiner');
});

test('a failed supplier list says so and loads again on retry', async () => {
  let attempts = 0;
  serve({ 'GET suppliers/': () => ++attempts === 1 ? { status: 500, data: {} } : { status: 200, data: page(1, 2, false) } });
  renderApp(<SupplierPicker value={null} onChange={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Try loading suppliers again' }));
  fireEvent.focus(screen.getByRole('combobox'));
  expect(await (await opened()).findByRole('option', { name: /Supplier 2\b/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Try loading suppliers again' })).not.toBeInTheDocument();
});
