import { expect, test } from 'vitest';
import { readGst } from './wire';
import type { Gstr1, Month } from './types';
test('parses nested and signed money once while preserving counts, quantities and GST slabs', () => {
  const m = readGst<Month>({ business: 3, gstr3b: { cash: { igst: '0.00', cgst: '41106.84', sgst: '41106.84', total: '82213.68' } }, since_filing: { taxable_diff: '-0.01' } });
  expect(m.gstr3b?.cash).toEqual({ igst: 0, cgst: 4110684, sgst: 4110684, total: 8221368 });
  expect(m.since_filing?.taxable_diff).toBe(-1);
  const sections = readGst<Gstr1>({ docs: [{ total: 18, cancelled: 1, net: 17 }], hsn: { b2c: [{ rate: '0.25', quantity: '6.400', taxable: '360960.00', cgst: '451.20', sgst: '451.20' }] } });
  expect(sections.docs[0].total).toBe(18);
  expect(sections.hsn.b2c[0]).toEqual({ rate: '0.25', quantity: '6.400', taxable: 36096000, cgst: 45120, sgst: 45120 });
});
test('keeps unknown paid heads and missing future figures as null; refuses malformed amounts', () => {
  expect(readGst({ cash: { igst: null, total: '0.00' }, gstr1: null })).toEqual({ cash: { igst: null, total: 0 }, gstr1: null });
  expect(() => readGst({ taxable: 'not money' })).toThrow('The return contains an amount the app cannot read.');
});
