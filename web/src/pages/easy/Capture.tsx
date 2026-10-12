import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { isCancel } from 'axios';
import { Camera, Images, FileText, CheckCircle2, Trash2, Maximize2, ImageOff, X, RefreshCw, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/core/auth/AuthProvider';
import { captureKeys, captureProblem, getCapture, readCapture, useCapture, useCaptureAction } from '@/core/api/captures';
import { useNetwork, useSlow } from '@/core/api/network';
import { useUploads } from '@/core/captures/useUploads';
import { CAPTURE_ACCEPT, prepareFiles } from '@/core/captures/files';
import { captureFormData } from '@/core/captures/multipart';
import { PhotoViewer } from '@/core/captures/PhotoViewer';
import { invalidateDashboard } from '@/core/due/fresh';
import { date, inr, toPaise, todayIST } from '@/core/format';
import { Banner, Button, BusyText, ConfirmDialog, Dialog, EmptyState, IconButton, QueryView, ListSkeleton, useToast, cn } from '@/core/ui';
import { EasyPage } from './parts';
import { useEasyFirm } from './state';
import { useTodayCaptures } from './capture-summary';
import type { CaptureSummary, CaptureSummaryList } from '@/core/captures/types';
import { canRemoveCapture, captureFailure, captureLabel, createCaptureUndo, resumeInitialRead } from './capture-model';

const time = (instant: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }).format(new Date(instant));
type Pending = { files: File[]; replaces: CaptureSummary | null; firmId: number };

export default function Capture() {
  const { me, can, whyNot } = useAuth();
  const { firmId, firm, loading, error } = useEasyFirm();
  const query = useTodayCaptures(firmId, todayIST());
  const uploads = useUploads();
  const cache = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const net = useNetwork();
  const discard = useCaptureAction('discard');
  const restore = useCaptureAction('restore');
  const [selected, setSelected] = useState<Pending | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<CaptureSummary | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [photo, setPhoto] = useState<CaptureSummary | null>(null);
  const [checking, setChecking] = useState(false);
  const [watched, setWatched] = useState<Set<number> | null>(null);
  const inspected = useRef(new Set<string>());
  const operation = useRef(false);
  const readingNow = useRef(new Map<number, AbortSignal>());
  const readScope = useRef(new AbortController());
  const ok = can('capture');
  const rows = query.data?.results ?? [];
  const deviceRows = uploads.items.filter(item => item.businessId === null || item.businessId === firmId);
  const newRows = watched ? rows.filter(row => !watched.has(row.id) && row.who?.id === me?.id) : [];
  const waiting = deviceRows.length > 0 || newRows.some(row => row.status === 'reading');
  const allRead = newRows.length > 0 && newRows.every(row => row.status === 'ready');
  const chooseDisabled = !ok || firmId === null || busy || uploads.loading;

  useEffect(() => {
    const controller = new AbortController();
    readScope.current = controller;
    inspected.current.clear();
    return () => controller.abort();
  }, [me?.id, firmId, ok]);

  const inspect = async (row: CaptureSummary) => {
    if (!ok || uploads.loading || uploads.busy || row.status !== 'reading' || readingNow.current.get(row.id)?.aborted === false
      || uploads.items.some(item => item.captureId === row.id)) return;
    const { signal } = readScope.current;
    readingNow.current.set(row.id, signal);
    try {
      const result = await resumeInitialRead(row.id, id => getCapture(id, signal, me?.id), async id => {
        const capture = await readCapture(id, signal, me?.id);
        if (!signal.aborted) {
          invalidateDashboard(cache);
          void cache.invalidateQueries({ queryKey: ['ai-reads'] });
        }
        return capture;
      });
      if (signal.aborted) return;
      cache.setQueryData(captureKeys.one(row.id), result);
      await cache.invalidateQueries({ queryKey: ['captures', 'list'] });
    } catch (error) { if (!signal.aborted && !isCancel(error)) setProblem(captureProblem(error).message); }
    finally { if (readingNow.current.get(row.id) === signal) readingNow.current.delete(row.id); }
  };
  // A mount/return may resume an interrupted initial read. This effect never schedules a network timer.
  useEffect(() => {
    if (!ok || uploads.loading || uploads.busy || net === 'offline') return;
    for (const row of rows) {
      const key = `${me?.id}:${firmId}:${row.id}`;
      if (row.status === 'reading' && !uploads.items.some(item => item.captureId === row.id) && !inspected.current.has(key)) {
        inspected.current.add(key);
        void inspect(row);
      }
    }
  }, [query.data, ok, uploads.loading, uploads.busy, uploads.items, net, me?.id, firmId]);

  const checkAgain = async () => {
    if (checking) return;
    setChecking(true); setProblem('');
    try {
      const refreshed = await query.refetch();
      if (refreshed.error) throw refreshed.error;
      for (const row of refreshed.data?.results ?? []) await inspect(row);
    } catch (error) { setProblem(captureProblem(error).message); }
    finally { setChecking(false); }
  };
  const add = async (pending: Pending) => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setProblem(''); setSelected(pending);
    let validated = false;
    try {
      // Validate the whole bill before discarding a failed original; never silently drop a page.
      const [pages] = await prepareFiles(pending.files, true);
      // Include multipart framing in the shared limit; the queue assigns the actual UUID when persisting.
      captureFormData({ files: pages, business_id: pending.firmId, client_id: '00000000-0000-4000-8000-000000000000' });
      validated = true;
      let retained = { ...pending, files: pages };
      if (pending.replaces) {
        await discard.mutateAsync(pending.replaces.id);
        retained = { ...retained, replaces: null };
        setSelected(retained);
      }
      await uploads.add(pages, { businessId: retained.firmId, hint: '', note: '', asPages: true });
      setSelected(null); setWatched(new Set(rows.map(row => row.id)));
    } catch (error) { if (!validated) setSelected(null); setProblem(error instanceof Error ? error.message : captureProblem(error).message); }
    finally { operation.current = false; setBusy(false); }
  };
  const choose = (files: FileList | null, replaces: CaptureSummary | null = null) => {
    if (!files?.length || firmId === null || chooseDisabled) return;
    void add({ files: Array.from(files), replaces, firmId });
  };
  const removeNow = async (row: CaptureSummary) => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setRemoveError('');
    try {
      await discard.mutateAsync(row.id);
      setRemoving(null);
      // Hide after the server agrees, even if refreshing the list then fails.
      cache.setQueriesData<CaptureSummaryList>({ queryKey: ['captures', 'list', 'summary'] }, data => {
        if (!data || !data.results.some(item => item.id === row.id)) return data;
        return { ...data, count: Math.max(0, data.count - 1), results: data.results.filter(item => item.id !== row.id) };
      });
      const undo = createCaptureUndo(() => restore.mutateAsync(row.id));
      const runUndo = () => { void undo().catch(error => toast.show({ title: 'Not restored yet', body: captureProblem(error).message, tone: 'neg', action: { label: 'Try again', onClick: runUndo }, duration: 6000 })); };
      toast.show({ title: 'Photo removed', body: `${captureLabel(row)}, taken at ${time(row.when)}.`, tone: 'brand', duration: 6000, action: { label: 'Undo', onClick: runUndo } });
    } catch (error) {
      const words = captureProblem(error).message;
      setRemoveError(words);
      if (row.who?.id === me?.id) setProblem(words);
    } finally { operation.current = false; setBusy(false); }
  };

  if (firmId === null) return <EasyPage title="Capture" docTitle="Easy mode · Capture">
    {loading && !error ? <ListSkeleton what="the firms" /> : <p role={error ? 'alert' : undefined}>{error ? "The firms couldn't load. Try again when the internet is back." : 'No firm to bill from yet. The owner adds firms in Records.'}</p>}
  </EasyPage>;
  return <EasyPage title="Capture" subtitle={`Supplier bills · ${firm?.name ?? ''}`} docTitle="Easy mode · Capture">
    <div className="flex flex-col gap-1.5 -mt-1"><h2 className="text-2xl font-semibold leading-tight">Photo of a supplier's bill</h2><p className="text-fg2">Take a photo of the bill. It's read in a moment, and the owner fills in the rest in the full view.</p></div>
    <div className="flex flex-col gap-3">
      <FileButton primary icon={Camera} accept="image/*" capture="environment" disabled={chooseDisabled} onFiles={choose}>Take a photo</FileButton>
      <FileButton icon={Images} accept={CAPTURE_ACCEPT} multiple disabled={chooseDisabled} onFiles={choose}>Choose from gallery or WhatsApp</FileButton>
      {busy ? <BusyText className="self-center text-md text-fg2">Uploading…</BusyText> : <p className="text-md text-muted text-center">Photos and PDFs both work.</p>}
      {!ok ? <p className="text-md text-fg2">{whyNot('capture', 'take photos of supplier bills')}</p> : null}
    </div>
    {problem ? <Banner tone="neg" title={selected ? 'Not uploaded yet' : "Couldn't use that file"} actions={<IconButton label="Close this message" icon={X} onClick={() => setProblem('')} />}><p className="text-md">{problem}</p>{selected ? <><p>The selected pages are still here. Keep this page open and try again.</p><ul aria-label="Selected pages">{selected.files.map((file, index) => <li key={index}>{file.name}</li>)}</ul><Button loading={busy} onClick={() => void add(selected)}>Try again</Button></> : null}</Banner> : null}
    {uploads.error ? <Banner tone="neg" title="Couldn't load photos kept on this phone">{uploads.error}</Banner> : null}
    {deviceRows.length ? <section aria-label="Photos waiting to upload" className="card p-4 flex flex-col gap-3">{deviceRows.map(item => <div key={item.clientId} className="flex flex-col gap-2">
      <p className="font-medium">{item.files.map(file => file.name).join(', ')}</p>
      {uploads.busy === item.clientId ? <BusyText>{rows.some(row => row.status === 'reading' && row.who?.id === me?.id) ? 'Reading the bill…' : 'Uploading…'}</BusyText> : <><p className="text-neg">{item.missing ? 'Capture no longer available' : item.phase === 'uploaded' ? 'Uploaded: waiting to be read.' : net === 'offline' ? "Not uploaded yet: you're offline." : 'Not uploaded yet.'}</p><p className="text-fg2">{item.error || (item.phase === 'uploaded' ? 'The photo is in the inbox.' : 'The pages are kept on this phone. Try again when the internet is back.')}</p>{item.missing ? <Button onClick={() => { void uploads.remove(item.clientId).catch(error => setProblem(captureProblem(error).message)); }}>Remove from this phone</Button> : <Button disabled={net === 'offline'} onClick={() => { void uploads.retry(item.clientId).catch(error => setProblem(captureProblem(error).message)); }}>Try again</Button>}</>}
    </div>)}</section> : null}
    {watched && (waiting || allRead) ? <Banner tone={waiting ? 'brand' : 'sale'} icon={waiting ? RefreshCw : CheckCircle2} title={waiting ? "We're reading it" : `${newRows.length === 1 ? 'Read' : 'All read'}. Thank you.`} actions={waiting ? undefined : <IconButton label="Close this message" icon={X} onClick={() => setWatched(null)} />}><span className="text-md">The owner fills in the rest in the full view. You can take the next photo now.</span></Banner> : null}
    <section aria-labelledby="easy-photos-t" className="card">
      <div className="px-4 pt-4 pb-2"><h2 id="easy-photos-t" className="text-lg font-semibold">Today's photos</h2><p className="text-md text-muted">{firm?.name} · {date(todayIST())}</p></div>
      <QueryView query={query} what="the photo list" skeleton={<ListSkeleton rows={2} what="today's photos" />}>{data => <>{rows.length ? <ul>{rows.map(row => {
        const removable = canRemoveCapture(row, me?.id, ok, can('capture.discard'));
        return <li key={row.id} data-row={row.id} className="flex flex-col gap-2 pl-4 pr-2 py-3 border-t border-rule"><div className="flex items-center gap-3">
          <IconButton label={`Open ${captureLabel(row)}, taken at ${time(row.when)}`} icon={row.status === 'failed' ? ImageOff : FileText} onClick={() => setPhoto(row)} />
          <div className="flex-1 min-w-0"><p className="font-medium break-words">{captureLabel(row)}</p><CaptureStatus row={row} /></div>
          {removable ? <IconButton disabled={busy} label={`Remove ${captureLabel(row)}, taken at ${time(row.when)}`} icon={Trash2} onClick={() => { setRemoveError(''); if (row.who?.id === me?.id) void removeNow(row); else setRemoving(row); }} /> : null}
        </div>{row.status === 'failed' && removable && ok ? <FileButton icon={Camera} accept="image/*" capture="environment" small disabled={chooseDisabled} onFiles={files => choose(files, row)}>Take it again</FileButton> : null}</li>;
      })}</ul> : <EmptyState icon={Camera} title="No photos today" className="border-t border-rule">When a supplier hands you a bill, take a photo here. Nobody needs to type it at the counter.</EmptyState>}
      <div className="flex flex-wrap gap-2 p-4 border-t border-rule"><Button icon={RefreshCw} loading={checking} disabled={net === 'offline'} onClick={() => void checkAgain()}>Check again</Button>{query.page > 1 ? <Button disabled={query.isFetching} onClick={query.previousPage}>Previous 50</Button> : null}{data.next ? <Button loading={query.isFetching} onClick={query.nextPage}>Next 50</Button> : null}<span className="text-md text-muted self-center">{data.count} photos · page {query.page}</span></div></>}</QueryView>
    </section>
    {can('purchase.create') && rows.some(row => row.status === 'ready') ? <Button size="lg" icon={Maximize2} onClick={() => navigate('/purchases/inbox', { state: { fullView: true } })}>Fill them in now in the full view</Button> : null}
    <ConfirmDialog open={removing !== null} onClose={() => { if (!busy) setRemoving(null); }} onConfirm={() => { if (removing) void removeNow(removing); }} tone="danger" busy={busy} busyLabel="Removing…" title="Remove this photo?" confirmLabel={removeError ? 'Try removing again' : 'Remove photo'} cancelLabel="Keep it" record={removing ? [['Firm', firm?.name ?? ''], ['Photo', captureLabel(removing)], ['Taken', `${date(todayIST(new Date(removing.when)))} · ${time(removing.when)}`], ['By', (removing.who?.name || 'Someone')]] : undefined} extra={removeError ? <p role="alert" className="text-neg">Not removed yet: {removeError} The photo is still in the list.</p> : undefined}><p>{removing?.who?.name || 'Someone else'} took this photo. It leaves the list and nobody fills it in. You can undo it straight after.</p></ConfirmDialog>
    {photo ? <CapturePhoto row={photo} close={() => setPhoto(null)} /> : null}
  </EasyPage>;
}

function CaptureStatus({ row }: { row: CaptureSummary }) {
  const slow = useSlow(row.status === 'reading', 30_000);
  const pages = row.pages > 1 ? ` · ${row.pages} pages` : '';
  if (row.status === 'reading' || row.status === 'failed') return <><p className="text-md text-muted">Taken at {time(row.when)} by {(row.who?.name || 'someone')}{pages}</p>{row.status === 'reading' ? <BusyText className="text-md text-brand">{slow ? 'Taking longer than usual. You can take the next photo.' : 'Reading the bill…'}</BusyText> : <p className="flex items-start gap-1.5 text-md text-neg"><ImageOff size={16} className="shrink-0 mt-0.5" aria-hidden="true" />{captureFailure(row.problem)}</p>}</>;
  return <>{row.number || row.total !== null ? <p className="text-md tnum"><span className="text-fg2">{row.number}{row.number && row.total !== null ? ' · ' : ''}</span>{row.total !== null ? <span className="text-amber">{inr(toPaise(row.total))}</span> : null}</p> : null}<p className="flex items-center gap-1.5 text-md text-sale"><CheckCircle2 size={16} className="shrink-0" aria-hidden="true" />Read · photo taken at {time(row.when)}{pages}</p></>;
}
function CapturePhoto({ row, close }: { row: CaptureSummary; close(): void }) {
  const query = useCapture(row.id);
  return <Dialog open onClose={close} title={captureLabel(row)} size="lg"><QueryView query={query} what="this photo">{capture => <PhotoViewer pages={capture.pages} label={captureLabel(row)} />}</QueryView></Dialog>;
}
function FileButton({ icon: Icon, children, accept, capture, multiple, onFiles, primary, disabled, small }: { icon: LucideIcon; children: ReactNode; accept: string; capture?: 'environment'; multiple?: boolean; onFiles(files: FileList | null): void; primary?: boolean; disabled?: boolean; small?: boolean }) {
  return <label className={cn('relative overflow-hidden w-full rounded-card inline-flex items-center justify-center gap-2.5 transition-[background-color,border-color,transform] duration-150', small ? 'min-h-12 px-4 text-md' : 'min-h-14 px-6 text-lg', 'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand has-[:focus-visible]:outline-offset-2', disabled ? 'bg-raised text-muted border border-line cursor-not-allowed' : primary ? 'bg-brand text-onbrand font-semibold hover:bg-brand-hover cursor-pointer active:scale-[0.98]' : 'bg-raised text-fg border border-ctl-line hover:border-muted/50 cursor-pointer active:scale-[0.98]')}><Icon size={small ? 18 : 22} aria-hidden="true" /><span>{children}</span><input type="file" accept={accept} capture={capture} multiple={multiple} disabled={disabled} onChange={event => { onFiles(event.target.files); event.target.value = ''; }} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed" /></label>;
}
