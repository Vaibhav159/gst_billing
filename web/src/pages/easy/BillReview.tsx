import { useEffect, useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { cn } from '@/core/cn';
import { amountInWords, inr, qty } from '@/core/format';
import { counterOf } from '@/core/sales/numbers';
import { rateText, taxLines } from '@/core/sales/words';
import { Button, ButtonLink, Checkbox, Dialog, DL, Money } from '@/core/ui';
import { hasContent } from '@/pages/sales/form/model';
import { perWord } from '@/pages/sales/form/rules';
import type { BillFormApi } from '@/pages/sales/form/useBillForm';
export type ReviewForm=Pick<BillFormApi,'reviewOpen'|'closeReview'|'saving'|'saveError'|'numberText'|'stored'|'waitingForNext'|'numberError'|'dateError'|'f'|'firmName'|'cust'|'figs'|'tt'>;
export type ReviewCheck={id:string;text:string;tick?:string};
export type BillReviewProps={F:ReviewForm;paymentWords:string;checks:ReviewCheck[];offline:boolean;canSave:boolean;visitOnly?:boolean;whyNot?:string;onSave:(number?:string)=>void;onFullView:()=>void};
// The route supplies 6B's shared payment words.
export function BillReview({F,paymentWords,checks,offline,canSave,visitOnly=false,whyNot='',onSave,onFullView}:BillReviewProps){
 const signature=JSON.stringify([F.f,F.numberText,checks]);
 const [ticked,setTicked]=useState<{signature:string;ids:string[]}>({signature:'',ids:[]});
 const [slow,setSlow]=useState(false);
 useEffect(()=>{if(!F.saving){setSlow(false);return;}const t=setTimeout(()=>setSlow(true),8000);return()=>clearTimeout(t);},[F.saving]);
 useEffect(()=>{if(!F.reviewOpen)setTicked({signature:'',ids:[]});},[F.reviewOpen]);
 const acknowledged=(id:string)=>ticked.signature===signature&&ticked.ids.includes(id);
 const all=checks.filter(c=>c.tick).every(c=>acknowledged(c.id));
 const error=F.saveError;
 const offer=error?.kind==='clash'&&error.next&&!F.f.numberTyped?((counterOf(F.stored)??0)>(counterOf(error.next)??0)?F.stored:error.next):'';
 const no=counterOf(offer||F.numberText)??(offer||F.numberText);
 const final=['draft_saved','cancelled','gone','replaces'].includes(error?.kind??'');
 const denied=offline||!canSave||F.saving||F.waitingForNext||!all||F.f.payment===null||F.f.payment===''||(F.cust?.type==='walkin'&&F.f.payment==='credit');
 const disabled=denied||Boolean(F.numberError)||Boolean(F.dateError)||final;
 const lines=F.f.lines.filter(hasContent);
 const savedLink=error?.link?.to.replace(/^\/sales\/(\d+)(?:\?.*)?$/,'/e/bill/$1');
 return <Dialog open={F.reviewOpen} onClose={()=>{if(!F.saving)F.closeReview();}} title="Check the bill" footer={<>
  <Button size="lg" disabled={F.saving} onClick={F.closeReview}>Change something</Button>
  {!final&&<Button variant="primary" size="xl" icon={Check} loading={F.saving} disabled={disabled} onClick={()=>{if(!disabled)onSave();}}>{F.saving?`Saving bill ${no}…`:error?`Save bill ${no} again`:`Save bill ${no}`}</Button>}
 </>}>
  <div className="flex flex-col gap-4 text-[16px] leading-[24px]">
   {offline&&<p role="status">{visitOnly?"This browser doesn't store unfinished bills, so this one lasts only while this page is open.":"You're offline. Your bill is kept on this phone; save it when the internet is back."}</p>}
   {!canSave&&<p>{whyNot}</p>}
   {error&&<div role="alert" className="rounded-ctl border border-neg-line bg-neg-tint px-4 py-3">
    <p className="font-semibold">{error.kind==='draft_saved'&&error.link?`This bill was saved already, as bill ${counterOf(error.link.label)??error.link.label.replace(/^Open /,'')}.`:error.title}</p>
    <p>{error.title==="Not saved: the app couldn't get through"?visitOnly?"Not saved yet: the app couldn't get through. Keep this page open and tap Save again in a minute.":"Not saved yet: the app couldn't get through. Your bill is safe on this phone; tap Save again in a minute.":error.body}</p>
    {offer&&<Button disabled={denied} onClick={()=>{if(!denied)onSave(offer);}}>Save as {counterOf(offer)??offer}</Button>}
    {savedLink&&<ButtonLink to={savedLink}>Open it</ButtonLink>}
    {error.kind==='filed'&&<Button onClick={onFullView}>Finish in the full view</Button>}
   </div>}
   {slow&&F.saving&&<p role="status" className="text-md text-fg2">Still saving. Don't close the app.</p>}
   {F.waitingForNext&&<p role="status">Getting the next number</p>}
   <p className="text-lg leading-relaxed">You are billing <strong>{F.cust?.type==='walkin'?'a walk-in customer':F.cust?.name??'a walk-in customer'}</strong> <strong className="tnum">{inr(F.figs.total)}</strong> from <strong>{F.firmName}</strong> for {lines.length} {lines.length===1?'item':'items'}, {paymentWords}. Bill number <strong className="tnum">{no}</strong>, as on the paper bill.</p>
   <ul className="rounded-ctl border border-line bg-field">{lines.map((l,index)=><li key={l.key} className="flex items-start justify-between gap-3 px-4 py-3 border-t border-rule first:border-t-0"><span className="min-w-0"><span className="block font-medium">{l.name}</span><span className="block text-md text-fg2 tnum">{qty(l.qty,l.unit)} × {rateText(l.rate)} a {perWord(l.unit)}</span></span><Money value={F.figs.lines[index]?.taxable??null} className="pt-0.5"/></li>)}</ul>
   <DL rows={[["Price before GST",inr(F.figs.taxable)],...taxLines({...F.figs,interstate:F.tt.inter}).map(t=>[t.label,inr(t.value)] as const),['Total',<Money key="total" value={F.figs.total} tone="sale" strong/>]]}/>
   {F.figs.total>100000000&&<p className="text-md text-fg2">In words: {amountInWords(F.figs.total)}</p>}
   {checks.map(c=><div key={c.id} className={cn('rounded-ctl border px-4 py-3 flex flex-col gap-2',c.tick?'border-neg-line bg-neg-tint':'border-brand-line bg-brand-tint')}>
    <p className="flex items-start gap-2 text-md"><AlertTriangle size={18} className={cn('shrink-0 mt-0.5',c.tick?'text-neg':'text-brand')} aria-hidden="true"/>{c.text}</p>
    {c.tick&&<Checkbox label={<span className="text-[16px]">{c.tick}</span>} checked={acknowledged(c.id)} onChange={on=>setTicked(previous=>({signature,ids:[...(previous.signature===signature?previous.ids:[]).filter(id=>id!==c.id),...(on?[c.id]:[])]}))}/>}
   </div>)}
   {!all&&<p className="text-md text-muted">Tick each red line once you've checked it; then Save lights up.</p>}
  </div>
 </Dialog>;
}
