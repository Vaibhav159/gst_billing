import { Download, FileCheck2, FileJson, Lock, LockOpen, Send } from 'lucide-react';
import { useAuth } from '@/core/auth/AuthProvider';
import { cn } from '@/core/cn';
import { date, dateShort, inr, monthLabel, plural } from '@/core/format';
import type { Filing, FilingInput, Month } from '@/core/gst/types';
import { Button, Card } from '@/core/ui';
import { useView } from '@/core/view';
import { AmendCard } from './AmendCard';
import { CaBundleButton } from './CaBundleButton';
import { useSplitPreference } from '@/pages/reports/period';

export type FilingAction = { type: 'mark'; kind: FilingInput['kind'] } | { type: 'edit' | 'remove'; record: Filing } | { type: 'unlock' | 'relock' } | { type: 'download'; kind: 'gstr1' | 'gstr1a' | 'gstr3b' | 'amendments' | 'share'; asFiled?: boolean; via?: 'download' | 'share' };
export type FilingCardProps = { month: Month; onAction: (action: FilingAction) => void };
const returnName = { gstr1: 'GSTR-1', gstr1a: 'GSTR-1A', gstr3b: 'GSTR-3B' };

export function FilingSteps({ month: m, onAction }: FilingCardProps) {
  const { isPhone } = useView();
  const { can } = useAuth();
  if (['open', 'future', 'unlocked'].includes(m.stage)) return null;
  const { gstr1: one, gstr3b: three } = m.record, got = m.download, n = m.checks.blockers.length;
  const where = isPhone ? ' on the portal, at the computer,' : ' on the portal';
  const stale = got?.stale && !one;
  const cash = m.gstr3b?.cash.total ?? 0;
  const changed = got?.changed.map((x) => x.invoice_number).join(', ');
  const steps = [
    // Once GSTR-1 is on record, checks are no longer a step before filing; a later failure is a correction, not the next step.
    { done: !n || Boolean(one), text: !n ? 'Checks pass' : one ? `${plural(n, 'check')} ${n === 1 ? 'fails' : 'fail'} on the books now; a fix goes in a correction` : `Fix ${plural(n, 'check')} that ${n === 1 ? 'fails' : 'fail'}`, warn: false },
    { done: !stale && (Boolean(got) || Boolean(one)), warn: Boolean(stale), text: stale ? <>{changed ? `${changed} changed after ${got.by.name} ${got.via === 'share' ? 'sent' : 'downloaded'} the file on ${dateShort(got.at.slice(0, 10))}.` : 'The books make a different file from the one downloaded.'} {can('gst.download') ? <Button size="sm" variant="link" className="align-baseline" onClick={() => onAction({ type: 'download', kind: isPhone ? 'share' : 'gstr1' })}>{isPhone ? 'Send it again' : 'Download it again'}</Button> : 'The file needs making again.'}</> : got ? `GSTR-1 file ${got.via === 'share' ? 'sent to the CA' : 'downloaded'} by ${got.by.name}, ${dateShort(got.at.slice(0, 10))}` : one ? 'GSTR-1 file not downloaded from the app' : isPhone ? 'Send the GSTR-1 file to the CA' : 'Download the GSTR-1 file' },
    { done: Boolean(one), warn: false, text: one ? `GSTR-1 filed ${date(one.filed_on)}${one.arn ? ` · ARN ${one.arn}` : ''}` : `File GSTR-1${where} then mark it filed here · due ${dateShort(m.due.gstr1)}` },
    { done: Boolean(three), warn: false, text: three ? `GSTR-3B filed ${date(three.filed_on)}${three.arn ? ` · ARN ${three.arn}` : ''} · ${inr(three.cash?.total ?? 0)} paid in cash` : `${cash > 0 ? `Pay ${inr(cash)} and file GSTR-3B` : 'File GSTR-3B (credit covers the tax)'}${where} then mark it filed here · due ${dateShort(m.due.gstr3b)}` },
  ];
  const next = steps.findIndex((x) => !x.done);
  return <ol aria-label="Filing steps" className="flex flex-col gap-1.5 text-sm">{steps.map((x, i) => <li key={i} aria-current={i === next ? 'step' : undefined} className={cn('flex items-start gap-2', x.done ? 'text-fg2' : x.warn ? 'text-neg' : i === next ? 'text-fg font-medium' : 'text-muted')}>{x.done ? <FileCheck2 size={16} className="text-sale shrink-0 mt-0.5" aria-hidden="true" /> : <span aria-hidden="true" className={cn('w-4 h-4 mt-0.5 rounded-full border grid place-items-center text-2xs shrink-0 tnum', x.warn ? 'border-neg text-neg' : i === next ? 'border-brand text-brand' : 'border-line')}>{i + 1}</span>}<span className="min-w-0">{x.text}{x.done ? <span className="sr-only"> (done)</span> : null}</span></li>)}</ol>;
}

export function FilingRecords({ month: m, onAction }: FilingCardProps) {
  const { can } = useAuth();
  return <div className="flex flex-col gap-2">{(['gstr1', 'gstr1a', 'gstr3b'] as const).map((kind) => {
    const r = m.record[kind]; if (!r) return null;
    const inUse = kind === 'gstr1' ? Boolean(m.record.gstr1a || m.record.gstr3b) : kind === 'gstr1a' && Boolean(m.record.gstr3b);
    return <section key={kind} aria-label={`${returnName[kind]} filing record`} className="rounded-ctl border border-line bg-field px-3 py-2.5 text-sm">
      <p className="font-medium">{returnName[kind]} filed {date(r.filed_on)}</p>{r.arn ? <p className="tnum text-fg2">ARN {r.arn}</p> : null}
      <p className="text-muted">Marked by {r.marked_by.name} on {date(r.marked_at.slice(0, 10))}</p>
      {r.updated_by ? <p className="text-muted">Updated by {r.updated_by.name} on {date(r.updated_at?.slice(0, 10) ?? '')}</p> : null}
      {kind === 'gstr3b' ? <p className="tnum">{inr(r.cash?.total ?? 0)} paid in cash</p> : null}
      <div className="flex flex-wrap gap-3">{can('gst.file') ? <Button size="sm" variant="link" onClick={() => onAction({ type: 'edit', record: r })}>Edit filing details</Button> : null}{can('gst.unlock') ? <Button size="sm" variant="link" disabled={inUse} title={inUse ? "Remove the later filing record first." : undefined} onClick={() => onAction({ type: 'remove', record: r })}>Remove this record</Button> : null}</div>
    </section>;
  })}</div>;
}

export function FilingCard({ month: m, onAction }: FilingCardProps) {
  const { isPhone } = useView();
  const [split] = useSplitPreference();
  const { can, whyNot, me } = useAuth();
  const visible = (action: 'gst.file' | 'gst.download' | 'gst.unlock') => can(action) || (me !== null && me.role !== 'viewer');
  const name = monthLabel(m.month, { long: true, year: false });
  if (m.stage === 'future') return null;
  if (m.stage === 'unlocked') return <AmendCard month={m} onAction={onAction} />;
  const readOnly = !visible('gst.download') && !visible('gst.file');
  const one = m.record.gstr1, filed = m.stage === 'filed', file = m.gstr1?.file;
  const fileFirst = !m.download || m.download.stale || m.checks.blockers.length > 0;
  const download = (kind: Extract<FilingAction, { type: 'download' }>['kind'], asFiled?: boolean) => onAction({ type: 'download', kind, ...(asFiled ? { asFiled } : {}) });
  const fileButton = <div><Button variant={fileFirst && !m.checks.blockers.length ? 'primary' : 'secondary'} size="lg" full icon={isPhone ? Send : Download} disabled={!file?.made || !can('gst.download')} onClick={() => download(isPhone ? 'share' : 'gstr1')}>{isPhone ? 'Send GSTR-1 file to the CA' : m.download?.stale ? 'Download the GSTR-1 file again' : 'Download GSTR-1 file for the portal'}</Button>{!can('gst.download') ? <p className="text-sm mt-1.5 text-muted">{whyNot('gst.download')}</p> : file?.why_not ? <p className="text-sm mt-1.5 text-neg">{file.why_not}</p> : file ? <div className="text-sm text-muted mt-1.5 flex flex-col gap-0.5"><span className="tnum text-fg2 break-all">{file.name}</span><span>In the file: {plural(file.b2b, 'B2B bill')} · {plural(file.b2cl, 'B2CL bill')} · {plural(file.b2cs_bills, 'B2C bill')} in {plural(file.b2cs_rows, 'summary row')} · {plural(file.hsn, 'HSN row')} · {plural(file.docs, 'document series', 'document series')}</span><span>{isPhone ? 'The CA uploads it on the GST portal at the computer.' : 'Upload it on the GST portal under GSTR-1, Prepare offline.'}</span>{isPhone ? <Button size="sm" variant="link" icon={Download} onClick={() => download('gstr1')} className="self-start">Download to this phone instead</Button> : null}</div> : null}</div>;
  const mark = one ? 'gstr3b' : 'gstr1';
  return <Card title={filed ? 'Filed returns' : one ? `GSTR-3B for ${name}` : `File ${name}`}><div className="flex flex-col gap-4">
    {m.record.legacy ? <p className="text-fg2">Filed and locked · before the app kept filing records</p> : <FilingSteps month={m} onAction={onAction} />}
    <FilingRecords month={m} onAction={onAction} />
    {readOnly ? <p className="text-sm text-muted">You can look at every return. Downloads and marking returns filed are for the owner and the accountant.</p> : <>
      {m.record.legacy && visible('gst.file') ? <Button disabled={!can('gst.file')} title={whyNot('gst.file')} onClick={() => onAction({ type: 'mark', kind: 'both' })}>Add the filing details</Button> : null}
      {m.stage === 'open' ? <p className="text-sm text-muted">{file?.why_not || `${name} is still running. The file can be made from ${date(m.due.file_from)}.`}</p> : <>
        {filed && one && visible('gst.download') ? <Button disabled={!can('gst.download')} title={whyNot('gst.download')} full size={isPhone ? 'lg' : 'md'} icon={Download} onClick={() => download('gstr1', true)}>Download GSTR-1 as filed</Button> : null}
        {!filed && !one && fileFirst && visible('gst.download') ? fileButton : null}
        {!filed && visible('gst.file') ? <div><Button disabled={!can('gst.file')} full size={isPhone ? 'lg' : 'md'} variant={one || !fileFirst ? 'primary' : 'outline'} icon={one ? Lock : FileCheck2} onClick={() => onAction({ type: 'mark', kind: mark })}>{one ? 'Mark GSTR-3B filed…' : 'Mark GSTR-1 filed…'}</Button><p className="text-sm text-muted mt-1.5">{!can('gst.file') ? whyNot('gst.file') : one ? `After you ${m.gstr3b?.cash.total ? `pay ${inr(m.gstr3b.cash.total)} and ` : ''}file GSTR-3B on the portal. Locks the whole month and keeps the figures as filed.` : m.checks.blockers.length ? 'A check fails, so the portal file stays blocked. If GSTR-1 is already on the portal, you can still record it.' : `After GSTR-1 is on the portal. Locks ${name}'s sales bills; purchases stay open for GSTR-3B.`}</p></div> : null}
        {!filed && !one && !fileFirst && visible('gst.download') ? fileButton : null}
        {!filed && !one && can('gst.file') ? <Button size="sm" variant="link" className="self-start -mt-2 !whitespace-normal" onClick={() => onAction({ type: 'mark', kind: 'both' })}><span className="text-left">Both returns already filed? Mark both at once</span></Button> : null}
        {visible('gst.download') ? <div className={cn('grid gap-2 items-start', isPhone ? 'grid-cols-1' : 'grid-cols-2')}><Button size={isPhone ? 'lg' : 'md'} icon={FileJson} disabled={!can('gst.download')} title={whyNot('gst.download')} onClick={() => download('gstr3b')}>GSTR-3B file</Button><CaBundleButton input={{ businessId: m.business, month: m.month, short: m.firm.short, gstin: m.firm.gst_number, split, includeGstr1: m.checks.blockers.length === 0 }} /></div> : null}
        {(filed || one) && visible('gst.unlock') ? <div><Button disabled={!can('gst.unlock')} full size={isPhone ? 'lg' : 'md'} variant="danger-outline" icon={LockOpen} onClick={() => onAction({ type: 'unlock' })}>{!filed && one ? `Unlock ${name}'s sales bills…` : `Unlock ${name}…`}</Button><p className="text-sm text-muted mt-1.5">{!can('gst.unlock') ? whyNot('gst.unlock') : !filed && one ? 'Only for a correction before GSTR-3B: it goes in GSTR-1A. A reason is required.' : 'Only for a correction. A reason is required and goes in the Audit log.'}</p></div> : null}
      </>}
    </>}
  </div></Card>;
}
