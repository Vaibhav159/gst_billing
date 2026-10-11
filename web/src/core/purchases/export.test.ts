import { waitFor } from '@testing-library/react';
import { purchaseExport } from './export';
import { excelBlob } from '@/core/excel/writer';
import { saveFile } from '@/core/print/files';
import { bytesOf } from '@/core/files/zip';
import { serve, type Call } from '@/test/server';
vi.mock('@/core/excel/writer', () => ({ excelBlob: vi.fn(async () => new Blob(['3D-owned Excel codec test double'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })) }));
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
beforeEach(() => { vi.mocked(saveFile).mockClear(); vi.mocked(excelBlob).mockClear(); });
test('CSV reads every filtered page with lines; keeps paise, quantity/rate precision and credit month across FYs', async () => {
  const calls = serve({ 'GET purchases/': (c: Call) => ({ status: 200, data: c.params.page === 1 ? page([row()], 2, '?page=2') : page([row(2)], 2) }) });
  await purchaseExport('csv', { business_id: 3, credit_month: '2026-10' });
  expect(calls.filter(c => c.method === 'GET').map(c => c.params)).toEqual([1, 2].map(page => ({ business_id: 3, credit_month: '2026-10', page, page_size: 200, include: 'lines', summary: 0 })));
  const [file, name] = vi.mocked(saveFile).mock.calls[0]; expect(name).toMatch(/\.csv$/);
  const csv = await text(file); expect(csv).toContain('Qty,Unit,Rate per unit'); expect(csv).toContain('1.001,gms,99.950'); expect(csv).toContain('100.05,1.51,1.50,0.00,103.06'); expect(csv).toContain('2026-03-31'); expect(csv).toContain('2026-10'); expect(csv).toContain("'=1+1"); expect(csv).toContain('"Supplier, =SUM(1)"');
});
test('Excel delegates month sheets, exact stored numbers and cross-FY credit totals to the 3D shared writer', async () => {
  serve({ 'GET purchases/': page([row(), row(2, { invoice_date: '2026-10-01', credit: { month: '2026-10', claimed: '0.00' } })]) });
  await purchaseExport('xlsx', {});
  expect(excelBlob).toHaveBeenCalledTimes(1);
  const sheets = vi.mocked(excelBlob).mock.calls[0][0];
  expect(sheets.map(s => s.name)).toEqual(['2026-03', '2026-10', 'Credit by month']);
  expect(sheets[0].cols).toHaveLength(18);
  expect(sheets[0].rows[0].kind).toBe('head');
  expect(sheets[0].rows[0].cells.slice(7, 10)).toEqual([{ v: 'Qty' }, { v: 'Unit' }, { v: 'Rate per unit' }]);
  expect(sheets[0].rows[1].kind).toBe('data');
  expect(sheets[0].rows[1].cells[5]).toEqual({ v: '=1+1' }); // shared codec owns safe literal bytes
  expect(sheets[0].rows[1].cells.slice(7, 10)).toEqual([{ v: '1.001', num: true }, { v: 'gms' }, { v: '99.950', num: true }]);
  expect(sheets[0].rows[1].cells[11]).toEqual({ v: '100.05', num: true });
  expect(sheets[0].rows.at(-1)?.kind).toBe('total');
  expect(sheets[0].rows.at(-1)?.cells[0]).toEqual({ v: 'Totals' });
  expect(sheets[0].rows.at(-1)?.cells[15]).toEqual({ v: '103.06', num: true });
  expect(sheets[2].rows[1]).toEqual({ kind: 'data', cells: [{ v: '2026-10' }, { v: '2', num: true }, { v: '3.01', num: true }] });
  const [file] = vi.mocked(saveFile).mock.calls[0];
  expect(file).toBe(await vi.mocked(excelBlob).mock.results[0].value);
});
test.each([['csv', 1001], ['xlsx', 1001], ['ca', 301]] as const)('%s refuses an over-limit set before exporting anything', async (kind, count) => {
  const calls = serve({ 'GET purchases/': page([row()], count, '?page=2') });
  await expect(purchaseExport(kind, {})).rejects.toThrow(/Narrow/); expect(calls).toHaveLength(1); expect(saveFile).not.toHaveBeenCalled(); expect(calls.some(c => c.url === 'audit-logs/log/')).toBe(false);
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
  expect(calls.some(r => r.url === 'purchases/2/')).toBe(false); expect(saveFile).not.toHaveBeenCalled(); expect(calls.some(r => r.url === 'audit-logs/log/')).toBe(false);
  const failed = serve({ 'GET purchases/': page([row(1, { has_files: true })]), 'GET purchases/1/': { files: [{ name: 'a.pdf', url: '/api/media/no' }] } });
  await expect(purchaseExport('ca', {})).rejects.toThrow(); expect(saveFile).not.toHaveBeenCalled(); expect(failed.some(r => r.url === 'audit-logs/log/')).toBe(false);
});
test('a shared writer failure stops the export; no fallback workbook or attachment read is attempted', async () => {
  const calls = serve({ 'GET purchases/': page([row(1, { has_files: true })]) });
  vi.mocked(excelBlob).mockRejectedValueOnce(new Error('Shared Excel writer failed.'));
  await expect(purchaseExport('ca', {})).rejects.toThrow('Shared Excel writer failed.');
  expect(calls).toHaveLength(1); expect(saveFile).not.toHaveBeenCalled();
});

test('pre-ledger purchases stay in CSV and bill-date sheets with blank credit month, outside the credit summary', async () => {
  serve({ 'GET purchases/': page([row(1, { invoice_date: '2024-03-31', credit: { month: null, claimed: '0.00', eligible: true, state: 'outside' } })]) });
  await purchaseExport('csv', {});
  expect(await text(vi.mocked(saveFile).mock.calls[0][0])).toContain('2024-03-31');
  expect(await text(vi.mocked(saveFile).mock.calls[0][0])).toContain('103.06,,0.00');
  await purchaseExport('xlsx', {});
  const sheets = vi.mocked(excelBlob).mock.calls[0][0];
  expect(sheets.map(s => s.name)).toEqual(['2024-03', 'Credit by month']);
  expect(sheets[0].rows[1].cells[16]).toEqual({ v: '' });
  expect(sheets[0].rows[1].cells[17]).toEqual({ v: '0.00', num: true });
  expect(sheets[1].rows).toEqual([{ kind: 'head', cells: [{ v: 'Credit month' }, { v: 'Bills' }, { v: 'Input tax credit' }] }]);
});
test('month totals sum paise-rounded historical lines, including the 0.025 + 0.025 boundary', async () => {
  const line = { ...row().lines[0], taxable: '0.025', cgst: '0', sgst: '0', igst: '0', amount: '0.025' };
  serve({ 'GET purchases/': page([row(1, { taxable: '0.05', total_amount: '0.05', cgst: '0', sgst: '0', igst: '0', lines: [line, { ...line, id: 11 }] })]) });
  await purchaseExport('xlsx', {});
  const sheet = vi.mocked(excelBlob).mock.calls[0][0][0];
  expect(sheet.rows[1].cells[11]).toEqual({ v: '0.03', num: true });
  expect(sheet.rows[2].cells[11]).toEqual({ v: '0.03', num: true });
  expect(sheet.rows.at(-1)?.cells[11]).toEqual({ v: '0.06', num: true });
  expect(sheet.rows.at(-1)?.cells[15]).toEqual({ v: '0.06', num: true });
});

test.each([
  ['csv', 'CSV', 'Purchases_2026-10_firm-3.csv'],
  ['xlsx', 'Excel', 'Purchases_2026-10_firm-3.xlsx'],
  ['ca', 'For the CA', 'Purchases_2026-10_firm-3_for-CA.zip'],
] as const)('%s records one invoice audit after download, for the bill actually selected', async (kind, label, filename) => {
  let downloadedBeforeAudit = false;
  const calls = serve({
    'GET purchases/': page([row(1, { invoice_number: 'UNSELECTED' }), row(2, { invoice_number: 'SELECTED-2' })]),
    'POST audit-logs/log/': () => { downloadedBeforeAudit = vi.mocked(saveFile).mock.calls.length === 1; return { status: 200, data: { status: 'logged' } }; },
  });
  await purchaseExport(kind, { business_id: 3, credit_month: '2026-10' }, [2, 2]);
  await waitFor(() => expect(calls.filter(c => c.url === 'audit-logs/log/')).toHaveLength(1));
  expect(calls.at(-1)).toMatchObject({ method: 'POST', url: 'audit-logs/log/', data: {
    action: 'exported', entity: 'invoice', entity_id: 2, entity_name: '#SELECTED-2 - Supplier, =SUM(1)',
    details: `${label} downloaded: ${filename} · Kiran / Supplier, =SUM(1) / #SELECTED-2 (ID 2)`,
  } });
  expect(downloadedBeforeAudit).toBe(true);
  expect(vi.mocked(saveFile).mock.calls[0][1]).toBe(filename);
});
test('a selected batch records one audit containing every actual exported ID and number across pages', async () => {
  const calls = serve({
    'GET purchases/': (c: Call) => ({ status: 200, data: c.params.page === 1 ? page([row(1, { invoice_number: 'UNSELECTED' }), row(2, { invoice_number: 'BILL-2' })], 3, '?page=2') : page([row(3, { business: 4, business_name: 'Meera', invoice_number: 'BILL-3' })], 3) }),
    'POST audit-logs/log/': { status: 'logged' },
  });
  await purchaseExport('csv', { fy: '2026-27' }, [3, 2, 3]);
  await waitFor(() => expect(calls.filter(c => c.url === 'audit-logs/log/')).toHaveLength(1));
  expect(calls.at(-1)?.data).toEqual({ action: 'exported', entity: 'invoice', entity_id: 0, entity_name: 'Purchases CSV (2 bills)',
    details: 'CSV downloaded: Purchases_2026-27.csv · Kiran / Supplier, =SUM(1) / #BILL-2 (ID 2); Meera / Supplier, =SUM(1) / #BILL-3 (ID 3)',
  });
});
test.each([0, 500])('audit status %i cannot reject or repeat a completed download', async status => {
  const calls = serve({ 'GET purchases/': page([row()]), 'POST audit-logs/log/': () => ({ status, data: {} }) });
  await expect(purchaseExport('csv', {})).resolves.toBeUndefined();
  await waitFor(() => expect(calls.filter(c => c.url === 'audit-logs/log/')).toHaveLength(1));
  expect(saveFile).toHaveBeenCalledOnce();
});
test('a download that throws produces no exported audit row', async () => {
  const calls = serve({ 'GET purchases/': page([row()]), 'POST audit-logs/log/': { status: 'logged' } });
  vi.mocked(saveFile).mockImplementationOnce(() => { throw new Error('Download failed.'); });
  await expect(purchaseExport('csv', {})).rejects.toThrow('Download failed.');
  expect(calls.some(c => c.url === 'audit-logs/log/')).toBe(false);
});
