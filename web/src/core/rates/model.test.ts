import { toBoard as boardOf } from '@/core/dashboard/wire';
import { RATE_ROWS, changed, moved, perGram, quotedErrors, rateKey } from './model';
import { rateSlip, rateNote } from './slip';
import { wireBoard } from './testing';

// X-40: rows.json is 5A Task 1's file; this file runs once 5A Task 1 lands.
test('five contract rows keep their order and quote units', () => {
  expect(RATE_ROWS.map(r => [r.key, r.label, r.sub, r.per, r.per_label])).toEqual([
    ['gold-24K', 'Gold 24K', '999', 10, '10 g'], ['gold-22K', 'Gold 22K', '916', 10, '10 g'],
    ['gold-18K', 'Gold 18K', '750', 10, '10 g'], ['silver-999', 'Silver 999', 'fine', 1000, 'kg'],
    ['silver-925', 'Silver 925', 'sterling', 1000, 'kg'],
  ]);
});
test('quotes become paise; per-gram precision and the typed quote stay exact', () => {
  const wire = wireBoard(); wire.quoted['silver-999'] = '72610.49'; wire.per_gram['silver-999'] = '72.610';
  const b = boardOf(wire)!;
  expect(b.quoted['silver-999']).toBe(7261049); expect(b.per_gram['silver-999']).toBe('72.610');
  expect(perGram(7261050, 1000)).toBe('72.611');
});
test('kind_effective alone selects a row; no kind, name or HSN inference', () => {
  expect(rateKey({ kind: null, kind_effective: 'gold', purity: '22K' })).toBe('gold-22K');
  for (const p of [null, {}, { kind: 'gold', purity: '22K' }, { kind_effective: 'diamond', purity: '22K' }, { kind_effective: 'gold', purity: '14K' }]) expect(rateKey(p)).toBeNull();
});
test('all five quotes are positive integer paise, at most 999999999', () => {
  const q = boardOf(wireBoard())!.quoted;
  expect(quotedErrors(q)).toEqual({});
  expect(quotedErrors({ ...q, 'gold-22K': null })['gold-22K']).toBe('Type the Gold 22K rate per 10 g.');
  for (const v of [0, -1, NaN, 0.5]) expect(quotedErrors({ ...q, 'silver-999': v })['silver-999']).toBe("That's not an amount.");
  expect(quotedErrors({ ...q, 'gold-24K': 1000000000 })['gold-24K']).toBe("That's more than ₹99,99,999.99 per 10 g.");
});
test('strictly more than a fifth, and unchanged comparison uses quotes', () => {
  const old = boardOf(wireBoard())!; old.quoted['gold-22K'] = 10000;
  expect(changed(old.quoted, old)).toBe(false); expect(changed(old.quoted, null)).toBe(true);
  for (const value of [8000, 12000]) expect(moved({ ...old.quoted, 'gold-22K': value }, old)).toEqual([]);
  for (const value of [7999, 12001]) expect(moved({ ...old.quoted, 'gold-22K': value }, old)).toEqual(['gold-22K']);
});
const gold = { kind_effective: 'gold', purity: '22K' };
const silver = { kind_effective: 'silver', purity: '999' };
function slip(rate: string, product = gold, unit = 'gms', easy = false) {
  const b = boardOf(wireBoard())!; b.per_gram['gold-22K'] = '100.000'; b.per_gram['silver-999'] = '100.000';
  return rateSlip({ rate, product, unit, board: b, easy });
}
test.each(['800', '1200', '80000', '120000', '8', '12'])('inclusive slip boundary %s', rate => expect(slip(rate)).not.toBeNull());
test.each(['799.999', '1200.001', '79999.999', '120000.001', '7.999', '12.001', '200'])('outside slip bands %s is quiet', rate => expect(slip(rate)).toBeNull());
test('corrections use the typed rate, half-up to three decimals', () => {
  expect(slip('999.995')?.fix).toBe('100.000'); expect(slip('99999.500', silver)?.fix).toBe('100.000');
  expect(slip('9.999')?.fix).toBe('99.990'); expect(slip('10', silver)).toBeNull();
  expect(slip('1000', gold, 'kg')).toBeNull(); expect(slip('1000', gold, 'pcs')).toBeNull();
  expect(slip('1000', gold, 'g')?.text).toBe("That's about 10 times the board's rate for gold 22K (₹100.00 a gram). Rates are per gram, not per 10 grams.");
  expect(slip('100000', silver)?.text).toContain('Rates are per gram, not per kg.');
  expect(slip('10')?.text).toContain('Check the rate is for one gram.');
  expect(slip('1000', gold, 'g', true)?.text).toContain('Rates here are per gram, not per 10 grams.');
});
test('three-place board remains the comparison value; no board or invalid rate gives no check', () => {
  const b = boardOf(wireBoard())!; b.per_gram['gold-22K'] = '100.005';
  expect(rateSlip({ rate: '800.039', product: gold, unit: 'g', board: b })).toBeNull();
  expect(rateSlip({ rate: '800.040', product: gold, unit: 'g', board: b })).not.toBeNull();
  for (const rate of ['', 'NaN', '-1', '0']) expect(rateSlip({ rate, product: gold, unit: 'g', board: b })).toBeNull();
  expect(rateSlip({ rate: '1000', product: gold, unit: 'g', board: null })).toBeNull();
});
test('dated notes never use a future board and name the date that supplied it', () => {
  const b = boardOf(wireBoard())!;
  expect(rateNote(b, 'gold-22K', '2026-10-12', '2026-10-12')).toBe("Today's board: ₹6,512.50 a gram · set 10:05 by Kailash");
  b.on = '2026-09-30'; b.per_gram['gold-22K'] = '6470.000';
  expect(rateNote(b, 'gold-22K', '2026-09-30', '2026-10-12')).toBe('Board on 30 Sep: ₹6,470.00 a gram');
  b.on = '2026-09-27'; expect(rateNote(b, 'gold-22K', '2026-09-30', '2026-10-12')).toBe('Board of 27 Sep: ₹6,470.00 a gram');
  expect(rateNote(b, 'gold-22K', '2026-09-26', '2026-10-12')).toBe('');
});
