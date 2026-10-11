import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderApp } from '@/test/render';
import { serve } from '@/test/server';
import { tick } from '@/test/clock';
import { SupplierSheet } from './SupplierSheet';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-10-08T10:00:00+05:30'));
});
afterEach(() => vi.useRealTimers());
const blank = { id: 21, name: 'Local refiner', gst_number: '', state_name: 'RAJASTHAN', state_code: '08', city: '', address: '', pan: '', mobile_number: '', email: '' };
test('a supplier without a GSTIN saves through suppliers and keeps typed text after a refusal', async () => {
  let attempts = 0;
  const calls = serve({ 'POST suppliers/': () => ++attempts === 1 ? { status: 400, data: { name: ['That name is on file.'] } } : { status: 201, data: blank } });
  const saved = vi.fn();
  renderApp(<SupplierSheet open onClose={() => {}} onSaved={saved} />);
  await tick(400);
  fireEvent.change(screen.getByLabelText('Supplier name'), { target: { value: 'Local refiner' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add supplier' }));
  expect(await screen.findByText('That name is on file.')).toBeVisible();
  expect(screen.getByLabelText('Supplier name')).toHaveValue('Local refiner');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(calls.filter(c => c.method === 'POST')[0].data).toMatchObject({ gst_number: '', name: 'Local refiner' });
});
test('a registry answer fills empty fields only and uses the existing snake_case contract', async () => {
  let reply!: (r: {status:number;data:unknown}) => void;
  serve({ 'GET gstin/08AAGPL3375F1ZO/': () => new Promise(resolve => { reply = resolve; }) });
  renderApp(<SupplierSheet open onClose={() => {}} initial={{ gst_number: '08AAGPL3375F1ZO' }} />);
  await waitFor(() => expect(reply).toBeTypeOf('function'));
  fireEvent.change(screen.getByLabelText('Supplier name'), { target: { value: 'Typed name' } });
  reply({ status: 200, data: { gstin: '08AAGPL3375F1ZO', valid: true, source: 'provider', trade_name: 'Registry name', address: 'Registry address', state_name: 'RAJASTHAN', pan: 'AAGPL3375F' } });
  await waitFor(() => expect(screen.getByLabelText('Address')).toHaveValue('Registry address'));
  expect(screen.getByLabelText('Supplier name')).toHaveValue('Typed name');
  expect(screen.getByLabelText('State')).toHaveValue('RAJASTHAN');
});
test('viewer sees the reason and cannot save a supplier', () => {
  renderApp(<SupplierSheet open onClose={() => {}} />, { me: { role: 'viewer', permissions: ['view'] } });
  expect(screen.queryByRole('button', { name: 'Add supplier' })).not.toBeInTheDocument();
  expect(screen.getByText(/Ask the owner if you need it/)).toBeVisible();
});
test('a GSTIN conflict can use the existing supplier without submitting it again', async () => {
  const existing = { ...blank, id: 42, name: 'Registry supplier', gst_number: '08AAGPL3375F1ZO' };
  const calls = serve({
    'GET gstin/08AAGPL3375F1ZO/': { gstin: existing.gst_number, valid: true, source: 'checksum' },
    'POST suppliers/': () => ({ status: 409, data: { code: 'gstin_taken', detail: 'This GSTIN belongs to Registry supplier, already in your suppliers.', supplier: existing } }),
  });
  const saved = vi.fn(); const close = vi.fn();
  renderApp(<SupplierSheet open onClose={close} onSaved={saved} initial={{ name: 'Typed supplier', gst_number: existing.gst_number }} />);
  await tick(400);
  fireEvent.click(screen.getByRole('button', { name: 'Add supplier' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Use Registry supplier' }));
  expect(saved).toHaveBeenCalledWith(expect.objectContaining({ id: 42, name: 'Registry supplier', gst_number: existing.gst_number }));
  expect(close).toHaveBeenCalledOnce();
  expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
});
test('a cancelled registration is a warning even when its GSTIN checks out', async () => {
  serve({ 'GET gstin/08AAGPL3375F1ZO/': { gstin: '08AAGPL3375F1ZO', valid: true, source: 'provider', status: 'Cancelled', trade_name: 'Registry supplier' } });
  renderApp(<SupplierSheet open onClose={() => {}} initial={{ gst_number: '08AAGPL3375F1ZO' }} />);
  const warning = await screen.findByText('Registration cancelled');
  expect(warning.closest('[role="status"]')).toHaveClass('border-neg-line');
  expect(screen.queryByText('Cancelled · Registry supplier (GST registry)')).not.toBeInTheDocument();
});
test('supplier fields and dismissal stay disabled until a submitted save settles', async () => {
  let reply!: (r: { status: number; data: unknown }) => void;
  const calls = serve({ 'POST suppliers/': () => new Promise(resolve => { reply = resolve; }) });
  renderApp(<SupplierSheet open onClose={() => {}} initial={{ name: 'Submitted supplier' }} />);
  await tick(400);
  fireEvent.click(screen.getByRole('button', { name: 'Add supplier' }));
  await waitFor(() => expect(reply).toBeTypeOf('function'));
  for (const label of ['Supplier name', 'GSTIN', 'State', 'City', 'Address', 'Phone', 'PAN', 'Email']) expect(screen.getByLabelText(label)).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(calls.find(c => c.method === 'POST')!.data).toMatchObject({ name: 'Submitted supplier' });
  reply({ status: 400, data: { name: ['That name is on file.'] } });
  expect(await screen.findByText('That name is on file.')).toBeVisible();
  expect(screen.getByLabelText('Supplier name')).toBeEnabled();
  expect(screen.getByLabelText('Supplier name')).toHaveValue('Submitted supplier');
});
test('a late registry answer for a GSTIN since edited fills nothing', async () => {
  let reply!: (r: {status:number;data:unknown}) => void;
  serve({ 'GET gstin/08AAGPL3375F1ZO/': () => new Promise(resolve => { reply = resolve; }) });
  renderApp(<SupplierSheet open onClose={() => {}} initial={{ gst_number: '08AAGPL3375F1ZO' }} />);
  await waitFor(() => expect(reply).toBeTypeOf('function'));
  fireEvent.change(screen.getByLabelText('GSTIN'), { target: { value: '08AAGPL3375F1Z' } });
  reply({ status: 200, data: { gstin: '08AAGPL3375F1ZO', valid: true, source: 'provider', trade_name: 'Registry name', address: 'Registry address', state_name: 'RAJASTHAN', pan: 'AAGPL3375F' } });
  await tick(400);
  expect(screen.getByLabelText('Address')).toHaveValue('');
  expect(screen.getByLabelText('Supplier name')).toHaveValue('');
});
test('the GSTIN check is announced through one region that is always on the page', async () => {
  let reply!: (r: {status:number;data:unknown}) => void;
  serve({ 'GET gstin/08AAGPL3375F1ZO/': () => new Promise(resolve => { reply = resolve; }) });
  const { container } = renderApp(<SupplierSheet open onClose={() => {}} />);
  const region = container.ownerDocument.getElementById('sup-gstin-status')!;
  expect(region).toHaveAttribute('role', 'status');
  expect(region).toHaveTextContent('');
  fireEvent.change(screen.getByLabelText('GSTIN'), { target: { value: '08AAGPL3375F1ZO' } });
  await waitFor(() => expect(reply).toBeTypeOf('function'));
  expect(container.ownerDocument.getElementById('sup-gstin-status')).toBe(region);
  expect(region).toHaveTextContent('Checking the GSTIN…');
  reply({ status: 200, data: { gstin: '08AAGPL3375F1ZO', valid: true, source: 'provider', status: 'Active', trade_name: 'Registry name' } });
  await waitFor(() => expect(region).toHaveTextContent('Active · Registry name (GST registry)'));
  expect(container.ownerDocument.getElementById('sup-gstin-status')).toBe(region);
});
test('an edit sends only the supplier fields, not the id or extra keys it was opened with', async () => {
  const calls = serve({ 'PUT suppliers/21/': { ...blank } });
  const initial = { id: 21, name: 'Local refiner', gst_number: '', state_name: 'RAJASTHAN', city: '', address: '', pan_number: '', mobile_number: '', email: '', gstin_valid: true } as never;
  renderApp(<SupplierSheet open onClose={() => {}} initial={initial} />);
  await tick(400);
  fireEvent.click(screen.getByRole('button', { name: 'Save supplier' }));
  await waitFor(() => expect(calls.some(c => c.method === 'PUT')).toBe(true));
  expect(Object.keys(calls.find(c => c.method === 'PUT')!.data).sort()).toEqual(['address', 'city', 'email', 'gst_number', 'mobile_number', 'name', 'pan_number', 'state_name']);
});
test('a refusal on a field the sheet does not show still says it was not saved', async () => {
  serve({ 'POST suppliers/': () => ({ status: 400, data: { mobile: ['Phone numbers have 10 digits.'] } }) });
  renderApp(<SupplierSheet open onClose={() => {}} initial={{ name: 'Local refiner' }} />);
  await tick(400);
  fireEvent.click(screen.getByRole('button', { name: 'Add supplier' }));
  expect(await screen.findByText('Not saved')).toBeVisible();
});
