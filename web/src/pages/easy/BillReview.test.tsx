import { useState } from 'react';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { renderApp } from '@/test/render';
import { blankLine } from '@/pages/sales/form/model';
import { billFigures } from '@/core/sales/maths';
import type { PaymentMode } from '@/core/sales/types';
import { BillReview, type ReviewForm } from './BillReview';
const form=():ReviewForm=>({
 reviewOpen:true, closeReview:vi.fn(), saving:false, saveError:null, numberText:'34', stored:'KGH/2026-27/34',waitingForNext:false,numberError:'',dateError:'',
 f:{firmId:3,customer:null,date:'2026-10-08',number:'',numberTyped:false,paper:false,posOverride:null,payment:'bank',notes:'',lines:[{...blankLine(),name:'Gold ring',hsn:'7113',gst:'3',qty:12.345,rate:'6512.50'}]},
 firmName:'KIRAN GOLD HOUSE',cust:null,figs:billFigures([{quantity:'12.345',rate:'6512.50',gst_percent:'3'}],false),tt:{inter:false,short:'CGST + SGST',why:''},
});
beforeEach(()=>vi.useFakeTimers({toFake:['Date','setTimeout','clearTimeout']}));
afterEach(()=>vi.useRealTimers());
const opened=()=>act(()=>{vi.advanceTimersByTime(400);});
it('shows exact paise and requires every red acknowledgement',()=>{
 const save=vi.fn();renderApp(<BillReview paymentWords="paid by UPI" F={form()} checks={[{id:'slip',text:'Check this rate',tick:'The rate is right'}]} offline={false} canSave onSave={save} onFullView={vi.fn()}/>);
 opened(); expect(screen.getAllByText('₹82,808.71').length).toBeGreaterThan(0);
 const b=screen.getByRole('button',{name:'Save bill 34'}); expect(b).toBeDisabled();
 fireEvent.click(screen.getByLabelText('The rate is right')); expect(b).toBeEnabled();
 fireEvent.click(b);expect(save).toHaveBeenCalledTimes(1);
 expect(screen.getByText(/as on the paper bill\./)).toBeVisible();
});
it('disables offline saves and never offers the cash override',()=>{
 const f=form();f.f.payment='cash';
 renderApp(<BillReview paymentWords="paid by UPI" F={f} checks={[]} offline canSave onSave={vi.fn()} onFullView={vi.fn()}/>);
 opened();expect(screen.getByRole('button',{name:'Save bill 34'})).toBeDisabled();
 expect(screen.getByText("You're offline. Your bill is kept on this phone; save it when the internet is back.")).toBeVisible();
 expect(screen.queryByText('Save it as all cash anyway')).toBeNull();
});
it('cash warnings do not hold an online save',()=>{
 const f=form();f.f.payment='cash';
 const save=vi.fn();
 const warning='₹2,00,000.00 taken in cash is at or over the ₹2,00,000 limit for one bill (Income Tax Sec 269ST).';
 renderApp(<BillReview paymentWords="paid in cash" F={f} checks={[{id:'cash_limit',text:warning}]} offline={false} canSave onSave={save} onFullView={vi.fn()}/>);
 opened();expect(screen.getByText(warning)).toBeVisible();
 expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
 const button=screen.getByRole('button',{name:'Save bill 34'});expect(button).toBeEnabled();
 fireEvent.click(button);expect(save).toHaveBeenCalledTimes(1);
});
it('revokes acknowledgements when the checked values change',()=>{
 function Harness(){const [f,set]=useState(form());return <><button onClick={()=>set({...f,numberText:'35'})}>Changed elsewhere</button><BillReview paymentWords="paid by UPI" F={f} checks={[{id:'slip',text:'Check this rate',tick:'The rate is right'}]} offline={false} canSave onSave={vi.fn()} onFullView={vi.fn()}/></>;}
 renderApp(<Harness/>);opened();fireEvent.click(screen.getByLabelText('The rate is right'));
 fireEvent.click(screen.getByText('Changed elsewhere'));
 expect(screen.getByRole('button',{name:'Save bill 35'})).toBeDisabled();
});
it('shows the 8 second saving note and refuses closing',()=>{
 const f={...form(),saving:true};renderApp(<BillReview paymentWords="paid by UPI" F={f} checks={[]} offline={false} canSave onSave={vi.fn()} onFullView={vi.fn()}/>);
 act(()=>vi.advanceTimersByTime(8000));expect(screen.getByText("Still saving. Don't close the app.")).toBeVisible();
 fireEvent.keyDown(document,{key:'Escape'});expect(f.closeReview).not.toHaveBeenCalled();
});
it('keeps clash words and offers only the brain-provided next number',()=>{
 const f={...form(),saveError:{kind:'clash' as const,title:'KGH/2026-27/34 was just used',body:'Check the number on the paper bill.',next:'KGH/2026-27/35'}};
 const save=vi.fn();renderApp(<BillReview paymentWords="paid by UPI" F={f} checks={[]} offline={false} canSave onSave={save} onFullView={vi.fn()}/>);opened();
 fireEvent.click(screen.getByRole('button',{name:'Save as 35'}));expect(save).toHaveBeenCalledWith('KGH/2026-27/35');
});

it('offers the fresh next number if another counter consumed the first offer',()=>{
 const f={...form(),numberText:'36',stored:'KGH/2026-27/36',saveError:{kind:'clash' as const,title:'34 was just used',body:'Check the number on the paper bill.',next:'KGH/2026-27/35'}};
 const save=vi.fn();renderApp(<BillReview paymentWords="paid by UPI" F={f} checks={[]} offline={false} canSave onSave={save} onFullView={vi.fn()}/>);opened();
 fireEvent.click(screen.getByRole('button',{name:'Save as 36'}));expect(save).toHaveBeenCalledWith('KGH/2026-27/36');
});
it('preserves a server refusal instead of replacing it with connection words',()=>{
 const f={...form(),saveError:{kind:'failed' as const,title:'Not saved',body:'Only the owner and counter staff can make bills.'}};
 renderApp(<BillReview paymentWords="paid by UPI" F={f} checks={[]} offline={false} canSave onSave={vi.fn()} onFullView={vi.fn()}/>);
 expect(screen.getByText('Only the owner and counter staff can make bills.')).toBeVisible();
});

it.each<[PaymentMode,string]>([
 ['cash','paid in cash'],['bank','paid by UPI'],['credit','billed on udhaar, to be paid later'],
 ['mixed','paid part in cash, part by UPI'],['','payment not recorded'],
])('review payment %s uses the same exact Easy sentence as Saved',(payment,words)=>{
 const f=form();f.f.payment=payment;
 renderApp(<BillReview paymentWords={words} F={f} checks={[]} offline={false} canSave onSave={vi.fn()} onFullView={vi.fn()}/>);
 expect(screen.getByText(/You are billing/)).toHaveTextContent(`, ${words}. Bill number`);
});

it('each reviewed line names its rate unit and shows its own rounded price before GST',()=>{
 const f=form();
 f.f.lines=[f.f.lines[0],blankLine(),{...blankLine(),name:'Loose diamond',hsn:'7102',gst:'0.25',unit:'ct',qty:2,rate:'1000.00'}];
 f.figs=billFigures([{quantity:'12.345',rate:'6512.50',gst_percent:'3'},{quantity:'2',rate:'1000',gst_percent:'0.25'}],false);
 renderApp(<BillReview paymentWords="paid by UPI" F={f} checks={[]} offline={false} canSave onSave={vi.fn()} onFullView={vi.fn()}/>);
 const lines=screen.getAllByRole('listitem');expect(lines).toHaveLength(2);
 expect(lines[0]).toHaveTextContent('12.345 gms × ₹6,512.50 a gram');
 expect(within(lines[0]).getByText('₹80,396.81')).toBeVisible();
 expect(lines[1]).toHaveTextContent('2.000 ct × ₹1,000.00 a carat');
 expect(within(lines[1]).getByText('₹2,000.00')).toBeVisible();
 expect(within(lines[0]).queryByText('₹82,808.71')).not.toBeInTheDocument();
});

it('a counted item says a piece and retains the shared rounded line amount',()=>{
 const f=form();f.f.lines=[{...blankLine(),name:'Silver spoon',unit:'nos',qty:2,rate:'0.025',hsn:'7114',gst:'3'}];
 f.figs=billFigures([{quantity:2,rate:'0.025',gst_percent:'3'}],false);
 renderApp(<BillReview paymentWords="paid by UPI" F={f} checks={[]} offline={false} canSave onSave={vi.fn()} onFullView={vi.fn()}/>);
 const line=screen.getByRole('listitem');
 expect(line).toHaveTextContent('2 nos × ₹0.025 a piece');
 expect(within(line).getByText('₹0.05')).toBeVisible();
});
