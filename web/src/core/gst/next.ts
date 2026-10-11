import type { Action } from '@/core/auth/permissions';
import type { Month } from './types';
export type NextStep='fix'|'send'|'mark1'|'mark3b'|'amend'|'relock';
export function nextSteps(m:Month,can:(action:Action)=>boolean):NextStep[] {
  if(m.stage==='unlocked')return [...(m.since_filing?.rows.some(r=>!r.too_late)&&can('gst.download')?['amend' as const]:[]),...(can('gst.lock')?['relock' as const]:[])];
  if(m.stage==='gstr1')return can('gst.file')?['mark3b']:[];
  if(m.stage==='filed'||m.stage==='future'||m.stage==='open')return [];
  const first=m.checks.blockers[0];
  if(first)return can(first.kind==='gstin'||first.kind==='badgstin'?'customer.edit':first.kind==='empty'?'view':'bill.edit')?['fix']:[];
  if(m.download&&!m.download.stale)return can('gst.file')?['mark1']:[];
  return [...(can('gst.download')?['send' as const]:[]),...(can('gst.file')?['mark1' as const]:[])];
}
