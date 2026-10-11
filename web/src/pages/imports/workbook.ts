import { useQueries } from '@tanstack/react-query';
import { api } from '@/core/api/client';
import { toCustomerPage } from '@/core/api/customers';
import type { PaymentMode } from '@/core/sales/types';
import type { ImportBill, ImportLine, ImportParty } from './batch';
import type { ImportBatch } from './session';
import { importUnit, type ParsedBill } from './model';
export type ReadyBill = { key: string; sheet: string; rows: number[]; kind: 'purchase' | 'sale'; business: number; party: number | Omit<ImportParty, 'ref'>; invoice_number: string; invoice_date: string; payment_mode: PaymentMode; lines: ImportLine[] };
export function rowsText(rows: number[]) { return rows.length === 1 ? `row ${rows[0]}` : rows.every((v, i) => !i || v === rows[i - 1] + 1) ? `rows ${rows[0]}–${rows[rows.length - 1]}` : `rows ${rows.join(', ')}`; }
export function makeBatches(file_name: string, rows: ReadyBill[]): ImportBatch[] {
  return (['purchase', 'sale'] as const).flatMap(kind => {
    const selected = rows.filter(r => r.kind === kind); if (!selected.length) return [];
    const parties: ImportParty[] = []; const ids = new Map<string, string>();
    const bills: ImportBill[] = selected.map(row => {
      let party: number | string;
      if (typeof row.party === 'number') party = row.party;
      else {
        const key = row.party.gst_number.trim().toUpperCase() || row.party.name.trim().toLowerCase();
        party = ids.get(key) ?? `party-${parties.length + 1}`;
        if (!ids.has(key)) { ids.set(key, party); parties.push({ ...row.party, ref: party }); }
      }
      const common = { ref: `Sheet “${row.sheet}” ${rowsText(row.rows)}`, business: row.business, invoice_number: row.invoice_number, invoice_date: row.invoice_date, payment_mode: row.payment_mode, lines: row.lines };
      return kind === 'purchase' ? { ...common, supplier: party, itc_eligible: true, itc_month: null, buyer_gstin: '', buyer_ack: false, pair: null } : { ...common, customer: party, paper: true, place_of_supply: null, notes: '' };
    });
    return [{ kind: kind === 'purchase' ? 'purchases' : 'sales', body: { file_name, dry_run: true, bills, ...(kind === 'purchase' ? { suppliers: parties } : { customers: parties }) } }];
  });
}
type MatchParty = { id: number; name: string; gst_number: string; state_name?: string; city?: string; address?: string };
const nameKey = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
export function matchParty(name: string, gstin: string, parties: MatchParty[]) {
  const exact = parties.filter(p => gstin.trim() ? p.gst_number.trim().toUpperCase() === gstin.trim().toUpperCase() : p.name.trim().toLowerCase() === name.trim().toLowerCase());
  const similar = parties.filter(p => nameKey(p.name) === nameKey(name));
  return { exact: exact.length === 1 ? exact[0] : null, suggestion: !exact.length && similar.length === 1 ? similar[0] : null };
}
/** Resolve only parties actually present in the file. The unfiltered customer endpoint intentionally includes dual-role records. */
export function useImportParties(bills: ParsedBill[], enabled: boolean) {
  const groups = new Map<string, { gstin: string; names: Set<string> }>();
  for (const bill of bills) {
    const gstin = bill.gstin.trim(), name = bill.party.trim(), term = gstin || name;
    if (!term) continue;
    const group = groups.get(term) ?? { gstin, names: new Set<string>() };
    if (name) group.names.add(name);
    groups.set(term, group);
  }
  const entries = [...groups].map(([term, group]) => ({ term, gstin: group.gstin, names: [...group.names].sort() }));
  const queries = useQueries({ queries: entries.map(({ term, gstin, names }) => ({ queryKey: ['customers', 'import-match', term, names], enabled,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const search = async (text: string) => toCustomerPage((await api.get('customers/', { params: { search: text, page_size: 100, figures: 0 }, signal })).data);
      const first = await search(term);
      if (!gstin || first.rows.some(person => person.gst_number.trim().toUpperCase() === gstin.toUpperCase())) return first;
      // A wrong GSTIN is never a name match. The name results only offer an explicit correction.
      // Keep both searches in this query so a failed fallback cannot make an unchecked party look ready.
      const named = await Promise.all(names.filter(name => name !== term).map(search));
      const rows = [...new Map([first, ...named].flatMap(page => page.rows).map(person => [person.id, person])).values()];
      return { ...first, rows, count: rows.length, next: [first, ...named].find(page => page.next)?.next ?? null };
    },
  })) });
  return new Map(entries.map(({ term }, i) => [term, queries[i]]));
}
export function useImportRates(bills: ParsedBill[], enabled: boolean, supplierIdsByBill: Record<string, number | null> = Object.fromEntries(bills.map(b => [b.key, null]))) {
  const lookupKey = (item: string, unit: string, supplier: number | null) => JSON.stringify([item, importUnit(unit), supplier]);
  const entries = [...new Map(bills.filter(b => b.kind === 'purchase' && Object.prototype.hasOwnProperty.call(supplierIdsByBill, b.key)).flatMap(b => b.lines.filter(l => l.item.trim()).map(l => {
    const supplier = supplierIdsByBill[b.key];
    return [lookupKey(l.item, l.unit, supplier), { product_name: l.item, unit: importUnit(l.unit), ...(supplier === null ? {} : { supplier_id: supplier }) }] as const;
  }))).entries()];
  const queries = useQueries({ queries: entries.map(([key, params]) => ({ queryKey: ['purchases', 'usual-rate', key], enabled, queryFn: async ({ signal }: { signal: AbortSignal }) => (await api.get<{ rate: string | null }>('purchases/usual-rate/', { params, signal })).data })) });
  const byKey = new Map(entries.map(([key], i) => [key, queries[i]]));
  const byBill = new Map(bills.map(b => {
    const applicable = b.kind === 'purchase' && Object.prototype.hasOwnProperty.call(supplierIdsByBill, b.key);
    const items = applicable ? b.lines.filter(l => l.item.trim()).map(l => ({ item: l.item, unit: importUnit(l.unit), query: byKey.get(lookupKey(l.item, l.unit, supplierIdsByBill[b.key])) })) : [];
    return [b.key, { rates: Object.fromEntries(items.map(({ item, unit, query }) => [`${item}|${unit}`, query?.data?.rate ?? null])), loading: enabled && items.some(({ query }) => query?.isPending), error: items.some(({ query }) => query?.isError) }];
  }));
  return { byBill };
}
