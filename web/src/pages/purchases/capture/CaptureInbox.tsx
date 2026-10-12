import { useState } from 'react';
import { Camera, Inbox } from 'lucide-react';
import { useAuth } from '@/core/auth/AuthProvider';
import { useCaptures } from '@/core/api/captures';
import type { Capture } from '@/core/captures/types';
import { useUploads } from '@/core/captures/useUploads';
import { PhotoDialog } from '@/core/captures/PhotoViewer';
import { useScope } from '@/core/scope';
import { useView } from '@/core/view';
import { plural } from '@/core/format';
import { ButtonLink, Card, EmptyState, Page, QueryView } from '@/core/ui';
import { AddPhotosCard, captureTitle, CaptureRow, DeviceRows, DiscardCaptureDialog } from './parts';

export default function CaptureInbox() {
  const { isPhone } = useView();
  const { can } = useAuth();
  const { firmId } = useScope();
  const captures = useCaptures(isPhone ? 'all' : firmId);
  const uploads = useUploads();
  const [discard, setDiscard] = useState<Capture | null>(null);
  const [photo, setPhoto] = useState<Capture | null>(null);
  const counts = captures.data?.counts;
  const breakdown = counts ? [counts.ready ? `${counts.ready} ready` : '', counts.reading ? `${counts.reading} reading` : '', counts.failed ? `${counts.failed} couldn't be read` : '', counts.no_firm ? `${counts.no_firm} without a firm` : ''].filter(Boolean).join(' · ') : '';
  const list = <QueryView query={captures} what="the captured bills">{(data) => data.results.length ? <Card pad={false}>{data.results.map((capture) => <CaptureRow key={capture.id} capture={capture} onDiscard={setDiscard} onPhoto={setPhoto} onRefresh={() => void captures.refetch()} />)}</Card> : <Card><EmptyState icon={Inbox} title="No captured bills waiting" actions={can('capture') ? <ButtonLink to="/capture" variant="primary" icon={Camera}>Capture a bill</ButtonLink> : undefined}>Photos of supplier bills wait here until someone fills them in. Take them on the counter phone's Capture tab{isPhone ? '.' : ', or drop them on this page.'}</EmptyState></Card>}</QueryView>;
  return <Page icon={Inbox} title="Captured bills to fill in" phoneTitle="Captured bills" back="/capture" breadcrumbs={[{ label: 'Purchases', to: '/purchases' }]} context={`${breakdown}${breakdown ? ' · ' : ''}not in purchases or the credit until filled in`} phoneSubtitle={captures.data ? `${plural(captures.data.count, 'bill')} to fill in${breakdown ? ` · ${breakdown}` : ''}` : undefined} actions={can('purchase.create') ? <ButtonLink to="/purchases/new">Add a purchase by hand</ButtonLink> : undefined} actionBar={isPhone && can('capture') ? <ButtonLink to="/capture" variant="primary" size="lg" icon={Camera}>Capture a bill</ButtonLink> : undefined}>
    {isPhone ? <p className="text-sm text-muted">Not in purchases or the credit until filled in. Tap a photo to see it.</p> : null}
    {uploads.items.length || uploads.error ? <Card title={`${plural(uploads.items.length, 'photo')} on this ${isPhone ? 'phone' : 'computer'}`} subtitle="Not in the inbox yet" pad={false}><DeviceRows uploads={uploads} /></Card> : null}
    {isPhone ? list : <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-5 items-start"><div>{list}</div><div className="flex flex-col gap-4">{can('capture') ? <AddPhotosCard uploads={uploads} /> : null}<Card title="From photo to purchase"><ol className="list-decimal pl-5 space-y-2 text-sm text-fg2"><li>Take a photo or add a PDF. The app reads it.</li><li>Fill in shows the bill beside the form, with anything unsure highlighted.</li><li>Saved bills move to Purchases and count in the month's input tax credit.</li></ol></Card></div></div>}
    <DiscardCaptureDialog capture={discard} onClose={() => setDiscard(null)} />
    {photo ? <PhotoDialog open onClose={() => setPhoto(null)} title={`Photo · ${captureTitle(photo)}`} pages={photo.pages} /> : null}
  </Page>;
}
