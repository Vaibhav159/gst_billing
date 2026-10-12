import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderApp } from '@/test/render';
import { blankLine, startNew } from '@/pages/sales/form/model';
import { toSaleProduct } from '@/pages/sales/form/products';
import { BillItems } from './BillItems';
const products = Array.from({length:14}, (_,i) => toSaleProduct({id:i+1,name:`Saved item ${i+1}`,hsn_code:'7113',gst_tax_rate:'0.03',default_unit:'gms',description:'',usage_count:i}));
const line = () => ({...blankLine(),key:'one',name:'Gold ring',hsn:'7113',gst:'3',qty:12.345});
const base = () => ({lines:[],products,canEditProducts:true,errors:{},onChange:vi.fn(),onAdd:vi.fn(),onRemove:vi.fn(),onNew:vi.fn(),notices:{}});
it('shows six saved names by usage and searches the remaining products', () => {
  const p=base(); renderApp(<BillItems {...p}/>);
  expect(screen.getByRole('button',{name:'Saved item 14'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'Saved item 8'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Something else'}));
  fireEvent.change(screen.getByLabelText('Find an item'),{target:{value:'Saved item 1'}});
  fireEvent.click(screen.getByRole('button',{name:'Saved item 1'}));
  expect(p.onAdd).toHaveBeenCalledWith(expect.objectContaining({name:'Saved item 1',rate:'',qty:null}));
});
it('leaves the paper rate blank and Enter moves weight to rate', () => {
  const p={...base(),lines:[line()]}; renderApp(<BillItems {...p}/>);
  const rate=screen.getByLabelText('Rate per gram, as on the paper bill');
  expect(rate).toHaveValue('');
  expect(screen.getByText('Making is included in this rate.')).toBeVisible();
  fireEvent.keyDown(screen.getByLabelText('Weight in grams'),{key:'Enter'});
  expect(rate).toHaveFocus();
  fireEvent.change(rate,{target:{value:'6512.50'}});
  expect(p.onChange).toHaveBeenCalledWith('one',{rate:'6512.50'});
  expect(screen.queryByLabelText('Making charges')).toBeNull();
});
it('keeps missing HSN editable for owner and explains it to staff', () => {
 const p={...base(),lines:[{...line(),hsn:''}]}; const view=renderApp(<BillItems {...p}/>);
 expect(screen.getByLabelText('HSN code')).toBeVisible();
 view.unmount(); renderApp(<BillItems {...p} canEditProducts={false}/>);
 expect(screen.getByText('This item has no HSN code. Ask the owner to add it in Products.')).toBeVisible();
});
it('applies supplied slip fixes to the typed line and shows field refusals',()=>{
 const p={...base(),lines:[line()],errors:{'one-rate':'Type the paper rate.'},notices:{one:[{text:'Rates here are per gram',fix:{label:'Use ₹6,512.50',patch:{rate:'6512.50'}}}]}};
 renderApp(<BillItems {...p}/>);
 fireEvent.click(screen.getByRole('button',{name:'Use ₹6,512.50'}));
 expect(p.onChange).toHaveBeenCalledWith('one',{rate:'6512.50'});
 expect(screen.getByText('Type the paper rate.')).toBeVisible();
});
it.each([
 {field:'qty' as const,label:'Weight in grams',error:'Type the paper weight.',slip:'Check the weight on the paper bill.'},
 {field:'rate' as const,label:'Rate per gram, as on the paper bill',error:'Type the paper rate.',slip:'Rates here are per gram.'},
])('describes the $field input with both its refusal and slip',({field,label,error,slip})=>{
 renderApp(<BillItems {...base()} lines={[line()]} errors={{[`one-${field}`]:error}} notices={{one:[{field,text:slip}]}}/>);
 const input=screen.getByLabelText(label);
 expect(input).toHaveAccessibleDescription(`${error} ${slip}`);
 expect(input).toHaveAttribute('aria-invalid','true');
});
it('keeps the rate hint in its description when a slip is shown without a refusal',()=>{
 renderApp(<BillItems {...base()} lines={[line()]} notices={{one:[{text:'Rates here are per gram.'}]}}/>);
 expect(screen.getByLabelText('Rate per gram, as on the paper bill')).toHaveAccessibleDescription('Making is included in this rate. Rates here are per gram.');
});
it('lets the owner repair a nonempty HSN that the server refused',()=>{
 renderApp(<BillItems {...base()} lines={[{...line(),hsn:'123'}]} errors={{'one-hsn':'Type 4 to 8 digits.'}}/>);
 expect(screen.getByLabelText('HSN code')).toHaveValue('123');
});
it('shows a board reference quietly without marking the rate invalid',()=>{
 renderApp(<BillItems {...base()} lines={[line()]} references={{one:"Board on 30 Sep: ₹6,470.00 a gram"}}/>);
 expect(screen.getByText('Board on 30 Sep: ₹6,470.00 a gram')).toBeVisible();
 expect(screen.getByLabelText('Rate per gram, as on the paper bill')).not.toHaveAttribute('aria-invalid','true');
 expect(screen.queryByRole('alert')).toBeNull();
});
it('opens the picker for the shared new-bill placeholder without drawing an empty item',()=>{
 const start=startNew({firmId:3,firmSource:'scope',today:'2026-10-08'});
 const p={...base(),lines:start.form.lines};renderApp(<BillItems {...p}/>);
 expect(screen.getByRole('heading',{name:'What is it?'})).toBeVisible();
 expect(screen.queryByLabelText('Weight in grams')).toBeNull();
 expect(screen.queryByLabelText('HSN code')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Saved item 14'}));
 expect(p.onAdd).toHaveBeenCalledWith(expect.objectContaining({productId:14,name:'Saved item 14',qty:null,rate:''}));
});
it('shows only actual items when the shared form still contains blank placeholders',()=>{
 const start=startNew({firmId:3,firmSource:'scope',today:'2026-10-08'});
 renderApp(<BillItems {...base()} lines={[...start.form.lines,line(),blankLine()]}/>);
 expect(screen.getAllByLabelText('Weight in grams')).toHaveLength(1);
 expect(screen.getByRole('heading',{name:'Item 1: Gold ring'})).toBeVisible();
 expect(screen.queryByLabelText('HSN code')).toBeNull();
 expect(screen.getByRole('button',{name:'Add another item'})).toBeVisible();
});
it('focuses the refused product card and keeps the server product error visible',async()=>{
 renderApp(<BillItems {...base()} lines={[line()]} errors={{'one-product':'Type the item name as it should print on the bill.'}} focus={{key:'one',field:'product'}}/>);
 const card=screen.getByRole('region',{name:'Item 1: Gold ring'});
 await waitFor(()=>expect(card).toHaveFocus());
 expect(screen.getByText('Type the item name as it should print on the bill.')).toBeVisible();
});
