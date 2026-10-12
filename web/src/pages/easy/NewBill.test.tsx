// BillFlow must pass address:false to its keeper; NewBill owns draft URL updates while
// preserving the current child path. No form, keeper, API hook or producer is mocked.
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { __resetDrafts, type DraftData } from '@/core/api/drafts';
import { __setNetState } from '@/core/api/network';
import { __resetDeviceDrafts, keptDraft, keptDrafts } from '@/core/deviceDrafts';
import { toDraftData, type Draft } from '@/core/draftData';
import { wireBoard, wireRates } from '@/core/rates/testing';
import { refuse, type Call, type Route } from '@/core/sales/fixtures';
import { mount } from '@/pages/customers/testing';
import { ANIL, formServer, RING, TODAY } from '@/pages/sales/form/testing';
import type { FormState } from '@/pages/sales/form/model';
import { tick } from '@/test/clock';
import BillFlow, { useEasyBill } from './BillFlow';
import NewBill, { ItemsRoute } from './NewBill';
import { BillCustomerRoute } from './BillCustomer';
import { WhoRoute } from './WhoRoute';

const ID = '5d1c2a8e-0b7f-4a8e-9c3a-1f2e3d4c5b6a';
const firm = { id: 3, name: 'KIRAN GOLD HOUSE', short: 'Kiran', gst_number: '08ABCPK1234F1Z5', state_name: 'RAJASTHAN', city: 'Jaipur' };
const weightLabel = 'Weight in grams';
const rateLabel = 'Rate per gram, as on the paper bill';
const board = wireBoard({ on: TODAY, set_at: '2026-10-08T10:05:12.204311+05:30' });
const rates = wireRates({ today: TODAY, latest: board, in_force: board });
const data = (patch: Partial<DraftData> = {}): DraftData => toDraftData({
  v: 1, firmId: 3, customer: ANIL, date: TODAY, number: '', numberTyped: false,
  paper: false, posOverride: null, payment: 'bank', notes: '', replaces: null,
  lines: [{ productId: 5, name: 'Gold Ring 22K', hsn: '711319', gst: '3', unit: 'gms', qty: 12.345, rate: '6512.50', note: '', custom: false }],
  ...patch,
});
const row = (value = data()): Draft => ({
  id: ID, business: 3, data: value, started_by: { id: 2, name: 'Rakesh Soni' },
  created_at: '2026-10-08T09:20:00+05:30', updated_at: '2026-10-08T09:25:00+05:30',
});

/** Observe the real provider without changing state or replacing a screen. */
function ObservedShell() {
  const { F } = useEasyBill();
  return <><output hidden data-testid="easy-form">{JSON.stringify({ form: F.f, draftId: F.draftId })}</output><NewBill /></>;
}
function draw(path = '/e/new') {
  return mount([
    { path: '/e/new', element: <BillFlow />, children: [{ element: <ObservedShell />, children: [
      { index: true, element: <WhoRoute /> }, { path: 'items', element: <ItemsRoute /> },
      { path: 'customer', element: <BillCustomerRoute /> },
    ] }] },
    { path: '/e', element: <h1>Easy home destination</h1> },
    { path: '/sales/new', element: <h1>Full view destination</h1> },
    { path: '/e/bill/:id', element: <h1>Existing bill destination</h1> },
    { path: '/e/saved/:id', element: <h1>Saved destination</h1> },
  ], [path]);
}
function state(): { form: FormState; draftId: string | null } {
  return JSON.parse(screen.getByTestId('easy-form').textContent ?? '{}');
}
function draftStore(initial: Draft[] = []) {
  const rows = new Map(initial.map(value => [value.id, value]));
  const put = ({ url, body }: Call) => {
    const request = body as { business: number | null; data: DraftData };
    const id = url.split('/')[1];
    const value: Draft = { ...row(request.data), id, business: request.business, updated_at: new Date().toISOString() };
    rows.set(id, value);
    return value;
  };
  const routes: Route[] = [
    ['GET', 'drafts/', () => ({ results: [...rows.values()] })],
    ['PUT', /^drafts\/[^/]+\/$/, put],
    ['DELETE', /^drafts\/[^/]+\/$/, ({ url }) => { rows.delete(url.split('/')[1]); return null; }],
  ];
  return { rows, put, routes };
}
function serve(extra: Route[] = [], initial: Draft[] = []) {
  const drafts = draftStore(initial);
  const server = formServer([...extra, ...drafts.routes,
    ['GET', 'firms/', () => ({ results: [firm] })],
    ['GET', 'firms/3/', () => firm],
    ['GET', 'preferences/', () => ({ data: { defaultBusinessId: '3', phoneMode: 'easy' } })],
    ['GET', 'shop-settings/', () => ({ default_business: 3, default_business_name: firm.name, show_bank: true })],
    ['GET', 'rates/', () => ({ today: TODAY, rows: [], latest: null, previous: null, in_force: null, set_today: false })],
  ]);
  return { ...server, drafts };
}
const writes = (calls: Call[]) => calls.filter(call => call.method === 'PUT' && call.url.startsWith('drafts/'));
const posts = (calls: Call[]) => calls.filter(call => call.method === 'POST' && call.url === 'sales/');
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(answer => { resolve = answer; });
  return { promise, resolve };
}
/** Let the query notifications and form debounces settle without real-time sleeps. */
async function shown<T>(read: () => T): Promise<T> {
  for (let n = 0; ; n++) {
    await tick(25);
    try { return read(); } catch (error) { if (n === 79) throw error; }
  }
}
async function newRing() {
  fireEvent.click(await shown(() => screen.getByRole('button', { name: /Anil Gupta/ })));
  fireEvent.click(await shown(() => screen.getByRole('button', { name: 'Gold Ring 22K' })));
  return shown(() => screen.getByLabelText(weightLabel));
}
async function newItem(name: string, material: string, category: string) {
  fireEvent.click(await shown(() => screen.getByRole('button', { name: /Anil Gupta/ })));
  fireEvent.click(await shown(() => screen.getByRole('button', { name: 'Not in the list? Add it' })));
  const dialog = await shown(() => screen.getByRole('dialog', { name: "Add an item that isn't in the list" }));
  await tick(400);
  fireEvent.change(within(dialog).getByLabelText('What is it called?'), { target: { value: name } });
  fireEvent.click(within(dialog).getByRole('button', { name: material }));
  fireEvent.click(within(dialog).getByRole('radio', { name: new RegExp(`^${category}`) }));
  return dialog;
}
function fillRing(weight = '12.345', rate = '6512.50') {
  fireEvent.change(screen.getByLabelText(weightLabel), { target: { value: weight } });
  fireEvent.change(screen.getByLabelText(rateLabel), { target: { value: rate } });
  fireEvent.click(screen.getByRole('radio', { name: /^UPI/ }));
}
async function review() {
  await shown(() => expect(screen.getByText('No. 34 · the number on the paper bill')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Check and save' }));
  const dialog = await shown(() => screen.getByRole('dialog', { name: 'Check the bill' }));
  await tick(400);
  return dialog;
}
async function leave(router: ReturnType<typeof draw>['router']) {
  await act(async () => { await router.navigate('/e'); });
  const dialog = await shown(() => screen.getByRole('dialog', { name: 'Keep this bill for later?' }));
  await tick(400);
  return dialog;
}

beforeEach(() => {
  localStorage.clear(); __resetDeviceDrafts(); __resetDrafts();
  (window as Window & { __phone?: boolean }).__phone = true;
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date('2026-10-08T10:00:00+05:30'));
  act(() => { onlineManager.setOnline(true); __setNetState('online'); });
});
afterEach(async () => {
  cleanup(); await tick(0); vi.useRealTimers();
  act(() => { onlineManager.setOnline(true); __setNetState('online'); });
});

test.each([
  { material: 'Gold 22K', category: 'Jewellery', typed: 'Gold kada', name: 'Gold kada 22K', kind: 'gold', purity: '22K', hsn: '7113', gst: '3', unit: 'gms' },
  { material: 'Diamond', category: 'Loose diamonds', typed: 'Loose diamond', name: 'Loose diamond', kind: 'diamond', purity: 'VS-GH', hsn: '7102', gst: '0.25', unit: 'ct' },
])('retaining $material sends its exact catalogue recipe and leaves the line rate blank', async (item) => {
  const product = { id: 77, name: item.name, hsn_code: item.hsn, gst_percent: item.gst, unit: item.unit,
    kind: item.kind, kind_effective: item.kind, purity: item.purity, description: '', usual_rate: null, purchase_only: false };
  let created = false;
  const { calls } = serve([
    ['GET', 'products/', () => ({ results: [RING, ...(created ? [product] : [])] })],
    ['GET', 'rates/', () => rates],
    ['POST', 'catalog/', () => { created = true; return product; }],
  ]);
  draw(); const dialog = await newItem(item.typed, item.material, item.category);
  fireEvent.click(within(dialog).getByLabelText(/^Also keep it in the item list/));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add to the bill' }));
  await shown(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const catalog = calls.filter(call => call.method === 'POST' && call.url === 'catalog/');
  expect(catalog).toHaveLength(1);
  expect(catalog[0].body).toEqual({ name: item.name, hsn_code: item.hsn, gst_percent: item.gst, unit: item.unit,
    description: '', kind: item.kind, purity: item.purity, usual_rate: null, purchase_only: false });
  expect(state().form.lines).toEqual([expect.objectContaining({ productId: 77, name: item.name,
    hsn: item.hsn, gst: item.gst, unit: item.unit, custom: false, qty: null, rate: '' })]);
  expect(screen.getByLabelText(`Rate per ${item.unit === 'ct' ? 'carat' : 'gram'}, as on the paper bill`)).toHaveValue('');
  if (item.kind === 'gold') {
    await shown(() => expect(screen.getByText("Today's board: ₹6,512.50 a gram · set 10:05 by Kailash")).toBeVisible());
    expect(state().form.lines[0].rate).toBe('');
  }
  expect(posts(calls)).toEqual([]);
});

test('a bill-only item survives the server draft roundtrip without a catalogue write or a board reference', async () => {
  let sameNameInCatalog = false;
  const { calls, drafts } = serve([
    ['GET', 'products/', () => ({ results: [RING, ...(sameNameInCatalog ? [{ ...RING, id: 77,
      name: 'Gold kada 22K', kind: 'gold', kind_effective: 'gold', purity: '22K' }] : [])] })],
    ['GET', 'rates/', () => rates],
  ]);
  const first = draw(); const dialog = await newItem('Gold kada', 'Gold 22K', 'Jewellery');
  expect(within(dialog).getByLabelText(/^Also keep it in the item list/)).not.toBeChecked();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add to the bill' }));
  await shown(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByLabelText(rateLabel)).toHaveValue('');
  fillRing('2.345', '6500.125'); await tick(1300);
  const id = state().draftId!;
  const expected = { productId: null, name: 'Gold kada 22K', hsn: '7113', gst: '3', unit: 'gms',
    qty: 2.345, rate: '6500.125', note: '', custom: true };
  await shown(() => expect(drafts.rows.get(id)?.data.lines).toEqual([expected]));
  expect(keptDraft(id)?.data.lines).toEqual([expected]);
  first.unmount(); await tick(0); localStorage.clear(); __resetDeviceDrafts(); __resetDrafts();
  sameNameInCatalog = true;
  draw(`/e/new/items?draft=${id}`);
  await shown(() => expect(screen.getByLabelText(rateLabel)).toHaveValue('6,500.125'));
  expect(state().form.lines).toEqual([expect.objectContaining(expected)]);
  expect(screen.getByText('On this bill only · HSN 7113 · GST 3%')).toBeVisible();
  expect(screen.queryByText(/Today's board:/)).not.toBeInTheDocument();
  expect(calls.some(call => call.method === 'GET' && call.url === 'drafts/')).toBe(true);
  expect(calls.filter(call => call.method === 'POST' && call.url === 'catalog/')).toEqual([]);
  expect(posts(calls)).toEqual([]);
});

test('one real bill keeps its fields across items, customer selection and the new-customer child', async () => {
  serve(); const { router } = draw(); await newRing(); fillRing();
  fireEvent.click(screen.getByRole('button', { name: /Bill number.*Change/ })); await tick(400);
  const number = screen.getByRole('dialog', { name: 'Bill number' });
  fireEvent.click(within(number).getByRole('switch', { name: 'A bill from an earlier day' }));
  fireEvent.change(within(number).getByRole('textbox', { name: 'Date on the paper bill' }), { target: { value: '30/9/2026' } });
  fireEvent.change(within(number).getByRole('textbox', { name: 'Number on the paper bill' }), { target: { value: '38' } });
  fireEvent.click(within(number).getByRole('button', { name: 'Done' })); await tick(250);
  const before = state().form;
  fireEvent.click(within(screen.getByRole('region', { name: 'Customer' })).getByRole('button', { name: 'Change' }));
  await shown(() => screen.getByLabelText('Search by name or phone'));
  expect(state().form).toEqual(before);
  await act(async () => { await router.navigate('/e/new/customer'); });
  await shown(() => screen.getByLabelText('Name'));
  expect(state().form).toEqual(before);
  await act(async () => { await router.navigate('/e/new/items'); });
  await shown(() => screen.getByLabelText(weightLabel));
  expect(state().form).toEqual(before);
  expect(state().form).toMatchObject({ date: '2026-09-30', paper: true, number: '38', numberTyped: true, payment: 'bank', customer: { id: ANIL.id } });
  expect(screen.getByLabelText(weightLabel)).toHaveValue('12.345');
  expect(screen.getByLabelText(rateLabel)).toHaveValue('6,512.50');
  expect(screen.queryByRole('dialog', { name: 'Keep this bill for later?' })).not.toBeInTheDocument();
});

test('only the first positive weight starts keeping, without moving away from the customer child', async () => {
  const { calls } = serve(); const { router } = draw(); await newRing();
  await tick(1500); expect(writes(calls)).toEqual([]); expect(state().draftId).toBeNull();
  fireEvent.change(screen.getByLabelText(weightLabel), { target: { value: '0' } });
  await tick(1500); expect(writes(calls)).toEqual([]);
  fireEvent.change(screen.getByLabelText(weightLabel), { target: { value: '12.345' } });
  await act(async () => { await router.navigate('/e/new/customer'); });
  await shown(() => screen.getByLabelText('Name')); await tick(1300);
  expect(router.state.location.pathname).toBe('/e/new/customer');
  expect(screen.getByLabelText('Name')).toBeInTheDocument();
  const id = state().draftId!;
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(router.state.location.search).toBe(`?draft=${id}`);
  expect(writes(calls)).toHaveLength(1);
  expect(writes(calls)[0]).toMatchObject({ url: `drafts/${id}/`, body: { data: { lines: [expect.objectContaining({ qty: 12.345, rate: '' })] } } });
});

test('saving a dirty customer returns to the same bill without a leave prompt and keeps later bill guarding', async () => {
  const { calls } = serve([['POST', 'customers/', ({ body }) => ({ ...ANIL, ...body as object, id: 12 })]]);
  const { router } = draw(); await newRing(); fillRing();
  const before = state().form;
  await act(async () => { await router.navigate('/e/new/customer'); });
  fireEvent.change(await shown(() => screen.getByLabelText('Name')), { target: { value: 'Meena Jain' } });
  fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '9414123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save and continue the bill' }));
  await shown(() => expect(router.state.location.pathname).toBe('/e/new/items'));
  expect(state().form).toEqual({ ...before, customer: expect.objectContaining({ id: 12, name: 'Meena Jain' }) });
  expect(screen.queryByRole('dialog', { name: 'Leave this customer?' })).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Keep this bill for later?' })).not.toBeInTheDocument();
  expect(calls.filter(call => call.method === 'POST' && call.url === 'customers/')).toHaveLength(1);
  expect(await leave(router)).toHaveTextContent('Meena Jain');
  expect(router.state.location.pathname).toBe('/e/new/items');
});

test('using a duplicate from a dirty customer form returns to the bill without a save or leave prompt', async () => {
  const { calls } = serve([['GET', 'customers/', () => ({ results: [ANIL] })]], [row()]);
  const { router } = draw(`/e/new/items?draft=${ID}`);
  await shown(() => screen.getByLabelText(weightLabel));
  const before = state().form;
  await act(async () => { await router.navigate('/e/new/customer'); });
  fireEvent.change(await shown(() => screen.getByLabelText('Name')), { target: { value: 'Meena Jain' } });
  fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: ANIL.mobile_number } });
  fireEvent.click(await shown(() => screen.getByRole('button', { name: 'Use Anil' })));
  await shown(() => expect(router.state.location.pathname).toBe('/e/new/items'));
  expect(state().form).toMatchObject({ ...before, customer: { id: ANIL.id, name: ANIL.name } });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(calls.filter(call => call.method === 'POST' && call.url === 'customers/')).toEqual([]);
  expect(await leave(router)).toHaveTextContent('Anil Gupta');
});

test('Keep waits for an outstanding write, keeps the latest values under the same id and then leaves', async () => {
  const held = deferred<unknown>(); let first!: Call; let waiting = true;
  const { calls, drafts } = serve([['PUT', /^drafts\/[^/]+\/$/, call => {
    if (waiting) { waiting = false; first = call; return held.promise; }
    return drafts.put(call);
  }]]);
  const { router } = draw(); await newRing(); fillRing(); await tick(1300);
  expect(writes(calls)).toHaveLength(1); const id = state().draftId!;
  fireEvent.change(screen.getByLabelText(rateLabel), { target: { value: '6500.125' } });
  const dialog = await leave(router);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Keep it as an unfinished bill' }));
  expect(within(dialog).getByRole('button', { name: 'Throw it away' })).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: 'Keep it as an unfinished bill' })).toBeDisabled();
  expect(router.state.location.pathname).toBe('/e/new/items');
  await act(async () => { held.resolve(drafts.put(first)); });
  await shown(() => screen.getByRole('heading', { name: 'Easy home destination' })); await tick(1500);
  expect(writes(calls).every(call => call.url === `drafts/${id}/`)).toBe(true);
  expect(keptDraft(id)?.data.lines[0]).toMatchObject({ qty: 12.345, rate: '6500.125' });
  expect(drafts.rows.get(id)?.data.lines[0].rate).toBe('6500.125');
  expect(keptDrafts().filter(draft => !draft.gone)).toHaveLength(1);
  expect(posts(calls)).toEqual([]);
});

test('Throw it away wins over a pending keep and cannot resurrect the draft on unmount', async () => {
  const held = deferred<unknown>(); let first!: Call;
  const { calls, drafts } = serve([['PUT', /^drafts\/[^/]+\/$/, call => { first = call; return held.promise; }]]);
  const { router } = draw(); await newRing(); fillRing(); await tick(1300);
  expect(writes(calls)).toHaveLength(1); const id = state().draftId!;
  fireEvent.change(screen.getByLabelText(rateLabel), { target: { value: '6500.125' } });
  const dialog = await leave(router);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Throw it away' }));
  await shown(() => screen.getByRole('heading', { name: 'Easy home destination' }));
  expect(keptDrafts().filter(draft => !draft.gone)).toEqual([]);
  await act(async () => { held.resolve(drafts.put(first)); }); await tick(1800);
  expect(calls.filter(call => call.method === 'DELETE' && call.url === `drafts/${id}/`)).toHaveLength(1);
  expect(writes(calls)).toHaveLength(1);
  expect(keptDraft(id)).toBeNull(); expect(drafts.rows.has(id)).toBe(false);
  expect(posts(calls)).toEqual([]);
});

test('Throw before the first timed keep still supplies shared Undo with the same complete draft', async () => {
  const { calls, drafts } = serve(); const { router } = draw(); await newRing(); fillRing();
  expect(state().draftId).toBeNull();
  const dialog = await leave(router);
  expect(state().draftId).toBeNull(); expect(writes(calls)).toEqual([]);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Throw it away' }));
  await shown(() => screen.getByRole('heading', { name: 'Easy home destination' }));
  await shown(() => expect(calls.some(call => call.method === 'DELETE' && call.url.startsWith('drafts/'))).toBe(true));
  const deleted = calls.find(call => call.method === 'DELETE' && call.url.startsWith('drafts/'))!;
  const id = deleted.url.split('/')[1];
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(keptDrafts().filter(draft => !draft.gone)).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: /^Undo/ }));
  await shown(() => expect(drafts.rows.has(id)).toBe(true));
  expect(keptDraft(id)?.data).toMatchObject({ customer: { id: ANIL.id }, payment: 'bank',
    lines: [expect.objectContaining({ name: 'Gold Ring 22K', qty: 12.345, rate: '6512.50' })] });
  expect(keptDrafts().filter(draft => !draft.gone)).toHaveLength(1);
  expect(writes(calls).every(call => call.url === `drafts/${id}/`)).toBe(true);
  expect(posts(calls)).toEqual([]);
});

test('Full view receives the existing id with the latest values after a filed-month refusal', async () => {
  const { calls, drafts } = serve([['POST', 'sales/', () => refuse(409, {
    code: 'month_closed', detail: 'October has just been filed.', locked_period: { business: 3, year: 2026, month: 10 },
  })]], [row()]);
  const { router } = draw(`/e/new/items?draft=${ID}`);
  await shown(() => screen.getByLabelText(weightLabel)); fillRing('13.001', '6500.125');
  const dialog = await review(); fireEvent.click(within(dialog).getByRole('button', { name: 'Save bill 34' }));
  const full = await shown(() => within(dialog).getByRole('button', { name: 'Finish in the full view' }));
  fireEvent.click(full);
  await shown(() => screen.getByRole('heading', { name: 'Full view destination' }));
  expect(router.state.location.pathname + router.state.location.search).toBe(`/sales/new?draft=${ID}`);
  expect(router.state.location.state).toEqual({ fullView: true });
  expect(writes(calls).length).toBeGreaterThan(0);
  expect(writes(calls).every(call => call.url === `drafts/${ID}/`)).toBe(true);
  expect(drafts.rows.get(ID)?.data.lines[0]).toMatchObject({ qty: 13.001, rate: '6500.125' });
  expect(keptDraft(ID)?.data.lines[0]).toMatchObject({ qty: 13.001, rate: '6500.125' });
  expect(posts(calls)).toHaveLength(1);
});

test.each(['cash', 'mixed'] as const)('%s at exactly two lakh warns without holding review or Save', async (payment) => {
  const large = data({ payment, lines: [{ ...data().lines[0], productId: null, name: 'Other item', hsn: '9988', gst: '0', qty: 1, rate: '200000', custom: true }] });
  const { calls } = serve([], [row(large)]); draw(`/e/new/items?draft=${ID}`);
  await shown(() => screen.getByText('No. 34 · the number on the paper bill'));
  expect(screen.getByRole('button', { name: 'Check and save' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Choose Part cash' })).not.toBeInTheDocument();
  const dialog = await review();
  expect(dialog).toHaveTextContent(payment === 'cash'
    ? '₹2,00,000.00 taken in cash is at or over the ₹2,00,000 limit for one bill (Income Tax Sec 269ST).'
    : 'The total is over ₹2,00,000, so the cash part must stay under ₹2,00,000 (income-tax rules).');
  expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
  const save = within(dialog).getByRole('button', { name: 'Save bill 34' });
  expect(save).toBeEnabled();
  fireEvent.click(save);
  await shown(() => screen.getByRole('heading', { name: 'Saved destination' }));
  expect(posts(calls)).toHaveLength(1);
  expect(posts(calls)[0].body).toMatchObject({ payment_mode: payment });
});

test('a first-save field refusal returns focus to that field and preserves every typed value', async () => {
  const { calls } = serve([['POST', 'sales/', () => refuse(400, { lines: { '0': { quantity: ['Check the weight written on this bill.'] } } })]]);
  const { router } = draw(); await newRing(); fillRing();
  const before = state().form;
  const dialog = await review(); fireEvent.click(within(dialog).getByRole('button', { name: 'Save bill 34' }));
  await shown(() => expect(screen.getByLabelText(weightLabel)).toHaveFocus());
  expect(screen.getByLabelText(weightLabel)).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText('Check the weight written on this bill.')).toBeVisible();
  expect(state().form).toEqual(before);
  expect(router.state.location.pathname).toBe('/e/new/items');
  expect(router.state.location.search).toBe(`?draft=${state().draftId}`);
  expect(screen.queryByRole('dialog', { name: 'Keep this bill for later?' })).not.toBeInTheDocument();
  expect(posts(calls)).toHaveLength(1);
});

test('an unsupported field refusal keeps the exact server words and every typed bill value', async () => {
  const { calls } = serve([['POST', 'sales/', () => refuse(400, { notes: ['Use at most 500 characters.'] })]]);
  draw(); await newRing(); fillRing();
  const before = state().form;
  const dialog = await review(); fireEvent.click(within(dialog).getByRole('button', { name: 'Save bill 34' }));
  await shown(() => expect(screen.getByText('Use at most 500 characters.')).toBeVisible());
  expect(screen.getByRole('button', { name: 'Finish in the full view' })).toBeVisible();
  expect(state().form).toEqual(before);
  expect(posts(calls)).toHaveLength(1);
});

test('draft_saved opens the existing bill without another POST or recreating its draft', async () => {
  const { calls, drafts } = serve([['POST', 'sales/', () => {
    drafts.rows.delete(ID);
    return refuse(409, { code: 'draft_saved', detail: 'This unfinished bill was saved as KGH/2026-27/34 already.',
      bill: { id: 501, invoice_number: 'KGH/2026-27/34', invoice_date: TODAY, customer_name: 'Anil Gupta', status: 'active' } });
  }]], [row()]);
  const { router } = draw(`/e/new/items?draft=${ID}`);
  await shown(() => screen.getByLabelText(weightLabel));
  const dialog = await review(); fireEvent.click(within(dialog).getByRole('button', { name: 'Save bill 34' }));
  const open = await shown(() => within(dialog).getByRole('link', { name: 'Open it' }));
  expect(open).toHaveAttribute('href', '/e/bill/501');
  expect(within(dialog).getByText('This bill was saved already, as bill 34.')).toBeVisible();
  expect(within(dialog).queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument();
  const keeps = writes(calls).length;
  fireEvent.click(open);
  await shown(() => screen.getByRole('heading', { name: 'Existing bill destination' })); await tick(1500);
  expect(router.state.location.pathname).toBe('/e/bill/501');
  expect(posts(calls)).toHaveLength(1);
  expect(posts(calls)[0].body).toMatchObject({ draft_id: ID });
  expect(writes(calls)).toHaveLength(keeps);
  expect(keptDraft(ID)).toBeNull();
  expect(screen.queryByRole('dialog', { name: 'Keep this bill for later?' })).not.toBeInTheDocument();
});
