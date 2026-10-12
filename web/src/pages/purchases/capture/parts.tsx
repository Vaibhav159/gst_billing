import { useEffect, useRef, useState } from 'react';
import { Camera, Clock, CloudOff, FileText, ImageOff, Images, RefreshCw, UploadCloud, X } from 'lucide-react';
import { useAuth } from '@/core/auth/AuthProvider';
import { captureProblem, useCaptureAction } from '@/core/api/captures';
import type { Capture } from '@/core/captures/types';
import { useUploads } from '@/core/captures/useUploads';
import { fileProblem, MAX_FILES } from '@/core/captures/files';
import { useFirms } from '@/core/scope';
import { usePrefs } from '@/core/prefs';
import { readStored, writeStored } from '@/core/storage';
import { date, plural, toPaise } from '@/core/format';
import { useView } from '@/core/view';
import { Banner, Button, ButtonLink, BusyText, Card, ConfirmDialog, Dialog, Field, Input, Money, Select, PhoneActionBar, useToast } from '@/core/ui';

export const captureTitle = (capture: Capture) => capture.read?.supplier.name || capture.hint || capture.label;
export const captureWhen = (capture: Capture) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(capture.captured_at));
export function CaptureStatus({ capture }: { capture: Capture }) {
  if (capture.status === 'reading') return <BusyText className="text-file font-medium text-sm">Reading the bill…</BusyText>;
  if (capture.status === 'failed') return <span className="inline-flex items-center gap-1.5 text-neg font-medium text-sm"><ImageOff size={15} aria-hidden="true" />Couldn't read this photo</span>;
  if (capture.status === 'filled') return <span className="text-brand text-sm">Saved as a purchase</span>;
  if (capture.status === 'discarded') return <span className="text-muted text-sm">Set aside</span>;
  return <span className="inline-flex items-center gap-1.5 text-brand font-medium text-sm"><Clock size={15} aria-hidden="true" />Ready to fill in</span>;
}
function DeviceThumb({ file }: { file: File | undefined }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file || !file.type.startsWith('image/') || typeof URL.createObjectURL !== 'function') return;
    const next = URL.createObjectURL(file); setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? <img src={url} alt="" onError={() => setUrl(null)} className="w-14 h-[72px] object-cover rounded-[4px] border border-line" /> : <FileText aria-hidden="true" className="w-14 h-[72px] text-muted shrink-0" />;
}
export function DeviceRows({ uploads }: { uploads: ReturnType<typeof useUploads> }) {
  const { isPhone } = useView();
  const device = isPhone ? 'phone' : 'computer';
  const { firms } = useFirms();
  const [problem, setProblem] = useState('');
  const run = (promise: Promise<void>) => { setProblem(''); void promise.catch((error) => setProblem(error instanceof Error ? error.message : 'The files could not be changed. Try again.')); };
  return <>{problem ? <Banner tone="neg">{problem}</Banner> : null}{uploads.error ? <Banner tone="neg">{uploads.error}</Banner> : null}{uploads.items.map((item) => {
    const busy = uploads.busy === item.clientId;
    return <div key={item.clientId} data-row={item.clientId} className="flex flex-wrap gap-3 px-4 py-3 border-t border-rule first:border-t-0">
      <DeviceThumb file={item.files[0]} />
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <p className="font-medium break-words">{item.hint || item.files[0]?.name}</p>
        <p className="text-sm text-muted">{item.businessId ? firms.find((firm) => firm.id === item.businessId)?.name || 'Buying firm' : 'Firm decided later'} · {new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }).format(new Date(item.createdAt))} · {plural(item.files.length, 'page')} · {(item.files.reduce((sum, file) => sum + file.size, 0) / 1048576).toFixed(1)} MB</p>
        {busy ? <BusyText className="text-file text-sm">{item.phase === 'uploaded' ? 'Reading the bill…' : 'Uploading…'}</BusyText>
          : item.missing ? <p className="text-sm text-muted">Capture no longer available</p> : item.phase === 'uploaded' ? <p className="text-sm text-amber">Uploaded: waiting to be read</p>
            : <span className="inline-flex items-center gap-1.5 text-neg font-medium text-sm"><CloudOff size={15} aria-hidden="true" />Not uploaded: kept on this {device}</span>}
        {!busy ? <p className="text-sm text-fg2">{item.error ? `${item.error.replace(/\.$/, '')}. ` : ''}{item.missing ? '' : item.phase === 'uploaded' ? 'The photo is in the inbox. Open it to check the reading.' : "The photo isn't lost: it goes up by itself when the internet is back."}</p> : null}
      </div>
      {!busy ? <div className="flex gap-2 flex-wrap">{!item.missing && <Button size="sm" icon={RefreshCw} onClick={() => run(uploads.retry(item.clientId))}>Try now</Button>}{item.phase === 'queued' || item.missing ? <Button size="sm" variant="ghost" icon={X} onClick={() => run(uploads.remove(item.clientId))}>Remove from this {device}</Button> : <ButtonLink size="sm" to={`/purchases/inbox/${item.captureId}`}>Open the inbox</ButtonLink>}</div> : null}
    </div>;
  })}</>;
}
export function AddPhotosCard({ uploads, phone = false }: { uploads: ReturnType<typeof useUploads>; phone?: boolean }) {
  const { me } = useAuth();
  const toast = useToast();
  const { firms, loading, error: firmError } = useFirms();
  const { prefs, ready } = usePrefs();
  const key = `gst3.capture.firm.${me?.id ?? 'signed-out'}`;
  const [firm, setFirm] = useState<string | null>(() => readStored(key));
  const [hint, setHint] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<File[]>([]);
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const selected = firm ?? (ready ? String(prefs.defaultBusinessId || 'later') : 'later');
  const value = selected !== 'later' && firms.some((f) => String(f.id) === selected) ? selected : '';
  const add = async (files: File[], asPages: boolean) => {
    if (saving) return;
    setSaving(true); setProblem('');
    try { await uploads.add(files, { businessId: value ? Number(value) : null, hint: hint.trim(), note: note.trim(), asPages }); setPending([]); setHint(''); setNote(''); }
    catch (error) { setProblem(error instanceof Error ? error.message : "The files couldn't be kept. Try again."); }
    finally { setSaving(false); }
  };
  const choose = (files: File[]) => {
    const problems = files.map(fileProblem).filter(Boolean);
    const good = files.filter((file) => !fileProblem(file));
    setProblem('');
    if (problems.length) toast.show({ title: problems.length === 1 ? "1 file wasn't added" : `${problems.length} files weren't added`, body: problems.join(' '), tone: 'neg' });
    if (good.length) setPending(good);
    if (good.length === 1) void add(good, false);
  };
  const inputChange = (element: HTMLInputElement) => { choose(Array.from(element.files || [])); element.value = ''; };
  const controls = <>
    <Field label="Buying firm" htmlFor="cap-firm" aside={<span className="text-xs text-muted">Remembered from last time</span>} hint={value ? undefined : 'Decide later: whoever fills it in picks the firm.'}>
      <Select id="cap-firm" value={value} disabled={loading || firmError || saving} onChange={(e) => { const next = e.target.value || 'later'; setFirm(next); writeStored(key, next); }} options={[{ value: '', label: 'Decide later' }, ...firms.map((f) => ({ value: String(f.id), label: f.name }))]} />
    </Field>
    {firmError ? <Banner tone="neg">The firms couldn't be loaded. Try again before adding a photo.</Banner> : null}
    <Field label="Supplier (optional)" htmlFor="cap-hint"><Input id="cap-hint" maxLength={120} value={hint} onChange={(e) => setHint(e.target.value)} placeholder="Like: Solanki Jewellers" disabled={saving} /></Field>
    <Field label="Note (optional)" htmlFor="cap-note" hint={phone ? 'Goes with the next photo, then clears.' : 'Goes with the next photos you add.'}><Input id="cap-note" maxLength={255} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Like: exhibition stall 14" disabled={saving} /></Field>
    {problem ? <Banner tone="neg">{problem}</Banner> : null}
    {pending.length === 1 && problem ? <Button icon={RefreshCw} loading={saving} onClick={() => void add(pending, false)}>Try keeping this file again</Button> : null}
    {phone ? <PhoneActionBar><button type="button" className="flex-1 basis-0 min-w-0 flex flex-col items-center justify-center gap-1 rounded-card px-2 py-3 min-h-[96px] text-center transition-[filter,transform,background-color] duration-150 active:scale-[0.98] bg-brand text-onbrand disabled:opacity-45" disabled={saving || loading || firmError} onClick={() => camera.current?.click()}><Camera size={24} aria-hidden="true" /><span className="text-md font-semibold">Take a photo</span><span className="text-xs opacity-80">Opens the camera</span></button><button type="button" className="flex-1 basis-0 min-w-0 flex flex-col items-center justify-center gap-1 rounded-card px-2 py-3 min-h-[96px] text-center transition-[filter,transform,background-color] duration-150 active:scale-[0.98] bg-raised border border-line text-fg disabled:opacity-45" disabled={saving || loading || firmError} onClick={() => input.current?.click()}><Images size={24} aria-hidden="true" /><span className="text-md font-semibold">Gallery or WhatsApp</span><span className="text-xs text-muted">Photos or PDFs</span></button></PhoneActionBar> : null}
    <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!saving && !loading && !firmError) choose(Array.from(e.dataTransfer.files)); }} className={phone ? 'flex gap-3' : 'rounded-card border-2 border-dashed border-line px-5 py-8 flex flex-col items-center gap-3 text-center'}>
      {phone ? null : <><UploadCloud className="text-brand" aria-hidden="true" /><p className="font-medium">Drop photos or PDFs here, or choose files</p></>}
      {!phone ? <Button disabled={saving || loading || firmError} onClick={() => input.current?.click()}>Choose files</Button> : null}
      <input ref={input} hidden type="file" multiple accept="image/jpeg,image/png,image/heic,image/heif,application/pdf" aria-label={phone ? 'Choose bill photos or PDFs' : 'Choose files'} onChange={(e) => inputChange(e.currentTarget)} />
      {phone ? <input ref={camera} hidden type="file" accept="image/*" capture="environment" aria-label="Take a photo of the bill" onChange={(e) => inputChange(e.currentTarget)} /> : <p className="text-sm text-muted">One bill per file, or several pages of one bill. PDF, JPEG, PNG or HEIC, up to 20 MB each.</p>}
    </div>
    <Dialog open={pending.length > 1} onClose={() => { if (!saving) setPending([]); }} title={`You chose ${pending.length} files`} description="Tell the app how to read them." size="sm">
      <div className="flex flex-col gap-2"><Button size="lg" variant="primary" full disabled={saving || pending.length > MAX_FILES} onClick={() => void add(pending, true)}>One bill with {pending.length} pages</Button><Button size="lg" full disabled={saving} onClick={() => void add(pending, false)}>{pending.length} separate bills</Button>{pending.length > MAX_FILES ? <p className="text-sm text-neg">A bill can have at most 8 pages here.</p> : null}{problem ? <p role="alert" className="text-neg">{problem}</p> : null}</div>
    </Dialog>
  </>;
  return phone ? <div className="flex flex-col gap-4">{controls}</div> : <Card title="Add bills" subtitle="Photos and PDFs from the scanner, email or WhatsApp"><div className="flex flex-col gap-4">{controls}</div></Card>;
}
function readDate(value: string | null) {
  if (!value) return '—';
  const parsed = new Date(`${value}T12:00:00Z`);
  const [year, month, day] = value.split('-').map(Number);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day ? date(value) : value || '—';
}
export function CaptureRow({ capture, onDiscard, onPhoto, onRefresh }: { capture: Capture; onDiscard(capture: Capture): void; onPhoto?: (capture: Capture) => void; onRefresh(): void }) {
  const { me, can } = useAuth();
  const { isPhone } = useView();
  const reader = useCaptureAction('read');
  const [error, setError] = useState('');
  const title = captureTitle(capture);
  const removable = !['filled', 'discarded'].includes(capture.status) && (can('capture.discard') || (can('capture') && capture.captured_by?.id === me?.id));
  return <div data-row={capture.id} className={`flex gap-4 border-t border-rule first:border-t-0 ${isPhone ? 'px-4 py-4 flex-col' : 'px-5 py-4'}`}>
    <div className="flex gap-3 min-w-0 flex-1">
      <button type="button" onClick={() => onPhoto?.(capture)} disabled={!onPhoto} aria-label={`Open the ${capture.pdf ? 'PDF' : 'photo'} of ${title}`} className="shrink-0 rounded-[4px] self-start">
        {capture.pages[0]?.preview_url ? <img src={capture.pages[0].preview_url} alt="" className="w-14 h-[72px] object-cover rounded-[4px] border border-line" /> : <FileText className="w-14 h-[72px] text-muted" aria-hidden="true" />}
      </button>
      <div className="flex-1 min-w-0 flex flex-col gap-1"><p className="font-medium leading-snug">{title}{capture.read?.invoice_number ? <span className="text-sm text-muted font-normal"> · {capture.read.invoice_number}</span> : null}</p>
        <p className="text-sm text-muted"><span className={capture.business ? '' : 'text-amber'}>{capture.business_name || 'Firm not decided'}</span> · captured {captureWhen(capture)} by {capture.captured_by?.name || 'someone'} · {plural(capture.pages.length, 'page')}</p>
        {capture.hint && !title.toLowerCase().includes(capture.hint.toLowerCase()) ? <p className="text-sm text-fg2">Supplier noted: {capture.hint}</p> : null}
        {capture.note ? <p className="text-sm text-fg2">Note: “{capture.note}”</p> : null}<CaptureStatus capture={capture} />
        {capture.status === 'failed' ? <p className="text-sm text-fg2">{capture.problem || "The photo couldn't be read."} The photo is kept.</p> : null}
        {capture.status === 'ready' && capture.read ? <p className="text-sm text-fg2">{capture.read.source === 'e-invoice' ? 'From the e-invoice' : 'Read'}: {plural(capture.read.lines.length, 'item')}, dated {readDate(capture.read.invoice_date)}, total <Money value={toPaise(capture.read.lines_total)} /></p> : null}
        {error ? <p role="alert" className="text-sm text-neg">{error}</p> : null}
      </div>
    </div>
    <div className={`flex gap-2 flex-wrap ${isPhone ? '[&>*]:flex-1' : 'flex-col items-stretch w-[176px] shrink-0'}`}>
      <ButtonLink size="sm" to={capture.status === 'filled' && capture.purchase ? `/purchases/${capture.purchase.id}` : `/purchases/inbox/${capture.id}`}>{can('purchase.create') && capture.status !== 'filled' ? capture.status === 'failed' ? 'Fill in by hand' : 'Fill in' : 'Open'}</ButtonLink>
      {capture.status === 'reading' ? <Button size="sm" onClick={onRefresh}>Check again</Button> : null}
      {capture.status === 'failed' && can('capture') ? <Button size="sm" icon={RefreshCw} loading={reader.isPending} onClick={() => { setError(''); void reader.mutateAsync(capture.id).catch((error) => setError(captureProblem(error).message)); }}>Try reading again</Button> : null}
      {removable ? <Button size="sm" variant="ghost" onClick={() => onDiscard(capture)}>Discard</Button> : null}
    </div>
  </div>;
}
export function DiscardCaptureDialog({ capture, onClose, onDone }: { capture: Capture | null; onClose(): void; onDone?: () => void }) {
  const discard = useCaptureAction('discard');
  const restore = useCaptureAction('restore');
  const toast = useToast();
  const [error, setError] = useState('');
  useEffect(() => setError(''), [capture?.id]);
  const undo = (id: number) => { void restore.mutateAsync(id).catch((error) => toast.show({ title: 'Not restored', body: captureProblem(error).message, tone: 'neg', action: { label: 'Try again', onClick: () => undo(id) } })); };
  if (!capture) return null;
  return <ConfirmDialog open onClose={onClose} title="Discard this photo?" tone="danger" confirmLabel={error ? 'Try again' : 'Discard photo'} busy={discard.isPending} busyLabel="Discarding…" record={[["Firm", capture.business_name || 'Not decided'], ['Photo', captureTitle(capture)], ['Captured', `${captureWhen(capture)} by ${capture.captured_by?.name || 'someone'}`], ['Pages', plural(capture.pages.length, 'page')]]} extra={error ? <p role="alert" className="text-neg">{error}</p> : null} onConfirm={() => {
    void discard.mutateAsync(capture.id).then(() => { onClose(); onDone?.(); toast.show({ title: 'Photo discarded', body: `${captureTitle(capture)} is out of the inbox. No purchase figures changed.`, action: { label: 'Undo', onClick: () => undo(capture.id) } }); }).catch((error) => setError(captureProblem(error).message));
  }}><p>The photo is set aside and leaves the inbox. It was never added to purchases, so no figures change.</p></ConfirmDialog>;
}