import { expect,test } from 'vitest';
import { sectionsFixture } from './fixtures';
import { summaryCsv } from './csv';
test('summary CSV keeps 0.25 percent, CTM quantities and paise, and neutralizes formula descriptions',()=>{
 const d=sectionsFixture();d.hsn.b2c=[{hsn:'710239',description:'=HYPERLINK("bad")',uqc:'CTM',quantity:'6.40',rate:'0.25',taxable:36096000,igst:0,cgst:45120,sgst:45120,service:false,bills:1}];
 const csv=summaryCsv(d);expect(csv).toContain('6.40,0.25,360960.00,0.00,451.20,451.20');expect(csv).toContain('CTM');expect(csv).toContain("'=");expect(csv.startsWith('\ufeff')).toBe(true);
});

test('April summary CSV exports combined portal HSN rows with their two-decimal filed quantities',()=>{
 const d={...sectionsFixture(),hsn:{b2b:[],b2c:[],data:[{hsn:'711319',description:'Gold jewellery',uqc:'GMS',quantity:'512.35',rate:'3',taxable:100000,igst:0,cgst:1500,sgst:1500,service:false,bills:2}]}};
 expect(summaryCsv(d)).toContain('All buyers,711319,Gold jewellery,GMS,512.35,3,1000.00,0.00,15.00,15.00,2');
 expect(summaryCsv(d)).not.toContain('512.350');
});
