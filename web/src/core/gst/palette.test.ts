import { expect, test } from 'vitest';
import { GST_PAGES } from './palette';
test('Ctrl K has credit, reconciliation and each of the seven named reports',()=>{
  expect(GST_PAGES.map(p=>[p.label,p.to])).toEqual([
    ['Credit and deadlines','/gst?tab=credit'],['Reconciliation','/gst?tab=recon'],
    ['Sales register','/reports/sales'],['Tax summary','/reports/tax'],['HSN summary','/reports/hsn'],['Month by month','/reports/months'],['Purchase register','/reports/purchases'],['Top customers','/reports/customers'],['Top products','/reports/products']
  ]);
});
