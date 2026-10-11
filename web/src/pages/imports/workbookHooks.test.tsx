import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { testQueryClient } from '@/test/render';
import { serve, type Call } from '@/test/server';
import { groupBills, readSheet, type ParsedBill } from './model';
import { matchParty, useImportParties, useImportRates } from './workbook';
const bill = (key: string, item: string, unit: string): ParsedBill => ({ ...groupBills(readSheet({ name: key, rows: [['Bill No', 'Date', 'Supplier', 'Item', 'Quantity', 'Unit', 'Rate', 'GST Rate'], ['1', '04/10/2026', 'ABC', item, '1', unit, '100', '0']] }), 'purchase')[0], key });
function wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={testQueryClient()}>{children}</QueryClientProvider>; }
test('blank item in one bill neither queries a rate nor leaves other bills checking', async () => {
  const calls = serve({ 'GET purchases/usual-rate/': { rate: '100.000' } });
  const rows = [bill('bad', '', 'GMS'), bill('good', 'Scrap', 'GMS')];
  const { result } = renderHook(() => useImportRates(rows, true, { bad: null, good: 21 }), { wrapper });
  await waitFor(() => expect(result.current.byBill.get('good')?.loading).toBe(false));
  expect(result.current.byBill.get('bad')?.loading).toBe(false);
  expect(calls).toHaveLength(1);
  expect(calls[0].params).toEqual({ product_name: 'Scrap', unit: 'gms', supplier_id: 21 });
});
test('same item from two suppliers has separate normalized queries and per-bill results', async () => {
  const calls = serve({ 'GET purchases/usual-rate/': (c: Call) => ({ status: 200, data: { rate: c.params.supplier_id === 21 ? '100.000' : '500.000' } }) });
  const rows = [bill('first', 'Scrap', 'GMS'), bill('second', 'Scrap', 'gms')];
  const { result } = renderHook(() => useImportRates(rows, true, { first: 21, second: 22 }), { wrapper });
  await waitFor(() => expect(result.current.byBill.get('second')?.rates['Scrap|gms']).toBe('500.000'));
  expect(result.current.byBill.get('first')?.rates['Scrap|gms']).toBe('100.000');
  expect(calls).toHaveLength(2);
});
test('supplier matching must finish before a rate request; errors affect only that bill', async () => {
  const calls = serve({ 'GET purchases/usual-rate/': (c: Call) => ({ status: c.params.supplier_id === 21 ? 503 : 200, data: { rate: '100.000' } }) });
  const rows = [bill('waiting', 'Gold', 'GMS'), bill('failed', 'Scrap', 'GMS'), bill('good', 'Silver', 'GRAM')];
  const { result } = renderHook(() => useImportRates(rows, true, { failed: 21, good: 22 }), { wrapper });
  await waitFor(() => expect(result.current.byBill.get('failed')?.error).toBe(true));
  expect(result.current.byBill.get('good')?.error).toBe(false);
  expect(calls.some((c: Call) => c.params.product_name === 'Gold')).toBe(false);
  expect(calls.find((c: Call) => c.params.product_name === 'Silver')?.params.unit).toBe('g');
});

const foundParty = { id: 21, name: 'ABC Bullion', gst_number: '08ABCDE1234F1Z0', state_name: 'RAJASTHAN' };
const partyBill = (name: string, gstin: string) => ({ ...bill('party', 'Gold', 'gms'), party: name, gstin });
test('an unmatched GSTIN also searches its name and offers the on-file GSTIN only as a suggestion', async () => {
  const calls = serve({ 'GET customers/': (c: Call) => ({ status: 200, data: { count: c.params.search === foundParty.name ? 1 : 0, next: null, results: c.params.search === foundParty.name ? [foundParty] : [] } }) });
  const wrong = '08ABCDE1234F1Z5';
  const { result } = renderHook(() => useImportParties([partyBill(foundParty.name, wrong)], true), { wrapper });
  await waitFor(() => expect(result.current.get(wrong)?.isSuccess).toBe(true));
  expect(calls.map(c => c.params.search)).toEqual([wrong, foundParty.name]);
  expect(calls.every(c => c.params.figures === 0 && c.params.role === undefined)).toBe(true);
  const match = matchParty(foundParty.name, wrong, result.current.get(wrong)!.data!.rows);
  expect(match.exact).toBeNull(); expect(match.suggestion?.gst_number).toBe(foundParty.gst_number);
});
test('a unique exact GSTIN never needs a second name search', async () => {
  const calls = serve({ 'GET customers/': { count: 1, next: null, results: [foundParty] } });
  const { result } = renderHook(() => useImportParties([partyBill('Other spelling', foundParty.gst_number)], true), { wrapper });
  await waitFor(() => expect(result.current.get(foundParty.gst_number)?.isSuccess).toBe(true));
  expect(calls).toHaveLength(1); expect(result.current.get(foundParty.gst_number)?.data?.rows[0].id).toBe(21);
});
test('a missing GSTIN searches the name only and a failed name fallback is never ready', async () => {
  const calls = serve({ 'GET customers/': (c: Call) => ({ status: c.params.search === 'Unavailable name' ? 503 : 200, data: { count: c.params.search === foundParty.name ? 1 : 0, results: c.params.search === foundParty.name ? [foundParty] : [] } }) });
  const { result } = renderHook(() => useImportParties([partyBill(foundParty.name, ''), partyBill('Unavailable name', 'BADGSTIN')], true), { wrapper });
  await waitFor(() => expect(result.current.get('BADGSTIN')?.isError).toBe(true));
  expect(result.current.get(foundParty.name)?.data?.rows[0].id).toBe(21);
  expect(calls.filter(c => c.params.search === foundParty.name)).toHaveLength(1);
  expect(result.current.get('BADGSTIN')?.data).toBeUndefined();
});
test('repeated unmatched GSTINs search each distinct name and deduplicate records by id', async () => {
  const second = { ...foundParty, id: 22, name: 'Branch Two', gst_number: '27ABCDE1234F1Z2' };
  const calls = serve({ 'GET customers/': (c: Call) => ({ status: 200, data: { count: 2, results: c.params.search === 'BADGSTIN' ? [] : c.params.search === second.name ? [foundParty, second] : [foundParty] } }) });
  const rows = [partyBill(foundParty.name, 'BADGSTIN'), partyBill(second.name, 'BADGSTIN'), partyBill(foundParty.name, 'BADGSTIN')];
  const { result } = renderHook(() => useImportParties(rows, true), { wrapper });
  await waitFor(() => expect(result.current.get('BADGSTIN')?.isSuccess).toBe(true));
  expect(calls).toHaveLength(3); expect(result.current.get('BADGSTIN')?.data?.rows.map(row => row.id)).toEqual([21, 22]);
  expect(matchParty(second.name, 'BADGSTIN', result.current.get('BADGSTIN')!.data!.rows).suggestion?.id).toBe(22);
});
test.each([
  { label: 'GSTIN results', firstNext: '/api/customers/?page=2&search=BADGSTIN', nameNext: null, rows: [] },
  { label: 'name results', firstNext: null, nameNext: '/api/customers/?page=2&search=ABC', rows: [foundParty] },
  { label: 'both searches', firstNext: '/api/customers/?page=2&search=BADGSTIN', nameNext: '/api/customers/?page=2&search=ABC', rows: [foundParty] },
])('partial $label preserve the incomplete lookup marker and cannot certify a new or unique party', async ({ firstNext, nameNext, rows }) => {
  serve({ 'GET customers/': (c: Call) => ({ status: 200, data: { count: 101, next: c.params.search === 'BADGSTIN' ? firstNext : nameNext, results: c.params.search === 'BADGSTIN' ? [] : rows } }) });
  const { result } = renderHook(() => useImportParties([partyBill(foundParty.name, 'BADGSTIN')], true), { wrapper });
  await waitFor(() => expect(result.current.get('BADGSTIN')?.isSuccess).toBe(true));
  const page = result.current.get('BADGSTIN')!.data!;
  expect(page.rows.map(row => row.id)).toEqual(rows.map(row => row.id));
  expect(page.next).toBe(firstNext ?? nameNext);
});
