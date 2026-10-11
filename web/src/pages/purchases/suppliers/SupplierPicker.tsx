import { useState } from 'react';
import { useSuppliers, useSupplier } from '@/core/api/suppliers';
import { useAuth } from '@/core/auth/AuthProvider';
import { fyOf, todayIST } from '@/core/format';
import { useDebounced } from '@/core/useDebounced';
import { Button, Combobox, Input } from '@/core/ui';
import type { SupplierRef } from '@/core/purchases/types';
import { SupplierSheet } from './SupplierSheet';

export function SupplierPicker({ id = 'pf-supplier', value, onChange, disabled = false }: { id?: string; value: number | null; onChange: (s: SupplierRef) => void; disabled?: boolean }) {
  const { can } = useAuth();
  // typed text belongs to the value it was typed against: a supplier the form sets later (a read) shows its own name
  const [draft, setDraft] = useState<{ text: string; value: number | null } | null>(null);
  // a supplier picked here is already known by name; only one set from outside needs its detail fetched
  const [known, setKnown] = useState<SupplierRef | null>(null);
  const [sheet, setSheet] = useState(false);
  const typed = draft && draft.value === value ? draft.text : null;
  const setTyped = (text: string) => setDraft({ text, value });
  const take = (s: SupplierRef) => { setKnown(s); setDraft(null); onChange(s); };
  const single = useSupplier(value !== null && known?.id !== value ? value : null);
  const name = value === null ? '' : known?.id === value ? known.name : single.data?.supplier.name ?? '';
  const query = typed ?? name;
  const list = useSuppliers(disabled ? null : 'all', fyOf(todayIST()), useDebounced(typed ?? ''));
  const rows = list.isPlaceholderData ? [] : list.data?.pages.flatMap(p => p.results) ?? [];
  if (disabled) return <Input id={id} value={name} disabled />;
  return <>
    <Combobox<SupplierRef | null> id={id} query={query} onQuery={setTyped} listLabel="Suppliers" placeholder="Search suppliers, or add one"
      options={[...rows.map(s => ({ key: String(s.id), title: s.name, sub: [s.gst_number || 'No GSTIN', s.city].filter(Boolean).join(' · '), value: s })),
        ...(can('supplier.edit') ? [{ key: 'add', title: 'Add a supplier', value: null, action: true }] : [])]}
      note={list.isError ? 'Suppliers could not be loaded. Try again.' : list.isFetching ? 'Looking for suppliers…' : undefined}
      onPick={o => { if (!o.value) setSheet(true); else take(o.value); }} />
    {list.hasNextPage && <Button size="sm" variant="link" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Show more suppliers</Button>}
    {list.isError && <Button size="sm" onClick={() => void list.refetch()}>Try loading suppliers again</Button>}
    <SupplierSheet open={sheet} initial={{ name: typed ?? '' }} onClose={() => setSheet(false)} onSaved={take} />
  </>;
}
