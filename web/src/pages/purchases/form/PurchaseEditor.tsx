import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/core/auth/AuthProvider';
import { useCreatePurchase, useUpdatePurchase, usePurchaseFiles, useReadPurchase, useCreditMonths, useCheckDuplicate, useUsualRate } from '@/core/api/purchases';
import { useSupplier, useSupplierMemory } from '@/core/api/suppliers';
import { problemOf, saveFailure, type ApiProblem } from '@/core/api/errors';
import { bytesOf } from '@/pages/sales/print/zip';
import { billFigures } from '@/core/sales/maths';
import { isInterState } from '@/core/sales/pos';
import { stateCodeOf, hasGstin, checkGstin } from '@/core/ids';
import { useFirms } from '@/core/scope';
import { useView } from '@/core/view';
import { useDebounced } from '@/core/useDebounced';
import { useUnsavedGuard } from '@/core/router/useUnsavedGuard';
import { date, fyOf, inr, monthLabel, todayIST, UNITS } from '@/core/format';
import { toPurchaseRef } from '@/core/purchases/wire';
import { PURCHASE_SLABS, rateCheck } from '@/core/purchases/model';
import { beforeLedgerWords, claimLabel, creditWords, deadlineNote, earliestCreditWords, lateNote } from '@/core/purchases/words';
import type { PurchaseDetail, PurchaseInput, PurchaseRead, PurchaseRef, ReadGroup } from '@/core/purchases/types';
import { Banner, Button, Card, Checkbox, Combobox, Field, IconButton, Input, Money, Select, Switch } from '@/core/ui';
import { DateField, RateInput } from '@/pages/sales/form/fields';
import { useSaleProducts, matchProducts } from '@/pages/sales/form/products';
import { SupplierPicker } from '../suppliers/SupplierPicker';
import { SupplierSheet } from '../suppliers/SupplierSheet';
import { emptyLine, fillEmpty, fromRead, newLine, payloadOf, purchaseErrors, type FormLine, type PurchaseValues } from './model';

export type PurchaseEditorProps = {
  initial: PurchaseValues; original?: PurchaseDetail; read?: PurchaseRead; capture?: number; photo?: ReactNode;
  onSaved: (purchase: PurchaseDetail) => void; onReview?: (body: PurchaseInput) => void; onFocusGroup?: (group: ReadGroup | 'buyer') => void;
  confirmed?: Partial<Record<ReadGroup, boolean>>; onConfirm?: (group: ReadGroup) => void;
  disabled?: boolean; onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void;
};
const GROUP_WORDS: Record<ReadGroup, string> = { supplier: 'supplier', gstin: 'GSTIN', bill_no: 'bill number', date: 'date', amounts: 'quantities and rates' };
/** Shared editor for typed bills, captures and an import row. onReview returns a body without saving a bill. */
export function PurchaseEditor({ initial, original, read: initialRead, capture, photo, onSaved, onReview, onFocusGroup,
  confirmed: sharedConfirmed, onConfirm, disabled: externallyBusy = false, onDirtyChange, onBusyChange }: PurchaseEditorProps) {
  const { can, whyNot } = useAuth(); const { isPhone } = useView(); const { firms } = useFirms();
  const allowed = can(original ? 'purchase.edit' : 'purchase.create');
  const readOnly = !allowed || Boolean(original?.locked);
  const [v, setV] = useState(initial); const base = useRef(JSON.stringify(initial));
  const [read, setRead] = useState(initialRead); const [localConfirmed, setConfirmed] = useState<Partial<Record<ReadGroup, boolean>>>({});
  const confirmed = sharedConfirmed ?? localConfirmed;
  const [touched, setTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({}); const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [file, setFile] = useState<File | null>(null); const [readFile, setReadFile] = useState<File | null>(null); const [saved, setSaved] = useState<PurchaseDetail | null>(null); const [done, setDone] = useState(false);
  const [supplierSheet, setSupplierSheet] = useState(false);
  const [reading, setReading] = useState(false); const readingRef = useRef(false);
  const [readProblem, setReadProblem] = useState('');
  const successfulReads = useRef<{ bytes: Uint8Array; read: PurchaseRead }[]>([]);
  const [refusedDuplicate, setRefusedDuplicate] = useState<{ key: string; purchase: PurchaseRef } | null>(null);
  const create = useCreatePurchase(); const update = useUpdatePurchase(); const attach = usePurchaseFiles(); const reader = useReadPurchase();
  const busyRef = useRef(false); const busy = create.isPending || update.isPending || attach.isPending;
  const readBusy = reading || reader.isPending;
  const disabled = readOnly || busy || readBusy || externallyBusy || Boolean(saved);
  const dirty = !done && !readOnly && (touched || Object.values(confirmed).some(Boolean) || JSON.stringify(v) !== base.current || Boolean(file));
  const guard = useUnsavedGuard(dirty);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { if (Object.values(confirmed).some(Boolean)) setTouched(true); }, [confirmed]);
  const firm = firms.find(f => f.id === v.business);
  const supplierQuery = useSupplier(v.supplier || null); const supplier = supplierQuery.data?.supplier;
  const noGstin = Boolean(supplier && !hasGstin(supplier.gst_number));
  const memory = useSupplierMemory(!original ? v.supplier || null : null, v.business || undefined);
  const beforeLedger = Boolean(v.invoice_date && v.invoice_date < '2025-04-01');
  const credit = useCreditMonths(beforeLedger ? null : v.business || null, v.invoice_date);
  const duplicateNumber = useDebounced(v.invoice_number);
  const duplicate = useCheckDuplicate(v.business && v.supplier && v.invoice_date && duplicateNumber ? { business_id: v.business, supplier_id: v.supplier, invoice_number: duplicateNumber, invoice_date: v.invoice_date, exclude_id: original?.id } : null);
  const duplicateKey = `${v.business}|${v.supplier}|${v.invoice_date}|${v.invoice_number}`;
  const dup = refusedDuplicate?.key === duplicateKey ? refusedDuplicate.purchase : duplicateNumber === v.invoice_number ? duplicate.data?.duplicate : null;
  const pending = (Object.keys(read?.confidence ?? {}) as ReadGroup[]).filter(k => read?.confidence[k] === 'medium' && !confirmed[k]);
  const unchanged = original && original.business === v.business && original.invoice_date === v.invoice_date;
  const chosenMonth = beforeLedger ? null : v.itc_month ?? (unchanged ? original.credit.month : credit.data?.default ?? v.invoice_date.slice(0, 7));
  const option = credit.data?.options.find(o => o.month === chosenMonth);
  const lapsed = unchanged && v.itc_month === undefined ? original.credit.lapsed : Boolean(credit.data?.lapsed || option && !option.in_time);
  const firmGstin = checkGstin(firm?.gstin);
  const inter = isInterState(firmGstin.status === 'valid' || firmGstin.status === 'check' ? firmGstin.code : stateCodeOf(firm?.state), supplier?.state_code ?? '');
  const effective = v.lines.map(l => ({ ...l, gst_percent: noGstin ? '0' : l.gst_percent }));
  const figures = billFigures(effective.map(l => ({ ...l, quantity: l.amount_only ? '1' : l.quantity, rate: l.amount_only ? l.taxable ?? '' : l.rate })), inter);
  const claim = v.itc_eligible && !noGstin && !lapsed && !beforeLedger;
  const buyer = v.buyer_gstin.trim().toUpperCase(); const mismatch = Boolean(buyer && firm && buyer !== firm.gstin);
  const words = beforeLedger ? beforeLedgerWords : creditWords({ eligible: v.itc_eligible, supplier: supplier?.name, noGstin, lapsed, month: chosenMonth || undefined, firm: firm?.short, option: option?.month !== v.invoice_date.slice(0, 7) ? option : undefined });
  const set = (patch: Partial<PurchaseValues>) => { setTouched(true); setV(old => ({ ...old, ...patch })); setProblem(null); };
  const confirm = (key: ReadGroup) => { if (disabled) return; setTouched(true); if (onConfirm) onConfirm(key); else setConfirmed(old => ({ ...old, [key]: true })); };
  const setLine = (i: number, patch: Partial<FormLine>) => { confirm('amounts'); setV(old => ({ ...old, lines: old.lines.map((l, j) => j === i ? { ...l, ...patch } : l) })); };
  useEffect(() => {
    if (!memory.data?.line || original) return;
    const line = memory.data.line;
    setV(old => old.supplier === v.supplier && old.lines.length === 1 && emptyLine(old.lines[0]) ? { ...old, lines: [{ ...old.lines[0], ...line, fromMemory: true }] } : old);
  }, [memory.data, original, v.supplier]);
  const completed = (p: PurchaseDetail) => { setDone(true); base.current = JSON.stringify(v); setSaved(p); };
  const notified = useRef<number | null>(null);
  useEffect(() => { if (done && saved && notified.current !== saved.id) { notified.current = saved.id; onSaved(saved); } }, [done, saved, onSaved]);
  // Publish the saved result before the shell re-enables read/discard actions.
  useEffect(() => { onBusyChange?.(busy || readBusy); }, [busy, readBusy, onBusyChange]);
  const attachSaved = async (p: PurchaseDetail) => {
    if (!file) { completed(p); return; }
    try { completed(await attach.mutateAsync({ id: p.id, file })); }
    catch (error) { setProblem(problemOf(error)); }
  };
  const submit = async () => {
    if (disabled || busyRef.current) return;
    const e = purchaseErrors({ ...v, lines: effective });
    if (mismatch && !v.buyer_ack) e.buyer_gstin = `This bill isn't addressed to ${firm?.name}'s GSTIN.`;
    if (dup && !v.duplicate_ok) e.invoice_number = `Already entered for ${dup.business_name}: ${dup.invoice_number} from ${dup.supplier_name}, ${date(dup.invoice_date)}, ${inr(dup.total_amount)}.`;
    setErrors(e);
    if (Object.keys(e).length) { document.getElementById(fieldId(Object.keys(e)[0]))?.focus(); return; }
    busyRef.current = true; setProblem(null);
    const body = payloadOf({ ...v, ...(capture ? { capture, source: 'capture' } : {}) }, { noGstin, pending, editing: Boolean(original) });
    if (onReview) { onReview(body); busyRef.current = false; return; }
    try {
      const p = original ? await update.mutateAsync({ id: original.id, body }) : await create.mutateAsync(body);
      setSaved(p); await attachSaved(p);
    } catch (error) { const p = problemOf(error); setProblem(p); setErrors(p.code === 'month_closed' ? { itc_month: p.message } : p.fields ?? {});
      if (p.code === 'duplicate') { const body = p.body as { purchase?: Record<string, unknown> }; if (body.purchase) setRefusedDuplicate({ key: duplicateKey, purchase: toPurchaseRef(body.purchase) }); }
    }
    finally { busyRef.current = false; }
  };
  const submitRef = useRef(submit); submitRef.current = submit;
  useEffect(() => {
    if (disabled || isPhone) return;
    const key = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void submitRef.current(); }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); confirm('amounts'); setV(old => old.lines.length < 200 ? { ...old, lines: [...old.lines, newLine()] } : old); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [disabled, isPhone]);
  const readSelectedFile = async () => {
    if (!file || file === readFile || readingRef.current || disabled) return;
    readingRef.current = true; setReading(true); setReadProblem('');
    try {
      const bytes = await bytesOf(file);
      const known = successfulReads.current.find(entry => entry.bytes.length === bytes.length && entry.bytes.every((b, i) => b === bytes[i]));
      const r = known?.read ?? await reader.mutateAsync({ files: [file], business_id: v.business || undefined, kind: 'form' });
      if (!known) successfulReads.current.push({ bytes, read: r });
      setRead(r); setReadFile(file); setConfirmed({}); setV(old => fillEmpty(old, fromRead(r, old.business)));
    } catch (error) {
      const p = problemOf(error); const kind = file.type === 'application/pdf' ? 'file' : 'photo';
      setReadProblem(p.kind === 'offline' ? `You're offline, so the ${kind} can't be read. Type the bill in, or try again when you're back online.` : p.kind === 'server' || p.kind === 'unreachable' ? `The ${kind} couldn't be read just now. Nothing was filled in; try again in a moment.` : p.message);
    } finally { readingRef.current = false; setReading(false); }
  };
  const checkNote = (group: ReadGroup) => pending.includes(group) ? <div className="flex items-center justify-between gap-3 rounded-ctl border border-brand-line bg-brand-tint px-3 text-sm"><span>Check this: read with medium confidence</span><Button size="sm" variant="link" disabled={disabled} onClick={() => confirm(group)}>Looks right</Button></div> : null;
  const saveLabel = onReview ? 'Use these changes' : original ? 'Save changes' : capture ? 'Save as purchase' : 'Save purchase';
  const saveButton = !readOnly && !saved ? <Button variant="primary" full loading={busy} disabled={disabled} onClick={() => void submit()}>{problem ? 'Try saving again' : saveLabel}</Button> : null;
  const totals = <Card title="Totals" subtitle={supplier && firm ? noGstin ? `${supplier.name} has no GSTIN: no GST on this bill` : inter ? `${supplier.name} is in ${supplier.state_name}: IGST` : `Same state as ${firm.short}: CGST + SGST` : "Pick the firm and supplier to see whether it's CGST + SGST or IGST."}>
    <dl className="flex flex-col gap-3">{[['Taxable value', figures.taxable], ...(inter ? [['IGST', figures.igst]] : [['CGST', figures.cgst], ['SGST', figures.sgst]]), ['Total on the bill', figures.total]].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt>{label}</dt><dd><Money value={Number(value)} strong /></dd></div>)}</dl>
    {figures.pending > 0 && <p className="text-sm text-amber">Some items have no GST slab yet, so their GST isn't in these totals.</p>}
    <div className="mt-3 rounded-ctl border border-file-line bg-file-tint px-4 py-3 flex flex-col gap-0.5"><span className="caps">Input tax credit</span><Money value={claim ? figures.tax : 0} tone="file" size="lg" /><span className="text-sm text-fg2">{words}</span></div>
    {!isPhone && <div className="mt-4">{saveButton}</div>}
  </Card>;
  const lockedMonth = original?.credit.month;
  const usedPurchase = problem?.code === 'capture_used' ? (problem.body as { purchase?: { id?: number } }).purchase : null;
  return <>{guard}
    {readOnly && <Banner tone="file" title={original?.locked ? `${monthLabel(lockedMonth!, { long: true })}'s GSTR-3B is filed` : 'You can look, but not change this purchase'}>{original?.locked ? `Have the owner unlock ${monthLabel(lockedMonth!, { long: true })} in GST returns first.` : whyNot(original ? 'purchase.edit' : 'purchase.create')}</Banner>}
    {saved && problem ? <Banner tone="neg" title="Purchase saved; its file was not attached" actions={<><Button onClick={() => void attachSaved(saved)} loading={attach.isPending}>Try attaching again</Button><Button onClick={() => completed(saved)}>Open the purchase</Button></>}>{problem.message}</Banner> : problem && <Banner tone="neg" title={saveFailure(problem).title}>{saveFailure(problem).body}</Banner>}
    {usedPurchase?.id && <Link className="link" to={`/purchases/${usedPurchase.id}`}>Open the purchase</Link>}
    {original?.needs_review && !readOnly && <Banner tone="brand" title="Read from a photo: needs a check">Compare the GST slab, quantities and rates with the photo, then save. Saving clears “Needs a check”.</Banner>}
    {read?.notes.map(note => <Banner key={note} tone="brand">{note}</Banner>)}
    <div className={isPhone ? 'flex flex-col gap-4' : 'grid grid-cols-[minmax(0,1fr)_340px] gap-5 items-start'}>
      <div className="flex flex-col gap-5 min-w-0" onFocus={event => {
        const id = (event.target as HTMLElement).id; onFocusGroup?.(id === 'pf-supplier' ? 'supplier' : id === 'pf-billno' ? 'bill_no' : id === 'pf-date' ? 'date' : id === 'pf-buyer' ? 'buyer' : 'amounts');
      }} onKeyDown={event => {
        if (event.key !== 'Enter' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || disabled) return;
        const target = event.target as HTMLElement;
        if (!['INPUT', 'SELECT'].includes(target.tagName) || target.getAttribute('aria-expanded') === 'true') return;
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not([disabled]):not([type="file"]),select:not([disabled])')];
        const i = controls.indexOf(target); if (i < 0) return;
        event.preventDefault(); if (controls[i + 1]) controls[i + 1].focus(); else void submit();
      }}>
        {photo}
        <Card title="The bill" subtitle="As printed on the supplier's bill">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Field label="Bought by" htmlFor="pf-firm" error={errors.business}><Select id="pf-firm" value={String(v.business || '')} disabled={disabled} options={[{ value: '', label: 'Choose a firm' }, ...firms.map(f => ({ value: String(f.id), label: f.name }))]} onChange={e => set({ business: Number(e.target.value), itc_month: undefined, buyer_ack: false, duplicate_ok: false })} /></Field>
            <Field label="Supplier" htmlFor="pf-supplier" error={errors.supplier}><SupplierPicker value={v.supplier || null} disabled={disabled} onChange={s => { set({ supplier: s.id, duplicate_ok: false }); confirm('supplier'); confirm('gstin'); }} />{checkNote('supplier')}<div role="group" aria-label="Supplier GSTIN"><p className="text-sm text-muted">{supplier?.gst_number || read?.supplier.gst_number || 'No GSTIN'}</p>{checkNote('gstin')}</div></Field>
            {read && !v.supplier && <div className="lg:col-span-2"><Button disabled={disabled} onClick={() => setSupplierSheet(true)}>Add {read.supplier.name} as a supplier</Button></div>}
            <Field label="Supplier's bill number" htmlFor="pf-billno" error={errors.invoice_number}><Input id="pf-billno" value={v.invoice_number} maxLength={50} disabled={disabled} onChange={e => { set({ invoice_number: e.target.value, duplicate_ok: false }); confirm('bill_no'); }} />{checkNote('bill_no')}
              {!v.invoice_number && memory.data?.next_number && <Button variant="link" size="sm" disabled={disabled} onClick={() => { set({ invoice_number: memory.data!.next_number! }); confirm('bill_no'); }}>Use {memory.data.next_number}</Button>}
            </Field>
            <Field label="Bill date" htmlFor="pf-date" error={errors.invoice_date}>{disabled ? <Input id="pf-date" value={date(v.invoice_date)} disabled /> : <DateField id="pf-date" value={v.invoice_date} today={todayIST()} onChange={iso => { set({ invoice_date: iso ?? '', itc_month: undefined, duplicate_ok: false }); confirm('date'); }} offReason={day => day > todayIST() ? 'Check the date on the bill.' : ''} label="Bill date" />}{checkNote('date')}</Field>
            <div className="lg:col-span-2 flex flex-col gap-3">
              {credit.data?.bill_month_closed && option && <p className="text-sm text-file">{lateNote(credit.data.bill_month, option, todayIST())}</p>}
              {credit.isFetching && <p role="status" className="text-sm text-muted">Checking open credit months…</p>}
              {credit.isError && <Banner tone="neg" title="Credit months could not be loaded" actions={<Button onClick={() => void credit.refetch()}>Try again</Button>}>{problemOf(credit.error).message}</Banner>}
              {credit.data && !original?.locked && <Field label="Claim the credit in" htmlFor="pf-credit" hint={earliestCreditWords} error={errors.itc_month}><Select id="pf-credit" value={chosenMonth ?? ''} disabled={disabled || credit.data.lapsed} options={credit.data.options.map(o => ({ value: o.month, label: claimLabel(o, todayIST()), disabled: !o.in_time }))} onChange={e => set({ itc_month: e.target.value })} /></Field>}
              {credit.data && v.invoice_date && fyOf(v.invoice_date) < fyOf(todayIST()) && <p className="text-sm text-muted">{deadlineNote(v.invoice_date, credit.data.deadline)}</p>}
              {dup && <Banner tone="neg" title="Already entered"><p>{dup.invoice_number} from {dup.supplier_name}, {date(dup.invoice_date)}, {inr(dup.total_amount)}. <Link className="link" to={`/purchases/${dup.id}`}>Open it</Link></p>{!duplicate.data?.same_spelling && <p>“{v.invoice_number}” and “{dup.invoice_number}” are the same number written differently.</p>}<Checkbox label="It's a different bill with the same number" checked={Boolean(v.duplicate_ok)} disabled={disabled} onChange={value => set({ duplicate_ok: value })} /></Banner>}
              <Field label="Billed to (GSTIN on the bill)" htmlFor="pf-buyer" hint="Optional. Printed under “Billed to”; checked against the firm's GSTIN." error={errors.buyer_gstin}><Input id="pf-buyer" maxLength={15} value={v.buyer_gstin} disabled={disabled} onChange={e => set({ buyer_gstin: e.target.value.toUpperCase(), buyer_ack: false })} /></Field>
              {mismatch && <Banner tone="brand" title={`This bill isn't addressed to ${firm?.name}'s GSTIN.`}><p>It won't match {firm?.short}'s credit in GSTR-2B.</p><Checkbox label="Record anyway" checked={v.buyer_ack} disabled={disabled} onChange={value => set({ buyer_ack: value })} /></Banner>}
            </div>
          </div>
        </Card>
        <Card title="Items" subtitle="Quantity with its unit, the supplier's rate, and the GST slab printed on the bill">
          {noGstin && <Banner title={`${supplier?.name} has no GSTIN`}>Every line is 0% and there's no input tax credit.<Button variant="link" onClick={() => setSupplierSheet(true)} disabled={disabled}>Add their GSTIN</Button></Banner>}
          {checkNote('amounts')}
          {v.lines.map((line, i) => <PurchaseLine key={i} line={line} index={i} supplier={v.supplier} errors={errors} noGstin={noGstin} disabled={disabled} change={patch => setLine(i, patch)} remove={() => { set({ lines: v.lines.length > 1 ? v.lines.filter((_, j) => j !== i) : [newLine()] }); confirm('amounts'); }} />)}
          {!disabled && <Button icon={Plus} disabled={v.lines.length >= 200} onClick={() => { set({ lines: [...v.lines, newLine()] }); confirm('amounts'); }}>Add another item</Button>}
          {errors.lines && <p role="alert" className="text-neg">{errors.lines}</p>}
        </Card>
        <Card title={capture ? 'Payment and credit' : 'Payment, credit and photo'}>
          <div className="flex flex-col gap-5">
            <Field label="How it was paid" htmlFor="pf-pay" hint={v.payment_mode === '' ? "Not recorded until you pick one. It doesn't change the GST." : undefined}><Select id="pf-pay" value={v.payment_mode} disabled={disabled} options={[{ value: '', label: 'Not recorded' }, { value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank / UPI' }, { value: 'credit', label: 'On credit' }, { value: 'mixed', label: 'Mixed' }]} onChange={e => set({ payment_mode: e.target.value as PurchaseValues['payment_mode'] })} /></Field>
            <Switch label="Claim input tax credit (ITC)" checked={claim} disabled={disabled || noGstin || lapsed || beforeLedger} onChange={value => set({ itc_eligible: value })} description={words} />
            {!capture && !original?.has_files && !readOnly && <Field label="Bill photo or PDF" htmlFor="pf-photo"><Input id="pf-photo" type="file" accept="image/jpeg,image/png,image/heic,image/heif,application/pdf" disabled={disabled} onChange={e => {
              const selected = e.target.files?.[0]; if (!selected) return;
              if (selected.size > 20 * 1024 * 1024) { setProblem({ kind: 'validation', message: `${selected.name} is too large. The most is 20 MB.` }); return; }
              setFile(selected); setReadProblem('');
            }} />{file && !original && <Button loading={readBusy} disabled={disabled || readFile === file} onClick={() => void readSelectedFile()}>{readProblem ? 'Try reading again' : 'Read it for me'}</Button>}</Field>}
            {readProblem && <Banner tone="neg" title="Could not read the bill">{readProblem}</Banner>}
            {read && !readProblem && <p role="status">Only empty fields were filled; check the highlighted ones.</p>}
            {pending.length > 0 && <p className="text-sm text-amber">Saving now marks it “Needs a check” until someone confirms the {pending.map(k => GROUP_WORDS[k]).join(', ')}.</p>}
          </div>
        </Card>
      </div>
      <div className={isPhone ? 'flex flex-col gap-3' : 'sticky top-6 flex flex-col gap-3'}>{totals}{isPhone && <div className="sticky bottom-4 card p-3" role="region" aria-label="Save">{saveButton}</div>}</div>
    </div>
    <SupplierSheet open={supplierSheet} onClose={() => setSupplierSheet(false)} initial={supplier ? { id: supplier.id, name: supplier.name, gst_number: supplier.gst_number, state_name: supplier.state_name, city: supplier.city, address: supplier.address, pan_number: supplier.pan, mobile_number: supplier.mobile_number, email: supplier.email } : read ? { name: read.supplier.name, gst_number: read.supplier.gst_number, city: read.supplier.city } : undefined} onSaved={s => { set({ supplier: s.id }); confirm('supplier'); confirm('gstin'); }} />
  </>;
}
function fieldId(key: string) { return ({ business: 'pf-firm', supplier: 'pf-supplier', invoice_number: 'pf-billno', invoice_date: 'pf-date', buyer_gstin: 'pf-buyer', itc_month: 'pf-credit' } as Record<string, string>)[key] ?? `pf-${key.replace(/\./g, '-')}`; }
function PurchaseLine({ line, index, supplier, errors, disabled, noGstin, change, remove }: { line: FormLine; index: number; supplier: number; errors: Record<string, string>; disabled: boolean; noGstin: boolean; change: (patch: Partial<FormLine>) => void; remove: () => void }) {
  const products = useSaleProducts(); const [query, setQuery] = useState(line.product_name);
  useEffect(() => setQuery(line.product_name), [line.product_name]);
  const debouncedName = useDebounced(line.product_name);
  const usual = useUsualRate(!disabled && line.product_name && debouncedName === line.product_name ? { product_name: debouncedName, unit: line.unit, supplier_id: supplier || undefined } : null);
  const usualProduct = products.data?.find(p => p.name === line.product_name);
  const slip = rateCheck({ rate: line.rate, unit: line.unit, name: line.product_name, usual: usual.data });
  const field = (key: string, label: string, child: ReactNode) => <Field label={label} htmlFor={`pf-lines-${index}-${key}`} error={errors[`lines.${index}.${key}`]}>{child}</Field>;
  const id = (key: string) => `pf-lines-${index}-${key}`;
  return <div className="flex flex-col gap-3 py-4 border-t border-rule first:border-t-0 first:pt-0">
    <div className="flex items-center justify-between"><p className="font-semibold">Item {index + 1}</p>{!disabled && <IconButton icon={Trash2} label={`Remove item ${index + 1}`} onClick={remove} />}</div>
    {field('product_name', 'Item', disabled ? <Input id={id('product_name')} value={line.product_name} disabled /> : <Combobox id={id('product_name')} query={query} onQuery={s => { setQuery(s); change({ product_name: s }); }} placeholder="Search products, or type the item" options={matchProducts(products.data ?? [], query).map(p => ({ key: String(p.id), title: p.name, sub: `HSN ${p.hsn_code} · usually ${p.gst_percent}%`, value: p }))} onPick={o => { change({ product_name: o.value.name, hsn_code: o.value.hsn_code, unit: o.value.unit }); setQuery(o.value.name); }} />)}
    <div className="grid grid-cols-2 gap-3">
      {field('hsn_code', 'HSN code', <Input id={id('hsn_code')} value={line.hsn_code} maxLength={8} disabled={disabled} onChange={e => change({ hsn_code: e.target.value })} />)}
      {field('gst_percent', 'GST slab', <Select id={id('gst_percent')} value={noGstin ? '0' : line.gst_percent} disabled={disabled || noGstin} options={[{ value: '', label: 'Choose the slab' }, ...PURCHASE_SLABS.map(s => ({ value: s, label: `${s}%` }))]} onChange={e => change({ gst_percent: e.target.value, fromMemory: false })} />)}
      {line.amount_only ? field('taxable', 'Taxable value', <Input id={id('taxable')} inputMode="decimal" value={line.taxable} disabled={disabled} onChange={e => change({ taxable: e.target.value })} />) : <>
        {field('quantity', 'Quantity', <Input id={id('quantity')} inputMode="decimal" value={line.quantity} disabled={disabled} onChange={e => change({ quantity: e.target.value })} />)}
        {field('rate', `Rate per ${line.unit}`, <RateInput id={id('rate')} value={line.rate} disabled={disabled} onChange={rate => change({ rate })} />)}
      </>}
      {field('unit', `Unit for item ${index + 1}`, <Select id={id('unit')} value={line.unit} disabled={disabled} options={UNITS.map(u => ({ value: u.value, label: u.label }))} onChange={e => change({ unit: e.target.value })} />)}
      {field('note', 'Item note', <Input id={id('note')} value={line.note} disabled={disabled} maxLength={60} onChange={e => change({ note: e.target.value })} />)}
    </div>
    {usualProduct?.gst_percent && !line.fromMemory && !disabled && !noGstin && (line.gst_percent === '' ? <p className="text-sm text-muted">Usual for this item: {usualProduct.gst_percent}%. <Button size="sm" variant="link" onClick={() => change({ gst_percent: usualProduct.gst_percent! })}>Use {usualProduct.gst_percent}%</Button></p> : line.gst_percent !== usualProduct.gst_percent ? <p className="text-sm text-amber">{line.product_name} is usually {usualProduct.gst_percent}%. Check the bill.</p> : null)}
    {line.fromMemory && <p className="text-sm text-file">From their last bill. Check it against this one.</p>}
    {line.amount_only && <p className="text-sm text-muted">Amount only</p>}
    {slip && <div role="status" className="text-sm text-amber"><p>{slip.text}</p>{slip.fix && <Button size="sm" onClick={() => change({ rate: slip.fix!.rate })}>{slip.fix.label}</Button>}</div>}
    {!line.rate && usual.data?.last && <p className="text-sm text-muted">Last paid: {usual.data.last.rate}/{line.unit} on {date(usual.data.last.invoice_date)}</p>}
  </div>;
}
