import { api } from '@/core/api/client';
import { paiseToDecimal } from '@/core/format';
import { saveFile } from '@/core/print/files';
import { zipFiles } from '@/core/files/zip';
import type { PurchaseFile, PurchaseRow } from '@/core/purchases/types';
import type { ExcelCell, ExcelSheet } from '@/core/excel';
import { toPurchasePage } from '@/core/purchases/wire';

type Cell = ExcelCell;
type Progress = { stage: 'bills' | 'files'; done: number; total: number };
type Options = { signal?: AbortSignal; onProgress?: (progress: Progress) => void };
const money = (paise: number): Cell => ({ n: paiseToDecimal(paise), format: '0.00' });
const headings = ['Firm', 'Supplier', 'GSTIN', 'Bill number', 'Bill date', 'Item', 'HSN code', 'Qty', 'Unit', 'Rate per unit', 'GST rate', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total', 'Credit month', 'Input tax credit'];
const check = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError'); };
const value = (cell: Cell) => typeof cell === 'string' ? cell : cell.n;
const safeName = (name: string) => name.replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').replace(/\.\.+/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 100) || 'bill';
function register(rows: PurchaseRow[]): Cell[][] {
  return [headings, ...rows.flatMap(b => (b.lines?.length ? b.lines : [null]).map((line, i) => [
    b.business_name, b.supplier.name, b.supplier.gst_number, b.invoice_number, b.invoice_date,
    line?.product_name ?? '', line?.hsn_code ?? '', line ? { n: line.quantity, format: '0.000' } : '', line?.unit ?? '', line ? { n: line.rate, format: '0.000' } : '', line ? { n: line.gst_percent } : '',
    money(line?.taxable ?? b.taxable), money(line?.cgst ?? b.cgst), money(line?.sgst ?? b.sgst), money(line?.igst ?? b.igst), money(line?.amount ?? b.total_amount),
    b.credit.month, i === 0 ? money(b.credit.claimed) : '',
  ]))];
}
const csvCell = (cell: Cell) => {
  // A CSV reader must never evaluate text supplied as a bill number, item or supplier as a formula.
  const raw = value(cell), text = typeof cell === 'string' && /^[\s]*[=+@\-]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
/** Purchase data projection only; 3D Task 1 owns workbook encoding. */
async function workbook(bills: PurchaseRow[]): Promise<Blob> {
  const months = [...new Set(bills.map(b => b.invoice_date.slice(0, 7)))].sort();
  const sheets: ExcelSheet[] = months.map(month => {
    const rows = bills.filter(b => b.invoice_date.startsWith(month));
    const sum = (key: 'taxable' | 'cgst' | 'sgst' | 'igst' | 'total_amount') => money(rows.reduce((total, b) => total + b[key], 0));
    return { name: month, rows: [...register(rows), ['Totals', '', '', '', '', '', '', '', '', '', '', sum('taxable'), sum('cgst'), sum('sgst'), sum('igst'), sum('total_amount'), '', money(rows.reduce((total, b) => total + b.credit.claimed, 0))]] };
  });
  sheets.push({ name: 'Credit by month', rows: [['Credit month', 'Bills', 'Input tax credit'], ...[...new Set(bills.map(b => b.credit.month))].sort().map(month => {
    const rows = bills.filter(b => b.credit.month === month); return [month, { n: String(rows.length) }, money(rows.reduce((total, b) => total + b.credit.claimed, 0))];
  })] });
  const { writeWorkbook } = await import('@/core/excel');
  return writeWorkbook(sheets);
}
/** Export the list's wire params, optionally only its selected IDs. Cancel/failure never downloads a partial file. */
export async function purchaseExport(kind: 'csv' | 'xlsx' | 'ca', params: Record<string, unknown>, ids?: number[], { signal, onProgress }: Options = {}): Promise<void> {
  const cap = kind === 'ca' ? 300 : 1000, selected = ids ? new Set(ids) : null;
  const tooMany = () => new Error(`Narrow the list to ${cap.toLocaleString('en-IN')} bills or fewer, then export again.`);
  if (selected && selected.size > cap) throw tooMany();
  if (selected?.size === 0) throw new Error('Select at least one purchase to export.');
  const { facets: _facets, ...filters } = params;
  const bills: PurchaseRow[] = []; let page = 1; let scanned = 0;
  while (true) {
    check(signal);
    const list = toPurchasePage((await api.get('purchases/', { params: { ...filters, include: 'lines', summary: 0, page, page_size: 200 }, signal })).data);
    if (!selected && list.count > cap) throw tooMany();
    scanned += list.results.length;
    for (const bill of list.results) if ((!selected || selected.has(bill.id)) && !bills.some(b => b.id === bill.id)) bills.push(bill);
    if (bills.length > cap) throw tooMany();
    onProgress?.({ stage: 'bills', done: scanned, total: list.count });
    if (!list.next || selected && bills.length === selected.size) break;
    if (!list.results.length) throw new Error('The purchase list changed. Refresh it and export again.');
    page += 1;
  }
  if (selected && bills.length !== selected.size) throw new Error('The selected purchases changed. Refresh the list and select them again.');
  if (!bills.length) throw new Error('There are no purchases to export.');
  if (bills.some(b => !b.lines)) throw new Error('The purchase items could not be read. Try exporting again.');
  check(signal);
  const base = `Purchases_${safeName(String(params.credit_month ?? params.month ?? params.fy ?? 'all'))}${params.business_id ? `_firm-${params.business_id}` : ''}`;
  let blob: Blob;
  if (kind === 'csv') blob = new Blob(['\ufeff', register(bills).map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  else {
    blob = await workbook(bills);
    if (kind === 'ca') {
      const excel = blob;
      async function* files() {
        yield { name: `${base}.xlsx`, blob: excel };
        for (const [i, bill] of bills.entries()) {
          check(signal);
          if (bill.has_files) {
            const detail = (await api.get(`purchases/${bill.id}/`, { signal })).data as { files: PurchaseFile[] };
            for (const [n, file] of detail.files.entries()) {
              check(signal);
              // A signed original on this app only: never send the app's authorization to an external host.
              if (!file.url.startsWith('/api/media/')) throw new Error('A bill file could not be read. Open the purchase and try again.');
              const original = (await api.get<Blob>(file.url, { responseType: 'blob', signal })).data;
              yield { name: `${safeName(bill.supplier.name)}_${safeName(bill.invoice_number)}_${bill.id}_${n + 1}_${safeName(file.name)}`, blob: original };
            }
          }
          onProgress?.({ stage: 'files', done: i + 1, total: bills.length });
        }
      }
      blob = await zipFiles(files());
    }
  }
  check(signal);
  saveFile(blob, kind === 'ca' ? `${base}_for-CA.zip` : `${base}.${kind}`);
}
