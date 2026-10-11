import { FilePen, Lock, Send } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '@/core/auth/AuthProvider';
import { cn } from '@/core/cn';
import { addMonths, date, inr, monthLabel, plural } from '@/core/format';
import { Button, Card } from '@/core/ui';
import { useView } from '@/core/view';
import { FilingRecords, type FilingCardProps } from './FilingCard';

const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${inr(Math.abs(value))}`;
/** The server assigns every amendment table and carrying month; the screen only presents it. */
export function AmendCard({ month: m, onAction }: FilingCardProps) {
  const { can, whyNot, me } = useAuth();
  const visible = (action: 'gst.file' | 'gst.download' | 'gst.lock') => can(action) || (me !== null && me.role !== 'viewer');
  const { isPhone } = useView();
  const plan = m.amendments, rows = m.since_filing?.rows ?? [];
  // A legacy month has both returns filed before the app, so without a plan it corrects in the next GSTR-1 (as PeriodDialog does).
  const before3b = plan?.before_gstr3b ?? (!m.record.gstr3b && !m.record.legacy);
  const name = monthLabel(m.month, { long: true, year: false });
  const next = monthLabel(plan?.carried_by ?? addMonths(m.month, 1), { long: true, year: false });
  return <Card id="gst-changes" className="scroll-mt-6" title={`Correcting ${name}`} subtitle={before3b ? `GSTR-1 filed ${date(m.record.gstr1?.filed_on ?? '')} · corrections go in GSTR-1A` : `Both returns filed · corrections go in ${next}'s GSTR-1`}>
    <div className="flex flex-col gap-4">
      <p className="text-fg2">{before3b ? `${name}'s GSTR-1 is filed and GSTR-3B isn't yet. Corrections go in GSTR-1A for ${name}, before you file GSTR-3B.` : `${name}'s GSTR-1 is filed. Corrections go in ${next}'s GSTR-1 as amendments; any tax difference is paid with ${next}'s GSTR-3B.`}</p>
      <section aria-label="Changes since filing"><p className="caps mb-1.5">Changes since filing · {rows.length ? plural(rows.length, 'bill') : 'none yet'}</p>
        {rows.length ? <ul className="flex flex-col gap-2">{rows.map((x) => <li key={`${x.id}-${x.kind}`} className="rounded-ctl border border-line bg-field px-3 py-2.5 text-sm"><div className="flex flex-wrap items-baseline justify-between gap-x-3"><span className="font-medium tnum">{x.invoice_number} <span className="text-muted font-normal">· {x.kind === 'added' ? 'added after filing' : x.kind === 'cancelled' ? 'cancelled after filing' : x.kind === 'deleted' ? 'deleted after filing' : 'changed'}</span></span><span className={cn('tnum font-semibold', x.tax_diff > 0 ? 'text-neg' : x.tax_diff < 0 ? 'text-sale' : 'text-fg2')}>{signed(x.tax_diff)} tax</span></div>
          <p className="text-fg2 tnum mt-0.5">{x.before ? <>Taxable {inr(x.before.taxable)}{x.after ? ' → ' : ''}</> : null}{x.after ? <>{x.before ? '' : 'Taxable '}{inr(x.after.taxable)}</> : null}{x.before && x.after && x.before.invoice_number !== x.after.invoice_number ? <> · number {x.before.invoice_number} → {x.after.invoice_number}</> : null}{x.before && x.after && (x.before.gst_number ?? '') !== (x.after.gst_number ?? '') ? <> · GSTIN {x.before.gst_number || 'none'} → {x.after.gst_number || 'none'}</> : null}</p>
          <p className="text-muted mt-0.5">{x.too_late ? `Too late to amend on the portal (30 Nov ${Number(m.fy.slice(0, 4)) + 1} was the last day). Ask your CA.` : `Goes in ${x.goes_in}`}</p>{!['deleted', 'cancelled'].includes(x.kind) ? <Link className="link text-sm inline-flex items-center min-h-11" to={`/sales/${x.id}`}>Open the bill</Link> : null}
        </li>)}</ul> : <p className="text-sm text-muted">Nothing has changed yet. Correct the bills, then download the amendments here.</p>}
      </section>
      {m.stage === 'unlocked' ? <FilingRecords month={m} onAction={onAction} /> : null}
      {visible('gst.download') ? <div><Button variant="primary" size="lg" full icon={isPhone ? Send : FilePen} disabled={!can('gst.download') || !rows.some((x) => !x.too_late)} onClick={() => onAction({ type: 'download', kind: before3b ? 'gstr1a' : 'amendments', via: isPhone ? 'share' : 'download' })}>{isPhone ? 'Send the amendments to the CA' : 'Download the amendments'}</Button><p className="text-sm text-muted mt-1.5">{!can('gst.download') ? whyNot('gst.download') : rows.length && plan ? <><span className="tnum text-fg2 break-all">{plan.file}</span>: {plan.summary}.</> : 'Nothing to amend yet.'}</p></div> : null}
      {visible('gst.file') && before3b && !m.record.gstr1a && rows.length ? <Button disabled={!can('gst.file')} title={whyNot('gst.file')} full variant="outline" onClick={() => onAction({ type: 'mark', kind: 'gstr1a' })}>Mark GSTR-1A filed…</Button> : null}
      {m.stage === 'unlocked' && visible('gst.lock') ? <div><Button disabled={!can('gst.lock')} full size={isPhone ? 'lg' : 'md'} variant="outline" icon={Lock} onClick={() => onAction({ type: 'relock' })}>Lock {name} again…</Button><p className="text-sm text-muted mt-1.5">{!can('gst.lock') ? whyNot('gst.lock') : 'The returns stay as filed; the record keeps both, so Reconciliation shows the difference.'}</p></div> : null}
    </div>
  </Card>;
}
