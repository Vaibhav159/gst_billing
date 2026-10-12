import { describe, expect, it } from 'vitest';
import { makeBatches, matchParty, type ReadyBill } from './workbook';
const line = { product_name: 'Gold', hsn_code: '7108', quantity: '1', rate: '100.125', unit: 'gms', gst_percent: '3', note: '' };
const row: ReadyBill = { key: 'KGH|3', sheet: 'KGH', rows: [3, 4], kind: 'purchase', business: 3, party: { name: 'ABC Bullion', gst_number: '08ABCDE1234F1Z5', state_name: 'RAJASTHAN', city: '', address: '' }, invoice_number: '0001', invoice_date: '2026-03-31', payment_mode: '', lines: [line] };
describe('checked workbook payloads', () => {
  it('groups new parties once, keeps the printed number and exact row references', () => {
    const batches = makeBatches('October.xlsx', [row, { ...row, key: 'KGH|5', rows: [5], invoice_number: '0002' }]);
    expect(batches).toHaveLength(1); expect(batches[0].body.suppliers).toHaveLength(1);
    expect(batches[0].body.bills[0]).toMatchObject({ ref: 'Sheet “KGH” rows 3–4', invoice_number: '0001', itc_eligible: true, itc_month: null, pair: null, lines: [line] });
    expect(batches[0].body.bills[1].supplier).toBe(batches[0].body.bills[0].supplier);
  });
  it('routes sales to their endpoint with paper and a customer; purchases never gain sales keys', () => {
    const result = makeBatches('Oct.csv', [row, { ...row, kind: 'sale', key: 'sale', party: 8 }]);
    expect(result[1].body.bills[0]).toMatchObject({ customer: 8, paper: true });
    expect(result[1].body.bills[0]).not.toHaveProperty('supplier');
    expect(result[0].body.bills[0]).not.toHaveProperty('customer');
  });
  it('GSTIN wins over a similar name; an ambiguous match never picks a party', () => {
    const people = [{ id: 1, name: 'ABC Bullion', gst_number: 'OTHER' }, { id: 2, name: 'ABC Bullion branch', gst_number: row.party && typeof row.party !== 'number' ? row.party.gst_number : '' }];
    expect(matchParty('ABC Bullion', people[1].gst_number, people).exact?.id).toBe(2);
    expect(matchParty('ABC Bullion', '', [...people, { id: 3, name: 'ABC Bullion', gst_number: '' }]).exact).toBeNull();
  });
  it('a conflicting GSTIN never matches automatically; the named party remains an explicit suggestion', () => {
    const person = { id: 21, name: 'ABC Bullion', gst_number: '08ABCDE1234F1Z0' };
    expect(matchParty(person.name, '08ABCDE1234F1Z5', [person])).toEqual({ exact: null, suggestion: person });
    expect(matchParty('Other spelling', ' 08abcde1234f1z0 ', [{ ...person, gst_number: ' 08ABCDE1234F1Z0 ' }]).exact?.id).toBe(21);
  });
  it('similar names are suggestions only', () => {
    const result = matchParty('A. B. C. Bullion', '', [{ id: 3, name: 'ABC Bullion', gst_number: '' }]);
    expect(result.exact).toBeNull(); expect(result.suggestion?.id).toBe(3);
  });
});
