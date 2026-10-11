// The pieces both the desktop and the phone form show (PROTO pages/sales/BillForm.jsx): the number, the date, the paper
// switch, the place of supply, the note under Paid by, the figures, and the banner that says where the bill came from.
import type { Ref } from "react";
import { AlertTriangle, BookOpenText, Info, RefreshCcw } from "lucide-react";
import { useNetwork } from "@/core/api/network";
import { amountInWords, date, fyOf, monthLabel, monthOf, possessive, weekday } from "@/core/format";
import { posOptions, stateNameOf } from "@/core/sales/pos";
import { taxLines } from "@/core/sales/words";
import { Badge, Banner, Button, ButtonLink, DL, Field, Input, Money, Select, Switch } from "@/core/ui";
import { DateField, focusSoon, LabelSpacer } from "./fields";
import { slabOf, stateOf } from "./model";
import { paymentNote, shiftDate } from "./rules";
import type { BillFormApi } from "./useBillForm";

type P = { F: BillFormApi; id: string };

/** A firm's month in the paper book (/sales/paper keeps its firm and month in the address). */
export const paperBookTo = (firmId: number, ym: string) => `/sales/paper?firm=${firmId}&month=${ym}`;

/** Closing a new bill returns to its paper book when it has a firm and date, otherwise to Sales. */
export const billCloseTo = (F: BillFormApi) => F.paper && F.f.date && F.f.firmId !== null ? paperBookTo(F.f.firmId, monthOf(F.f.date)) : "/sales";

/** A server-refused field takes focus once the review has closed, on either view. */
export function saveFromReview(F: BillFormApi, focus: (key: string) => void, numberOverride?: string): void {
  void F.save({ numberOverride }).then((r) => { if (r.refused) { const key = r.refused; setTimeout(() => focus(key), 0); } });
}

/** The bill number: always the paper bill's, typed, or the next one confirmed; a saved bill's kept unless renumbered (PROTO BillForm.jsx:262-299). */
export function NumberField({ F, id, inputRef }: P & { inputRef?: Ref<HTMLInputElement> }) {
  const offline = useNetwork() === "offline";
  const err = F.showErr("number");
  const fy = fyOf(F.f.date || F.today).replace("-", "‑");
  const short = F.firm?.short ?? "the firm";
  if (F.keep && F.bill) {
    const old = F.bill.invoice_number;
    return (
      <Field label="Bill number" error={err} hint="A bill keeps its number. Renumbering is for the owner, while the month is open."
        aside={F.canMove ? <Button size="sm" variant="link" onClick={() => { F.setNumber(old); focusSoon(id, true); }}>Renumber…</Button> : <LabelSpacer />}>
        <p id={id} className="min-h-11 flex items-center gap-2 px-0.5 tnum text-md font-semibold">{old}</p>
      </Field>
    );
  }
  const text = F.numberText.trim();
  const saved = text && F.stored !== text ? `Saved as ${F.stored}. ` : "";
  const why = F.numberNote
    || (F.waitingForNext ? "Looking up the next number…"
      : !F.f.numberTyped && F.suggestion ? (F.paper ? "The paper book's next number. Type the paper bill's own if it's different." : `Next free number for ${short} in FY ${fy}. Type the paper bill's number if it's different.`)
        : !F.suggestion && !F.f.numberTyped ? `Type the number written on the paper bill.${offline ? " The app can't look up the next free number offline." : ""}`
          : F.paper ? (saved ? "" : "As written on the paper bill.") : `Any format: 108 or SGJ/2024-25/108. Checked against ${possessive(short)} bills in FY ${fy} as you type.`);
  const aside = F.edit && F.bill && !F.moved
    ? <Button size="sm" variant="link" onClick={F.takeSuggestion}>{`Keep ${F.bill.invoice_number}`}</Button>
    : F.f.numberTyped && F.suggestion && text !== F.suggestion ? <Button size="sm" variant="link" onClick={() => { F.takeSuggestion(); focusSoon(id, true); }}>Use the next free one</Button> : <LabelSpacer />;
  return (
    <Field label={F.paper ? "Number on the paper bill" : "Bill number"} htmlFor={id} error={err} hint={`${saved}${why}`} aside={aside}>
      <Input ref={inputRef} id={id} maxLength={16} value={F.numberText} invalid={Boolean(err)} inputClassName="tnum" autoComplete="off" spellCheck={false}
        onChange={(e) => F.setNumber(e.target.value)} />
    </Field>
  );
}

/** "Copying a paper bill": a bill from the paper bill book, typed in later with its own number and date (PROTO BillForm.jsx:313-324). */
export function PaperSwitch({ F, id }: P) {
  const ym = F.f.date ? monthOf(F.f.date) : "";
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-[min(100%,280px)] flex-1">
        <Switch id={id} label="Copying a paper bill" checked={F.f.paper} onChange={F.setPaper}
          description={F.f.paper ? "Its number and date are the paper bill's. Nothing goes on WhatsApp: the customer has the paper bill." : "For a bill from the paper bill book, typed in later with its own number and date."} />
      </div>
      {F.f.paper && ym && F.f.firmId !== null ? <ButtonLink size="sm" variant="ghost" icon={BookOpenText} to={paperBookTo(F.f.firmId, ym)}>The paper book</ButtonLink> : null}
    </div>
  );
}

/** The date: Today and Yesterday; a paper bill's own date, with Same as last bill, Day before and Day after (PROTO BillForm.jsx:326-356). */
export function DateBlock({ F, id, inputRef }: P & { inputRef?: Ref<HTMLInputElement> }) {
  const err = F.showErr("date");
  const pick = (iso: string) => { F.set({ date: iso }); F.setTouched((t) => ({ ...t, date: true })); };
  const hint = F.dateWarn || (F.f.date && !F.errors.date ? `${weekday(F.f.date)} · goes into ${monthLabel(monthOf(F.f.date), { long: true })}'s GSTR-1` : "Day first: 8/10, 08-10-2026 or 8 Oct. Alt + Down opens the calendar.");
  const field = (
    <DateField id={id} inputRef={inputRef} value={F.f.date} today={F.today} offReason={F.offReason} label={F.paper ? "Date on the paper bill" : "Date"}
      onChange={(iso) => F.set({ date: iso ?? "" })} onCommit={() => F.setTouched((t) => ({ ...t, date: true }))}
      invalid={Boolean(err)} describedBy={err ? `${id}-error` : `${id}-hint`} />
  );
  if (F.paper) {
    const cur = F.f.date;
    const last = F.lastPaperDay;
    const after = cur ? shiftDate(cur, 1) : "";
    return (
      <Field label="Date on the paper bill" htmlFor={id} error={err} hint={hint} aside={<LabelSpacer />}>
        {field}
        <span className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
          <Button size="sm" variant="link" disabled={!last || last === cur} title={last ? `The last paper bill's date, ${date(last)}` : "No paper bill typed in yet"} onClick={() => pick(last)}>Same as last bill</Button>
          <Button size="sm" variant="link" disabled={!cur} onClick={() => pick(shiftDate(cur, -1))}>Day before</Button>
          <Button size="sm" variant="link" disabled={!cur || after > F.today} onClick={() => pick(after)}>Day after</Button>
        </span>
      </Field>
    );
  }
  return (
    <Field label="Date" htmlFor={id} error={err}
      hint={F.dateWarn ? <span className="text-brand inline-flex gap-1.5 items-start"><AlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />{hint}</span> : hint}
      aside={<span className="flex gap-3"><Button size="sm" variant="link" onClick={() => pick(F.today)}>Today</Button><Button size="sm" variant="link" onClick={() => pick(shiftDate(F.today, -1))}>Yesterday</Button></span>}>
      {field}
    </Field>
  );
}

/**
 * Place of supply for goods is where they're handed over: a counter sale is in the firm's state whoever buys; goods sent
 * to another state are taxed there (IGST). One question (PROTO BillForm.jsx:358-393).
 */
export function PlaceOfSupply({ F, id }: P) {
  const home = F.firmState;
  const away = F.pos !== home;
  const custCode = F.cust ? stateOf(F.cust.gst_number, F.cust.state_name) : "";
  const custAway = custCode && custCode !== home ? custCode : "";
  const err = F.showErr("pos");
  const setAway = (on: boolean) => {
    if (!on) F.set({ posOverride: F.auto === home ? null : home });
    else { const st = custAway || ""; F.set({ posOverride: st === F.auto ? null : st }); if (!st) focusSoon(`${id}-state`); }
  };
  const pick = (st: string) => F.set({ posOverride: st === F.auto ? null : st });
  return (
    <div className="flex flex-col gap-2.5 min-w-0">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Badge tone="sale">{F.tt.short}</Badge>
        <span className="text-sm text-fg2">{F.pos ? F.tt.why : "choose the state it's delivered to"}</span>
      </div>
      <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
        <div className="min-w-[min(100%,260px)]">
          <Switch id={`${id}-away`} label="Delivered to another state" checked={away} onChange={setAway}
            description={away ? "Taxed as IGST in the state it goes to" : `Handed over here, so CGST + SGST in ${stateNameOf(home)}${F.cust && !F.cust.gst_number && custAway ? `, even for a buyer from ${stateNameOf(custAway)}` : ""}`} />
        </div>
        {away ? (
          <Field label="Delivered to" htmlFor={`${id}-state`} error={err} className="w-full max-w-[280px] anim-rise">
            <Select id={`${id}-state`} value={F.pos || ""} placeholder="Choose the state" invalid={Boolean(err)}
              options={posOptions(custAway || home).filter((o) => o.value !== home)} onChange={(e) => pick(e.target.value)} />
          </Field>
        ) : null}
      </div>
    </div>
  );
}

/** The note under Paid by: nothing chosen for you, udhaar, part cash, or cash over the limit (PROTO BillForm.jsx:554-568). */
export function PaymentNote({ F, id }: P) {
  const text = paymentNote(F.f.payment, F.cashOver);
  if (!text) return null;
  // no entrance animation: it's there from the first draw, and a fading note reads as low contrast
  return <p id={id} className={F.cashOver && F.f.payment === "cash" ? "text-sm text-brand" : "text-sm text-muted"}>{text}</p>;
}

/**
 * Taxable value, each head by slab, the total and its words; nothing worked out for a line until its GST rate is chosen,
 * and a rate that isn't a slab (v2's 7%) isn't one chosen (PROTO BillForm.jsx:764-781).
 */
export function SummaryFigures({ F, compact = false }: { F: BillFormApi; compact?: boolean }) {
  const lines = taxLines({ ...F.figs, interstate: F.tt.inter });
  const missing = F.filled.filter((l) => !slabOf(l.gst));
  return (
    <div className="flex flex-col gap-3">
      <DL rows={[["Taxable value", <Money key="tx" value={F.figs.taxable} bump />], ...lines.map((t) => [t.label, <Money key={t.key} value={t.value} bump />] as const)]} />
      {missing.length ? <p className="text-sm text-neg anim-rise">GST isn&apos;t worked out for {missing.map((l) => l.name).join(", ")} until its rate is chosen.</p> : null}
      <div className="flex items-baseline justify-between gap-3 border-t border-rule pt-3">
        <span className="font-semibold">Total</span>
        <Money value={F.figs.total} size={compact ? "2xl" : "3xl"} tone="sale" bump />
      </div>
      {F.figs.total ? <p className="text-sm text-muted -mt-1">{amountInWords(F.figs.total)}</p> : <p className="text-sm text-muted -mt-1">Pick a customer and an item to see the bill add up.</p>}
    </div>
  );
}

/** Where the bill came from, one line each (PROTO BillForm.jsx:203-253). */
export function Origins({ F }: { F: BillFormApi }) {
  const o = F.start.origin;
  const out = [];
  if (o?.kind === "remake") {
    out.push(<Banner key="r" tone="brand" icon={RefreshCcw} title={`Making ${o.number} again`}>
      It was cancelled{o.reason ? ` (“${o.reason}”)` : ""}. Same customer, items and payment; correct what was wrong. It takes the paper bill&apos;s number, and the audit log says it replaces {o.number}.
    </Banner>);
  }
  if (o?.kind === "copy") {
    out.push(<Banner key="c" tone="brand" icon={Info} title={`Copied from ${o.number}`}>
      {possessive(o.customer)} bill of {date(o.date)}. Check the weights and rates; the date, number and payment are new.
    </Banner>);
  }
  if (o?.kind === "amountOnly") out.push(<Banner key="a" tone="brand" icon={Info} title="Some lines came in as an amount only">They open as 1 × their value, so the total stays the same. Add the weight and rate if you have them.</Banner>);
  return <>{out}</>;
}
