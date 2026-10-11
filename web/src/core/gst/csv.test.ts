import { expect,test } from 'vitest';
import { sectionsFixture } from './fixtures';
import { summaryCsv } from './csv';
test('summary CSV keeps 0.25 percent, CTM quantities and paise, and neutralizes formula descriptions',()=>{
 const d=sectionsFixture();d.hsn.b2c=[{hsn:'710239',description:'=HYPERLINK("bad")',uqc:'CTM',quantity:'6.400',rate:'0.25',taxable:36096000,igst:0,cgst:45120,sgst:45120,service:false,bills:1}];
 const csv=summaryCsv(d);expect(csv).toContain('6.400,0.25,360960.00,0.00,451.20,451.20');expect(csv).toContain('CTM');expect(csv).toContain("' =".replace(' ',''));expect(csv.startsWith('\ufeff')).toBe(true);
});
