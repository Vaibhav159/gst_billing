import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { serve } from '@/test/server';
import { testQueryClient } from '@/test/render';
import { useImportSession, type ImportBatch } from './session';
const batch = (kind: 'purchases' | 'sales'): ImportBatch => ({ kind, body: { file_name: 'Oct.csv', dry_run: true, bills: [{ ref: kind, business: 3, invoice_number: '1', invoice_date: '2026-10-04', payment_mode: '', supplier: 21, lines: [] }] } });
const answer = (kind: string, dry_run: boolean, ok = true) => ({ dry_run, ok, bills: [{ ref: kind, ok, id: dry_run ? null : 9, problems: ok ? [] : [{ field: 'invoice_number', detail: 'This bill is already in the app.' }], duplicate: null, credit: null }], totals: { bills: 1, total_amount: '103.00', credit: '3.00' } });
function setup() { const client = testQueryClient(); return renderHook(() => useImportSession(), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }); }
describe('import review snapshot', () => {
  it('checks every kind before any writes and saves the exact checked selection', async () => {
    const calls = serve(Object.fromEntries(['purchases', 'sales'].map(k => [`POST ${k}/import/`, (c: { data: unknown }) => ({ status: 200, data: answer(k, (c.data as { dry_run: boolean }).dry_run) })])));
    const h = setup(); const batches = [batch('purchases'), batch('sales')];
    await act(async () => { expect(await h.result.current.check(batches)).toBe(true); batches[0].body.bills[0].invoice_number = 'changed'; await h.result.current.importChecked(); });
    expect(calls.map(c => [c.url, (c.data as { dry_run: boolean }).dry_run])).toEqual([['purchases/import/', true], ['sales/import/', true], ['purchases/import/', false], ['sales/import/', false]]);
    expect((calls[2].data as ImportBatch['body']).bills[0].invoice_number).toBe('1');
    expect(h.result.current.reports).toHaveLength(2);
  });
  it('a refused dry run permits no writes', async () => {
    const calls = serve({ 'POST purchases/import/': answer('purchases', true, false) }); const h = setup();
    await act(async () => { expect(await h.result.current.check([batch('purchases')])).toBe(false); await h.result.current.importChecked(); });
    expect(calls).toHaveLength(1); expect(h.result.current.checked).toBeNull();
  });
  it('records partial success without offering to save the successful slice again', async () => {
    const calls = serve({ 'POST purchases/import/': (c: { data: unknown }) => ({ status: 200, data: answer('purchases', (c.data as { dry_run: boolean }).dry_run) }), 'POST sales/import/': (c: { data: unknown }) => (c.data as { dry_run: boolean }).dry_run ? { status: 200, data: answer('sales', true) } : { status: 400, data: { invoice_number: ['The number is taken.'] } } });
    const h = setup();
    await act(async () => { await h.result.current.check([batch('purchases'), batch('sales')]); await h.result.current.importChecked(); });
    expect(h.result.current.reports.map(r => r.kind)).toEqual(['purchases']);
    expect(h.result.current.checked).toBeNull();
    expect(h.result.current.error).toContain('The number is taken.');
    await act(async () => { await h.result.current.importChecked(); });
    expect(calls).toHaveLength(4);
  });
  it('clearing the review invalidates permission to save', async () => {
    const calls = serve({ 'POST purchases/import/': answer('purchases', true) }); const h = setup();
    await act(async () => { await h.result.current.check([batch('purchases')]); h.result.current.reset(); await h.result.current.importChecked(); });
    expect(calls).toHaveLength(1);
  });
  it('a lost answer is uncertain, not a false claim that nothing was imported', async () => {
    serve({ 'POST purchases/import/': (c: { data: unknown }) => (c.data as { dry_run: boolean }).dry_run ? { status: 200, data: answer('purchases', true) } : { status: 0 } }); const h = setup();
    await act(async () => { await h.result.current.check([batch('purchases')]); await h.result.current.importChecked(); });
    expect(h.result.current.error).toContain('Check Purchases before importing again');
    expect(h.result.current.checked).toBeNull();
  });
});
