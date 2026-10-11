import type { Customer, CustomerRow } from "@/core/api/customers";
import { Check, ChevronRight, User, UserPlus, WifiOff } from "lucide-react";
import { cn } from "@/core/cn";
import { date, plural } from "@/core/format";
import { Button, Field, ListSkeleton, SearchInput, Steps } from "@/core/ui";

export type WhoIsBuyingProps = {
  firmName: string; selected: Customer | null; recent: CustomerRow[]; matches: CustomerRow[] | null;
  typed: string; searchNote: string; loading: boolean; failure: string; walkin: Customer | null;
  maskPhone: (phone: string) => string;
  canAdd: boolean; canCreate: boolean; whyCreate: string;
  onType: (text: string) => void; onPick: (customer: Customer) => void; onNew: (typed: string) => void;
};

/** Presentation only: the Easy layout owns the brain; queries, firm/header and pinned New customer stay outside. */
export function WhoIsBuying({ firmName, selected, recent, matches, typed, searchNote, loading, failure, walkin,
  canAdd, canCreate, whyCreate, maskPhone, onType, onPick, onNew }: WhoIsBuyingProps) {
  const q = typed.trim();
  const rows = recent.filter((c) => c.type !== "walkin").slice(0, 6);
  const searchRows = matches?.filter((c) => c.type !== "walkin");
  const pending = searchNote || (q.length < 2 ? "Type at least 2 characters to search." : "Searching…");
  const choice = (c: CustomerRow) => <CustomerChoice key={c.id} customer={c} phoneText={maskPhone(c.mobile_number)} selected={selected?.id === c.id} disabled={!canCreate} onPick={() => onPick(c)} />;
  return <>
    <div className="[&_.text-xs]:!text-md -mt-1"><Steps step={1} total={2} label="Who is buying" /></div>
    <h2 className="text-2xl font-semibold leading-tight -mb-1">Who is buying?</h2>
    {!canCreate ? <p className="text-md text-muted">{whyCreate}</p> : null}
    {failure ? <p role="status" className="flex items-start gap-2 rounded-ctl border border-line bg-card px-4 py-3 text-md text-fg2">
      <WifiOff size={18} className="text-muted shrink-0 mt-0.5" aria-hidden="true" />{failure}
    </p> : null}
    {loading ? <ListSkeleton rows={6} what="your customers" /> : <>
      <Field label="Search by name or phone" htmlFor="easy-who">
        <SearchInput id="easy-who" label={null} value={typed} onChange={onType} placeholder="Like Anil or 98290" />
      </Field>
      {q ? searchNote || q.length < 2 || searchRows === undefined ? <p role="status" className="text-md text-muted">{pending}</p>
        : searchRows.length ? <section aria-label={`Customers matching ${q}`} className="card anim-rise">
          <div className="flex items-baseline justify-between px-4 pt-3.5 pb-2">
            <h3 className="font-semibold">{plural(searchRows.length, "customer")} found</h3>
            <span className="text-md text-muted">Last bill here</span>
          </div>
          <ul>{searchRows.map((c) => <li key={c.id}>{choice(c)}</li>)}</ul>
        </section> : <div className="card p-5 flex flex-col gap-3 anim-rise">
          <p className="text-lg font-medium">No customer called “{q}” yet</p>
          <p className="text-fg2">Check the spelling, or try the phone number. If they are new, add them; it takes a few seconds.</p>
          {canAdd ? <Button variant="outline" size="lg" icon={UserPlus} onClick={() => onNew(q)} className="self-start">Add “{q}” as a new customer</Button> : null}
        </div> : <>
          <button type="button" disabled={!canCreate || !walkin} onClick={() => { if (walkin) onPick(walkin); }}
            className={cn("card w-full flex items-center gap-3 p-4 min-h-[80px] text-left transition-[border-color,background-color,transform] duration-150 hover:border-muted/50 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed", walkin && selected?.id === walkin.id && "border-brand bg-brand-sel")}>
            <span aria-hidden="true" className="w-12 h-12 rounded-ctl bg-brand-tint border border-brand-line grid place-items-center text-brand shrink-0"><User size={22} /></span>
            <span className="flex-1 min-w-0">
              <span className="block text-lg font-medium">Walk-in customer</span>
              <span className="block text-md text-muted">No name or phone needed</span>
              {walkin && selected?.id === walkin.id ? <span className="sr-only">(on this bill now)</span> : null}
            </span>
            {walkin && selected?.id === walkin.id ? <Check size={20} className="text-brand shrink-0" aria-hidden="true" /> : <ChevronRight size={20} className="text-muted shrink-0" aria-hidden="true" />}
          </button>
          {rows.length ? <section aria-labelledby="easy-recent-t" className="card">
            <div className="flex items-baseline justify-between px-4 pt-3.5 pb-2">
              <h3 id="easy-recent-t" className="font-semibold">Recent customers</h3>
              <span className="text-md text-muted">Last bill</span>
            </div>
            <ul>{rows.map((c) => <li key={c.id}>{choice(c)}</li>)}</ul>
          </section> : <p className="text-fg2">No customers have bills at {firmName} this year yet. Search above, or add a new customer.</p>}
        </>}
    </>}
  </>;
}

/** Amounts and full phone/bill numbers stay off the counter screen. */
function CustomerChoice({ customer, phoneText, selected, disabled, onPick }: { customer: CustomerRow; phoneText: string; selected: boolean; disabled: boolean; onPick: () => void }) {
  const last = customer.figures?.last_bill;
  return <button type="button" onClick={onPick} disabled={disabled}
    className={cn("w-full flex items-center gap-3 px-4 py-3 min-h-[68px] text-left border-t border-rule transition-colors hover:bg-raised/60 disabled:opacity-50 disabled:cursor-not-allowed", selected && "bg-brand-sel")}>
    <span className="flex-1 min-w-0">
      <span className="block font-medium break-words">{customer.name}</span>
      <span className="block text-md text-muted tnum">{phoneText}{customer.gst_number ? " · shop" : ""}</span>
    </span>
    <span className="text-right shrink-0 text-md text-muted tnum">{last ? date(last.invoice_date) : "No bills here this year"}</span>
    {selected ? <><Check size={20} className="text-brand shrink-0" aria-hidden="true" /><span className="sr-only">(on this bill now)</span></> : null}
  </button>;
}
export default WhoIsBuying;
