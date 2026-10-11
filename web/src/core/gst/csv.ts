import { csvCell } from '@/core/csv';
import { paiseToDecimal } from '@/core/format';
import type { Gstr1 } from './types';
export function summaryCsv(data:Gstr1):string {
  const money=(r:{taxable:number;igst:number;cgst:number;sgst:number})=>[r.taxable,r.igst,r.cgst,r.sgst].map(paiseToDecimal);
  const rows:(string|number)[][]=[['Rate summary'],['GST rate','Taxable value','IGST','CGST','SGST','Tax','Bill value','Bills'],...data.by_rate.map(r=>[r.rate,...money(r),paiseToDecimal(r.tax),paiseToDecimal(r.value),r.bills]),[],['HSN summary'],['Buyer','HSN','Description','UQC','Qty','GST rate','Taxable value','IGST','CGST','SGST','Bills'],...(['b2b','b2c'] as const).flatMap(k=>data.hsn[k].map(r=>[k.toUpperCase(),r.hsn,r.description,r.uqc,r.quantity,r.rate,...money(r),r.bills]))];
  return `\ufeff${rows.map(r=>r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
