import { blankLine, startNew } from '@/pages/sales/form/model';
import { nextBillStep } from './flow';
const line={...blankLine(),key:'x',name:'Gold ring',qty:12.345,rate:'6512.50',hsn:'7113',gst:'3'};
it('guides to the first unfinished field without dropping other items',()=>{
 expect(nextBillStep([],null)).toEqual({label:"Pick what they're buying",kind:'items'});
 expect(nextBillStep([{...line,qty:null},line],null)).toEqual({label:'Type the weight',kind:'qty',key:'x'});
 expect(nextBillStep([{...line,rate:''}],null)).toEqual({label:'Type the rate',kind:'rate',key:'x'});
 expect(nextBillStep([line],null)).toEqual({label:'Next: how they paid',kind:'payment'});
 expect(nextBillStep([line],'bank')).toEqual({label:'Check and save',kind:'review'});
});
it.each(['199999.99','200000','200000.01'])('cash can proceed to review at ₹%s',rate=>{
 expect(nextBillStep([{...line,qty:1,rate,gst:'0'}],'cash').kind).toBe('review');
});

it('ignores the shared brain placeholder on a new bill and beside a completed item',()=>{
 const start=startNew({firmId:3,firmSource:'scope',today:'2026-10-08'});
 expect(nextBillStep(start.form.lines,null)).toEqual({label:"Pick what they're buying",kind:'items'});
 expect(nextBillStep([...start.form.lines,line,blankLine()],'bank')).toEqual({label:'Check and save',kind:'review'});
 expect(nextBillStep([...start.form.lines,{...line,qty:null}],null)).toEqual({label:'Type the weight',kind:'qty',key:'x'});
});
