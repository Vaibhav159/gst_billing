import { useRef } from 'react';
import type { Month, Year } from '@/core/gst/types';
import { STATE_META, TONE_TEXT, dueText } from '@/core/gst/stages';
import { addMonths, date, dateShort, inr, monthLabel, rangeLabel, todayIST } from '@/core/format';
import { Card, cn, DL, Money, Select, type DLRow } from '@/core/ui';
export function MonthStrip({year,month,onPick,phone=false}: {year:Year;month:string|null;onPick:(month:string)=>void;phone?:boolean}) {
  const box=useRef<HTMLDivElement>(null);
  const available=year.months.filter(m=>m.stage!=='future');
  if(phone) return <Select aria-label="Month" value={month??''} onChange={e=>onPick(e.target.value)} options={available.map(m=>({value:m.month,label:`${monthLabel(m.month,{long:true})} · ${STATE_META[m.stage].label}`}))}/>;
  return <section id="gst-strip" className="card px-5 pt-4 pb-5 flex flex-col gap-4 scroll-mt-6"><h2 className="text-md font-semibold">FY {year.fy}</h2>
    <div ref={box} role="radiogroup" aria-label={`Months of FY ${year.fy}`} className="grid grid-cols-6 xl:grid-cols-12 gap-2" onKeyDown={e=>{
      if(!['ArrowRight','ArrowLeft','Home','End'].includes(e.key)||!available.length)return;
      e.preventDefault();const i=available.findIndex(m=>m.month===month);const n=e.key==='Home'?0:e.key==='End'?available.length-1:Math.max(0,Math.min(available.length-1,i+(e.key==='ArrowRight'?1:-1)));
      onPick(available[n].month);box.current?.querySelector<HTMLButtonElement>(`[data-ym="${available[n].month}"]`)?.focus();
    }}>{year.months.map(m=>{const meta=STATE_META[m.stage];const selected=m.month===month;return <button key={m.month} type="button" role="radio" aria-checked={selected} tabIndex={selected?0:-1} disabled={m.stage==='future'} data-ym={m.month} onClick={()=>onPick(m.month)} aria-label={`${monthLabel(m.month,{long:true})}: ${meta.label}`}
      className={cn('relative text-left rounded-ctl border px-2 pt-2 pb-2.5 flex flex-col gap-0.5 min-h-[78px] min-w-0',selected?'bg-brand-sel border-brand':m.stage==='future'?'border-dashed border-line':'bg-field border-line hover:border-muted/50')}>
      <span className="flex items-center justify-between gap-1"><span className="font-semibold">{monthLabel(m.month,{year:false})}</span>{meta.icon?<meta.icon size={14} aria-hidden="true" className={TONE_TEXT[meta.tone]}/>:null}</span><span className={cn('text-xs font-medium truncate',TONE_TEXT[meta.tone])}>{meta.short}</span>
      <span className="text-xs tnum text-muted truncate">{m.stage==='filed'?m.gstr3b_filed_on?`3B ${dateShort(m.gstr3b_filed_on)}`:'Before the app':m.stage==='future'?'':m.stage==='gstr1'?`3B due ${dateShort(m.due.gstr3b)}`:m.stage==='open'?'Month running':`due ${dateShort(m.due.gstr1)}`}</span>
    </button>;})}</div>
  </section>;
}
export function StatusCard({month:m}: {month:Month}) {
  const meta = STATE_META[m.stage], record = m.record, position = m.gstr3b;
  const next = monthLabel(m.amendments?.carried_by ?? addMonths(m.month, 1), { long: true, year: false });
  const rows: DLRow[] = (['gstr1', 'gstr3b'] as const).map((kind) => {
    const filed = record[kind];
    return [kind === 'gstr1' ? 'GSTR-1' : 'GSTR-3B', filed ? <span>filed {date(filed.filed_on)}{filed.arn ? <span className="block text-xs text-muted tnum">ARN {filed.arn}</span> : null}</span> : record.legacy ? 'Filed before the app' : <span>due {date(m.due[kind])} · {dueText(todayIST(), m.due[kind])}</span>];
  });
  if (m.stage === 'open' && m.running) rows.unshift(['Month', `running · ${rangeLabel(m.running.from, m.running.to)} so far`]);
  if (m.stage === 'filed' && record.locked_on) rows.push(['Locked', `by ${record.locked_by?.name ?? 'someone'} on ${date(record.locked_on)}`]);
  if (m.stage === 'gstr1') rows.push(['Sales bills', `locked since GSTR-1${record.gstr1?.marked_by ? ` (marked by ${record.gstr1.marked_by.name})` : ''}`]);
  if (m.stage === 'unlocked') rows.push(['Unlocked', record.unlocked ? `by ${record.unlocked.by.name} on ${date(record.unlocked.at.slice(0, 10))}` : 'for a correction'], ['Reason', record.unlocked?.reason || 'Not given']);
  const paid = Boolean(record.gstr3b) && m.stage !== 'unlocked';
  const paidBefore = m.stage === 'unlocked' && record.gstr3b ? record.gstr3b.cash?.total ?? record.gstr3b.cash_worked_out?.total ?? null : null;
  const cash = paid ? record.gstr3b?.cash?.total ?? position?.cash.total : position?.cash.total;
  const cashLabel = paid ? 'Tax paid in cash' : paidBefore !== null ? 'Tax in cash on the books now' : m.stage === 'open' ? 'Tax to pay in cash so far' : 'Tax to pay in cash';
  const amendmentCash = m.since_filing?.gstr3b?.cash_diff;
  const caption = !position ? '' : paid ? `as filed ${date(record.gstr3b?.filed_on)}${cash !== position.cash.total ? ` · the return worked out ${inr(position.cash.total)}` : ` · after ${inr(position.used.total)} of credit`}`
    : paidBefore !== null ? `${inr(paidBefore)} was paid with GSTR-3B on ${date(record.gstr3b?.filed_on)}${amendmentCash != null && amendmentCash !== 0 ? `; the ${inr(amendmentCash, { sign: true })} goes in ${next}'s GSTR-3B` : ''}`
    : position.cash.total === 0 ? `Credit covers it · ${inr(position.carry_on.total)} carries to ${next}` : `after ${inr(position.used.total)} of credit · pay by ${date(m.due.gstr3b)}`;
  return <Card title={monthLabel(m.month,{long:true})} subtitle={m.firm.name}>
    <p className={cn('font-semibold',TONE_TEXT[meta.tone])}>{meta.label}</p>
    <DL className="text-sm" rows={rows} />
    {m.stage==='open'?<p className="text-sm text-fg2">{monthLabel(m.month,{long:true})} is still running. Its returns can be filed from {date(m.due.file_from)}.</p>:null}
    {cash !== undefined ? <div className="pt-3 border-t border-rule flex flex-col gap-1"><span className="caps">{cashLabel} · {monthLabel(m.month, { long: true, year: false })}</span><Money value={cash} strong /><p className="text-sm text-muted">{caption}</p></div>:null}
    {m.late?<div className="mt-3 text-sm text-neg" aria-label="Late fee and interest">{(['gstr1','gstr3b'] as const).map(k=>m.late![k].days?<p key={k}>{k==='gstr1'?'GSTR-1':'GSTR-3B'}: {m.late![k].days} days · {inr(m.late![k].per_day)} a day · {inr(m.late![k].fee)}{m.late![k].capped?` · cap ${inr(m.late![k].cap)} reached`:` · capped at ${inr(m.late![k].cap)}`}</p>:null)}{m.late.interest>0?<p>Interest so far {inr(m.late.interest)} · 18% a year on {inr(m.late.interest_on)} in cash, from {date(m.late.interest_from)}</p>:null}</div>:null}
  </Card>;
}
