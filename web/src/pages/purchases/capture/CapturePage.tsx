import { useState } from 'react';
import { Camera, Inbox, Lock } from 'lucide-react';
import { useAuth } from '@/core/auth/AuthProvider';
import { useCaptures } from '@/core/api/captures';
import type { Capture } from '@/core/captures/types';
import { useUploads } from '@/core/captures/useUploads';
import { todayIST, plural } from '@/core/format';
import { useView } from '@/core/view';
import { Banner, ButtonLink, Card, Page, QueryView } from '@/core/ui';
import { PhotoDialog } from '@/core/captures/PhotoViewer';
import { AddPhotosCard, captureTitle, CaptureRow, DeviceRows, DiscardCaptureDialog } from './parts';

export default function CapturePage() {
  const { isPhone } = useView();
  const { can, whyNot } = useAuth();
  const captures = useCaptures('all', 'all');
  const uploads = useUploads();
  const [discard, setDiscard] = useState<Capture | null>(null);
  const [photo, setPhoto] = useState<Capture | null>(null);
  const list = <Card title="Captured today" subtitle={isPhone ? undefined : 'All firms'} pad={false} actions={<ButtonLink size="sm" variant="link" to="/purchases/inbox">Inbox</ButtonLink>}>
    <DeviceRows uploads={uploads} />
    <QueryView query={captures} what="today's captures">{(data) => {
      const waiting = data.counts.reading + data.counts.ready + data.counts.failed;
      const today = data.results.filter((capture) => capture.status !== 'discarded' && todayIST(new Date(capture.captured_at)) === todayIST());
      return <>{today.length ? today.map((capture) => <CaptureRow key={capture.id} capture={capture} onDiscard={setDiscard} onPhoto={setPhoto} onRefresh={() => void captures.refetch()} />) : !uploads.items.length ? <p className="px-5 pb-5 text-fg2">Nothing captured today. Bills wait in the inbox until someone fills them in.</p> : null}
        <div className="border-t border-rule px-4 py-3 flex items-center justify-between gap-3"><span className="text-sm text-fg2">{waiting ? `${plural(waiting, 'captured bill')} waiting in the inbox` : 'The inbox is empty'}</span>{waiting ? <ButtonLink variant="link" to="/purchases/inbox">{can('purchase.create') ? 'Fill in now' : 'Open the inbox'}</ButtonLink> : null}</div></>;
    }}</QueryView>
  </Card>;
  return <Page logo={isPhone} icon={Camera} title="Capture supplier bills" phoneTitle="Capture a supplier's bill" phoneSubtitle="For purchases · snap it now, fill it in later" breadcrumbs={[{ label: 'Purchases', to: '/purchases' }]} context="Photos and PDFs wait in the inbox until someone fills them in. They're not in purchases or the credit until then." actions={<ButtonLink to="/purchases/inbox" icon={Inbox}>Open the inbox</ButtonLink>}>
    <div className={isPhone ? 'flex flex-col gap-4' : 'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5 items-start'}>
      {can('capture') ? <AddPhotosCard key={isPhone ? 'phone' : 'desktop'} uploads={uploads} phone={isPhone} /> : <Banner tone="muted" icon={Lock}>{whyNot('capture')}</Banner>}
      {list}
    </div>
    {!isPhone ? <p className="text-sm text-muted">On the counter phone, the Capture tab takes the photo with the camera in one tap.</p> : null}
    <DiscardCaptureDialog capture={discard} onClose={() => setDiscard(null)} />
    {photo ? <PhotoDialog open onClose={() => setPhoto(null)} title={`Photo · ${captureTitle(photo)}`} pages={photo.pages} /> : null}
    <span className="sr-only" aria-live="polite">{captures.data?.counts.reading ? 'Reading the bill' : ''}</span>
  </Page>;
}
