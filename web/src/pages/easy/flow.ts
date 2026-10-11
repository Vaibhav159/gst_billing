import { inr } from '@/core/format';
import type { PaymentMode } from '@/core/sales/types';
import { hasContent, type FormLine } from '@/pages/sales/form/model';
export type BillStep={label:string;kind:'items'|'qty'|'rate'|'payment'|'review';key?:string};
export function nextBillStep(lines:FormLine[],payment:PaymentMode|null,total:number):BillStep{
 lines=lines.filter(hasContent);
 if(!lines.length)return {label:"Pick what they're buying",kind:'items'};
 const weight=lines.find(l=>!(Number(l.qty)>0));
 if(weight)return {label:'Type the weight',kind:'qty',key:weight.key};
 const rate=lines.find(l=>!(Number(l.rate)>0));
 if(rate)return {label:'Type the rate',kind:'rate',key:rate.key};
 if(!payment||(payment==='cash'&&total>=20000000))return {label:'Next: how they paid',kind:'payment'};
 return {label:'Check and save',kind:'review'};
}
export const cashWords=(total:number)=>`Cash can't be ₹2 lakh or more on one bill. Take at least ${inr(total-19999999)} by UPI and choose Part cash.`;
