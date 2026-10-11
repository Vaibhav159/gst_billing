import { purchaseExport } from './export';
import { writeWorkbook } from '@/core/excel';
import { saveFile } from '@/core/print/files';
import { bytesOf } from '@/pages/sales/print/zip';
import { serve, type Call } from '@/test/server';
vi.mock('@/core/excel', () => ({ writeWorkbook: vi.fn(async () => new Blob(['3D-owned Excel codec test double'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })) }));
vi.mock('@/core/print/files', () => ({ saveFile: vi.fn() }));
const row = (id = 1, overrides: Record<string, unknown> = {}) => ({
  id, business: 3, business_name: 'Kiran', invoice_number: 'UBS/0850', invoice_date: '2026-03-31', fy: '2025-26',
  supplier: { id: 21, name: 'Supplier, =SUM(1)', gst_number: '08AACFU5521R1ZN' },
  taxable: '100.05', cgst: '1.51', sgst: '1.50', igst: '0.00', tax: '3.01', total_amount: '103.06',
  credit: { month: '2026-10', claimed: '3.01', eligible: true, lapsed: false, late: true, state: 'open' },
  lines: [{ id: 10, product_name: '=1+1', hsn_code: '7113', quantity: '1.001', unit: 'gms', rate: '99.950', gst_percent: '3', taxable: '100.05', cgst: '1.51', sgst: '1.50', igst: '0.00', tax: '3.01', amount: '103.06', note: '' }],
  has_files: false, ...overrides,
});
const page = (results: unknown[], count = results.length, next: string | null = null) => ({ count, results, next, previous: null });
const text = async (b: Blob) => new TextDecoder().decode(await bytesOf(b));
async function entries(blob: Blob) {
  const bytes = await bytesOf(blob); const view = new DataView(bytes.buffer); const out = new Map<string, Uint8Array>(); let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true), len = view.getUint16(at + 26, true), extra = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.slice(at + 30, at + 30 + len));
    const start = at + 30 + len + extra; out.set(name, bytes.slice(start, start + size)); at = start + size;
  }
  return out;
}
beforeEach(() => { vi.mocked(saveFile).mockClear(); vi.mocked(writeWorkbook).mockClear(); });
test('CSV reads every filtered page with lines; keeps paise, quantity/rate precision and credit month across FYs', async () => {
  const calls = serve({ 'GET purchases/': (c: Call) => ({ status: 200, data: c.params.page === 1 ? page([row()], 2, '?page=2') : page([row(2)], 2) }) });
  await purchaseExport('csv', { business_id: 3, credit_month: '2026-10' });
  expect(calls.map(c => c.params)).toEqual([1, 2].map(page => ({ business_id: 3, credit_month: '2026-10', page, page_size: 200, include: 'lines', summary: 0 })));
  const [file, name] = vi.mocked(saveFile).mock.calls[0]; expect(name).toMatch(/\.csv$/);
  const csv = await text(file); expect(csv).toContain('Qty,Unit,Rate per unit'); expect(csv).toContain('1.001,gms,99.950'); expect(csv).toContain('100.05,1.51,1.50,0.00,103.06'); expect(csv).toContain('2026-03-31'); expect(csv).toContain('2026-10'); expect(csv).toContain("'=1+1"); expect(csv).toContain('"Supplier, =SUM(1)"');
});
test('Excel delegates month sheets, exact stored numbers and cross-FY credit totals to the 3D shared writer', async () => {
  serve({ 'GET purchases/': page([row(), row(2, { invoice_date: '2026-10-01', credit: { month: '2026-10', claimed: '0.00' } })]) });
  await purchaseExport('xlsx', {});
  expect(writeWorkbook).toHaveBeenCalledTimes(1);
  const sheets = vi.mocked(writeWorkbook).mock.calls[0][0];
  expect(sheets.map(s => s.name)).toEqual(['2026-03', '2026-10', 'Credit by month']);
  expect(sheets[0].rows[0].slice(7, 10)).toEqual(['Qty', 'Unit', 'Rate per unit']);
  expect(sheets[0].rows[1][5]).toBe('=1+1'); // codec must force strings to literal cells; 3D tests that byte boundary
  expect(sheets[0].rows[1].slice(7, 10)).toEqual([{ n: '1.001', format: '0.000' }, 'gms', { n: '99.950', format: '0.000' }]);
  expect(sheets[0].rows[1][11]).toEqual({ n: '100.05', format: '0.00' });
  expect(sheets[0].rows.at(-1)?.[0]).toBe('Totals');
  expect(sheets[0].rows.at(-1)?.[15]).toEqual({ n: '103.06', format: '0.00' });
  expect(sheets[2].rows[1]).toEqual(['2026-10', { n: '2' }, { n: '3.01', format: '0.00' }]);
  const [file] = vi.mocked(saveFile).mock.calls[0];
  expect(file).toBe(await vi.mocked(writeWorkbook).mock.results[0].value);
});
test.each([['csv', 1001], ['xlsx', 1001], ['ca', 301]] as const)('%s refuses an over-limit set before exporting anything', async (kind, count) => {
  const calls = serve({ 'GET purchases/': page([row()], count, '?page=2') });
  await expect(purchaseExport(kind, {})).rejects.toThrow(/Narrow/); expect(calls).toHaveLength(1); expect(saveFile).not.toHaveBeenCalled();
});
test('selected exports contain only selected IDs and refuse a selected bill that disappeared', async () => {
  serve({ 'GET purchases/': page([row(), row(2, { invoice_number: 'ONLY-2' })]) });
  await purchaseExport('csv', {}, [2]); expect(await text(vi.mocked(saveFile).mock.calls[0][0])).toContain('ONLY-2'); expect(await text(vi.mocked(saveFile).mock.calls[0][0])).not.toContain('UBS/0850');
  vi.mocked(saveFile).mockClear(); await expect(purchaseExport('csv', {}, [3])).rejects.toThrow(/changed/); expect(saveFile).not.toHaveBeenCalled();
});
test('CA zip fetches originals once, names colliding unsafe filenames uniquely and includes the register', async () => {
  const calls = serve({ 'GET purchases/': page([row(1, { has_files: true }), row(2, { has_files: true })]),
    'GET purchases/1/': { files: [{ id: 'src', name: '../original.pdf', url: '/api/media/one?s=signed', preview_url: '/api/media/preview' }] },
    'GET purchases/2/': { files: [{ id: 'src', name: '../original.pdf', url: '/api/media/two?s=signed', preview_url: '/api/media/preview' }] },
    'GET /api/media/one?s=signed': new Blob(['original one']), 'GET /api/media/two?s=signed': new Blob(['original two']),
  });
  const onProgress = vi.fn(); await purchaseExport('ca', {}, undefined, { onProgress });
  const zip = await entries(vi.mocked(saveFile).mock.calls[0][0]); const names = [...zip.keys()];
  expect(names.filter(n => n.endsWith('.xlsx'))).toHaveLength(1); expect(names.filter(n => n.endsWith('.pdf'))).toHaveLength(2); expect(names.every(n => !n.includes('..'))).toBe(true); expect(names.some(n => n.includes('Supplier'))).toBe(true);
  expect(calls.filter(c => c.url.includes('preview'))).toHaveLength(0); expect(onProgress).toHaveBeenLastCalledWith({ stage: 'files', done: 2, total: 2 });
});
test('cancel or failed attachment leaves no partial download; progress can stop the next read', async () => {
  const c = new AbortController(); const calls = serve({ 'GET purchases/': page([row(1, { has_files: true }), row(2, { has_files: true })]), 'GET purchases/1/': { files: [] } });
  await expect(purchaseExport('ca', {}, undefined, { signal: c.signal, onProgress: p => { if (p.stage === 'files' && p.done === 1) c.abort(); } })).rejects.toThrow();
  expect(calls.some(r => r.url === 'purchases/2/')).toBe(false); expect(saveFile).not.toHaveBeenCalled();
  serve({ 'GET purchases/': page([row(1, { has_files: true })]), 'GET purchases/1/': { files: [{ name: 'a.pdf', url: '/api/media/no' }] } });
  await expect(purchaseExport('ca', {})).rejects.toThrow(); expect(saveFile).not.toHaveBeenCalled();
});
test('a shared writer failure stops the export; no fallback workbook or attachment read is attempted', async () => {
  const calls = serve({ 'GET purchases/': page([row(1, { has_files: true })]) });
  vi.mocked(writeWorkbook).mockRejectedValueOnce(new Error('Shared Excel writer failed.'));
  await expect(purchaseExport('ca', {})).rejects.toThrow('Shared Excel writer failed.');
  expect(calls).toHaveLength(1); expect(saveFile).not.toHaveBeenCalled();
});
