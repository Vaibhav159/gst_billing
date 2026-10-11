import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Landmark } from 'lucide-react';
import { api } from '@/core/api/client';
import { summaryCsv } from '@/core/gst/csv';
import { getGstFile, invalidateGst, useGstLedger, useGstMonth, useGstMonthEnd, useGstSections, useGstWrite, useGstYear } from '@/core/api/gst';
import { billQuery } from '@/core/api/sales';
import { problemOf, type ApiProblem } from '@/core/api/errors';
import { useAuth } from '@/core/auth/AuthProvider';
import { useFirms, useScope } from '@/core/scope';
import { useView } from '@/core/view';
import { date, fyOf, fyMonths, monthLabel, todayIST } from '@/core/format';
import { gstHref, resolveGstNav, type GstNav } from '@/core/gst/navigation';
import type { Check, Month, Year } from '@/core/gst/types';
import { nextSteps } from '@/core/gst/next';
import { STATE_META } from '@/core/gst/stages';
import { saveFile, shareFile } from '@/core/print/files';
import { Banner, Button, Card, Dialog, EmptyState, Page, QueryView, Segmented, Select, PhoneActionBar, Tabs, useToast } from '@/core/ui';
import { useBillDialogs } from '@/pages/sales/actions/BillDialogs';
import { MonthStrip, StatusCard } from './MonthStrip';
import { Checks } from './Checks';
import { Gstr1Card } from './Gstr1Card';
import { Gstr3bCard } from './Gstr3bCard';
import { FilingCard, type FilingAction } from './FilingCard';
import { FilingDialog, PeriodDialog } from './FilingDialogs';
import { AmendCard } from './AmendCard';
import { Cockpit } from './Cockpit';
// Named 3D views stay in their own lazy chunks.
const CreditView=lazy(()=>import('./CreditView').then(m=>({default:m.CreditView})));
const ReconView=lazy(()=>import('./ReconView').then(m=>({default:m.ReconView})));
export default function GstReturns() {
  const scope=useScope(), {firms,loading,error,problem}=useFirms(), {isPhone}=useView();const [search]=useSearchParams();const navigate=useNavigate(),qc=useQueryClient();
  const preliminary=resolveGstNav(search,{firm:scope.firmId,fy:scope.fy,firms:firms.map(f=>f.id),phone:isPhone,defaultMonth:null});
  const year=useGstYear(!scope.ready||preliminary.tab==='all'?null:preliminary.firm,preliminary.fy);
  const nav=resolveGstNav(search,{firm:scope.firmId,fy:scope.fy,firms:firms.map(f=>f.id),phone:isPhone,defaultMonth:year.data?.default_month??null});
  const picked=search.has('month')||year.data?nav.month:null;
  const month=useGstMonth(scope.ready&&nav.tab==='returns'?nav.firm:null,picked);
  const over=fyMonths(nav.fy).filter(m=>m<todayIST().slice(0,7));
  const endMonth=nav.month&&over.includes(nav.month)?nav.month:over.at(-1)??null;
  const phoneBadgeMonth=isPhone&&nav.tab==='returns'&&picked&&picked<todayIST().slice(0,7)?picked:null;
  const end=useGstMonthEnd(scope.ready?(nav.tab==='all'?endMonth:phoneBadgeMonth):null);
  const badge=(id:number)=>{if(!isPhone||nav.tab!=='returns'||!picked)return '';const current=todayIST().slice(0,7);if(picked>=current)return STATE_META[picked===current?'open':'future'].word;const row=end.data?.firms.find(r=>r.firm.id===id);return row?STATE_META[row.stage].word:'';};
  const seen=useRef({firm:scope.firmId,fy:scope.fy,search:search.toString()});
  const go=(patch:Partial<GstNav>)=>{const n={...nav,...patch};if(n.tab==='all')scope.setFirmId('all');else if(n.firm)scope.setFirmId(n.firm);navigate(gstHref(nav,patch),{replace:true});};
  useEffect(()=>{
    if(!scope.ready||loading)return;
    const old=seen.current, s=search.toString();seen.current={firm:scope.firmId,fy:scope.fy,search:s};
    if(old.search===s&&(old.firm!==scope.firmId||old.fy!==scope.fy)) {
      const changedFy=old.fy!==scope.fy;
      navigate(gstHref({...nav,firm:typeof scope.firmId==='number'?scope.firmId:nav.firm,fy:scope.fy,month:changedFy?null:nav.month,tab:scope.firmId==='all'&&!isPhone?'all':nav.tab==='all'?'returns':nav.tab,sec:'b2b',fix:false}),{replace:true});return;
    }
    if(nav.tab==='all'){if(scope.firmId!=='all')scope.setFirmId('all');}
    else if(nav.firm!==null&&scope.firmId!==nav.firm)scope.setFirmId(nav.firm);
    if(nav.fy!==scope.fy)scope.setFy(nav.fy);
    // The URL and the header are the two sources of navigation; the previous pair identifies the source of a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[search,scope.firmId,scope.fy,scope.ready,loading]);
  const tabs=[...(!isPhone?[{value:'all',label:'Month end · all firms'}]:[]),{value:'returns',label:isPhone?'Returns':'Monthly returns'},{value:'recon',label:isPhone?'Reconcile':'Reconciliation'},{value:'credit',label:isPhone?'Credit':'Credit and deadlines'}];
  const firm=firms.find(f=>f.id===nav.firm);const [errorWords,setErrorWords]=useState('');
  const endGeneration=useRef(0);
  useEffect(()=>{endGeneration.current+=1;return()=>{endGeneration.current+=1;};},[nav.tab,endMonth]);
  const downloadEnd=async(id:number)=>{const f=end.data?.firms.find(r=>r.firm.id===id);if(!f||!endMonth)return;const at=endGeneration.current;setErrorWords('');try{const blob=await getGstFile(id,endMonth,'gstr1',!!f.record.gstr1);if(endGeneration.current!==at)return;saveFile(blob,`GSTR1_${f.firm.gst_number}_${endMonth.slice(5)}${endMonth.slice(0,4)}.json`);invalidateGst(qc);}catch(e){if(endGeneration.current===at)setErrorWords(problemOf(e).message);}};
  return <Page title="GST returns" icon={Landmark} context={nav.tab==='all'?`All ${firms.length} firms · each files under its own GSTIN · FY ${nav.fy}`:`${firm?.name??''} · GSTIN ${firm?.gstin??''} · FY ${nav.fy}`} back="/more">
    {isPhone?<Segmented full label="GST view" value={nav.tab} options={tabs} onChange={tab=>go({tab:tab as GstNav['tab']})}/>:<Tabs label="GST views" idBase="gstv" panelId="gstv-panel" value={nav.tab} tabs={tabs} onChange={tab=>go({tab:tab as GstNav['tab']})}/>}
    {nav.tab!=='all'&&firms.length?<Segmented full={isPhone} label="Firm" value={nav.firm??firms[0].id} onChange={firm=>go({firm})} options={firms.map(f=>({value:f.id,label:`${f.short}${badge(f.id)?` · ${badge(f.id)}`:''}`}))}/>:null}
    {errorWords?<Banner tone="neg" title="File not downloaded">{errorWords}</Banner>:null}
    <div id="gstv-panel" role={isPhone?undefined:'tabpanel'} aria-labelledby={isPhone?undefined:`gstv-${nav.tab}`} className="flex flex-col gap-5 min-w-0">
      {error?<Banner tone="neg" title="Couldn't load firms">{problem?.message}</Banner>:loading?<p role="status">Loading GST returns…</p>:!firms.length?<EmptyState title="Add a firm to see its GST returns"/>:nav.fy<'2025-26'&&nav.tab!=='credit'?<Card><EmptyState title={`No returns for FY ${nav.fy} in the app`} actions={<><Button onClick={()=>go({fy:'2025-26',month:null})}>Show FY 2025-26</Button><Button onClick={()=>go({fy:fyOf(todayIST()),month:null})}>Show this year</Button></>}>The app's GST records start in April 2025. Returns for FY {nav.fy} were filed before that, outside the app. The credit the firms carried into FY 2025-26 is kept under Credit and deadlines.</EmptyState></Card>:nav.tab==='all'?<>{!endMonth?<Card>No month of FY {nav.fy} is over yet, so nothing is due. Returns open after the month ends.</Card>:<><Select aria-label="Month" value={endMonth} onChange={e=>go({month:e.target.value})} options={[...over].reverse().map(m=>({value:m,label:monthLabel(m,{long:true})}))}/><QueryView query={end} what="Month end">{d=><Cockpit data={d} onOpen={(firm,fix)=>go({tab:'returns',firm,month:d.month,fix})} onDownload={id=>void downloadEnd(id)} onMark={firm=>navigate(`${gstHref(nav,{tab:'returns',firm,month:d.month})}&mark=1`,{replace:true})}/>}</QueryView></>}</>:nav.tab==='recon'||nav.tab==='credit'?<Suspense fallback={<p role="status">Loading {nav.tab==='credit'?'Credit and deadlines':'Reconciliation'}…</p>}>{nav.firm!==null?nav.tab==='credit'?<CreditView businessId={nav.firm} fy={nav.fy}/>:<ReconView businessId={nav.firm} fy={nav.fy}/>:null}</Suspense>:<QueryView query={year} what="GST year">{y=><QueryView query={month} what="GST returns">{m=><ReturnsMonth key={`${m.business}/${m.month}`} month={m} year={y} nav={nav} go={go} autoMark={search.get('mark')==='1'}/>}</QueryView>}</QueryView>}
    </div>
  </Page>;
}
type ReturnsMonthProps = {month:Month;year:Year;nav:GstNav;go:(patch:Partial<GstNav>)=>void;autoMark?:boolean};
/** A future answer contains due dates only; no filing, checks or money data is read. */
export function ReturnsMonth(props: ReturnsMonthProps) {
  const {isPhone}=useView();
  const {month:m,year,go}=props;
  if(m.stage==='future')return <><MonthStrip year={year} month={m.month} onPick={month=>go({month})} phone={isPhone}/><Card><EmptyState title={`${monthLabel(m.month,{long:true})} hasn't started`} actions={<Button onClick={()=>go({month:todayIST().slice(0,7)})}>Show {monthLabel(todayIST().slice(0,7),{long:true})}</Button>}>Its returns open after the month ends: GSTR-1 is due on {date(m.due.gstr1)} and GSTR-3B on {date(m.due.gstr3b)}.</EmptyState></Card></>;
  return <StartedMonth {...props}/>;
}
function StartedMonth({month:m,year,nav,go,autoMark=false}: ReturnsMonthProps) {
  const {isPhone}=useView(),auth=useAuth(),qc=useQueryClient(),navigate=useNavigate(),toast=useToast();const dialogs=useBillDialogs();
  const [asFiled,setAsFiled]=useState(!!m.record.gstr1&&m.stage!=='unlocked');
  useEffect(()=>{setAsFiled(!!m.record.gstr1&&m.stage!=='unlocked');},[m.record.gstr1?.id,m.stage]);
  const sections=useGstSections(m.business,m.month,asFiled),ledger=useGstLedger(m.business,m.month);
  const mutation=useGstWrite();const [action,setAction]=useState<FilingAction|null>(null);const [failure,setFailure]=useState<ApiProblem|null>(null);const lastDownload=useRef<FilingAction|null>(null);const [fileBusy,setFileBusy]=useState(false);const started=useRef(false);const [shareReady,setShareReady]=useState<{blob:Blob;name:string}|null>(null);
  const fileGeneration=useRef(0);const [shareBusy,setShareBusy]=useState(false);
  useEffect(()=>{fileGeneration.current+=1;return()=>{fileGeneration.current+=1;};},[m.business,m.month]);
  const act=(a:FilingAction)=>{
    setFailure(null);if(a.type!=='download'){setAction(a);return;}if(!auth.can('gst.download')||fileBusy)return;lastDownload.current=a;setFileBusy(true);const at=fileGeneration.current;
    void(async()=>{try{
      const kind=a.kind==='share'?'gstr1':a.kind;
      const via=a.kind==='share'?'share':a.via??'download';
      const blob=await getGstFile(m.business,m.month,kind,!!a.asFiled,via);
      if(fileGeneration.current!==at)return;
      const period=kind==='amendments'?(m.amendments?.carried_by??m.month):m.month;
      const name=kind==='amendments'?m.amendments?.file:`${kind.toUpperCase()}_${m.firm.gst_number}_${period.slice(5)}${period.slice(0,4)}.json`;
      const file={blob,name:name??`GSTR1_${m.firm.gst_number}_${period.slice(5)}${period.slice(0,4)}_amendments.json`};
      if(via==='share'){const result=await shareFile(file.blob,file.name,{title:`GST returns · ${monthLabel(m.month)}`});if(fileGeneration.current!==at)return;if(result==='late')setShareReady(file);else if(result==='unsupported')saveFile(file.blob,file.name);}else saveFile(file.blob,file.name);
      invalidateGst(qc);
    }catch(e){if(fileGeneration.current===at)setFailure(problemOf(e));}finally{if(fileGeneration.current===at)setFileBusy(false);}})();
  };
  const sharePrepared=async()=>{
    if(!shareReady||shareBusy)return;
    const file=shareReady,at=fileGeneration.current;setShareBusy(true);
    try{const result=await shareFile(file.blob,file.name,{title:`GST returns · ${monthLabel(m.month)}`});if(fileGeneration.current!==at)return;if(result==='unsupported'||result==='late')saveFile(file.blob,file.name);setShareReady(null);}
    catch(e){if(fileGeneration.current===at)setFailure(problemOf(e));}
    finally{if(fileGeneration.current===at)setShareBusy(false);}
  };
  const fix=async(check:Check)=>{
    setFailure(null);try {
      if(check.kind==='to_confirm'){const p=check.bills.find(b=>'bill_no'in b);if(p)navigate(`/purchases/${p.id}`);return;}
      if(check.kind==='gap'){go({sec:'docs',fix:false});return;}
      if(check.kind==='deleted'){if(auth.can('audit.view'))navigate('/audit');return;}
      if(check.customer&&['gstin','badgstin'].includes(check.kind)){if(auth.can('customer.edit'))navigate(`/customers/${check.customer.id}/edit?focus=gst_number`);return;}
      const ref=check.bills.find(b=>'invoice_number'in b);if(!ref?.id)return;
      if(check.kind==='duplicate'&&auth.can('bill.edit')){const result=await qc.fetchQuery(billQuery(check.suggested??ref.id));if(result.kind==='bill')dialogs.open('renumber',result.bill);else navigate(`/sales/${ref.id}`);return;}
      navigate(`/sales/${ref.id}${auth.can('bill.edit')&&['hsn','state','head'].includes(check.kind)?'/edit':''}`);
    }catch(e){setFailure(problemOf(e));}
  };
  useEffect(()=>{if(started.current)return;started.current=true;if(nav.fix&&m.checks.blockers[0])void fix(m.checks.blockers[0]);if(autoMark&&auth.can('gst.file'))act({type:'mark',kind:m.record.gstr1?'gstr3b':'gstr1'});if(nav.fix||autoMark)go({fix:false});},[]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit=(method:'post'|'patch'|'delete',path:string,body:unknown)=>{if(mutation.isPending)return;setFailure(null);mutation.mutate({method,path,body},{onSuccess:()=>{setAction(null);toast.show({title:'Filing record saved'});},onError:e=>setFailure(problemOf(e))});};
  const csv=()=>{if(!auth.can('gst.download')||!sections.data)return;const name=`GST_summary_${m.firm.name.replace(/[^A-Za-z0-9]+/g,'_')}_${monthLabel(m.month).replace(/ /g,'_')}.csv`;saveFile(new Blob([summaryCsv(sections.data)],{type:'text/csv;charset=utf-8'}),name);void api.post('audit-logs/log/',{action:'exported',entity:'report',details:`Rate and HSN summary, ${m.firm.name}, ${monthLabel(m.month)}`}).catch(()=>toast.show({title:'Summary CSV downloaded',body:'The download was not recorded in the Audit log.'}));};
  const originalAsFiled=!!m.record.gstr1;
  const download=<>{auth.me?.role!=='viewer'?<Button disabled={!auth.can('gst.download')||(!originalAsFiled&&!m.gstr1?.file.made)||fileBusy} title={!auth.can('gst.download')?auth.whyNot('gst.download'):!originalAsFiled?m.gstr1?.file.why_not:undefined} onClick={()=>act({type:'download',kind:'gstr1',asFiled:originalAsFiled})}>{originalAsFiled?'Download GSTR-1 as filed':'Download GSTR-1 JSON'}</Button>:null}{auth.me?.role!=='viewer'?<Button disabled={!auth.can('gst.download')||!sections.data} title={auth.whyNot('gst.download')} onClick={csv}>Summary CSV</Button>:null}</>;
  const tables=<><QueryView query={sections} what="GSTR-1 sections">{data=><Gstr1Card data={data} month={m} section={nav.sec} onSection={sec=>go({sec})} asFiled={asFiled} onAsFiled={setAsFiled} phone={isPhone} actions={download}/>}</QueryView><QueryView query={ledger} what="GSTR-3B working">{data=><Gstr3bCard month={m} data={data} phone={isPhone} actions={auth.can('gst.download')?<Button disabled={fileBusy||m.stage==='open'} onClick={()=>act({type:'download',kind:'gstr3b'})}>Download GSTR-3B JSON</Button>:null}/>}</QueryView></>;
  const record=<><StatusCard month={m}/><Checks month={m} onFix={check=>void fix(check)}/><FilingCard month={m} onAction={act}/>{m.stage!=='unlocked'&&m.since_filing?<AmendCard month={m} onAction={act}/>:null}</>;
  const next=nextSteps(m,auth.can).map(step=><Button key={step} variant="primary" disabled={fileBusy} onClick={()=>step==='fix'?void fix(m.checks.blockers[0]):step==='relock'?act({type:'relock'}):step==='amend'?act({type:'download',kind:m.amendments?.before_gstr3b?'gstr1a':'amendments',via:'share'}):step==='send'?act({type:'download',kind:'share'}):act({type:'mark',kind:step==='mark1'?'gstr1':'gstr3b'})}>{step==='fix'?m.checks.blockers[0].kind==='duplicate'?'Fix the duplicate number':'Fix the bill':step==='relock'?'Lock again':step==='mark1'?'Mark GSTR-1 filed':step==='mark3b'?'Mark GSTR-3B filed':'Send to the CA'}</Button>);
  return <><MonthStrip year={year} month={m.month} onPick={month=>go({month})} phone={isPhone}/>{failure?<Banner tone="neg" title={action?'Not saved':failure.kind==='offline'?"You're offline, so the file wasn't made":'The file wasn’t made'} actions={!action&&lastDownload.current?<Button onClick={()=>act(lastDownload.current!)}>Try again</Button>:undefined}>{failure.kind==='offline'&&!action?'Try again when the internet is back.':failure.message}</Banner>:null}{fileBusy?<p role="status">Making the return file…</p>:null}
    {isPhone?<>{record}{tables}{auth.me?.role!=='viewer'&&next.length>0?<PhoneActionBar>{next}</PhoneActionBar>:null}</>:<div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] gap-5 items-start"><div className="flex flex-col gap-5 min-w-0">{tables}</div><div className="flex flex-col gap-5 min-w-0">{record}</div></div>}
    {action?.type==='mark'||action?.type==='edit'?<FilingDialog key={`${m.business}/${m.month}/${action.type==='mark'?action.kind:action.record.id}`} month={m} kind={action.type==='mark'?action.kind:action.record.kind} record={action.type==='edit'?action.record:undefined} busy={mutation.isPending} error={failure} onClose={()=>{if(!mutation.isPending)setAction(null);}} onSubmit={body=>{if(action.type==='edit'){const {filed_on,arn,cash_total,cash,late_fee,interest,credit_left}=body;submit('patch',`filings/${action.record.id}/`,{filed_on,arn,cash_total,cash,late_fee,interest,credit_left});}else submit('post','filings/',body);}}/>:action&&['unlock','relock','remove'].includes(action.type)?<PeriodDialog month={m} kind={action.type as 'unlock'|'relock'|'remove'} record={action.type==='remove'?action.record:undefined} busy={mutation.isPending} error={failure} onClose={()=>{if(!mutation.isPending)setAction(null);}} onSubmit={body=>action.type==='remove'?submit('delete',`filings/${action.record.id}/`,{reason:body.reason}):submit('post',`months/${action.type}/`,body)}/>:null}
    {shareReady?<Dialog open title="Your return file is ready" onClose={()=>{if(!shareBusy)setShareReady(null);}} footer={<><Button disabled={shareBusy} onClick={()=>setShareReady(null)}>Not now</Button><Button loading={shareBusy} onClick={()=>void sharePrepared()}>Share</Button></>}><p>{shareReady.name} took a moment to make. Press Share, then pick WhatsApp or any app.</p></Dialog>:null}{dialogs.element}<Link className="text-sm text-muted" to={`/sales?firm=${m.business}&month=${m.month}`}>Open these bills</Link>
  </>;
}
