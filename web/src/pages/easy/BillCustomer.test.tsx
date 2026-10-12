// Gate: run after 4C firmListQuery and 6B/6D production modules land.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { mount } from '@/pages/customers/testing';
import { fakeToday, formServer, ANIL } from '@/pages/sales/form/testing';
import BillFlow, { useEasyBill } from './BillFlow';
import { BillCustomer } from './BillCustomer';

const firm = { id: 3, name: 'KIRAN GOLD HOUSE', short: 'Kiran', gst_number: '08ABCPK1234F1Z5', state_name: 'RAJASTHAN', city: 'Jaipur' };
function Chosen() { const { F } = useEasyBill(); return <output>{JSON.stringify({ customer: F.f.customer, firm: F.f.firmId })}</output>; }
function draw(typed = '', onDirty = vi.fn()) {
  return { onDirty, ...mount([{ path: '/e/new', element: <BillFlow />, children: [
    { path: 'customer', element: <BillCustomer typed={typed} onDirty={onDirty} /> }, { path: 'items', element: <Chosen /> },
  ] }], ['/e/new/customer']) };
}
beforeEach(() => { fakeToday(); localStorage.clear(); });
afterEach(() => vi.useRealTimers());
const base = [
  ['GET', 'firms/', () => ({ results: [firm] })],
  ['GET', 'preferences/', () => ({ data: { defaultBusinessId: '3' } })],
] satisfies Parameters<typeof formServer>[0];
it('uses the live city and typed name, then returns the created customer to the same bill', async () => {
  const { calls } = formServer([...base,
    ['GET', 'customers/', () => ({ results: [] })],
    ['POST', 'customers/', ({ body }) => ({ ...ANIL, ...body as object, id: 12 })],
  ]);
  const { router, onDirty } = draw('Meena Jain');
  expect(await screen.findByLabelText('Name')).toHaveValue('Meena Jain');
  expect(screen.getByLabelText('Town or city')).toHaveValue('Jaipur');
  fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '9414123456' } });
  await waitFor(() => expect(onDirty).toHaveBeenCalledWith(true));
  fireEvent.click(screen.getByRole('button', { name: 'Save and continue the bill' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/e/new/items'));
  expect(screen.getByRole('status')).toHaveTextContent('"id":12');
  expect(screen.getByRole('status')).toHaveTextContent('"firm":3');
  expect(onDirty).toHaveBeenLastCalledWith(false);
  expect(calls.find(c => c.method === 'POST' && c.url === 'customers/')?.body).toMatchObject({ city: 'Jaipur', businesses: [3], state_name: 'RAJASTHAN' });
  expect(calls.filter(c => c.method !== 'GET' && c.url !== 'customers/')).toEqual([]);
});
it('prefills a phone and uses the duplicate customer without creating another', async () => {
  const { calls } = formServer([...base, ['GET', 'customers/', () => ({ results: [ANIL] })]]); const { router } = draw('98290 41122');
  expect(await screen.findByLabelText('Mobile number')).toHaveValue('98290 41122');
  expect(screen.getByLabelText('Name')).toHaveValue('');
  fireEvent.click(await screen.findByRole('button', { name: 'Use Anil' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/e/new/items'));
  expect(screen.getByRole('status')).toHaveTextContent('"id":7');
  expect(calls.filter(c => c.method !== 'GET')).toEqual([]);
});
it('reports dirty state to the parent and clears it on unmount', async () => {
  formServer(base); const { unmount, onDirty } = draw();
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Meena' } });
  await waitFor(() => expect(onDirty).toHaveBeenLastCalledWith(true));
  unmount(); expect(onDirty).toHaveBeenLastCalledWith(false);
});
