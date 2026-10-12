import { inwardKey, duplicateKey, slabFrom, creditDeadline, lastCreditMonth, rateCheck } from './model';
import { beforeLedgerWords, claimLabel, lateNote, creditWords } from './words';

test.each([['SJ-101', 'SJ/101'], [' ubs/26-27/0850 ', 'UBS-26-27-0850']])('duplicate key folds %s and %s', (a, b) => expect(inwardKey(a)).toBe(inwardKey(b)));
test('digit boundaries, supplier registration, firm and FY belong to the duplicate key', () => {
  expect(inwardKey('12-3')).not.toBe(inwardKey('1-23'));
  const a = { business: 3, supplier: { id: 21, gst_number: '08AACFU5521R1ZN' }, invoice_number: 'UBS/0850', invoice_date: '2026-03-31' };
  expect(duplicateKey(a)).toBe(duplicateKey({ ...a, supplier: { ...a.supplier, id: 99 } }));
  expect(duplicateKey(a)).not.toBe(duplicateKey({ ...a, invoice_date: '2026-04-01' }));
  expect(duplicateKey(a)).not.toBe(duplicateKey({ ...a, business: 2 }));
});
test.each([[3, '3'], ['3%', '3'], [0.03, '3'], ['0.25%', '0.25'], [0.0025, '0.25'], [1, '1'], ['0', '0'], ['2.5%', null], ['', null], [null, null]])('slab %s has the exact contract percent %s', (raw, expected) => expect(slabFrom(raw)).toBe(expected));
test('credit deadline observes the IST financial year and October cutoff', () => {
  expect(creditDeadline('2026-03-31')).toBe('2026-11-30');
  expect(lastCreditMonth('2026-04-01')).toBe('2027-10');
  expect(creditDeadline('2025-03-31')).toBe('2025-11-30');
});
test('before-ledger wording leaves opening credit and lapse undecided', () => {
  expect(beforeLedgerWords).toBe('This bill is before April 2025. Its credit is in the opening balance or lapsed.');
});
test('late wording follows returned options and never silently disables eligibility', () => {
  const option = { month: '2026-09', due: '2026-10-20', running: false, in_time: true };
  expect(claimLabel(option, '2026-10-08')).toBe('September 2026 (not filed yet, 3B due 20 Oct)');
  expect(lateNote('2026-08', option, '2026-10-08')).toBe('August 2026 is filed, so its credit goes in a later return: September 2026 (not filed yet, 3B due 20 Oct).');
  expect(creditWords({ eligible: false })).toBe("Off: for purchases the business can't claim, like things for personal use. The bill still counts in purchases.");
});
test('rate warning flags x5 and one fifth and offers an exact decimal correction for per-ten', () => {
  const usual = { rate: '6878.000', from: 'them' as const, last: null };
  expect(rateCheck({ rate: '6878.001', unit: 'gms', name: 'Gold', usual })).toBeNull();
  expect(rateCheck({ rate: '68780.123', unit: 'gms', name: 'Gold', usual })?.fix?.rate).toBe('6878.012');
  expect(rateCheck({ rate: '68780.123', unit: 'gms', name: 'Gold', usual })?.fix?.label).toBe('Use ₹6,878.012/gms');
  expect(rateCheck({ rate: '68780.123', unit: 'gms', name: 'Gold', usual })?.text).toMatch(/^₹68,780\.123\/gms is about 10 times .*\(₹6,878\.00\/gms\)/);
  expect(rateCheck({ rate: '1375.600', unit: 'gms', name: 'Gold', usual })?.text).toContain('1/5 of what you usually pay them');
});
