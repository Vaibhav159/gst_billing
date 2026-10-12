// These checks exercise the real shared hooks and bill context; no substitute producer modules.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router';
import { mount } from '@/pages/customers/testing';
import { fakeToday, formServer } from '@/pages/sales/form/testing';
import BillFlow, { useEasyBill } from './BillFlow';
import { WhoRoute } from './WhoRoute';

const firm = { id: 3, name: 'KIRAN GOLD HOUSE', short: 'Kiran', gst_number: '08ABCPK1234F1Z5', state_name: 'RAJASTHAN', city: 'Jaipur' };
function Chosen() { const { F } = useEasyBill(); return <output>{JSON.stringify(F.f.customer)}</output>; }
function Prefill() { const location = useLocation(); return <output>{JSON.stringify(location.state)}</output>; }
function draw() {
  return mount([{ path: '/e/new', element: <BillFlow />, children: [
    { index: true, element: <WhoRoute /> }, { path: 'items', element: <Chosen /> }, { path: 'customer', element: <Prefill /> },
  ] }], ['/e/new']);
}
beforeEach(() => { fakeToday(); localStorage.clear(); });
afterEach(() => vi.useRealTimers());
const serve = () => formServer([
  ['GET', 'firms/', () => ({ results: [firm] })],
  ['GET', 'preferences/', () => ({ data: { defaultBusinessId: '3' } })],
]);
it('uses the six-customer firm/year query and selects the complete customer in the mounted bill', async () => {
  const { calls } = serve(); const { router } = draw();
  const choice = await screen.findByRole('button', { name: /Anil Gupta/ });
  expect(choice).toHaveTextContent('••• 41122'); expect(choice).not.toHaveTextContent('₹');
  expect(calls.find(c => c.url === 'customers/' && c.params.ordering === '-last_bill')?.params).toMatchObject({
    figures_business_id: 3, start_date: '2026-04-01', end_date: '2026-10-08', page_size: 7,
  });
  fireEvent.click(choice);
  await waitFor(() => expect(router.state.location.pathname).toBe('/e/new/items'));
  expect(screen.getByRole('status')).toHaveTextContent('"id":7');
  expect(screen.getByRole('status')).toHaveTextContent('"mobile_number":"9829041122"');
  expect(calls.filter(c => c.method !== 'GET')).toEqual([]);
});
it('does not request a one-character search or show a false no-customer answer while typing', async () => {
  const { calls } = serve(); draw();
  fireEvent.change(await screen.findByLabelText('Search by name or phone'), { target: { value: 'A' } });
  expect(screen.getByText('Type at least 2 characters to search.')).toBeVisible();
  expect(screen.queryByText(/No customer called/)).not.toBeInTheDocument();
  expect(calls.filter(c => c.url === 'customers/' && c.params.search)).toEqual([]);
  fireEvent.change(screen.getByLabelText('Search by name or phone'), { target: { value: 'Meena' } });
  expect(screen.queryByText(/No customer called/)).not.toBeInTheDocument();
  expect(await screen.findByText('No customer called “Meena” yet')).toBeVisible();
});
it('takes the typed text to the bill customer child without changing layout or firm', async () => {
  serve(); const { router } = draw();
  fireEvent.change(await screen.findByLabelText('Search by name or phone'), { target: { value: 'Meena' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Add “Meena” as a new customer' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/e/new/customer'));
  expect(router.state.location.state).toEqual({ typed: 'Meena' });
});
