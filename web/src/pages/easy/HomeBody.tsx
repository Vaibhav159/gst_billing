import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { CheckCircle2, ChevronRight, Clock, Moon, Send, Sparkles, WifiOff } from "lucide-react";
import { useDiscardDraft, useKeepDraft } from "@/core/api/drafts";
import { problemOf } from "@/core/api/errors";
import { useNetwork } from "@/core/api/network";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { keepOnDevice } from "@/core/deviceDrafts";
import type { UnfinishedBill } from "@/core/draftData";
import { inr, plural, qty } from "@/core/format";
import { canShareFiles } from "@/core/print/files";
import { useView } from "@/core/view";
import type { BillDetail, BillRow, SalesPage } from "@/core/sales/types";
import { timeOf } from "@/core/sales/words";
import { Button, Card, Dialog, Money, QueryView, Skeleton, useToast } from "@/core/ui";
import { useSendBill, useSendReady } from "@/pages/sales/actions/useSendBill";
import { freshUnsent } from "./home-send";

/** A structural slice of part 5's answer; no second mapper or cache. */
export type HomeDue = { items: { kind: string; count: number }[] };
export type HomeDrafts = { bills: UnfinishedBill[]; loading: boolean; answered: boolean };
export type FetchUnsent = (firmId: number, day: string, signal?: AbortSignal) => Promise<BillRow[]>;
export type HomeBodyProps = {
  fetchUnsent: FetchUnsent; sales: UseQueryResult<SalesPage>;
  firmId: number | null; today: string; welcome: { seen: boolean; done: () => void }; drafts: HomeDrafts;
  due: UseQueryResult<HomeDue>; rates: ReactNode; gst?: ReactNode; renderRows: (rows: BillRow[]) => ReactNode;
};
export function HomeBody({ sales, fetchUnsent, firmId, today, welcome, drafts, due, rates, gst, renderRows }: HomeBodyProps) {
  const { can } = useAuth();
  const evening = timeOf(new Date().toISOString()) >= "18:00";
  const scoped = drafts.bills.filter((d) => d.business === firmId);
  return <>
    {!welcome.seen ? <Welcome onDone={welcome.done} /> : null}
    {evening && sales.data ? <section aria-label="End of the day">
      <QueryView query={due} what="the end-of-day count" skeleton={<Skeleton w={220} h={38} />}>
        {(data) => <EndOfDay fetchUnsent={fetchUnsent} firmId={firmId} today={today} sales={sales.data!} countReady={due.isSuccess && due.fetchStatus === "idle" && !due.isPlaceholderData} unsent={data.items.find((i) => i.kind === "unsent")?.count ?? 0} drafts={{ ...drafts, bills: scoped }} />}
      </QueryView>
    </section> : null}
    {scoped.map((d) => <Unfinished key={d.id} draft={d} firmId={firmId} />)}
    {drafts.loading ? <p role="status" className="text-md text-muted">Getting unfinished bills…</p> : null}
    <Card pad={false} aria-busy={sales.isPending || undefined}>
      <div className="px-4 pt-4 pb-3"><h2 className="caps">Sales today</h2></div>
      <QueryView query={sales} what="today's sales list" skeleton={<div className="px-4 pb-4"><Skeleton w={220} h={38} /><p role="status" className="text-md text-fg2">Getting today's bills…</p></div>}>
        {(data) => <>
          <div className="px-4 pb-3">{data.summary.bills ? <><p className="text-md text-muted">{plural(data.summary.bills, "bill")} · incl. GST</p><Money value={data.summary.total_amount} size="4xl" tone="sale" className="block mt-1.5" /></> : <p className="text-2xl font-semibold text-fg2 mt-1.5">No sales yet today</p>}</div>
          {data.results.length ? <div className="border-t border-rule">{renderRows(data.results.slice(0, 6))}</div> : <p className="px-4 pb-5 text-fg2">{can("bill.create") ? <>Tap <span className="font-semibold text-fg">New bill</span> below to make the first one. It takes two steps.</> : "Bills made today show here."}</p>}
          {data.count ? <div className="border-t border-rule px-4"><Link to="/e/bills" className="link inline-flex items-center gap-1 min-h-12">{data.count > 6 ? `See all ${data.count} of today's bills` : "All bills"}<ChevronRight size={16} aria-hidden="true" /></Link></div> : null}
        </>}
      </QueryView>
    </Card>
    {rates}
    {gst}
  </>;
}

export function Welcome({ onDone }: { onDone: () => void }) {
  const { can } = useAuth();
  const [open, setOpen] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const close = () => { if (!open) return; setOpen(false); timer.current = setTimeout(onDone, 260); };
  const points = can("bill.create")
    ? [["Make a bill in two steps.", "Who is buying, then what they bought."], ["Send it on WhatsApp.", "Your phone's share menu opens with the bill's PDF."], ["Snap supplier bills in Capture.", "Take a photo; the owner fills in the rest."]]
    : can("capture") ? [["Bills and GST in plain words.", "Today's bills, any bill, and this month's GST."], ["Snap supplier bills in Capture.", "Take a photo of a supplier's bill."], ["Returns are in the full view.", "Switch to it from More."]]
      : [["See today's bills.", "Each with its total and whether it was sent."], ["Find any bill.", "By name, phone or bill number, in Bills."], ["Check this month's GST.", "In plain words, from the GST card."]];
  return <div className={cn("fold transition-[margin] duration-200 ease-out", !open && "-mb-5")} data-open={open ? "true" : "false"} {...(open ? {} : { inert: "" })}><div><section aria-labelledby="easy-welcome-t" className="card p-5 flex flex-col gap-4">
    <div className="flex items-start gap-3"><span aria-hidden="true" className="w-11 h-11 rounded-ctl bg-brand-tint border border-brand-line grid place-items-center text-brand shrink-0"><Sparkles size={20} /></span><div className="min-w-0"><h2 id="easy-welcome-t" className="text-lg font-semibold leading-snug">Welcome to Easy mode</h2><p className="text-md text-fg2">{can("bill.create") ? "Big buttons for the counter. Three things to know:" : "Three things you can do here:"}</p></div></div>
    <ol className="flex flex-col gap-3">{points.map(([title, text], i) => <li key={title} className="flex items-start gap-3"><span aria-hidden="true" className="w-8 h-8 rounded-full bg-brand-tint border border-brand-line text-brand font-semibold grid place-items-center shrink-0 tnum">{i + 1}</span><span className="pt-1"><span className="font-semibold">{title}</span> <span className="text-fg2">{text}</span></span></li>)}</ol>
    <Button size="lg" full onClick={close}>Got it</Button>
  </section></div></div>;
}

function Unfinished({ draft: d, firmId }: { draft: UnfinishedBill; firmId: number | null }) {
  const { can, me } = useAuth();
  const net = useNetwork();
  const discard = useDiscardDraft(); const keep = useKeepDraft(); const qc = useQueryClient(); const { show } = useToast();
  const name = d.data.customer?.name || "Walk-in Customer";
  const items = d.data.lines.map((l) => l.qty ? `${l.name} ${qty(l.qty, l.unit)}` : l.name).join(", ") || "No items yet";
  const full = d.data.posOverride !== null || d.data.firmId !== firmId;
  const remove = () => {
    // Shared discard/keep can find a row loaded by Easy's scoped query, including its starter.
    keepOnDevice({ ...d, synced: !d.onDevice });
    void discard(d.id).then(() => qc.invalidateQueries({ queryKey: ["drafts"] }));
    show({ title: "Unfinished bill removed", body: `${name} · ${items}`, tone: "brand", action: { label: "Undo", onClick: () => {
      keepOnDevice({ ...d, synced: false, gone: false });
      void keep(d.id, d.business, d.data).then((result) => {
        void qc.invalidateQueries({ queryKey: ["drafts"] });
        if (result.refusal) show({ title: "Not restored yet", body: result.refusal, tone: "neg" });
      });
    } } });
  };
  return <section aria-label={`Unfinished bill for ${name}`} className="card p-4 flex flex-col gap-3">
    <div className="flex items-start gap-3"><span aria-hidden="true" className="w-11 h-11 rounded-ctl bg-raised border border-line grid place-items-center text-fg2 shrink-0"><Clock size={20} /></span><div className="flex-1 min-w-0">
      <h2 className="font-medium">Unfinished bill · {name}</h2><p className="text-md text-fg2">{d.data.notes || items}</p>
      {d.onDevice ? <p className="flex items-center gap-1.5 text-md text-neg mt-0.5"><WifiOff size={15} aria-hidden="true" />{net === "offline" ? "Not saved yet: the internet was off. Finish it to save." : "Kept on this phone. Finish it to save."}</p> : null}
      <p className="text-md text-muted mt-0.5">Started {timeOf(d.created_at) || "today"}{d.started_by ? ` by ${d.started_by.name}` : ""}</p>
    </div></div>
    {can("bill.create") ? <div className="flex flex-wrap gap-2"><Link className="inline-flex items-center justify-center min-h-11 px-4 rounded-ctl border border-brand-line text-brand hover:bg-brand-tint font-semibold" to={`${full ? "/sales/new" : "/e/new/items"}?draft=${encodeURIComponent(d.id)}`} state={full ? { fullView: true } : undefined}>{full ? "Finish in the full view" : "Finish"}</Link>
      {me?.role === "owner" || d.started_by?.id === me?.id ? <Button variant="ghost" onClick={() => void remove()} aria-label={`Remove ${name}'s unfinished bill`}>Remove</Button> : null}
    </div> : null}
  </section>;
}

function EndOfDay({ fetchUnsent, firmId, today, sales, countReady, unsent, drafts }: { fetchUnsent: FetchUnsent; firmId: number | null; today: string; sales: SalesPage; countReady: boolean; unsent: number; drafts: HomeDrafts }) {
  const { can } = useAuth(); const [open, setOpen] = useState(false);
  const parts = [plural(sales.summary.bills, "bill"), inr(sales.summary.total_amount)];
  if (unsent) parts.push(`${unsent} not sent`);
  if (drafts.bills.length) parts.push(`${drafts.bills.length} unfinished`);
  const clear = countReady && !unsent && !drafts.bills.length && drafts.answered && can("bill.send");
  return <section aria-labelledby="easy-eod-t" className={cn("card p-4 flex flex-col gap-3", clear ? "" : "border-brand-line")}>
    <div className="flex items-start gap-3"><span aria-hidden="true" className="w-11 h-11 rounded-ctl bg-brand-tint border border-brand-line grid place-items-center text-brand shrink-0"><Moon size={20} /></span><div className="min-w-0"><h2 id="easy-eod-t" className="text-lg font-semibold leading-snug">End of the day</h2><p className="text-md text-fg2 tnum">Today: {parts.map((x, i) => <span key={i}>{i ? "\u00a0· " : null}<span className="whitespace-nowrap">{x}</span></span>)}</p></div></div>
    {clear ? <p className="flex items-center gap-2 text-sale font-medium"><CheckCircle2 size={18} aria-hidden="true" />Every bill is sent and nothing is left unfinished.</p> : null}
    <div className="flex flex-wrap gap-2">{unsent > 0 && can("bill.send") ? <Button variant="primary" icon={Send} onClick={() => setOpen(true)}>Send the bills</Button> : null}
      {drafts.bills.length ? <p className="text-md text-fg2 self-center">{drafts.bills.length === 1 ? "The unfinished bill is just below: Finish or Remove." : "The unfinished bills are just below: Finish or Remove each."}</p> : null}
    </div>
    {open && firmId !== null ? <SendToday fetchUnsent={fetchUnsent} key={`${firmId}:${today}`} firmId={firmId} today={today} onClose={() => setOpen(false)} /> : null}
  </section>;
}

export function SendToday({ fetchUnsent, firmId, today, onClose }: { fetchUnsent: FetchUnsent; firmId: number; today: string; onClose: () => void }) {
  const qc = useQueryClient(); const send = useSendBill(); const ready = useSendReady();
  const { isPhone } = useView();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [prepared, setPrepared] = useState<{ bill: BillDetail; at: number } | null>(null);
  const query = useQuery({ queryKey: ["easy-send-session", firmId, today], queryFn: ({ signal }) => fetchUnsent(firmId, today, signal), staleTime: 0, gcTime: 0, retry: false });
  const [finished, setFinished] = useState<Record<number, "sent" | "changed">>({});
  const [busy, setBusy] = useState<number | null>(null); const running = useRef(false); const [error, setError] = useState<string | null>(null);
  const deliverChecked = async (current: BillDetail) => {
    // This call runs inside the fallback's second click, before an await.
    const delivery = send(current, { onRecorded: () => { if (mounted.current) setFinished((x) => ({ ...x, [current.id]: "sent" })); } });
    if (await delivery && mounted.current) setFinished((x) => ({ ...x, [current.id]: "sent" }));
  };
  const sendOne = async (row: BillRow) => {
    if (running.current) return;
    running.current = true; setBusy(row.id); setError(null);
    try {
      if (prepared?.bill.id === row.id && Date.now() - prepared.at < 5000) {
        setPrepared(null); await deliverChecked(prepared.bill); return;
      }
      setPrepared(null);
      const current = await freshUnsent(qc, row.id, firmId, today);
      if (!mounted.current) return;
      if (!current) { setFinished((x) => ({ ...x, [row.id]: "changed" })); return; }
      if (current.checks.includes("no_lines") || (current.segment === "b2b" && current.checks.includes("no_hsn"))) {
        setError(`Bill ${current.counter ?? current.invoice_number} needs a check. Open it from Bills before sending it.`); return;
      }
      if (!isPhone || !canShareFiles()) { setPrepared({ bill: current, at: Date.now() }); return; }
      await deliverChecked(current);
    } catch (e) { if (mounted.current) setError(problemOf(e).message); }
    finally { running.current = false; if (mounted.current) setBusy(null); }
  };
  const allDone = query.data?.every((b) => finished[b.id]) ?? false;
  return <Dialog open onClose={onClose} title="Send today's bills" description="Each opens the share sheet with its PDF; pick WhatsApp and the customer."
    footer={<Button size="lg" onClick={onClose}>{allDone ? "Done" : "Close"}</Button>}>
    <QueryView query={query} what="today's unsent bills">{(rows) => <ul className="flex flex-col">{rows.map((b) => <li key={b.id} className="flex items-center gap-3 py-3 border-t border-rule first:border-t-0">
      <span className="flex-1 min-w-0"><span className="block font-medium">{b.customer.name}</span><span className="block text-md text-muted tnum">No. {b.counter ?? b.invoice_number} · {inr(b.total_amount)}</span></span>
      {finished[b.id] ? <span className="inline-flex items-center gap-1 text-sale font-semibold"><CheckCircle2 size={16} aria-hidden="true" />{finished[b.id] === "sent" ? "Sent" : "No longer waiting to be sent"}</span>
        : <Button icon={Send} loading={busy === b.id} disabled={!ready || busy !== null} onClick={() => void sendOne(b)} aria-label={`Send bill ${b.counter ?? b.invoice_number} to ${b.customer.name}`}>Send</Button>}
    </li>)}</ul>}</QueryView>
    {prepared ? <p role="status" className="text-md text-fg2 mt-2">Bill {prepared.bill.counter ?? prepared.bill.invoice_number} checked. Tap Send again to open WhatsApp.</p> : null}
    {error ? <p role="alert" className="text-md text-neg mt-2">{error}</p> : null}
    {allDone ? <p role="status" className="text-sale font-medium mt-2">No bills left to send in this list.</p> : null}
  </Dialog>;
}
