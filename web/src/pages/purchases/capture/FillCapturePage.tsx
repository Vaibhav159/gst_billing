import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Eye, ImageOff, Inbox, Lock, MessageSquareText, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { useAuth } from '@/core/auth/AuthProvider';
import { captureProblem, useCapture, useCaptureAction } from '@/core/api/captures';
import { PhotoViewer, ReadingChecks } from '@/core/captures/PhotoViewer';
import { checkWords, useReadConfidence } from '@/core/captures/confidence';
import type { Capture, PurchaseRead, ReadGroup } from '@/core/captures/types';
import { toPurchaseRead } from '@/core/purchases/wire';
import { plural } from '@/core/format';
import { useView } from '@/core/view';
import { Banner, Button, ButtonLink, Card, EmptyState, Page, QueryView } from '@/core/ui';
import { PurchaseCaptureForm } from '../form/PurchaseCaptureForm';
import { captureTitle, captureWhen, CaptureStatus, DiscardCaptureDialog } from './parts';

const crumbs = [{ label: 'Purchases', to: '/purchases' }, { label: 'Captured bills', to: '/purchases/inbox' }];
function Unavailable({ capture }: { capture?: Capture }) {
  return <Page icon={Inbox} title="Captured bill" breadcrumbs={crumbs} back="/purchases/inbox"><Card>
    <EmptyState icon={Inbox} title="This photo isn't in the inbox any more" actions={<>
      {capture?.purchase ? <ButtonLink variant="primary" to={`/purchases/${capture.purchase.id}`}>Open the purchase</ButtonLink> : null}
      <ButtonLink to="/purchases/inbox" variant={capture?.purchase ? 'outline' : 'primary'}>Open the inbox</ButtonLink><ButtonLink to="/purchases">Purchases</ButtonLink>
    </>}>Someone has already filled it in or discarded it. Filled-in bills are in Purchases, marked “From a photo”.</EmptyState>
  </Card></Page>;
}
export default function FillCapturePage() {
  const { id } = useParams();
  const captureId = id && /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) > 0 ? Number(id) : null;
  const capture = useCapture(captureId);
  const gone = capture.isError && captureProblem(capture.error).kind === 'notfound';
  if (captureId === null || gone && !capture.data) return <Unavailable />;
  if (!capture.data) return <Page icon={Inbox} title="Fill in a captured bill" breadcrumbs={crumbs} back="/purchases/inbox"><QueryView query={capture} what="this photo">{() => null}</QueryView></Page>;
  return <Fill key={captureId} capture={capture.data} gone={gone} refreshing={capture.isFetching} refresh={() => { void capture.refetch(); }} refreshError={capture.isError && !gone ? captureProblem(capture.error).message : ''} />;
}

function Fill({ capture, gone, refreshing, refresh, refreshError }: { capture: Capture; gone: boolean; refreshing: boolean; refresh(): void; refreshError: string }) {
  const { can, whyNot, me } = useAuth(); const { isPhone } = useView(); const navigate = useNavigate();
  const [accepted, setAccepted] = useState<PurchaseRead | null>(capture.status === 'ready' ? capture.read : null);
  const [revision, setRevision] = useState(0); const [dirty, setDirty] = useState(false); const [saving, setSaving] = useState(false);
  const [arrived, setArrived] = useState(false); const [discard, setDiscard] = useState(false); const [discarded, setDiscarded] = useState(false);
  const [focus, setFocus] = useState<ReadGroup | null>(null); const [readError, setReadError] = useState('');
  const seen = useRef(capture.read); const confidence = useReadConfidence(accepted);
  const read = useMemo(() => accepted ? toPurchaseRead(accepted) : null, [accepted]);
  const reader = useCaptureAction('read');
  const busy = saving || reader.isPending || discard;
  const allowed = can('purchase.create');
  const removable = can('capture.discard') || can('capture') && capture.captured_by?.id === me?.id;
  // Filled, discarded or gone on a refresh: nothing more can be saved from this photo.
  const terminal = gone || capture.status === 'filled' || capture.status === 'discarded';
  useEffect(() => {
    if (readError && (capture.status === 'ready' || terminal)) setReadError('');
  }, [capture.status, terminal, readError]);
  // A refresh updates status; only an accepted reading may replace the real form's keyed instance.
  useEffect(() => {
    if (capture.status !== 'ready' || !capture.read || seen.current === capture.read) return;
    seen.current = capture.read;
    if (dirty || saving || Object.values(confidence.confirmed).some(Boolean)) setArrived(true);
    else { setAccepted(capture.read); setRevision(v => v + 1); setArrived(false); }
  }, [capture.read, capture.status, dirty, saving, confidence.confirmed]);
  // Remove the editor (and its one leave guard) before leaving after an intentional discard.
  useEffect(() => { if (discarded) void navigate('/purchases/inbox', { replace: true }); }, [discarded, navigate]);
  if (discarded) return null;
  // A save can refresh this capture to filled before the form publishes onSaved. Typed work is never unmounted (X-62).
  if (terminal && !saving && !discard && !dirty) return <Unavailable capture={capture} />;

  const accept = () => {
    if (busy || !allowed || !capture.read || capture.status !== 'ready') return;
    setAccepted(capture.read); setRevision(v => v + 1); setDirty(false); setArrived(false); setFocus(null);
  };
  const retry = () => {
    if (busy || !can('capture') || capture.status !== 'failed') return;
    setReadError(''); void reader.mutateAsync(capture.id).catch(error => setReadError(captureProblem(error).message));
  };
  const confirm = (group: ReadGroup) => { if (!busy && allowed) confidence.confirm(group); };
  let banner;
  if (terminal) banner = <Banner tone="neg" icon={Inbox} title={gone ? "This photo isn't in the inbox any more" : capture.status === 'filled' ? 'Someone has already filled in this bill' : 'Someone discarded this photo'}
    actions={capture.purchase ? <ButtonLink size="sm" to={`/purchases/${capture.purchase.id}`}>Open the purchase</ButtonLink> : undefined}>What you typed is still here until you leave this page, but it can't be saved from this photo.</Banner>;
  else if (!allowed) banner = <Banner tone="muted" icon={Lock} title="You can look at this photo, but not fill it in">{whyNot('purchase.create')}</Banner>;
  else if (capture.status === 'reading') banner = <Banner tone="file" title="Reading the bill…">The form fills itself in when it's done, in a few seconds. You can start typing now; nothing you type gets replaced.</Banner>;
  else if (capture.status === 'failed') banner = <Banner tone="neg" icon={ImageOff} title="Couldn't read this photo" actions={can('capture') ? <Button size="sm" icon={RefreshCw} loading={reader.isPending} disabled={busy} onClick={retry}>Try reading again</Button> : undefined}>{capture.problem || "The photo couldn't be read."} The photo stays here: fill the bill in by hand from it, or try reading again.</Banner>;
  else if (arrived) banner = <Banner tone="file" title="The bill has been read" actions={<Button size="sm" variant="primary" disabled={busy} onClick={accept}>Use what was read</Button>}>You had already started typing, so nothing was replaced.</Banner>;
  else if (confidence.pending.length) banner = <Banner tone="brand" icon={Eye} title={`${plural(confidence.pending.length, 'thing')} to check against the photo`}>The highlighted {confidence.pending.map(k => checkWords[k]).join(', ')} {confidence.pending.length === 1 ? 'was' : 'were'} read with medium confidence. Correct {confidence.pending.length === 1 ? 'it' : 'them'}, or press Looks right.</Banner>;
  else if (accepted?.source === 'e-invoice') banner = <Banner tone="sale" icon={Sparkles} title="From the e-invoice">An IRN was read from this bill. Check the GST slab and save.</Banner>;
  else if (accepted) banner = <Banner tone="sale" icon={Sparkles} title="Read from the photo">{Object.values(accepted.confidence).every(value => value === 'high') ? 'Everything was read with high confidence. Glance over it and save.' : 'The fields read with medium confidence have been checked. Glance over it and save.'}</Banner>;
  const title = captureTitle(capture); const when = captureWhen(capture); const firm = capture.business_name || 'Firm decided later';
  const hint = capture.hint || capture.note ? <p className="text-sm text-fg2 inline-flex gap-1.5"><MessageSquareText size={15} className="shrink-0 mt-0.5 text-muted" aria-hidden="true" />{[capture.hint ? `Supplier noted at capture: ${capture.hint}` : '', capture.note ? `Note: “${capture.note}”` : ''].filter(Boolean).join(' · ')}</p> : null;
  const original = <div className="flex flex-col gap-3">{hint}<PhotoViewer pages={capture.pages} label={`Photo of ${title}`} height={isPhone ? '32vh' : 'max(460px, calc(100vh - 250px))'} />{accepted ? <ReadingChecks read={accepted} confirmed={confidence.confirmed} onConfirm={allowed && !busy ? confirm : undefined} focusKey={focus} /> : null}</div>;
  return <Page icon={Inbox} title="Fill in a captured bill" phoneTitle="Fill in" phoneSubtitle={`${title} · ${firm}`} back="/purchases/inbox" breadcrumbs={crumbs}
    context={`${title} · ${firm} · captured ${when} by ${capture.captured_by?.name || 'someone'}${capture.note ? ` · “${capture.note}”` : ''}`}
    actions={<Button size="sm" icon={RefreshCw} loading={refreshing} disabled={busy} onClick={refresh}>Check again</Button>}
    phoneActions={<Button size="sm" disabled={busy || refreshing} onClick={refresh}>Check again</Button>}>
    {banner}{readError || refreshError ? <Banner tone="neg">{readError || refreshError}</Banner> : null}
    <div className={isPhone ? 'flex flex-col gap-4' : 'grid grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] gap-5 items-start'}>
      {isPhone ? original : <Card title={capture.pdf ? 'Bill (PDF)' : 'Bill photo'} subtitle={`${plural(capture.pages.length, 'page')} · captured ${when} by ${capture.captured_by?.name || 'someone'}`} actions={<CaptureStatus capture={capture} />}>{original}</Card>}
      <div className="flex flex-col gap-4 min-w-0 [&>div.grid]:grid-cols-1 [&>div.grid>div.sticky]:static">
        <PurchaseCaptureForm key={`${capture.id}:${revision}`} captureId={capture.id} businessId={capture.business} read={read}
          confirmed={confidence.confirmed} onConfirm={confirm} disabled={reader.isPending || discard || terminal}
          onFocusGroup={group => setFocus(group === 'buyer' ? null : group)} onDirtyChange={setDirty} onBusyChange={setSaving}
          onSaved={bill => { void navigate(`/purchases/${bill.id}?from=capture`, { replace: true }); }} />
        {removable && !terminal ? <Button variant="danger-outline" icon={Trash2} full disabled={busy} onClick={() => setDiscard(true)}>Discard photo</Button> : null}
      </div>
    </div>
    <DiscardCaptureDialog capture={discard ? capture : null} typed={dirty} onClose={() => setDiscard(false)} onDone={() => setDiscarded(true)} />
  </Page>;
}
