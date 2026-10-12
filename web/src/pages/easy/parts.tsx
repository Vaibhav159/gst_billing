// Shared Easy controls ported from the prototype; money comes from part 1's mapped server answers.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { ChevronLeft, Plus, CheckCircle2, MessageCircle, Printer, Pencil, WifiOff, CloudOff, Send, RotateCcw, Maximize2 } from "lucide-react";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { useNetwork } from "@/core/api/network";
import { useCancelBill } from "@/core/api/sales";
import { useAuth } from "@/core/auth/AuthProvider";
import { inr, qty, date, dateShort, mobileText } from "@/core/format";
import { mobileOf } from "@/core/sales/share";
import type { BillDetail, BillRow, PaymentMode } from "@/core/sales/types";
import { halfPercent, PAY_SHORT, rateText, sentWhen, timeOf } from "@/core/sales/words";
import { AppMark, Button, ButtonLink, Badge, Chip, ConfirmDialog, LoadError, PhoneActionBar, cn, useDocTitle, scrollIntoViewSafe } from "@/core/ui";
import { SendCell } from "@/pages/sales/actions/SendCell";
import { useSendBill, useSendReady, type SendOptions } from "@/pages/sales/actions/useSendBill";
import { WhatsAppDialog } from "@/pages/sales/actions/WhatsAppDialog";
import { PAY_CHOICES } from "./state";
const billNo = (bill: Pick<BillRow, "counter" | "invoice_number">) => String(bill.counter ?? bill.invoice_number);
/**
 * Easy page: sticky header, roomy content, optional pinned bar above the tabs.
 * back: true (history back), a path, or a function. Without back: the app mark (a tab's first screen).
 * The header carries data-phone-header, the shell's marker for a phone page header.
 */
export function EasyPage({ title, subtitle, back, actions, children, bar, className, docTitle }: {
  title: ReactNode; subtitle?: ReactNode; back?: boolean | string | (() => void); actions?: ReactNode; children?: ReactNode;
  bar?: ReactNode; className?: string; docTitle?: string;
}) {
  const navigate = useNavigate();
  useDocTitle(docTitle || (typeof title === "string" ? title : undefined));
  const onBack = typeof back === "function" ? back : typeof back === "string" ? () => navigate(back) : () => navigate(-1);
  // On the narrowest phones (under 360 px) the header drops the app mark and lets the
  // title wrap onto a second line, so a firm's name is never cut.
  const head = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (!head.current || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < 360));
    ro.observe(head.current);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="min-h-full flex flex-col">
      <header data-phone-header="" className="sticky top-0 z-nav bg-bar border-b border-rule">
        <div ref={head} className={cn("flex items-center gap-2 px-3 min-h-[68px]", narrow && "py-2")}>
          {back ? (
            <Button variant="ghost" icon={ChevronLeft} onClick={onBack} className={cn("shrink-0 !justify-start !pl-1.5 !pr-2 !text-fg", narrow ? "w-[80px]" : "w-[88px]")}>Back</Button>
          ) : narrow ? null : <span className="pl-1 shrink-0"><AppMark size={40} /></span>}
          <div className={cn("flex-1 min-w-0", back ? "text-center" : "pl-1")}>
            <h1 data-page-title="" tabIndex={-1} className={cn("text-lg font-semibold leading-tight outline-none", narrow ? "line-clamp-2 break-words" : "truncate")}>{title}</h1>
            {subtitle ? <p className={cn("text-md text-muted leading-snug mt-0.5", narrow ? "line-clamp-2 break-words" : "truncate")}>{subtitle}</p> : null}
          </div>
          {actions ? <div className="shrink-0 flex items-center gap-1">{actions}</div> : back ? <span aria-hidden="true" className={cn("shrink-0", narrow ? "w-[80px]" : "w-[88px]")} /> : null}
        </div>
      </header>
      <div className={cn("flex-1 px-4 pt-5 pb-10 flex flex-col gap-5 min-w-0", className)}>{children}</div>
      {bar ? <PhoneActionBar>{bar}</PhoneActionBar> : null}
    </div>
  );
}

/** The firm a bill is being made for, as a filled pill: the one thing that must never be a surprise. */
export function FirmPill({ firm }: { firm: { name: string } }) {
  return <span className="inline-flex items-center self-start rounded-full bg-brand-tint border border-brand-line text-brand font-semibold px-3 min-h-8 text-md">{firm.name}</span>;
}

/** The one big button pinned above the tabs. Disabled with the reason for roles that can't bill. */
export function NewBillButton() {
  const { can, whyNot } = useAuth();
  const navigate = useNavigate();
  const net = useNetwork();
  const ok = can("bill.create");
  const hint = !ok ? whyNot("bill.create")
    : net === "offline" ? "You can make the bill now; save it when the internet is back."
    : net === "unreachable" ? "You can make the bill now; if it doesn't save, try again in a minute." : "";
  return (
    <div className="flex flex-col gap-1.5">
      <Button variant="primary" size="xl" icon={Plus} full disabled={!ok} onClick={() => navigate("/e/new")}>New bill</Button>
      {hint ? <p className="text-center text-md text-fg2">{hint}</p> : null}
    </div>
  );
}

/**
 * The one offline layout: the screen's header, buttons and section frames stay;
 * this sits where the section's content would be and says what's wrong.
 */
export function LoadInside({ load, what }: { load: { error: unknown; refetch: () => unknown }; what: string }) {
  return <LoadError problem={problemOf(load.error)} retry={() => { void load.refetch(); }} what={what} className="!border-0 !bg-transparent !rounded-none" />;
}

/** "Not saved yet": what went wrong and that nothing is lost, with the way to try again. */
export function SaveProblem({ error, kept = "Your bill is safe on this phone", again = "tap Save again", head = "Not saved yet", onRetry, retryLabel = "Try again", className }: {
  error: ApiProblem | null; kept?: string; again?: string; head?: string; onRetry?: () => void; retryLabel?: string; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) scrollIntoViewSafe(ref.current, { block: "nearest" }); }, [error]);
  if (!error) return null;
  const off = error.kind === "offline";
  const network = off || error.kind === "server" || error.kind === "unreachable";
  const m = network ? { title: `${head}: ${off ? "you're offline." : "the app couldn't get through."}`, body: `${kept}; ${again} ${off ? "when the internet is back" : "in a minute"}.` } : { title: head, body: error.message };
  const I = off ? WifiOff : CloudOff;
  return (
    <div ref={ref} role="alert" className={cn("flex flex-col gap-3 rounded-card border border-neg-line bg-neg-tint px-4 py-3.5 anim-rise", className)}>
      <div className="flex items-start gap-3">
        <I size={20} className="text-neg shrink-0 mt-0.5" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-semibold">{m.title}</p>
          <p className="text-md text-fg2 mt-0.5">{m.body}</p>
        </div>
      </div>
      {onRetry ? <Button variant="secondary" size="lg" onClick={onRetry} className="self-start">{retryLabel}</Button> : null}
    </div>
  );
}

/** Sales bills, newest first: the number first (what staff read out), then time and payment; the total in green. */
export function BillRows({ bills, flash, withDate, longDate }: { bills: BillRow[]; flash?: ReadonlySet<number>; withDate?: boolean; longDate?: boolean }) {
  return (
    <ul>
      {bills.map((b) => {
        const c = b.customer;
        const off = b.status === "cancelled";
        const empty = !b.line_count;
        return (
          <li key={b.id} className={cn("flex items-center gap-1 pr-2 border-t border-rule first:border-t-0", flash?.has(b.id) && "anim-flash")}>
            <Link to={`/e/bill/${b.id}`} data-row={b.id} className="flex-1 min-w-0 flex items-center gap-3 pl-4 pr-1 py-3 min-h-[68px] rounded-ctl">
              <span className="flex-1 min-w-0">
                <span className="block font-medium break-words">{c.name}</span>
                <span className="block text-md text-muted">{(withDate ? [`No. ${billNo(b)}`, PAY_SHORT[b.payment_mode]] : [`No. ${billNo(b)}`, timeOf(b.created_at), PAY_SHORT[b.payment_mode]]).map((x, i) => <span key={i}>{i ? "\u00a0· " : null}<span className="whitespace-nowrap">{x}</span></span>)}</span>
              </span>
              <span className="text-right shrink-0">
                {empty ? <span className="block text-md text-muted">No items</span>
                  : <span className={cn("block tnum", off ? "text-muted line-through" : "text-sale")}>{inr(b.total_amount)}</span>}
                {withDate ? <span className="block text-md text-muted tnum">{longDate ? date(b.invoice_date) : dateShort(b.invoice_date)}</span> : null}
              </span>
            </Link>
            {off ? <Badge tone="neg" className="mx-1">Cancelled</Badge> : empty ? null
              : b.sent ? <span className="inline-flex items-center gap-1 text-sale font-semibold shrink-0 px-2" title={`Sent ${sentWhen(b.sent)}`}><CheckCircle2 size={15} aria-hidden="true" />Sent</span>
              // no number to send to (a walk-in): a plain status here; the bill itself has Send and Print
              : !mobileOf(c.mobile_number) && !b.sent ? <span className="shrink-0 px-2 text-[15px] text-muted">Not sent</span>
              : <SendCell bill={b} compact />}
          </li>
        );
      })}
    </ul>
  );
}

/** A small white paper copy of the bill, as the customer gets it. */
export function PaperBill({ bill }: { bill: BillDetail }) {
  const { firm, customer: cust } = bill;
  return (
    <figure className="rounded-card bg-white text-black border border-line px-4 py-3.5 shadow-pop" aria-label={`Bill ${billNo(bill)} as the customer gets it`}>
      <div className="flex items-baseline justify-between gap-3 text-xs"><span className="font-semibold tracking-wide">TAX INVOICE</span><span className="tnum">{bill.invoice_number} · {date(bill.invoice_date)}</span></div>
      <p className="text-xs mt-1">{firm.name} · GSTIN {firm.gst_number}</p>
      <p className="text-xs mt-0.5">Bill to: {cust.name}{cust.type !== "walkin" && cust.city ? `, ${cust.city}` : ""}</p>
      <div className="border-t border-black/15 mt-2 pt-2 flex flex-col gap-1 text-xs tnum">
        {bill.lines.map(l => <div key={l.id} className="flex flex-col gap-0.5"><div className="flex justify-between gap-3"><span className="min-w-0">{l.product_name} · {qty(Number(l.quantity), l.unit)} × {rateText(l.rate).slice(1)}</span><span>{inr(l.taxable).slice(1)}</span></div></div>)}
        {!bill.lines.length ? <p className="text-black/70">No items on this bill.</p> : null}
        {bill.slabs.map(s => <div key={s.gst_percent} className="flex justify-between gap-3 text-black/70"><span>{bill.interstate ? `IGST ${s.gst_percent}%` : `CGST ${halfPercent(s.gst_percent)} + SGST ${halfPercent(s.gst_percent)}`}</span><span>{inr(s.tax).slice(1)}</span></div>)}
      </div>
      <div className="border-t border-black/70 mt-2 pt-1.5 flex justify-between text-sm font-semibold tnum"><span>Total</span><span>{inr(bill.total_amount)}</span></div>
      {bill.status === "cancelled" ? <p className="mt-1.5 text-xs font-semibold tracking-wide">CANCELLED</p> : null}
    </figure>
  );
}

/** Who the bill goes to, with a quick way to fix the number before sending. */
export function SendTo({ bill }: { bill: BillDetail }) {
  const { can } = useAuth();
  const cust = bill.customer;
  if (cust.type === "walkin") return <p className="text-md text-muted text-center">Walk-in customer: you pick the chat in WhatsApp.</p>;
  return (
    <div className="flex items-center gap-2 rounded-ctl border border-line bg-card pl-4 pr-1.5 py-2 min-h-16">
      <p className="flex-1 min-w-0">
        <span className="block"><span className="text-muted">Goes to </span><span className="font-medium break-words">{cust.name}</span></span>
        <span className="block tnum text-fg2">{cust.mobile_number ? `+91 ${mobileText(cust.mobile_number)}` : "No number saved"}</span>
      </p>
      {can("customer.edit") ? (
        <ButtonLink to={`/e/customers/${cust.id}/edit`} variant="ghost" icon={Pencil} aria-label={`Change ${cust.name}'s number or details`}>Change</ButtonLink>
      ) : null}
    </div>
  );
}

/**
 * One way to send: "Send the bill" opens the phone's share sheet with the PDF, and the
 * bill shows Sent only once the share went through. Offline it says so under the button
 * and offers "Mark as sent" for when the internet is back. A sent bill is a quiet line
 * with a plain "Send again".
 */
export function SendBig({ bill }: { bill: BillDetail }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const send = useSendBill();
  const ready = useSendReady();
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  const [bump, setBump] = useState(0);
  const [failed, setFailed] = useState<{ problem: ApiProblem; retry: (() => Promise<boolean>) | null } | null>(null);
  if (bill.status === "cancelled" || !bill.lines.length) return null;
  if (bill.customer.gst_number && bill.lines.some(l => !l.hsn_code)) {
    return can("bill.edit") ? <div className="flex flex-col gap-2 rounded-card border border-neg-line bg-neg-tint px-4 py-3.5"><p className="font-semibold">Add the missing HSN code before sending.</p><p className="text-md text-fg2">A shop's bill needs the GST code on every item.</p><Button icon={Maximize2} onClick={() => navigate(`/sales/${bill.id}/edit`, { state: { fullView: true } })} className="self-start">Add it in the full view</Button></div>
      : <p className="rounded-card border border-line bg-card px-4 py-3.5 text-md text-fg2">The owner adds the missing HSN code before this bill goes out; a shop's bill needs it on every item.</p>;
  }
  if (!can("bill.send")) return <p className={cn("text-center font-semibold", bill.sent ? "text-sale" : "text-muted")}>{bill.sent ? `Sent ${sentWhen(bill.sent)}` : "Not sent yet"}</p>;
  const feedback: Pick<SendOptions, "quiet" | "onMarkFailed" | "onRecorded"> = {
    quiet: true,
    onRecorded: () => { setFailed(null); setBump(k => k + 1); },
    onMarkFailed: (problem, retry) => setFailed({ problem, retry }),
  };
  const mark = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (failed?.retry) await failed.retry();
      else await send(bill, { ...feedback, onNeedNumber: () => setAsk(true) });
    } finally { setBusy(false); }
  };
  if (failed) {
    const off = failed.problem.kind === "offline";
    const I = off ? WifiOff : CloudOff;
    return <div className="flex flex-col gap-3"><div role="alert" className="flex items-start gap-3 rounded-card border border-neg-line bg-neg-tint px-4 py-3.5"><I size={20} className="text-neg shrink-0 mt-0.5" aria-hidden="true" /><p className="text-md text-fg2">{failed.retry ? <><span className="block font-semibold text-fg">Not marked as sent: {off ? "you're offline." : "the app couldn't get through."}</span>{off ? "If you shared it, WhatsApp delivers it when the internet is back. Tap Mark as sent once you're online." : "If you shared it, the customer has it. Tap Mark as sent in a minute."}</> : failed.problem.message}</p></div>{failed.retry ? <Button size="lg" icon={CheckCircle2} loading={busy} onClick={() => void mark()}>{busy ? "Marking as sent…" : "Mark as sent"}</Button> : null}</div>;
  }
  return <>{!bill.sent ? <Button variant="primary" size="xl" icon={MessageCircle} full loading={busy} disabled={!ready} onClick={(e) => { if (e.detail > 1) return; void mark(); }}>{busy ? "Sending…" : "Send the bill"}</Button> : <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2"><p role="status" className="text-sale font-semibold"><span key={bump} className={cn(bump > 0 && "anim-bump")}><span className="inline-flex items-center gap-2"><CheckCircle2 size={20} className="shrink-0" aria-hidden="true" />Sent {sentWhen(bill.sent)}</span></span></p><Button variant="secondary" icon={Send} loading={busy} disabled={!ready} onClick={(e) => { if (e.detail > 1) return; void mark(); }}>{busy ? "Sending…" : "Send again"}</Button></div>}<WhatsAppDialog bill={ask ? bill : null} onClose={() => setAsk(false)} sendOptions={feedback} /></>;
}

/** The shared A4 print page, reached through Easy's route so Back returns to this bill. */
export function PrintButton({ bill }: { bill: BillDetail }) {
  const navigate = useNavigate();
  if (!bill.lines.length) return null;
  return <Button size="lg" icon={Printer} full onClick={() => navigate(`/e/bill/${bill.id}/print`)}>Print</Button>;
}

const REASONS = ["Wrong weight or rate", "Wrong customer", "Customer didn't buy"];
/** "Made a mistake?": the owner cancels with a dialog naming the bill; others are told to ask the owner. */
export function CancelBill({ bill }: { bill: BillDetail }) {
  const { can } = useAuth();
  const cancel = useCancelBill();
  const busy = cancel.isPending;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<ApiProblem | null>(null);
  if (bill.status === "cancelled") return null;
  if (!can("bill.cancel")) return <p className="text-md text-muted text-center">Made a mistake? Ask the owner to cancel it.</p>;
  if (bill.locked) return <p className="text-md text-muted text-center">This bill's month is already filed with GST, so it can't be cancelled here. Unlock the month in the full view first.</p>;
  const firm = bill.firm;
  const cust = bill.customer;
  const confirm = () => {
    if (busy) return;
    void cancel.mutateAsync({ id: bill.id, reason: reason || "Made a mistake on the bill" }).then(() => { setError(null); setOpen(false); }, (error: unknown) => setError(problemOf(error)));
  };
  return (
    <>
      <Button variant="link" onClick={() => { setReason(""); setError(null); setOpen(true); }} className="!text-neg underline underline-offset-4 self-center">Made a mistake? Cancel this bill</Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} onConfirm={confirm} tone="danger" busy={busy} busyLabel="Cancelling…"
        title={`Cancel bill ${billNo(bill)}?`} confirmLabel={error ? "Try cancelling again" : "Cancel this bill"} cancelLabel="Keep the bill"
        record={[["Firm", firm.name], ["Bill", bill.invoice_number], ["Date", `${date(bill.invoice_date)} · ${timeOf(bill.created_at)}`], ["Customer", cust.name], ["Total", inr(bill.total_amount)]]}
        extra={(
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <p className="text-md text-fg2">What went wrong? (optional)</p>
              <div role="group" aria-label="What went wrong" className="flex flex-wrap gap-2">
                {REASONS.map((r) => <Chip key={r} selected={reason === r} onClick={() => setReason(reason === r ? "" : r)}>{r}</Chip>)}
              </div>
            </div>
            <SaveProblem error={error} head="Not cancelled yet" kept="The bill is still active" again="try" />
          </div>
        )}>
        <p>The bill stays in your list marked Cancelled. It keeps its number, so the GST list stays complete.</p>
        <p>This can't be undone. After cancelling you can make it again with the same items, corrected.</p>
      </ConfirmDialog>
    </>
  );
}

/** After a cancel: the same customer, items and payment in a new bill, so a slip costs one edit. */
export function MakeAgain({ bill }: { bill: BillDetail }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  if (bill.status !== "cancelled" || !can("bill.create") || !bill.lines.length) return null;
  const toCustomer = /wrong customer/i.test(bill.cancel_reason || "");
  return (
    <div className="flex flex-col gap-2">
      <Button variant="primary" size="xl" icon={RotateCcw} full onClick={() => navigate(`${toCustomer ? "/e/new" : "/e/new/items"}?again=${bill.id}`)}>Make it again</Button>
      <p className="text-md text-fg2 text-center">{toCustomer ? "Starts at Who is buying?, with the same items and payment." : "A new bill with the same customer, items and payment, ready to correct."}</p>
    </div>
  );
}

/**
 * How they paid: four big choices in two rows, none picked until the person taps one.
 * Udhaar sits diagonally from UPI (the two look alike at a glance), under Cash.
 */
const PAY_GRID = ["cash", "bank", "credit", "mixed"] as const;
export function PayChoice({ value, onChange, invalid, describedBy, disabled = {} }: {
  value: PaymentMode | null; onChange: (value: PaymentMode) => void; invalid?: boolean; describedBy?: string; disabled?: Partial<Record<PaymentMode, boolean>>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const opts = PAY_GRID.map((v) => PAY_CHOICES.find((o) => o.value === v)!);
  const vals = opts.map((o) => o.value).filter((v) => !disabled[v]);
  const tabStop = vals.find(v => v === value) ?? vals[0];
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const fwd = e.key === "ArrowRight" || e.key === "ArrowDown";
    if (!fwd && e.key !== "ArrowLeft" && e.key !== "ArrowUp") return;
    e.preventDefault();
    if (!vals.length) return;
    const i = Math.max(0, vals.findIndex(v => v === value));
    const n = vals[(i + (fwd ? 1 : vals.length - 1)) % vals.length];
    onChange(n);
    setTimeout(() => box.current?.querySelector<HTMLButtonElement>(`[data-v="${n}"]`)?.focus(), 0);
  };
  return (
    <div ref={box} role="radiogroup" aria-labelledby="easy-paid-t" aria-describedby={describedBy} aria-invalid={invalid || undefined} onKeyDown={onKey}
      className={cn("grid grid-cols-2 gap-2 rounded-card", invalid && "outline outline-2 outline-offset-2 outline-neg")}>
      {opts.map((o) => {
        const sel = o.value === value;
        const off = Boolean(disabled[o.value]);
        return (
          <button key={o.value} type="button" role="radio" aria-checked={sel} data-v={o.value} disabled={off} tabIndex={o.value === tabStop ? 0 : -1} onClick={() => onChange(o.value)}
            className={cn("min-h-16 px-2 py-2 rounded-ctl border flex flex-col items-center justify-center leading-tight text-[17px] transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97]",
              off ? "bg-raised border-line text-muted cursor-not-allowed" : sel ? "bg-brand-sel border-brand text-brand font-semibold" : "bg-card border-ctl-line text-fg hover:border-muted/50")}>
            <span>{o.label}</span>
            {o.sub ? <span className={cn("text-md font-normal mt-0.5", sel ? "text-brand" : "text-muted")}>{o.sub}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Placeholder rows while a page's figures load (never ₹0). */
export function CardSkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-4 border-t border-rule">
          <span className="flex-1 flex flex-col gap-2"><span className="block h-4 w-1/2 rounded-md bg-raised anim-pulse" /><span className="block h-3 w-2/5 rounded-md bg-raised anim-pulse" /></span>
          <span className="block h-4 w-[86px] rounded-md bg-raised anim-pulse" />
        </div>
      ))}
    </div>
  );
}
