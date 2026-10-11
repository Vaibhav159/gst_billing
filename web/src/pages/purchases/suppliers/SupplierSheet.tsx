import { useEffect, useState } from 'react';
import { useAuth } from '@/core/auth/AuthProvider';
import { useSaveSupplier } from '@/core/api/suppliers';
import { useGstinRegistry } from '@/core/api/registry';
import { problemOf } from '@/core/api/errors';
import { checkGstin, cleanGstin, gstinPlaceholder, stateOptions } from '@/core/ids';
import { toSupplierRef } from '@/core/purchases/wire';
import { Banner, Button, Field, Input, Select, Sheet, Textarea, cn } from '@/core/ui';
import type { SupplierInput, SupplierRef } from '@/core/purchases/types';

export type SupplierSheetProps = { open: boolean; onClose: () => void; initial?: Partial<SupplierInput> & { id?: number }; onSaved?: (supplier: SupplierRef) => void };
const blank: SupplierInput = { name: '', gst_number: '', state_name: '', city: '', address: '', mobile_number: '', pan_number: '', email: '' };
const keys = Object.keys(blank) as (keyof SupplierInput)[];
// only the SupplierInput fields: an id, or anything else a caller opened the sheet with, never reaches the request
const inputOf = (x?: Partial<SupplierInput>): SupplierInput => Object.fromEntries(keys.map(k => [k, x?.[k] ?? blank[k]])) as SupplierInput;
export function SupplierSheet(props: SupplierSheetProps) {
  return props.open ? <SupplierFields key={props.initial?.id ?? 'new'} {...props} /> : null;
}
function SupplierFields({ open, onClose, initial, onSaved }: SupplierSheetProps) {
  const { can, whyNot } = useAuth();
  const allowed = can('supplier.edit');
  const [v, setV] = useState<SupplierInput>(() => inputOf(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [clash, setClash] = useState<SupplierRef | null>(null);
  const save = useSaveSupplier();
  const disabled = !allowed || save.isPending;
  const g = cleanGstin(v.gst_number ?? '');
  const check = checkGstin(g);
  const registry = useGstinRegistry(open && allowed ? g : '');
  const r = registry.data;
  useEffect(() => {
    if (save.isPending || !r?.valid || r.gstin !== g) return;
    setV(old => old.gst_number === g ? { ...old, name: old.name || r.trade_name || r.legal_name || '', address: old.address || r.address || '', state_name: r.state_name || old.state_name, pan_number: old.pan_number || r.pan || '' } : old);
  }, [r, g, save.isPending]);
  const set = (key: keyof SupplierInput, value: string) => { setV(old => ({ ...old, [key]: value })); setErrors(old => ({ ...old, [key]: '' })); setClash(null); save.reset(); };
  const submit = async () => {
    if (!allowed || save.isPending) return;
    const e: Record<string, string> = {};
    if (!v.name.trim()) e.name = "Type the supplier's name as it's printed on their bill.";
    if (g && !gstinPlaceholder(g) && check.status !== 'valid') e.gst_number = check.status === 'check' ? `${g} doesn't check out: ${check.warning} Correct it, or leave it blank for an unregistered party.` : `${g} isn't a GSTIN (15 characters, starting with the 2-digit state code). Correct it, or leave it blank for an unregistered party.`;
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      const supplier = await save.mutateAsync({ id: initial?.id, body: { ...inputOf(v), name: v.name.trim(), gst_number: gstinPlaceholder(g) ? '' : g, ...(check.status === 'valid' ? { state_name: check.state } : {}) } });
      onSaved?.(supplier); onClose();
    } catch (error) {
      const problem = problemOf(error); setErrors(problem.fields ?? {});
      const body = problem.body as { supplier?: Record<string, unknown> } | undefined;
      setClash(problem.code === 'gstin_taken' && body?.supplier ? toSupplierRef(body.supplier) : null);
    }
  };
  return <Sheet open={open} onClose={save.isPending ? () => {} : onClose} title={initial?.id ? 'Edit supplier' : 'Add a supplier'}
    description="As printed on their bill. The GSTIN decides CGST + SGST or IGST, and whether there's credit."
    footer={<><Button disabled={save.isPending} onClick={onClose}>Cancel</Button>{allowed && <Button variant="primary" loading={save.isPending} onClick={() => void submit()}>{save.isError ? 'Try again' : initial?.id ? 'Save supplier' : 'Add supplier'}</Button>}</>}>
    <div className="flex flex-col gap-4">
      {!allowed && <Banner title="You can look, but not change this supplier">{whyNot('supplier.edit')}</Banner>}
      {save.isError && !keys.some(k => errors[k]) && <Banner tone="neg" title="Not saved">{problemOf(save.error).message}</Banner>}
      {clash && <Banner actions={<Button disabled={disabled} onClick={() => { onSaved?.(clash); onClose(); }}>Use {clash.name}</Button>}>Use {clash.name} instead of adding it again.</Banner>}
      <Field label="Supplier name" htmlFor="sup-name" error={errors.name}><Input id="sup-name" value={v.name} disabled={disabled} maxLength={255} onChange={e => set('name', e.target.value)} /></Field>
      <Field label="GSTIN" htmlFor="sup-gstin" error={errors.gst_number} hint="15 characters, on the top of their bill. Leave it empty, or type URP, if they aren't registered."><Input id="sup-gstin" value={v.gst_number} disabled={disabled} maxLength={15} onChange={e => {
        const next = cleanGstin(e.target.value); const c = checkGstin(next);
        setClash(null); save.reset(); setErrors(old => ({ ...old, gst_number: '' }));
        setV(old => ({ ...old, gst_number: next, ...(c.status === 'valid' ? { state_name: c.state, pan_number: c.pan } : {}) }));
      }} /></Field>
      {r?.valid && r.status?.trim().toLowerCase() === 'cancelled' && <Banner tone="neg" title="Registration cancelled">{r.trade_name || r.legal_name || g} (GST registry). Check the registration before claiming credit on this supplier's bills.</Banner>}
      {/* always on the page, so screen readers announce each change of the GSTIN check */}
      <p id="sup-gstin-status" role="status" className={cn('text-sm', r?.valid && !registry.isFetching ? 'text-sale' : 'text-muted')}>{registry.isFetching ? 'Checking the GSTIN…'
        : r?.valid ? r.status?.trim().toLowerCase() === 'cancelled' ? '' : r.source === 'checksum' ? 'The GST registry did not answer; the state and PAN come from the number.' : `${r.status || 'Found'} · ${r.trade_name || r.legal_name || ''} (GST registry)`
        : registry.isError ? "The GST registry didn't answer; the state and PAN come from the number." : ''}</p>
      <div className="grid grid-cols-2 gap-4">
        <Field label="State" htmlFor="sup-state" error={errors.state_name}><Select id="sup-state" value={v.state_name} options={[{ value: '', label: 'Choose a state' }, ...stateOptions()]} disabled={disabled || check.status === 'valid'} onChange={e => set('state_name', e.target.value)} /></Field>
        <Field label="City" htmlFor="sup-city" error={errors.city}><Input id="sup-city" value={v.city} disabled={disabled} onChange={e => set('city', e.target.value)} /></Field>
      </div>
      <Field label="Address" htmlFor="sup-address" error={errors.address}><Textarea id="sup-address" value={v.address} disabled={disabled} onChange={e => set('address', e.target.value)} /></Field>
      <Field label="Phone" htmlFor="sup-phone" error={errors.mobile_number}><Input id="sup-phone" value={v.mobile_number} disabled={disabled} inputMode="tel" onChange={e => set('mobile_number', e.target.value)} /></Field>
      <Field label="PAN" htmlFor="sup-pan" error={errors.pan_number}><Input id="sup-pan" value={v.pan_number} disabled={disabled} maxLength={10} onChange={e => set('pan_number', e.target.value.toUpperCase())} /></Field>
      <Field label="Email" htmlFor="sup-email" error={errors.email}><Input id="sup-email" value={v.email} disabled={disabled} type="email" onChange={e => set('email', e.target.value)} /></Field>
    </div>
  </Sheet>;
}
