import { expect, test, vi } from 'vitest';
import { shareFile } from '@/core/print/files';
test('the existing handoff helper preserves portal JSON MIME instead of relabelling it PDF',async()=>{
  const share=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'share',{value:share,configurable:true});Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});
  await shareFile(new Blob(['{}'],{type:'application/json'}),'GSTR1.json',{title:'September GSTR-1'});
  expect(share.mock.calls[0][0].files[0].type).toBe('application/json');
});
