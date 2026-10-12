import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { serve } from '@/test/server';
import { testQueryClient } from '@/test/render';
import { batchRequest, useBatchImport, useReadBill, type ImportBody } from './batch';
const body: ImportBody = { file_name: 'Oct.csv', dry_run: true, suppliers: [], bills: [{ ref: 'Sheet “Oct” row 2', business: 3, supplier: 21, invoice_number: '001', invoice_date: '2026-10-04', payment_mode: '', itc_eligible: true, itc_month: null, lines: [{ product_name: 'Gold', hsn_code: '7108', quantity: '1', rate: '100', unit: 'gms', gst_percent: '3', note: '' }] }] };
const answer = { dry_run: true, ok: true, bills: [{ ref: body.bills[0].ref, ok: true, id: null, problems: [], duplicate: null, credit: null }], suppliers: [], totals: { bills: 1, total_amount: '103.00', credit: '3.00' } };
const wrap = () => { const client = testQueryClient(); return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }; };
describe('batch imports', () => {
  it('uses the atomic endpoint and preserves decimal strings and row references', async () => {
    const calls = serve({ 'POST purchases/import/': answer });
    expect(await batchRequest('purchases', body)).toEqual(answer);
    expect(calls[0].data).toEqual(body);
  });
  it('returns per-bill problems from an HTTP 200 refusal', async () => {
    const refused = { ...answer, ok: false, bills: [{ ...answer.bills[0], ok: false, problems: [{ field: 'itc_month', detail: 'Choose an open month.' }] }] };
    serve({ 'POST purchases/import/': refused });
    expect((await batchRequest('purchases', body)).bills[0].problems[0].detail).toBe('Choose an open month.');
  });
  it('allows exactly 300 bills and refuses 301 without a request', async () => {
    const calls = serve({ 'POST purchases/import/': answer });
    await batchRequest('purchases', { ...body, bills: Array.from({ length: 300 }, (_, n) => ({ ...body.bills[0], ref: String(n) })) });
    await expect(batchRequest('purchases', { ...body, bills: Array.from({ length: 301 }, (_, n) => ({ ...body.bills[0], ref: String(n) })) })).rejects.toThrow('An import can hold at most 300 bills. Split the file.');
    expect(calls).toHaveLength(1);
  });
  it('refuses an empty selection and more than 100 new parties', async () => {
    const calls = serve({});
    await expect(batchRequest('purchases', { ...body, bills: [] })).rejects.toThrow('There are no bills to import.');
    await expect(batchRequest('purchases', { ...body, suppliers: Array.from({ length: 101 }, (_, n) => ({ ref: String(n), name: String(n), gst_number: '', state_name: '', city: '', address: '' })) })).rejects.toThrow('100');
    await expect(batchRequest('sales', { ...body, suppliers: [], customers: Array.from({ length: 101 }, (_, n) => ({ ref: String(n), name: String(n), gst_number: '', state_name: '', city: '', address: '' })) })).rejects.toThrow('100');
    expect(calls).toHaveLength(0);
  });
  it('invalidates figures only after an actual successful import', async () => {
    let saved = false;
    serve({ 'POST purchases/import/': () => ({ status: 200, data: { ...answer, dry_run: !saved } }) });
    const { client, wrapper } = wrap();
    for (const key of ['suppliers', 'purchases', 'sales', 'customers', 'dashboard', 'due-next']) client.setQueryData([key], []);
    const h = renderHook(() => useBatchImport('purchases'), { wrapper });
    await act(async () => { await h.result.current.mutateAsync(body); });
    for (const key of ['suppliers', 'purchases', 'sales', 'customers', 'dashboard', 'due-next']) expect(client.getQueryState([key])?.isInvalidated).toBe(false);
    saved = true;
    await act(async () => { await h.result.current.mutateAsync({ ...body, dry_run: false }); });
    for (const key of ['suppliers', 'purchases', 'sales', 'customers', 'dashboard', 'due-next']) expect(client.getQueryState([key])?.isInvalidated).toBe(true);
  });
  it('does not retry a lost answer or queue an offline save', async () => {
    const calls = serve({ 'POST purchases/import/': () => ({ status: 0 }) });
    const h = renderHook(() => useBatchImport('purchases'), { wrapper: wrap().wrapper });
    await act(async () => { await expect(h.result.current.mutateAsync({ ...body, dry_run: false })).rejects.toBeDefined(); });
    await waitFor(() => expect(h.result.current.isError).toBe(true));
    expect(calls).toHaveLength(1);
  });
  it('reads multipart files with kind photos and refreshes the information-only count', async () => {
    const calls = serve({ 'POST purchases/read/': { source: 'photo', notes: [] } });
    const { client, wrapper } = wrap(); client.setQueryData(['ai-reads'], {});
    const h = renderHook(() => useReadBill(), { wrapper });
    const data = new FormData(); data.append('files', new File(['synthetic'], 'bill.jpg', { type: 'image/jpeg' })); data.append('kind', 'photos');
    await act(async () => { await h.result.current.mutateAsync(data); });
    expect((calls[0].data as FormData).get('kind')).toBe('photos');
    expect(client.getQueryState(['ai-reads'])?.isInvalidated).toBe(true);
  });
  it('refuses a 24 MiB file group once multipart overhead is counted, before HTTP', async () => {
    const calls = serve({ 'POST purchases/read/': { source: 'pdf', notes: [] } });
    const h = renderHook(() => useReadBill(), { wrapper: wrap().wrapper });
    const data = new FormData();
    data.append('files', new File([new Uint8Array(12 * 1024 * 1024)], 'front.pdf', { type: 'application/pdf' }));
    data.append('files', new File([new Uint8Array(12 * 1024 * 1024)], 'back.pdf', { type: 'application/pdf' }));
    data.append('kind', 'photos'); data.append('business_id', '3');
    await act(async () => { await expect(h.result.current.mutateAsync(data)).rejects.toThrow('These pages come to 24.1 MB. One bill can send at most 24 MB; take fewer or smaller pages.'); });
    expect(calls).toHaveLength(0);
  });
  it('sends a prepared group with headroom and retains all its metadata', async () => {
    const reply = { source: 'pdf', notes: [] };
    const calls = serve({ 'POST purchases/read/': reply });
    const h = renderHook(() => useReadBill(), { wrapper: wrap().wrapper });
    const data = new FormData();
    data.append('files', new File([new Uint8Array(12 * 1024 * 1024)], 'front.pdf', { type: 'application/pdf' }));
    data.append('files', new File([new Uint8Array(12 * 1024 * 1024 - 16 * 1024)], 'back.pdf', { type: 'application/pdf' }));
    data.append('kind', 'photos'); data.append('business_id', '3');
    await act(async () => { await expect(h.result.current.mutateAsync(data)).resolves.toEqual(reply); });
    expect(calls).toHaveLength(1);
    const sent = calls[0].data as FormData;
    expect((sent.getAll('files') as File[]).map(file => file.name)).toEqual(['front.pdf', 'back.pdf']);
    expect(sent.get('kind')).toBe('photos'); expect(sent.get('business_id')).toBe('3');
  });
});
