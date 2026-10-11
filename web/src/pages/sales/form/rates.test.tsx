import { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { pass } from '@/test/clock';
import { renderApp } from '@/test/render';
import { wireBoard, wireRates } from '@/core/rates/testing';
import { lineFromProduct, startNew } from './model';
import { toSaleProduct } from './products';
import { LineRow } from './lines';
import { ItemSheet } from './ItemSheet';
import { lineRateReference } from './rules';
import { useBillForm } from './useBillForm';
import { formServer, RING } from './testing';
import { toBoard as boardOf } from '@/core/dashboard/wire';

const product = { ...toSaleProduct(RING), kind: null, kind_effective: 'gold' as const, purity: '22K' };
const products = [product];
const start = () => {
  const s = startNew({ firmId: 3, firmSource: 'scope', today: '2026-10-12' });
  s.form.lines = [{ ...lineFromProduct(product, s.form.lines[0]), qty: 1, rate: '65125' }]; return s;
};
function Harness({ phone = false }: { phone?: boolean }) {
  const F = useBillForm(start()); const l = F.f.lines[0]; const [open, setOpen] = useState(true);
  return <><output data-testid="rate">{l.rate}</output><button onClick={() => F.set({ date: '2026-09-30' })}>Earlier date</button>
    <button onClick={() => F.addLine(false, { ...l, key: 'second' })}>Second line</button>
    {phone ? <ItemSheet F={F} open={open} lineKey={l.key} products={products} again={0} onClose={() => setOpen(false)} onAgain={() => {}} onRemove={() => {}} />
      : F.f.lines.map((line, i) => <LineRow key={line.key} F={F} l={line} i={i} products={products} productsFailed={false} onNewProduct={() => {}} oneRow />)}
  </>;
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T10:10:00+05:30')); });
afterEach(() => vi.useRealTimers());
function server() {
  return formServer([['GET', 'rates/', ({ params }) => wireRates({ in_force: params.date === '2026-09-30' ? wireBoard({ on: '2026-09-27' }) : wireBoard() })]]);
}
test('desktop rate note and fix are descriptive, voluntary and shared across lines', async () => {
  const { calls } = server(); renderApp(<Harness />); await pass(400);
  const input = screen.getByLabelText('Line 1 rate per gram'); expect(input).toHaveValue('65,125.00');
  expect(screen.getByText("Today's board: ₹6,512.50 a gram · set 10:05 by Kailash")).toBeInTheDocument();
  expect(input.getAttribute('aria-describedby')).toContain('board');
  fireEvent.click(screen.getByRole('button', { name: 'Use ₹6,512.50' })); expect(screen.getByTestId('rate')).toHaveTextContent('6512.500'); expect(input).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Second line' })); await pass(); expect(calls.filter(c => c.url === 'rates/')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Earlier date' }));
  expect(screen.queryByText(/Today's board:/)).not.toBeInTheDocument(); await pass(400);
  expect(screen.getAllByText('Board of 27 Sep: ₹6,512.50 a gram')).toHaveLength(2); expect(screen.getByTestId('rate')).toHaveTextContent('6512.500');
  expect(calls.filter(c => c.url === 'rates/').map(c => c.params.date)).toEqual(['2026-10-12', '2026-09-30']);
});
test('phone fix changes only the item sheet draft until Save item', async () => {
  (window as unknown as { __phone: boolean }).__phone = true; server(); renderApp(<Harness phone />); await pass(400);
  fireEvent.click(screen.getByRole('button', { name: 'Use ₹6,512.50' }));
  expect(screen.getByLabelText('Rate per gram')).toHaveValue('6512.500'); expect(screen.getByLabelText('Rate per gram')).toHaveFocus(); expect(screen.getByTestId('rate')).toHaveTextContent('65125');
  fireEvent.click(screen.getByRole('button', { name: 'Save item' })); await pass(); expect(screen.getByTestId('rate')).toHaveTextContent('6512.500');
});
test('no in-force board means no latest fallback and no change to typing', async () => {
  formServer([['GET', 'rates/', () => wireRates({ in_force: null })]]); renderApp(<Harness />); await pass();
  expect(screen.queryByText(/Today's board:/)).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: /^Use ₹/ })).not.toBeInTheDocument(); expect(screen.getByTestId('rate')).toHaveTextContent('65125');
});
test('saved names resolve only a unique exact product and one-off or non-gram lines stay quiet', () => {
  const s = start(), line = { ...s.form.lines[0], productId: null }; const rates = { ...wireRates(), latest: null, previous: null, in_force: boardOf(wireBoard()) };
  expect(lineRateReference(line, products, rates, '2026-10-12')?.slip).not.toBeNull();
  for (const changed of [{ ...line, custom: true }, { ...line, unit: 'kg' }, { ...line, name: 'Gold Ring' }]) expect(lineRateReference(changed, products, rates, '2026-10-12')).toBeNull();
  expect(lineRateReference(line, [product, { ...product, id: 9 }], rates, '2026-10-12')).toBeNull();
  expect(lineRateReference(line, products, rates, '2026-10-11')).toBeNull();
});
