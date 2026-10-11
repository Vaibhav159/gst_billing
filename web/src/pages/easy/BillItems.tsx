import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/core/cn';
import { inr, qty, unitDecimals } from '@/core/format';
import { lineFigures } from '@/core/sales/maths';
import { rateText } from '@/core/sales/words';
import { Button, Field, IconButton, Input, Money, QtyInput, SearchInput, Select } from '@/core/ui';
import { focusSoon, RateInput } from '@/pages/sales/form/fields';
import { blankLine, hasContent, lineFromProduct, SLAB_OPTIONS, type FormLine } from '@/pages/sales/form/model';
import { matchProducts, quickProducts, type SaleProduct } from '@/pages/sales/form/products';
export type LineNotice = { text:string; field?:'qty'|'rate'; fix?:{label:string;patch:Partial<FormLine>} };
export type BillItemsProps = {
 lines:FormLine[]; products:SaleProduct[]; canEditProducts:boolean; errors:Record<string,string>;
 notices:Record<string,LineNotice[]>; copied?:FormLine[]; focus?:{key:string;field:'qty'|'rate'|'hsn'|'gst'|'product'}; references?:Record<string,string>;
 onChange:(key:string,patch:Partial<FormLine>)=>void; onAdd:(line:FormLine)=>void;
 onRemove:(line:FormLine)=>void; onNew:()=>void;
};
export function BillItems({lines:allLines,products,canEditProducts,errors,notices,copied=[],focus,references={},onChange,onAdd,onRemove,onNew}:BillItemsProps) {
 const lines=allLines.filter(hasContent);
 const [adding,setAdding]=useState(lines.length===0);
 const [folded,setFolded]=useState<string[]>([]);
 const [more,setMore]=useState(false);
 const [search,setSearch]=useState('');
 const repairs=useRef(new Set(lines.filter(l=>!l.hsn).map(l=>l.key)));
 lines.filter(l=>!l.hsn||errors[`${l.key}-hsn`]).forEach(l=>repairs.current.add(l.key));
 useEffect(()=>{if(focus){setFolded(x=>x.filter(k=>k!==focus.key));focusSoon(`${focus.key}-${focus.field}`);}},[focus]);
 const main=quickProducts(products,6);
 const rest=quickProducts(products,products.length).filter(p=>!main.some(m=>m.id===p.id));
 const add=(p:SaleProduct)=>{
   const l=lineFromProduct(p,blankLine());
   onAdd(l); setAdding(false); setMore(false); setSearch('');
   setFolded(lines.filter(x=>Number(x.qty)>0&&Number(x.rate)>0).map(x=>x.key));
   focusSoon(`${l.key}-qty`);
 };
 return <>
 {lines.map((l,i)=>{
  const old=copied.find(x=>x.key===l.key);
  const fig=lineFigures({quantity:l.qty??"",rate:l.rate,gst_percent:l.gst??""},false);
  const warnings=(field:string)=>(notices[l.key]??[]).filter(n=>(n.field??"rate")===field);
  const notice=(field:string)=>warnings(field).length?<div id={`${l.key}-${field}-slips`}>{warnings(field).map(n=><div key={n.text} role="alert" className="rounded-ctl border border-neg-line bg-neg-tint px-3.5 py-3 anim-rise"><p>{n.text}</p>{n.fix&&<Button onClick={()=>onChange(l.key,n.fix!.patch)}>{n.fix.label}</Button>}</div>)}</div>:null;
  const copiedQty=old?.qty===l.qty&&old?.name===l.name;
  const copiedRate=old?.rate===l.rate&&old?.name===l.name;
  const gram=['g','gms'].includes(l.unit);
  const word=gram?'gram':l.unit==='ct'?'carat':l.unit;
  const open=()=>{setFolded(x=>x.filter(k=>k!==l.key));focusSoon(`${l.key}-qty`);};
  if(folded.includes(l.key)&&!Object.keys(errors).some(k=>k.startsWith(`${l.key}-`))&&!notices[l.key]?.length&&Number(l.qty)>0&&Number(l.rate)>0) return <section key={l.key} aria-label={l.name} className="card pl-4 pr-2 py-3 flex flex-wrap items-center gap-x-3 gap-y-1">
   <div className="flex-1 min-w-0"><h2 className="font-medium break-words">{l.name}</h2><p className="text-md text-muted tnum">{qty(l.qty,l.unit)} × {rateText(l.rate)} a {word}</p></div>
   <Money value={fig?.taxable??0} className="font-medium"/><Button aria-label={`Change ${l.name}`} onClick={open}>Change</Button>
  </section>;
  return <section key={l.key} id={`${l.key}-product`} tabIndex={-1} aria-labelledby={`it-${l.key}`} aria-describedby={errors[`${l.key}-product`]?`${l.key}-product-error`:undefined} className="card p-4 flex flex-col gap-4">
   <div className="flex items-center gap-2 -mt-1 -mr-1"><div className="flex-1 min-w-0">
    <h2 id={`it-${l.key}`} className="text-lg font-semibold leading-snug"><span className="sr-only">Item {i+1}: </span>{l.name}</h2>
    {errors[`${l.key}-product`]&&<p id={`${l.key}-product-error`} className="text-neg">{errors[`${l.key}-product`]}</p>}
    {l.custom&&<p className="text-md text-muted">On this bill only · HSN {l.hsn} · GST {l.gst}%</p>}
    {(copiedQty||copiedRate)&&<p className="text-md text-brand">From the cancelled bill: check the weight and rate.</p>}
   </div><IconButton label={`Remove ${l.name}`} icon={Trash2} variant="danger" onClick={()=>onRemove(l)}/></div>
   <Field label={gram?'Weight in grams':l.unit==='ct'?'Weight in carats':`Quantity in ${l.unit}`} htmlFor={`${l.key}-qty`} error={errors[`${l.key}-qty`]}>
    <QtyInput id={`${l.key}-qty`} unit={l.unit} decimals={unitDecimals(l.unit)} value={l.qty} onChange={v=>onChange(l.key,{qty:v})}
     aria-describedby={warnings("qty").length?`${l.key}-qty-slips`:undefined} invalid={Boolean(errors[`${l.key}-qty`])||Boolean(warnings("qty").length)} inputClassName={cn('!text-2xl font-semibold tnum',copiedQty&&'!border-brand')} enterKeyHint="next"
     onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();document.getElementById(`${l.key}-rate`)?.focus();}}}/>
   </Field>
   {notice("qty")}
   <Field label={`Rate per ${word}, as on the paper bill`} htmlFor={`${l.key}-rate`} hint="Making is included in this rate." error={errors[`${l.key}-rate`]}>
    <RateInput id={`${l.key}-rate`} value={l.rate} aria-describedby={warnings("rate").length?`${l.key}-rate-slips`:undefined} invalid={Boolean(errors[`${l.key}-rate`])||Boolean(warnings("rate").length)} onChange={rate=>onChange(l.key,{rate})} inputClassName={cn('!text-xl tnum',copiedRate&&'!border-brand')}
     onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();document.querySelector<HTMLElement>('[role="radiogroup"][aria-labelledby="easy-paid-t"] [role="radio"]:not([disabled])')?.focus();}}}/>
   </Field>
   {(repairs.current.has(l.key)||!l.hsn)&&(canEditProducts?<Field label="HSN code" htmlFor={`${l.key}-hsn`} hint="Type the HSN code, 4 to 8 digits (7113 for jewellery)" error={errors[`${l.key}-hsn`]}>
    <Input id={`${l.key}-hsn`} inputMode="numeric" maxLength={8} value={l.hsn} onChange={e=>onChange(l.key,{hsn:e.target.value.replace(/\D/g,'')})}/>
   </Field>:<p className="text-md text-neg">This item has no HSN code. Ask the owner to add it in Products.</p>)}
   {l.hsn&&errors[`${l.key}-hsn`]&&<p className="text-neg">{errors[`${l.key}-hsn`]}</p>}
   {(!l.gst||errors[`${l.key}-gst`])&&<Field label="GST rate" htmlFor={`${l.key}-gst`} error={errors[`${l.key}-gst`]}>
    <Select id={`${l.key}-gst`} value={l.gst??''} placeholder="Choose the GST rate" options={SLAB_OPTIONS} onChange={e=>onChange(l.key,{gst:e.target.value})}/>
   </Field>}
   {references[l.key]&&<p className="text-md text-muted">{references[l.key]}</p>}
   {notice("rate")}
   <p className="text-md text-fg2 tnum leading-relaxed" aria-live="polite">{Number(l.qty)>0&&Number(l.rate)>0?`${qty(l.qty,l.unit)} × ${rateText(l.rate)} = ${inr(fig?.taxable??0)}, plus GST ${l.gst}%`:Number(l.rate)>0?'Type the weight to see the price.':'Type the weight and the rate to see the price.'}</p>
  </section>;
 })}
 {adding||!lines.length?<section aria-labelledby="easy-what-t" className="card p-4 flex flex-col gap-3 anim-rise">
  <div className="flex items-center justify-between gap-3 min-h-11"><h2 id="easy-what-t" className="text-lg font-semibold">{lines.length?'What else is it?':'What is it?'}</h2>{lines.length>0&&<Button variant="ghost" onClick={()=>setAdding(false)}>Not now</Button>}</div>
  <div className="flex flex-wrap gap-2">{main.map(p=><Button key={p.id} onClick={()=>add(p)} className="!rounded-full !min-h-12 !px-4">{p.name}</Button>)}
   <Button variant="ghost" aria-expanded={more} onClick={()=>setMore(!more)} className="!rounded-full !min-h-12 !px-4 border border-dashed border-ctl-line">{more?'Show fewer':'Something else'}</Button></div>
  {more&&<div className="flex flex-col gap-2 anim-rise">{products.length>12&&<SearchInput label="Find an item" value={search} onChange={setSearch}/>}
   <div className="flex flex-wrap gap-2">{matchProducts(rest,search).map(p=><Button key={p.id} onClick={()=>add(p)} className="!rounded-full !min-h-12 !px-4">{p.name}</Button>)}</div></div>}
  <Button variant="ghost" onClick={onNew} className="self-start !text-brand !px-2">Not in the list? Add it</Button>
  {errors.lines&&<p className="text-neg">{errors.lines}</p>}
 </section>:<Button size="xl" full icon={Plus} onClick={()=>{setFolded(lines.filter(l=>Number(l.qty)>0&&Number(l.rate)>0).map(l=>l.key));setAdding(true);}} className="!border-dashed !bg-transparent !text-fg2 hover:!text-fg font-medium">Add another item</Button>}
 </>;
}
