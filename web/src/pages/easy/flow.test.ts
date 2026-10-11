import { blankLine, startNew } from '@/pages/sales/form/model';
import { nextBillStep, cashWords } from './flow';
const line={...blankLine(),key:'x',name:'Gold ring',qty:12.345,rate:'6512.50',hsn:'7113',gst:'3'};
it('guides to the first unfinished field without dropping other items',()=>{
 expect(nextBillStep([],null,0)).toEqual({label:"Pick what they're buying",kind:'items'});
 expect(nextBillStep([{...line,qty:null},line],null,0)).toEqual({label:'Type the weight',kind:'qty',key:'x'});
 expect(nextBillStep([{...line,rate:''}],null,0)).toEqual({label:'Type the rate',kind:'rate',key:'x'});
 expect(nextBillStep([line],null,8280871)).toEqual({label:'Next: how they paid',kind:'payment'});
 expect(nextBillStep([line],'bank',8280871)).toEqual({label:'Check and save',kind:'review'});
});
it('stops all cash at exactly two lakh and accepts one paisa below',()=>{
 expect(nextBillStep([line],'cash',20000000).kind).toBe('payment');
 expect(nextBillStep([line],'cash',19999999).kind).toBe('review');
 expect(cashWords(20000000)).toBe("Cash can't be ₹2 lakh or more on one bill. Take at least ₹0.01 by UPI and choose Part cash.");
});
it('ignores the shared brain placeholder on a new bill and beside a completed item',()=>{
 const start=startNew({firmId:3,firmSource:'scope',today:'2026-10-08'});
 expect(nextBillStep(start.form.lines,null,0)).toEqual({label:"Pick what they're buying",kind:'items'});
 expect(nextBillStep([...start.form.lines,line,blankLine()],'bank',8280871)).toEqual({label:'Check and save',kind:'review'});
 expect(nextBillStep([...start.form.lines,{...line,qty:null}],null,0)).toEqual({label:'Type the weight',kind:'qty',key:'x'});
});
