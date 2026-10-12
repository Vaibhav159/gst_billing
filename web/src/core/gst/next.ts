import type { Action } from '@/core/auth/permissions';
import type { Check, Month } from './types';
export type NextStep='fix'|'send'|'mark1'|'mark3b'|'amend'|'relock';
export function nextSteps(m:Month,can:(action:Action)=>boolean):NextStep[] {
  if(m.stage==='unlocked')return [...(m.since_filing?.rows.some(r=>!r.too_late)&&can('gst.download')?['amend' as const]:[]),...(can('gst.lock')?['relock' as const]:[])];
  if(m.stage==='gstr1')return can('gst.file')?['mark3b']:[];
  if(m.stage==='filed'||m.stage==='future'||m.stage==='open')return [];
  const first=m.checks.blockers[0];
  if(first)return can(fixNeeds(first))?['fix']:[];
  if(m.download&&!m.download.stale)return can('gst.file')?['mark1']:[];
  return [...(can('gst.download')?['send' as const]:[]),...(can('gst.file')?['mark1' as const]:[])];
}
/** The permission behind what the page's fix opens for a blocker: a customer, a purchase, a section, the bin or a bill. */
function fixNeeds(check:Check):Action {
  switch(check.kind){case 'gstin':case 'badgstin':return 'customer.edit';case 'to_confirm':return 'purchase.edit';case 'deleted':return 'audit.view';case 'empty':case 'gap':return 'view';default:return 'bill.edit';}
}
/** The phone step's words for the first blocker, naming what the fix opens. */
export function fixLabel(check:Check):string {
  switch(check.kind){case 'duplicate':return 'Fix the duplicate number';case 'gstin':case 'badgstin':return "Fix the customer's GSTIN";case 'gap':return 'See Documents issued';case 'to_confirm':return 'Open the purchase';case 'empty':return 'Open the bill';case 'deleted':return 'Open the deleted bill';default:return 'Fix the bill';}
}
