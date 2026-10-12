import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Outlet, useBlocker, useLocation, useNavigate, useOutletContext } from 'react-router';
import { newDraftId, useKeepDraft } from '@/core/api/drafts';
import { problemOf } from '@/core/api/errors';
import { useNetwork } from '@/core/api/network';
import { useAuth } from '@/core/auth/AuthProvider';
import { counterOf } from '@/core/sales/numbers';
import { timeOf } from '@/core/sales/words';
import { Button, Dialog, Money, QueryView, Steps } from '@/core/ui';
import { focusSoon } from '@/pages/sales/form/fields';
import { blankLine, lineFromProduct, toDraftData } from '@/pages/sales/form/model';
import { useCreateProduct } from '@/pages/sales/form/products';
import { keepsOnDevice } from '@/core/deviceDrafts';
import { useEasyBill } from './BillFlow';
import { BillItems, type BillItemsProps, type LineNotice } from './BillItems';
import { BillNumber } from './BillNumber';
import { BillReview } from './BillReview';
import { LeaveBillDialog } from './BillLeave';
import { NewItemSheet, type EasyNewItem } from './NewItem';
import { billRateNotices } from './billRates';
import { cashWords, nextBillStep } from './flow';
import { EasyPage, FirmPill, PayChoice } from './parts';
import { useEasyProducts } from './queries';
import { maskPhone, paidWords, unusual, weightSlip } from './state';

export type BillView = { onCustomerDirty: (dirty: boolean) => void; fullView: () => void; busy: boolean };
const inside = (path: string) => /^\/e\/new(?:\/(?:items|customer))?\/?$/.test(path);

/** This route holds view/leave state only. The parent BillFlow owns the sole brain and keeper. */
export default function NewBill() {
  const { F, drafts } = useEasyBill();
  const navigate = useNavigate();
  const location = useLocation();
  const keep = useKeepDraft();
  const [customerDirty, onCustomerDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const allowed = useRef(false);
  const hasBill = Boolean(F.draftId) || F.f.lines.some(line => (line.qty ?? 0) > 0);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (allowed.current || F.savedTo || F.saveError?.kind === 'draft_saved') return false;
    if (currentLocation.pathname === nextLocation.pathname && currentLocation.search === nextLocation.search) return false;
    const currentParams = new URLSearchParams(currentLocation.search);
    const nextParams = new URLSearchParams(nextLocation.search);
    const ownDraft = nextParams.get('draft') === F.draftId;
    currentParams.delete('draft'); nextParams.delete('draft');
    const ownDraftAddress = currentLocation.pathname === nextLocation.pathname && F.draftId
      && ownDraft && currentParams.toString() === nextParams.toString();
    if (ownDraftAddress) return false;
    if (busy || F.saving) return true;
    return customerDirty || (hasBill && !inside(nextLocation.pathname));
  });
  // Requires 6B's keeper option address:false: naming a draft must never change its current child screen.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (busy || F.saving || blocker.state === 'blocked' || !F.draftId || F.savedTo || params.get('draft') === F.draftId) return;
    params.set('draft', F.draftId);
    navigate({ pathname: location.pathname, search: `?${params}` }, { replace: true, state: location.state });
  }, [F.draftId, F.savedTo, F.saving, busy, blocker.state, location.pathname, location.search, location.state, navigate]);
  const customerOnly = blocker.state === 'blocked' && customerDirty && (!hasBill || inside(blocker.location.pathname));
  useEffect(() => {
    if (!customerDirty) return;
    const ask = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [customerDirty]);
  const proceed = () => {
    allowed.current = true;
    if (blocker.state === 'blocked') blocker.proceed();
  };
  const flush = async () => {
    const id = F.draftId ?? newDraftId();
    // Update the existing keeper's id before its pending/unmount keep can run.
    flushSync(() => F.setDraftId(id));
    const result = await keep(id, F.f.firmId, toDraftData(F.f, F.start.replaces));
    if (!result.kept) throw new Error(result.refusal || "This bill couldn't be kept.");
    if (result.kept === 'visit') throw new Error("This browser doesn't store unfinished bills, so this one lasts only while this page is open.");
    return id;
  };
  const keepAndLeave = async () => {
    if (busy || F.saving) return;
    setBusy(true); setFailure('');
    try { if (hasBill) await flush(); proceed(); }
    catch (error) { setFailure(error instanceof Error ? error.message : problemOf(error).message); }
    finally { setBusy(false); }
  };
  const fullView = async () => {
    if (busy || F.saving) return;
    setBusy(true); setFailure('');
    try {
      const id = await flush();
      allowed.current = true;
      navigate(`/sales/new?draft=${encodeURIComponent(id)}`, { state: { fullView: true } });
    } catch (error) { setFailure(error instanceof Error ? error.message : problemOf(error).message); }
    finally { setBusy(false); }
  };
  const discard = () => {
    if (busy || F.saving) return;
    if (!F.draftId && hasBill) {
      const id = newDraftId();
      flushSync(() => F.setDraftId(id));
      // The shared layer records the snapshot synchronously and serializes PUT/DELETE; Undo has something to restore.
      void keep(id, F.f.firmId, toDraftData(F.f, F.start.replaces));
    }
    drafts.discard(); allowed.current = true; blocker.reset?.(); navigate('/e');
  };
  // Internal navigation preserves this shell. A permitted customer return must not disable later leave checks.
  useEffect(() => { if (blocker.state === 'unblocked') allowed.current = false; }, [blocker.state]);
  return <>
    <fieldset disabled={busy || F.saving} className="contents">
      <Outlet context={{ onCustomerDirty, fullView: () => { void fullView(); }, busy } satisfies BillView} />
    </fieldset>
    {failure && <p role="alert" className="px-4 py-3 text-neg">{failure}</p>}
    {customerOnly ? <Dialog open title="Leave this customer?" onClose={() => blocker.reset?.()} footer={<>
      <Button onClick={() => blocker.reset?.()}>Keep editing</Button>
      <Button variant="danger-outline" onClick={() => { onCustomerDirty(false); proceed(); }}>Leave customer</Button>
    </>}><p>This customer isn't saved yet. Leaving loses what you typed about them. The bill stays as it was.</p></Dialog> : <LeaveBillDialog
      open={blocker.state === 'blocked'} name={F.cust?.name ?? 'The customer'} busy={busy || F.saving}
      error={failure || (customerDirty ? "The customer details aren't saved. Keeping this bill won't add them." : '')}
      onStay={() => blocker.reset?.()} onKeep={() => { void keepAndLeave(); }}
      onThrow={discard} />}
  </>;
}

export function ItemsRoute() {
  const { F, drafts } = useEasyBill();
  const { fullView, busy } = useOutletContext<BillView>();
  const { can, whyNot } = useAuth();
  const navigate = useNavigate();
  const offline = useNetwork() === 'offline';
  const products = useEasyProducts(F.f.firmId);
  const create = useCreateProduct();
  const [newItem, setNewItem] = useState(false);
  const [focus, setFocus] = useState<BillItemsProps['focus']>();
  const [numberFocus, setNumberFocus] = useState<{ field: 'number' | 'date'; key: number }>();
  const [unsupportedKey, setUnsupportedKey] = useState('');
  const unsupported = unsupportedKey ? F.errors[unsupportedKey] || F.saveError?.body || '' : '';
  const rate = billRateNotices(F.f.lines, products.data ?? [], F.rates, F.f.date);
  const notices: Record<string, LineNotice[]> = {};
  for (const line of F.f.lines) {
    const weight = weightSlip(line), slip = rate.ratesByLine[line.key];
    notices[line.key] = [
      ...(weight ? [{ text: weight.text, field: 'qty' as const, ...(weight.fix !== null ? { fix: { label: weight.fixLabel, patch: { qty: weight.fix } } } : {}) }] : []),
      ...(slip ? [{ text: slip.text, field: 'rate' as const, fix: { label: slip.label, patch: { rate: slip.fix } } }] : []),
    ];
  }
  const checks = unusual(F.f, { total: F.figs.total, inter: F.tt.inter, twin: F.checks.find(check => check.key === 'twin')?.text ?? '', itax: F.itax, rates: rate.ratesByLine });
  const step = nextBillStep(F.f.lines, F.f.payment, F.figs.total);
  const goPay = () => document.querySelector<HTMLElement>('[role="radiogroup"][aria-labelledby="easy-paid-t"] [role="radio"]:not([disabled])')?.focus();
  const refused = (key: string) => {
    if (key === 'customer') { navigate('/e/new'); return; }
    if (key === 'number' || key === 'date') { setNumberFocus({ field: key, key: Date.now() }); return; }
    if (key === 'payment') { goPay(); return; }
    const line = F.f.lines.find(item => key.startsWith(`${item.key}-`));
    const field = line ? key.slice(line.key.length + 1) : '';
    if (line && ['qty', 'rate', 'hsn', 'gst', 'product'].includes(field)) {
      setFocus({ key: line.key, field: field as NonNullable<BillItemsProps['focus']>['field'] }); return;
    }
    if (key === 'lines') { document.getElementById('easy-what-t')?.scrollIntoView({ block: 'center' }); return; }
    setUnsupportedKey(key);
  };
  const next = () => {
    if (step.kind === 'qty' || step.kind === 'rate') { setFocus({ key: step.key!, field: step.kind }); return; }
    if (step.kind === 'payment') { goPay(); return; }
    if (step.kind === 'items') { document.querySelector<HTMLElement>('[aria-labelledby="easy-what-t"] button')?.focus(); return; }
    const answer = F.openReview(); if (!answer.ok) refused(answer.first);
  };
  const save = async (numberOverride?: string) => {
    const answer = await F.save({ numberOverride });
    if (answer.refused) refused(answer.refused);
  };
  const add = async ({ line, keep, kind, purity }: EasyNewItem) => {
    const added = keep && can('product.edit') ? lineFromProduct(await create.mutateAsync({ name: line.name, hsn_code: line.hsn, gst_percent: line.gst!, unit: line.unit, description: line.note, kind, purity }), blankLine()) : line;
    F.addLine(false, added); setNewItem(false); focusSoon(`${added.key}-qty`);
  };
  const errors = Object.fromEntries(Object.keys(F.errors).map(key => [key, F.showErr(key)]).filter(([, words]) => words));
  const no = counterOf(F.stored) ?? F.numberText;
  const origin = F.start.origin;
  const copied = origin?.kind === 'remake' ? F.start.form.lines : [];
  return <EasyPage title="New bill" subtitle={`Bill No. ${no}`} docTitle="New bill · items" back="/e" bar={<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
    <div className="flex flex-col justify-center min-w-[120px]"><span className="caps">Total</span>{F.f.lines.some(line => (line.qty ?? 0) > 0 && Number(line.rate) > 0) ? <Money value={F.figs.total} size="2xl" tone="sale" bump /> : <span className="text-md text-muted">Nothing yet</span>}</div>
    <Button variant="primary" size="xl" disabled={!can('bill.create') || busy} onClick={next} className="!px-4 flex-1 min-w-[150px]">{step.label}</Button>
  </div>}>
    <FirmPill firm={{ name: F.firmName }} />
    <div className="[&_.text-xs]:!text-md -mt-1"><Steps step={2} total={2} label="What they are buying" /></div>
    {origin?.kind === 'draft' && <p className="text-md text-fg2">Finishing the bill {origin.startedBy?.name ?? 'someone'} started at {timeOf(origin.startedAt)}.</p>}
    {origin?.kind === 'remake' && <p className="text-md text-brand">Making bill {counterOf(origin.number) ?? origin.number} again{origin.reason ? ` (${origin.reason.toLowerCase()})` : ''}: correct what was wrong, then save.</p>}
    <section aria-label="Customer" className="card p-4 flex items-center gap-3"><div className="flex-1 min-w-0"><p className="caps">Customer</p><p className="text-lg font-medium break-words mt-0.5">{F.cust?.name ?? 'Choose a customer'}</p><p className="text-md text-muted">{F.cust?.type === 'walkin' ? 'No name or phone needed' : maskPhone(F.cust?.mobile_number ?? '')}</p>{F.tt.inter && <p className="text-md text-fg2">Another state, so GST is charged as IGST.</p>}</div><Button onClick={() => navigate('/e/new')}>Change</Button></section>
    <QueryView query={products} what="the item list">{list => <BillItems lines={F.f.lines} products={list} canEditProducts={can('product.edit')} errors={errors} notices={notices} references={rate.references} copied={copied} focus={focus} onChange={F.setLine} onAdd={line => F.addLine(false, line)} onRemove={line => F.removeLine(line.key)} onNew={() => setNewItem(true)} />}</QueryView>
    <section className="card p-4 flex flex-col gap-3"><h2 id="easy-paid-t" className="text-lg font-semibold">How did they pay?</h2><PayChoice value={F.f.payment} onChange={F.setPayment} disabled={{ credit: F.cust?.type === 'walkin' }} />
      {F.cust?.type === 'walkin' && <p className="text-md text-muted">Udhaar needs the customer's name and phone. <Button onClick={() => navigate('/e/new/customer')}>Add them.</Button></p>}
      {F.cashOver && <div role="alert"><p>{cashWords(F.figs.total)}</p><Button onClick={() => F.setPayment('mixed')}>Choose Part cash</Button></div>}
    </section>
    <BillNumber F={F} focus={numberFocus} />
    {offline && <p role="status">{!keepsOnDevice() ? "This browser doesn't store unfinished bills, so this one lasts only while this page is open." : "You're offline. Your bill is kept on this phone; save it when the internet is back."}</p>}
    {drafts.refusal && <p role="alert">{drafts.refusal}</p>}
    {unsupported && <div role="alert"><p>{unsupported}</p><Button onClick={fullView}>Finish in the full view</Button></div>}
    {newItem && <NewItemSheet open products={products.data ?? []} canKeep={can('product.edit')} onClose={() => setNewItem(false)} onAdd={add} onUseExisting={product => { const line = lineFromProduct(product, blankLine()); F.addLine(false, line); setNewItem(false); focusSoon(`${line.key}-qty`); }} />}
    <BillReview F={F} checks={checks} paymentWords={paidWords(F.f.payment)} offline={offline} canSave={can('bill.create')} visitOnly={!keepsOnDevice()} whyNot={whyNot('bill.create', 'make bills')} onSave={number => { void save(number); }} onFullView={fullView} />
  </EasyPage>;
}
