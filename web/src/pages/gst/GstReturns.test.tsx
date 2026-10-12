import { act, configure, fireEvent, screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router';
import { StrictMode, useState } from 'react';
import { expect, test, vi, beforeEach, afterAll } from 'vitest';
import { renderApp } from '@/test/render';
import { serve } from '@/test/server';
import { monthFixture, yearFixture, sectionsFixture, ledgerFixture, endFixture } from '@/core/gst/fixtures';
import GstReturns from './GstReturns';
import { shareFile, saveFile } from '@/core/print/files';
configure({asyncUtilTimeout:5000});
afterAll(()=>configure({asyncUtilTimeout:1000}));
const goScope=vi.fn();
const goFy=vi.fn();
const scopeState=vi.hoisted(()=>({ready:true,firmId:3 as number|'all',fy:'2026-27',loading:false}));
vi.mock('@/core/scope',async original=>({...await original<typeof import('@/core/scope')>(),useScope:()=>({firmId:scopeState.ready?scopeState.firmId:null,fy:scopeState.fy,ready:scopeState.ready,setFirmId:goScope,setFy:goFy,fyChoices:['2026-27','2025-26','2024-25']}),useFirms:()=>({firms:scopeState.loading?[]:[{id:3,name:'KIRAN GOLD HOUSE',short:'Kiran',gstin:'08VRHFA2322D1ZI',state:'RAJASTHAN'},{id:1,name:'AARAV JEWELLERS',short:'Aarav',gstin:'08DLTFT2681H1ZV',state:'RAJASTHAN'}],loading:scopeState.loading,error:false,problem:null})}));
vi.mock('@/core/print/files',()=>({saveFile:vi.fn(),shareFile:vi.fn()}));
vi.mock('./CreditView',()=>({CreditView:({businessId,fy}:{businessId:number;fy:string})=> <p data-testid="credit-scope">{businessId}/{fy}</p>}));
vi.mock('./ReconView',()=>({ReconView:({businessId,fy}:{businessId:number;fy:string})=> <p data-testid="recon-scope">{businessId}/{fy}</p>}));
beforeEach(()=>{Object.assign(scopeState,{ready:true,firmId:3,fy:'2026-27',loading:false});goScope.mockReset();goFy.mockReset();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-08T06:00:00Z'));});
function server(m: unknown=monthFixture()) {return serve({'GET gst/year/':yearFixture(),'GET gst/month/':m,'GET gst/month/gstr1/':sectionsFixture(),'GET gst/month/gstr3b/':ledgerFixture(),'GET gst/month-end/':endFixture()});}
test('opens exact month and section, requests each lazy detail once, and hides filing from viewers',async()=>{
  const calls=server();renderApp(<GstReturns/>,{path:'/gst?firm=3&month=2026-09&sec=docs',me:{role:'viewer',permissions:['view','reports.export']}});
  expect(await screen.findByRole('tab',{name:/Documents/})).toHaveAttribute('aria-selected','true');
  expect(screen.queryByRole('button',{name:/Mark.*filed/})).not.toBeInTheDocument();
  expect(calls.filter(c=>c.url==='gst/month/')).toHaveLength(1);
  expect(calls.filter(c=>c.url==='gst/month/gstr1/')).toHaveLength(1);
});
test('old FY explains records and never requests a pre-ledger month',async()=>{
  const calls=server();renderApp(<GstReturns/>,{path:'/gst?fy=2024-25'});
  expect(await screen.findByText('No returns for FY 2024-25 in the app')).toBeInTheDocument();
  expect(calls.some(c=>c.url==='gst/month/')).toBe(false);
});
test('future month shows its dates without asking for tables',async()=>{
  const calls=server({business:3,month:'2026-11',fy:'2026-27',stage:'future',due:{gstr1:'2026-12-11',gstr3b:'2026-12-20',file_from:'2026-12-01'},firm:null,record:null,checks:null,gstr1:null,gstr3b:null,running:null,late:null,since_filing:null,amendments:null,amended_in:null,download:null,prev_gstr3b_missing:null});renderApp(<GstReturns/>,{path:'/gst?firm=3&month=2026-11&mark=1&fix=1'});
  expect(await screen.findByText("November 2026 hasn't started")).toBeInTheDocument();
  expect(screen.getByText('Its returns open after the month ends: GSTR-1 is due on 11 Dec 2026 and GSTR-3B on 20 Dec 2026.')).toBeInTheDocument();
  expect(calls.some(c=>c.url==='gst/month/gstr1/'||c.url==='gst/month/gstr3b/')).toBe(false);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('no GST query runs while the scope is unresolved, even after firms have loaded',async()=>{
  scopeState.ready=false;
  const calls=server();
  function ScopeWait() {const [ready,setReady]=useState(false);scopeState.ready=ready;return <><button onClick={()=>setReady(true)}>Resolve scope</button><GstReturns/></>;}
  renderApp(<ScopeWait/>,{path:'/gst?firm=3&month=2026-09'});
  await waitFor(()=>expect(screen.getByText('Resolve scope')).toBeInTheDocument());
  expect(calls.filter(c=>c.url.startsWith('gst/'))).toHaveLength(0);
  fireEvent.click(screen.getByText('Resolve scope'));
  expect(await screen.findByRole('tab',{name:/Documents/})).toBeInTheDocument();
  expect(calls.filter(c=>c.url==='gst/month/')).toHaveLength(1);
});

test.each(['scope first','firms first'])('a deep link keeps its firm while defaults hydrate, %s',async order=>{
  const calls=server();
  function HydratingScope() {
    const [step,setStep]=useState(0),[firm,setFirm]=useState<number|'all'>(1);
    scopeState.ready=step>=(order==='scope first'?1:2);
    scopeState.loading=step<(order==='firms first'?1:2);
    scopeState.firmId=firm;goScope.mockImplementation(setFirm);
    const location=useLocation();
    return <><button onClick={()=>setStep(s=>s+1)}>Continue loading</button><output data-testid="gst-location">{location.search}</output><GstReturns/></>;
  }
  renderApp(<HydratingScope/>,{path:'/gst?firm=3&month=2026-09&sec=docs'});
  expect(calls.filter(c=>c.url.startsWith('gst/'))).toHaveLength(0);
  fireEvent.click(screen.getByText('Continue loading'));
  fireEvent.click(screen.getByText('Continue loading'));
  await screen.findByRole('tab',{name:/Documents/});
  expect(new URLSearchParams(screen.getByTestId('gst-location').textContent!).get('firm')).toBe('3');
  expect(screen.getByRole('radio',{name:'Kiran'})).toHaveAttribute('aria-checked','true');
  expect(scopeState.firmId).toBe(3);
  expect(calls.filter(c=>c.url==='gst/month/').at(-1)?.params).toEqual({business_id:3,month:'2026-09'});
});

test('a deep link keeps its exact prior-FY month while deliberate header firm and FY changes navigate',async()=>{
  server();
  function HeaderScope() {
    const [firm,setFirm]=useState<number|'all'>(1),[fy,setFy]=useState('2026-27');
    scopeState.firmId=firm;scopeState.fy=fy;goScope.mockImplementation(setFirm);goFy.mockImplementation(setFy);
    const location=useLocation();
    return <><button onClick={()=>setFirm(1)}>Header firm</button><button onClick={()=>setFy('2026-27')}>Header FY</button><output data-testid="gst-location">{location.search}</output><GstReturns/></>;
  }
  renderApp(<StrictMode><HeaderScope/></StrictMode>,{path:'/gst?firm=3&month=2025-05&sec=docs&fix=1&tab=credit'});
  await screen.findByTestId('credit-scope');
  const query=()=>new URLSearchParams(screen.getByTestId('gst-location').textContent!);
  expect(query().get('firm')).toBe('3');
  expect(query().get('month')).toBe('2025-05');
  expect(query().get('sec')).toBe('docs');
  expect(query().get('fix')).toBe('1');
  expect(scopeState.fy).toBe('2025-26');
  fireEvent.click(screen.getByText('Header firm'));
  await waitFor(()=>expect(query().get('firm')).toBe('1'));
  expect(query().get('month')).toBe('2025-05');
  expect(query().has('sec')).toBe(false);
  expect(query().has('fix')).toBe(false);
  fireEvent.click(screen.getByText('Header FY'));
  await waitFor(()=>expect(query().get('fy')).toBe('2026-27'));
  expect(query().has('month')).toBe(false);
  expect(query().get('firm')).toBe('1');
});

test.each(['firm','FY'])('an implicit GST link canonicalizes a deliberate header %s change and resets its section',async kind=>{
  server();
  function HeaderScope() {
    const [firm,setFirm]=useState<number|'all'>(3),[fy,setFy]=useState('2026-27');
    scopeState.firmId=firm;scopeState.fy=fy;goScope.mockImplementation(setFirm);goFy.mockImplementation(setFy);
    const location=useLocation();
    return <><button onClick={()=>kind==='firm'?setFirm(1):setFy('2025-26')}>Change header</button><output data-testid="gst-location">{location.search}</output><GstReturns/></>;
  }
  renderApp(<StrictMode><HeaderScope/></StrictMode>,{path:'/gst?sec=docs'});
  await screen.findByRole('tab',{name:/Documents/});
  fireEvent.click(screen.getByText('Change header'));
  const query=()=>new URLSearchParams(screen.getByTestId('gst-location').textContent!);
  await waitFor(()=>expect(query().has('sec')).toBe(false),{timeout:1000});
  expect(query().get('firm')).toBe(kind==='firm'?'1':'3');
  if(kind==='firm')expect(query().get('month')).toBe('2026-09');
  else {expect(query().get('fy')).toBe('2025-26');expect(query().has('month')).toBe(false);}
});

test('unlocking refreshes the month and changes GSTR-1 from the snapshot to the live books',async()=>{
  const m=monthFixture({stage:'gstr1'});m.record.gstr1={id:81,business:3,month:m.month,kind:'gstr1',filed_on:'2026-10-07',arn:'AA0810260345671',cash:null,cash_worked_out:null,late_fee:null,interest:null,credit_left:null,marked_by:{id:1,name:'Kailash'},marked_at:'2026-10-07T12:00:00+05:30',updated_by:null,updated_at:null,legacy:false};
  let unlocked=false;
  const calls=serve({'GET gst/year/':yearFixture(),'GET gst/month/':()=>({status:200,data:unlocked?{...m,stage:'unlocked',record:{...m.record,unlocked:{at:'2026-10-08T12:00:00+05:30',by:{id:1,name:'Kailash'},reason:'Wrong GSTIN'}}}:m}),'GET gst/month/gstr1/':sectionsFixture(),'GET gst/month/gstr3b/':ledgerFixture(),'POST gst/months/unlock/':()=>{unlocked=true;return {status:200,data:{...m,stage:'unlocked'}};}});
  renderApp(<GstReturns/>,{path:'/gst?firm=3&month=2026-09'});
  expect(await screen.findByRole('radio',{name:'As filed'})).toHaveAttribute('aria-checked','true');
  fireEvent.click(screen.getByRole('button',{name:"Unlock September's sales bills…"}));
  await screen.findByRole('dialog',{name:"Unlock September's sales bills?"});
  vi.setSystemTime(Date.now()+400);
  fireEvent.change(screen.getByLabelText(/Reason for unlocking/),{target:{value:'Wrong GSTIN'}});
  fireEvent.click(screen.getByRole('button',{name:'Unlock September'}));
  await waitFor(()=>expect(screen.getByRole('radio',{name:'Books now'})).toHaveAttribute('aria-checked','true'));
  expect(calls.some(c=>c.url==='gst/month/gstr1/'&&c.params.as_filed===1)).toBe(true);
  expect(calls.some(c=>c.url==='gst/month/gstr1/'&&!('as_filed'in c.params))).toBe(true);
  expect(calls.filter(c=>c.url==='gst/month/').length).toBeGreaterThan(1);
  expect(screen.queryByRole('button',{name:'Download GSTR-1 JSON'})).not.toBeInTheDocument();
},15000);

test('Summary CSV records the contract audit entity after downloading',async()=>{
  const calls=serve({'GET gst/year/':yearFixture(),'GET gst/month/':monthFixture(),'GET gst/month/gstr1/':sectionsFixture(),'GET gst/month/gstr3b/':ledgerFixture(),'POST audit-logs/log/':{}});
  renderApp(<GstReturns/>,{path:'/gst?firm=3&month=2026-09'});
  fireEvent.click(await screen.findByRole('button',{name:'Summary CSV'}));
  await waitFor(()=>expect(calls.find(c=>c.url==='audit-logs/log/')?.data).toEqual({action:'exported',entity:'report',details:'Rate and HSN summary, KIRAN GOLD HOUSE, Sep 2026'}));
});

test('a month-end file download refreshes the recorded file status',async()=>{
  let downloaded=false;
  const calls=serve({'GET gst/month-end/':()=>{const e=endFixture();if(downloaded)e.firms[0].download={by:{id:1,name:'Kailash'},at:'2026-10-08T12:00:00+05:30',via:'download',stale:false,changed:[]};return {status:200,data:e};},'GET gst/files/gstr1/':()=>{downloaded=true;return {status:200,data:new Blob(['{}'],{type:'application/json'})};}});
  renderApp(<GstReturns/>,{path:'/gst?tab=all&month=2026-09'});
  fireEvent.click(await screen.findByRole('button',{name:'Download'}));
  expect(await screen.findByText(/Downloaded by Kailash/)).toBeInTheDocument();
  expect(calls.filter(c=>c.url==='gst/month-end/')).toHaveLength(2);
});
test('phone opens sections in a sheet and keeps the viewer without an action bar',async()=>{
  Object.defineProperty(window,"__phone",{value:true,writable:true,configurable:true});server();renderApp(<GstReturns/>,{path:'/gst?firm=3&month=2026-09',me:{role:'viewer',permissions:['view','reports.export']}});
  const open=await screen.findByRole('button',{name:/Documents issued/});fireEvent.click(open);
  expect(await screen.findByRole('dialog',{name:/Documents issued/})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Send to the CA'})).not.toBeInTheDocument();
});
test('an as-filed download uses stored bytes even when live checks now fail',async()=>{
  const m=monthFixture({stage:'filed'});m.record.gstr1={id:81,business:3,month:m.month,kind:'gstr1',filed_on:'2026-10-07',arn:'AA0810260345671',cash:null,cash_worked_out:null,late_fee:null,interest:null,credit_left:null,marked_by:{id:1,name:'Kailash'},marked_at:'2026-10-07T12:00:00+05:30',updated_by:null,updated_at:null,legacy:false};
  m.checks.blockers=[{kind:'empty',blocks:true,text:'KGH/2026-27/1 has no items',detail:'',bills:[],more_bills:0,customer:null,suggested:null}];m.gstr1!.file.made=false;
  const calls=serve({'GET gst/year/':yearFixture(),'GET gst/month/':m,'GET gst/month/gstr1/':sectionsFixture(),'GET gst/month/gstr3b/':ledgerFixture(),'GET gst/files/gstr1/':new Blob(['{"frozen":true}'])});
  renderApp(<GstReturns/>,{path:'/gst?firm=3&month=2026-09'});
  fireEvent.click(await screen.findByRole('radio',{name:'Books now'}));
  fireEvent.click((await screen.findAllByRole('button',{name:'Download GSTR-1 as filed'}))[0]);
  await waitFor(()=>expect(calls.some(c=>c.url==='gst/files/gstr1/'&&c.params.as_filed===1)).toBe(true));
});

test('phone firm badges ask for the selected running month, not the last ended month',async()=>{
  Object.defineProperty(window,'__phone',{value:true,writable:true,configurable:true});
  const calls=server(monthFixture({month:'2026-10',stage:'open'}));
  renderApp(<GstReturns/>,{path:'/gst?firm=3&month=2026-10'});
  await screen.findByRole('button',{name:/Documents issued/});
  expect(calls.some(c=>c.url==='gst/month-end/')).toBe(false);
  expect(screen.getByRole('radio',{name:'Kiran · Open'})).toBeInTheDocument();
});

test.each(['credit','recon'])('passes businessId and FY to the named 3D %s export',async tab=>{
  server();renderApp(<GstReturns/>,{path:`/gst?tab=${tab}&firm=3&fy=2026-27`});
  expect(await screen.findByTestId(`${tab}-scope`)).toHaveTextContent('3/2026-27');
});
test('phone GSTR-1 send preserves its file and sharing fallback, independently of the CA zip',async()=>{
  Object.defineProperty(window,'__phone',{value:true,writable:true,configurable:true});
  vi.mocked(shareFile).mockClear();vi.mocked(saveFile).mockClear();
  vi.mocked(shareFile).mockResolvedValue('unsupported');
  const raw=new Blob(['{"fp":"092026","b2b":[]}'],{type:'application/json'});
  const calls=serve({'GET gst/year/':yearFixture(),'GET gst/month/':monthFixture(),'GET gst/month/gstr1/':sectionsFixture(),'GET gst/month/gstr3b/':ledgerFixture(),'GET gst/month-end/':endFixture(),'GET gst/files/gstr1/':raw});
  renderApp(<GstReturns/>,{path:'/gst?firm=3&month=2026-09'});
  fireEvent.click(await screen.findByRole('button',{name:'Send GSTR-1 file to the CA'}));
  await waitFor(()=>expect(shareFile).toHaveBeenCalledWith(raw,'GSTR1_08VRHFA2322D1ZI_092026.json',{title:'GST returns · Sep 2026'}));
  expect(calls.find(c=>c.url==='gst/files/gstr1/')?.params).toEqual({business_id:3,month:'2026-09',via:'share'});
  expect(calls.some(c=>c.url==='reports/ca-workbook/'||c.url==='gst/files/bundle/')).toBe(false);
  expect(saveFile).toHaveBeenCalledWith(raw,'GSTR1_08VRHFA2322D1ZI_092026.json');
});

test.each(['Send GSTR-1 file to the CA','Download to this phone instead'])('leaving the month while %s is pending never hands off its old file',async label=>{
  Object.defineProperty(window,'__phone',{value:true,writable:true,configurable:true});
  vi.mocked(shareFile).mockReset().mockResolvedValue('unsupported');vi.mocked(saveFile).mockClear();
  let finish!: (reply:{status:number;data:Blob})=>void;
  const pending=new Promise<{status:number;data:Blob}>(resolve=>{finish=resolve;});
  const calls=serve({'GET gst/year/':yearFixture(),'GET gst/month/':monthFixture(),'GET gst/month/gstr1/':sectionsFixture(),'GET gst/month/gstr3b/':ledgerFixture(),'GET gst/month-end/':endFixture(),'GET gst/files/gstr1/':()=>pending});
  renderApp(<GstReturns/>,{path:'/gst?firm=3&month=2026-09'});
  fireEvent.click(await screen.findByRole('button',{name:label}));
  await waitFor(()=>expect(calls.some(c=>c.url==='gst/files/gstr1/')).toBe(true));
  fireEvent.click(screen.getByRole('radio',{name:'Credit'}));
  await screen.findByTestId('credit-scope');
  await act(async()=>{finish({status:200,data:new Blob(['{}'],{type:'application/json'})});await pending;});
  expect(shareFile).not.toHaveBeenCalled();expect(saveFile).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog',{name:'Your return file is ready'})).not.toBeInTheDocument();
});

test('changing the month-end scope while its file is pending never downloads the old month',async()=>{
  Object.defineProperty(window,'__phone',{value:false,writable:true,configurable:true});
  vi.mocked(saveFile).mockClear();
  let finish!: (reply:{status:number;data:Blob})=>void;
  const pending=new Promise<{status:number;data:Blob}>(resolve=>{finish=resolve;});
  const calls=serve({'GET gst/month-end/':endFixture(),'GET gst/files/gstr1/':()=>pending});
  renderApp(<GstReturns/>,{path:'/gst?tab=all&month=2026-09'});
  fireEvent.click(await screen.findByRole('button',{name:'Download'}));
  await waitFor(()=>expect(calls.some(c=>c.url==='gst/files/gstr1/')).toBe(true));
  fireEvent.change(screen.getByLabelText('Month'),{target:{value:'2026-08'}});
  await waitFor(()=>expect(calls.some(c=>c.url==='gst/month-end/'&&c.params.month==='2026-08')).toBe(true));
  await act(async()=>{finish({status:200,data:new Blob(['{}'],{type:'application/json'})});await pending;});
  expect(saveFile).not.toHaveBeenCalled();
});

test('the second-press Share button accepts one handoff while the share sheet is pending',async()=>{
  Object.defineProperty(window,'__phone',{value:true,writable:true,configurable:true});
  let finish!: (result:'shared')=>void;
  const pending=new Promise<'shared'>(resolve=>{finish=resolve;});
  vi.mocked(shareFile).mockReset().mockResolvedValueOnce('late').mockImplementation(()=>pending);vi.mocked(saveFile).mockClear();
  serve({'GET gst/year/':yearFixture(),'GET gst/month/':monthFixture(),'GET gst/month/gstr1/':sectionsFixture(),'GET gst/month/gstr3b/':ledgerFixture(),'GET gst/month-end/':endFixture(),'GET gst/files/gstr1/':new Blob(['{}'],{type:'application/json'})});
  renderApp(<GstReturns/>,{path:'/gst?firm=3&month=2026-09'});
  fireEvent.click(await screen.findByRole('button',{name:'Send GSTR-1 file to the CA'}));
  const share=await screen.findByRole('button',{name:'Share'});
  vi.setSystemTime(Date.now()+400);
  fireEvent.click(share);fireEvent.click(share);
  expect(shareFile).toHaveBeenCalledTimes(2);
  expect(share).toHaveAttribute('aria-busy','true');
  await act(async()=>{finish('shared');await pending;});
  expect(screen.queryByRole('dialog',{name:'Your return file is ready'})).not.toBeInTheDocument();
  expect(saveFile).not.toHaveBeenCalled();
});
const filedGstr1=(m:ReturnType<typeof monthFixture>)=>{m.record.gstr1={id:81,business:3,month:m.month,kind:'gstr1',filed_on:'2026-10-07',arn:'AA0810260345671',cash:null,cash_worked_out:null,late_fee:null,interest:null,credit_left:null,marked_by:{id:1,name:'Kailash'},marked_at:'2026-10-07T12:00:00+05:30',updated_by:null,updated_at:null,legacy:false};return m;};
test('a rejected save shows once, in its dialog, and Cancel leaves no file banner or old retry behind',async()=>{
  const m=filedGstr1(monthFixture({stage:'gstr1'}));
  serve({'GET gst/year/':yearFixture(),'GET gst/month/':m,'GET gst/month/gstr1/':sectionsFixture(),'GET gst/month/gstr3b/':ledgerFixture(),'GET gst/files/gstr3b/':()=>({status:503,data:{detail:'The file service is down.'}}),'POST gst/months/unlock/':()=>({status:400,data:{detail:'September is already unlocked.'}})});
  renderApp(<GstReturns/>,{path:'/gst?firm=3&month=2026-09'});
  fireEvent.click(await screen.findByRole('button',{name:'GSTR-3B file'}));
  expect(await screen.findByText('The file wasn’t made')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:"Unlock September's sales bills…"}));
  await screen.findByRole('dialog',{name:"Unlock September's sales bills?"});
  vi.setSystemTime(Date.now()+400);
  fireEvent.change(screen.getByLabelText(/Reason for unlocking/),{target:{value:'Wrong GSTIN'}});
  fireEvent.click(screen.getByRole('button',{name:'Unlock September'}));
  await waitFor(()=>expect(screen.getAllByText(/September is already unlocked/)).toHaveLength(1));
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByText(/file wasn.t made/)).not.toBeInTheDocument();
  expect(screen.queryByText(/September is already unlocked/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Try again'})).not.toBeInTheDocument();
},15000);
test('a failed fix lookup has its own words and no download retry',async()=>{
  const m=monthFixture({stage:'blocked'});m.checks.blockers=[{kind:'duplicate',blocks:true,text:'Bill number used twice',detail:'',bills:[{id:388,invoice_number:'KGH/2026-27/17',invoice_date:'2026-09-09',customer_name:'Anita',status:'active'}],more_bills:0,customer:null,suggested:391}];
  serve({'GET gst/year/':yearFixture(),'GET gst/month/':m,'GET gst/month/gstr1/':sectionsFixture(),'GET gst/month/gstr3b/':ledgerFixture(),'GET sales/391/':()=>({status:500,data:{detail:'Server error.'}})});
  renderApp(<GstReturns/>,{path:'/gst?firm=3&month=2026-09&fix=1'});
  expect(await screen.findByText("Couldn't open that")).toBeInTheDocument();
  expect(screen.queryByText(/file wasn.t made/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Try again'})).not.toBeInTheDocument();
},15000);
test('an owner fixing a deleted bill goes to its bin row',async()=>{
  const m=monthFixture({stage:'blocked'});m.checks.blockers=[{kind:'deleted',blocks:true,text:'A bill was deleted',detail:'',bills:[{id:null,bin_id:4,invoice_number:'KGH/2026-27/27',invoice_date:'2026-09-24',customer_name:'Walk-in',status:'deleted'}],more_bills:0,customer:null,suggested:null}];
  server(m);
  function Where(){const l=useLocation();return <output data-testid="where">{l.pathname+l.search}</output>;}
  renderApp(<><GstReturns/><Where/></>,{path:'/gst?firm=3&month=2026-09&fix=1'});
  await waitFor(()=>expect(screen.getByTestId('where')).toHaveTextContent('/audit?restore=4'));
},15000);
