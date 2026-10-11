import { expect,test } from 'vitest';
import { monthFixture } from './fixtures';
import { nextSteps } from './next';
test('corrections take precedence over live checks; relock stays a separate choice',()=>{
 const m=monthFixture({stage:'unlocked',since_filing:{at:'2026-10-08',bills_diff:1,taxable_diff:100,tax_diff:3,rows:[{kind:'added',id:1,invoice_number:'1',section:'b2cs',place_of_supply:'08',rate:'3',before:null,after:null,tax_diff:3,goes_in:"October's GSTR-1",too_late:false}],gstr3b:null}});
 m.checks.blockers=[{kind:'empty',blocks:true,text:'No items',detail:'',bills:[],more_bills:0,customer:null,suggested:null}];
 expect(nextSteps(m,()=>true)).toEqual(['amend','relock']);
});
test('GSTR-1 stage points to 3B even if books have a later check; viewers get no bar',()=>{
 const m=monthFixture({stage:'gstr1'});m.checks.blockers=[{kind:'empty',blocks:true,text:'No items',detail:'',bills:[],more_bills:0,customer:null,suggested:null}];
 expect(nextSteps(m,()=>true)).toEqual(['mark3b']);expect(nextSteps(m,()=>false)).toEqual([]);
});
