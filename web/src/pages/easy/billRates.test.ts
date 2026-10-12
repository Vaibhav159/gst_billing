import { toBoard } from '@/core/dashboard/wire';
import type { RatesData } from '@/core/api/dashboard';
import { blankLine, startNew, type FormLine } from '@/pages/sales/form/model';
import { toSaleProduct } from '@/pages/sales/form/products';
import { unusual } from './state';
import { billRateNotices } from './billRates';

const product = toSaleProduct({
  id: 7, name: 'Gold Ring 22K', hsn_code: '7113', gst_tax_rate: '0.0300',
  default_unit: 'gms', description: '', usage_count: 4,
  kind: null, kind_effective: 'gold', purity: '22K', purchase_only: false,
});
const old = toBoard({
  id: 31, on: '2026-09-30', set_at: '2026-09-30T10:05:00+05:30',
  set_by: { id: 1, name: 'Kailash Mehta' },
  quoted: { 'gold-22K': '65125.00', 'silver-925': '72610.00' },
  per_gram: { 'gold-22K': '6512.500', 'silver-925': '72.610' },
})!;
const latest = { ...old, id: 32, on: '2026-10-12', per_gram: { ...old.per_gram, 'gold-22K': '66000.000' } };
const boards: RatesData = { today: '2026-10-12', rows: [], latest, previous: old, set_today: true, in_force: old };
const line = (patch: Partial<FormLine> = {}): FormLine => ({
  ...blankLine(), key: 'ring', name: product.name, productId: product.id,
  hsn: '7113', gst: '3', qty: 12.345, unit: 'gms', rate: '66000', ...patch,
});
const empty = { references: {}, notices: {}, ratesByLine: {} };

test('uses the historical board in force, never latest, and preserves the typed correction', () => {
  const l = line();
  const result = billRateNotices([l], [product], boards, '2026-09-30');
  expect(result.references.ring).toBe('Board on 30 Sep: ₹6,512.50 a gram');
  expect(result.notices.ring).toEqual([{
    text: "That's about 10 times the board's rate for gold 22K (₹6,512.50 a gram). Rates here are per gram, not per 10 grams.",
    field: 'rate', fix: { label: 'Use ₹6,600.00', patch: { rate: '6600.000' } },
  }]);
  expect(result.ratesByLine.ring?.tick).toBe('Yes, ₹66,000.00 a gram is right for Gold Ring 22K');
  expect(l.rate).toBe('66000');
  expect(old.per_gram['gold-22K']).toBe('6512.500');
});

test('no board in force, a later board, or an unavailable chosen date stays quiet despite latest', () => {
  for (const rates of [undefined, { ...boards, in_force: null }, { ...boards, in_force: undefined }, { ...boards, in_force: latest }]) {
    expect(billRateNotices([line()], [product], rates, '2026-09-30')).toEqual(empty);
  }
  expect(billRateNotices([line()], [product], boards, '')).toEqual(empty);
});

test('missing product metadata and an absent matching board row cannot infer a reference', () => {
  const missingKind = { ...product, kind: 'gold' as const };
  Reflect.deleteProperty(missingKind, 'kind_effective');
  const missingPurity = { ...product };
  Reflect.deleteProperty(missingPurity, 'purity');
  for (const products of [undefined, [], [missingKind], [missingPurity]]) {
    expect(billRateNotices([line()], products, boards, '2026-09-30')).toEqual(empty);
  }
  expect(billRateNotices([line()], [product], { ...boards, in_force: { ...old, per_gram: {} } }, '2026-09-30')).toEqual(empty);
});

test('a saved line uses only a unique exact product name and an existing id never falls back to the name', () => {
  const saved = line({ productId: null });
  expect(billRateNotices([saved], [product], boards, '2026-09-30').notices.ring).toHaveLength(1);
  expect(billRateNotices([saved], [product, { ...product, id: 8 }], boards, '2026-09-30')).toEqual(empty);
  expect(billRateNotices([line({ productId: null, name: 'gold ring 22k' })], [product], boards, '2026-09-30')).toEqual(empty);
  expect(billRateNotices([line({ productId: 99 })], [product], boards, '2026-09-30')).toEqual(empty);
  expect(billRateNotices([line()], [product, { ...product, id: 8 }], boards, '2026-09-30').notices.ring).toHaveLength(1);
});

test('custom lines and units outside grams stay quiet even with a matching product', () => {
  for (const patch of [{ custom: true }, { unit: 'ct' }, { unit: 'kg' }, { unit: 'pcs' }]) {
    expect(billRateNotices([line(patch)], [product], boards, '2026-09-30')).toEqual(empty);
  }
});

test.each([
  ['66000', '6600.000'],
  ['6600000', '6600.000'],
  ['660', '6600.000'],
  ['65125.125', '6512.513'],
])('shared correction of %s is passed verbatim as %s', (typed, fixed) => {
  const result = billRateNotices([line({ rate: typed })], [product], boards, '2026-09-30');
  expect(result.notices.ring[0].fix?.patch).toEqual({ rate: fixed });
  expect(result.ratesByLine.ring?.fix).toBe(fixed);
});

test('a blank rate gets only a reference and a silver rate with making gets no broad warning', () => {
  const blank = billRateNotices([line({ rate: '' })], [product], boards, '2026-09-30');
  expect(blank.references.ring).toBe('Board on 30 Sep: ₹6,512.50 a gram');
  expect(blank.notices).toEqual({});
  expect(blank.ratesByLine.ring).toBeNull();
  const silver = toSaleProduct({ id: 8, name: 'Silver ring', hsn_code: '7113', gst_tax_rate: '0.03', default_unit: 'gms', kind: 'silver', kind_effective: 'silver', purity: '925' });
  const result = billRateNotices([line({ productId: silver.id, name: silver.name, rate: '145.22' })], [silver], boards, '2026-09-30');
  expect(result.references.ring).toBe('Board on 30 Sep: ₹72.61 a gram');
  expect(result.notices).toEqual({});
  expect(result.ratesByLine.ring).toBeNull();
});

test('the same adapter result supplies the check sheet through 6B unusual', () => {
  const l = line();
  const form = startNew({ firmId: 3, firmSource: 'scope', today: '2026-09-30' }).form;
  form.lines = [l];
  const result = billRateNotices(form.lines, [product], boards, form.date);
  const checks = unusual(form, { total: 10000, rates: result.ratesByLine });
  expect(checks).toEqual([expect.objectContaining({ id: 'rate-ring', text: result.notices.ring[0].text,
    tick: 'Yes, ₹66,000.00 a gram is right for Gold Ring 22K' })]);
});
