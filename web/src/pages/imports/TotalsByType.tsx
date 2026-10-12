import { hasGstin } from '@/core/ids';
import { segmentOf } from '@/core/sales/pos';
import type { BillFigures } from '@/core/sales/maths';
import { Table, Th, Td, Tr, Money, cn } from '@/core/ui';
export type ImportTotalRow = { kind: 'sale' | 'purchase'; gstin: string; totals: BillFigures; /** Server-confirmed credit in paise; absent until dry-run. */ credit?: number };
const KINDS = [
  { k: 'b2b', label: 'Sales to a GSTIN (B2B)' },
  { k: 'b2c', label: 'Sales without a GSTIN (B2C)' },
  { k: 'itc', label: 'Purchases with credit' },
  { k: 'noitc', label: 'Purchases without credit' },
] as const;
function kindOf(row: ImportTotalRow) {
  if (row.kind === 'sale') return segmentOf(row.gstin, row.totals.igst > 0, row.totals.total) === 'b2b' ? 'b2b' : 'b2c';
  return (row.credit === undefined ? hasGstin(row.gstin) && row.totals.tax > 0 : row.credit > 0) ? 'itc' : 'noitc';
}
function sum(rows: ImportTotalRow[]) {
  return rows.reduce((t, row) => ({ taxable: t.taxable + row.totals.taxable, cgst: t.cgst + row.totals.cgst, sgst: t.sgst + row.totals.sgst, igst: t.igst + row.totals.igst, total: t.total + row.totals.total, credit: t.credit + (row.credit ?? 0) }), { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0, credit: 0 });
}
/** Port of Import.jsx TotalsByType: selected rows only; sums preserve each server-style line rounding. */
export function TotalsByType({ rows }: { rows: ImportTotalRow[] }) {
  const rowsBy = KINDS.map(k => { const list = rows.filter(row => kindOf(row) === k.k); return { ...k, n: list.length, t: sum(list), pendingCredit: list.some(row => row.credit === undefined) }; });
  const all = sum(rows);
  return <Table label="Ticked bills by tax type" className="border border-rule rounded-ctl">
    <thead><tr><Th>Tax type</Th><Th align="right">Bills</Th><Th align="right">Taxable</Th><Th align="right">CGST</Th><Th align="right">SGST</Th><Th align="right">IGST</Th><Th align="right">Total</Th></tr></thead>
    <tbody>{rowsBy.map(r => <Tr key={r.k} className={cn(!r.n && 'text-muted')}>
      <Td className="font-medium">{r.label}{r.k === 'itc' && r.n ? <span className="block text-xs text-sale font-normal">{r.pendingCredit ? 'ITC checked before import' : <>ITC <Money value={r.t.credit} /></>}</span> : null}</Td>
      <Td align="right">{r.n}</Td>
      <Td align="right"><Money value={r.t.taxable} bump /></Td><Td align="right"><Money value={r.t.cgst} bump /></Td><Td align="right"><Money value={r.t.sgst} bump /></Td><Td align="right"><Money value={r.t.igst} bump /></Td>
      <Td align="right"><Money value={r.t.total} strong bump /></Td>
    </Tr>)}
      <Tr className="bg-raised/40"><Td className="font-semibold">All ticked</Td><Td align="right" className="font-semibold">{rows.length}</Td><Td align="right"><Money value={all.taxable} bump /></Td><Td align="right"><Money value={all.cgst} bump /></Td><Td align="right"><Money value={all.sgst} bump /></Td><Td align="right"><Money value={all.igst} bump /></Td><Td align="right"><Money value={all.total} strong bump /></Td></Tr>
    </tbody>
  </Table>;
}
