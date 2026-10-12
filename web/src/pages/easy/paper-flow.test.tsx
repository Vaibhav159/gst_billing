import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { __resetDrafts, type DraftData } from '@/core/api/drafts';
import { __setNetState } from '@/core/api/network';
import { __resetDeviceDrafts } from '@/core/deviceDrafts';
import { toDraftData, type Draft } from '@/core/draftData';
import { wireBoard, wireRates, type WireRates } from '@/core/rates/testing';
import { FIRM, type Route } from '@/core/sales/fixtures';
import { mount } from '@/pages/customers/testing';
import type { FormState } from '@/pages/sales/form/model';
import { ANIL, formServer, RING, wireBook, wireNext } from '@/pages/sales/form/testing';
import { tick } from '@/test/clock';
import BillFlow, { useEasyBill } from './BillFlow';
import NewBill, { ItemsRoute } from './NewBill';

const TODAY = '2026-10-12';
const ID = '5d1c2a8e-0b7f-4a8e-9c3a-1f2e3d4c5b6a';
const rateLabel = 'Rate per gram, as on the paper bill';
const historical = wireBoard({ id: 40, on: '2026-09-30',
  quoted: { 'gold-22K': '64700.00' }, per_gram: { 'gold-22K': '6470.000' } });

/** Observe the real provider; all changes below come from the actual route controls. */
function ObservedShell() {
  const { F } = useEasyBill();
  return <><output hidden data-testid="paper-form">{JSON.stringify(F.f)}</output><NewBill /></>;
}
function draw() {
  return mount([
    { path: '/e/new', element: <BillFlow />, children: [{ element: <ObservedShell />, children: [
      { path: 'items', element: <ItemsRoute /> },
    ] }] },
    { path: '/e/saved/:id', element: <h1>Saved paper bill destination</h1> },
  ], [`/e/new/items?draft=${ID}`]);
}
const state = (): FormState => JSON.parse(screen.getByTestId('paper-form').textContent ?? '{}');
function serve(extra: Route[] = [], rate = '6500.125') {
  let draft: Draft = {
    id: ID, business: 3, started_by: { id: 2, name: 'Rakesh Soni' },
    created_at: '2026-10-12T09:20:00+05:30', updated_at: '2026-10-12T09:25:00+05:30',
    data: toDraftData({ v: 1, firmId: 3, customer: ANIL, date: TODAY, paper: false,
      number: '', numberTyped: false, posOverride: null, payment: 'bank', notes: '', replaces: null,
      lines: [{ productId: RING.id, name: RING.name, hsn: RING.hsn_code, gst: '3', unit: 'gms',
        qty: 12.345, rate, note: '', custom: false }],
    }),
  };
  return formServer([...extra,
    ['GET', 'firms/', () => ({ results: [FIRM] })],
    ['GET', 'preferences/', () => ({ data: { defaultBusinessId: '3', phoneMode: 'easy' } })],
    ['GET', 'shop-settings/', () => ({ default_business: 3, default_business_name: FIRM.name, show_bank: true })],
    ['GET', 'products/', () => ({ results: [{ ...RING, kind: null, kind_effective: 'gold', purity: '22K' }] })],
    ['GET', 'drafts/', () => ({ results: [draft] })],
    ['PUT', `drafts/${ID}/`, ({ body }) => {
      draft = { ...draft, data: (body as { data: DraftData }).data, updated_at: new Date().toISOString() };
      return draft;
    }],
    ['GET', 'sales/next-number/', ({ params }) => wireNext(3, String(params.invoice_date), 99)],
    ['GET', 'sales/paper-book/', ({ params }) => wireBook({ month: params.month,
      next: { counter: 38, invoice_number: 'KGH/2026-27/38', invoice_date: '2026-09-29' } })],
    ['GET', 'rates/', ({ params }) => wireRates({ in_force: params.date === TODAY ? wireBoard() : historical })],
  ]);
}
async function shown<T>(read: () => T): Promise<T> {
  for (let n = 0; ; n++) {
    await tick(25);
    try { return read(); } catch (error) { if (n === 79) throw error; }
  }
}
async function chooseEarlier(text: string) {
  fireEvent.click(screen.getByRole('button', { name: /Bill number.*Change/ }));
  await tick(400);
  const dialog = screen.getByRole('dialog', { name: 'Bill number' });
  const earlier = within(dialog).getByRole('switch', { name: 'A bill from an earlier day' });
  if (earlier.getAttribute('aria-checked') !== 'true') fireEvent.click(earlier);
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Date on the paper bill' }), { target: { value: text } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
  await tick(400);
}

beforeEach(() => {
  localStorage.clear(); __resetDeviceDrafts(); __resetDrafts();
  (window as Window & { __phone?: boolean }).__phone = true;
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date('2026-10-12T10:10:00+05:30'));
  act(() => { onlineManager.setOnline(true); __setNetState('online'); });
});
afterEach(async () => {
  cleanup(); await tick(0); vi.useRealTimers();
  act(() => { onlineManager.setOnline(true); __setNetState('online'); });
});

test('P6-7 uses the selected month paper-book counter, its in-force board, and the chosen date on save', async () => {
  const { calls } = serve(); draw();
  await shown(() => screen.getByText("Today's board: ₹6,512.50 a gram · set 10:05 by Kailash"));
  expect(screen.getByText('No. 99 · the number on the paper bill')).toBeInTheDocument();
  await chooseEarlier('30/9/2026');
  await shown(() => screen.getByText('No. 38 · the number on the paper bill'));
  expect(state()).toMatchObject({ date: '2026-09-30', paper: true, numberTyped: false });
  expect(screen.getByText('Board on 30 Sep: ₹6,470.00 a gram')).toBeVisible();
  expect(screen.queryByText(/Today's board:/)).not.toBeInTheDocument();
  expect(screen.getByLabelText(rateLabel)).toHaveValue('6,500.125');
  expect(calls).toContainEqual(expect.objectContaining({ url: 'sales/paper-book/', params: expect.objectContaining({ business_id: 3, month: '2026-09' }) }));
  expect(calls).toContainEqual(expect.objectContaining({ url: 'sales/next-number/', params: expect.objectContaining({ business_id: 3, invoice_date: '2026-09-30' }) }));
  expect(calls).toContainEqual(expect.objectContaining({ url: 'rates/', params: { date: '2026-09-30' } }));
  expect(calls).toContainEqual(expect.objectContaining({ url: 'sales/', params: expect.objectContaining({ customer_id: ANIL.id, start_date: '2026-09-30', end_date: '2026-09-30' }) }));
  fireEvent.click(screen.getByRole('button', { name: 'Check and save' }));
  const review = await shown(() => screen.getByRole('dialog', { name: 'Check the bill' }));
  await tick(400);
  fireEvent.click(within(review).getByRole('button', { name: 'Save bill 38' }));
  await shown(() => screen.getByRole('heading', { name: 'Saved paper bill destination' }));
  expect(calls.filter(call => call.method === 'POST' && call.url === 'sales/')).toEqual([
    expect.objectContaining({ body: expect.objectContaining({ invoice_date: '2026-09-30', paper: true, invoice_number: '38', draft_id: ID }) }),
  ]);
});

test('a delayed old-day board cannot change the selected day or restore a reference or slip when that day has no board', async () => {
  let release!: (rates: WireRates) => void;
  const held = new Promise<WireRates>(resolve => { release = resolve; });
  const { calls } = serve([['GET', 'rates/', ({ params }) => params.date === '2026-09-30' ? held
    : wireRates({ in_force: params.date === TODAY ? wireBoard() : null })]], '66000');
  draw();
  await shown(() => screen.getByText("Today's board: ₹6,512.50 a gram · set 10:05 by Kailash"));
  expect(screen.getByRole('button', { name: 'Use ₹6,600.00' })).toBeInTheDocument();
  await chooseEarlier('30/9/2026');
  expect(calls).toContainEqual(expect.objectContaining({ url: 'rates/', params: { date: '2026-09-30' } }));
  expect(screen.queryByText(/Today's board:|Board (?:on|of) /)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Use ₹6,600.00' })).not.toBeInTheDocument();
  await chooseEarlier('29/9/2026');
  await shown(() => expect(calls).toContainEqual(expect.objectContaining({ url: 'rates/', params: { date: '2026-09-29' } })));
  await act(async () => { release(wireRates({ in_force: historical })); });
  await tick(400);
  expect(state()).toMatchObject({ date: '2026-09-29', paper: true });
  expect(screen.getByText('No. 38 · the number on the paper bill')).toBeVisible();
  expect(screen.queryByText(/Today's board:|Board (?:on|of) /)).not.toBeInTheDocument();
  expect(screen.queryByText(/That's about/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Use ₹6,600.00' })).not.toBeInTheDocument();
  expect(screen.getByLabelText(rateLabel)).toHaveValue('66,000.00');
  expect(state().lines[0].rate).toBe('66000');
});
