// Batch print, /sales/batch?ids= (PROTO sales/BatchPrint.jsx): the bills ticked in the list, previewed one after
// another as they will print, then Print all or One combined PDF. One file holds every bill's pages, each bill's
// copies together; it's made as soon as the choices are known, so Print opens within the press. Each bill is one
// request, through billQuery and from the cache when it's there, and a batch takes up to MAX_BILLS (Neon's free plan).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useQueries, useQueryClient, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Download, Info, Printer, X } from "lucide-react";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { useNetwork } from "@/core/api/network";
import { billQuery, cachedBillNumber, useShopSettings, type BillOutcome } from "@/core/api/sales";
import { date, dateShort, inr, plural, todayIST } from "@/core/format";
import { printFile, saveFile } from "@/core/print/files";
import { batchLog, useLogPrint, type PrintLog } from "@/core/print/log";
import { makeBillPdf, pdfCodeMissing } from "@/core/print/make";
import { copyPages, COPY_MARKS, hasBank, printBill, type PrintBill } from "@/core/print/model";
import { Paper, PrintCopy, ScaledPaper } from "@/core/print/Paper";
import type { BillDetail, Copies, ShopSettings } from "@/core/sales/types";
import { andList, billsAnd } from "@/core/sales/words";
import { Banner, Button, ButtonLink, Card, EmptyState, FailNote, LoadError, Money, Page, Segmented, Skeleton, StaleNote, Switch, useToast } from "@/core/ui";
import { billsSpan, useMade, whatPrints } from "./parts";

/** A batch takes up to this many bills: each is a request of its own (Neon's free plan), and its PDF is made here, in the browser. */
const MAX_BILLS = 100;
const COPIES: { value: Copies; label: string }[] = [{ value: "original", label: "Original only" }, { value: "all", label: "All three" }];
const CRUMBS = [{ label: "Sales", to: "/sales" }];
const OFFLINE: ApiProblem = { kind: "offline", message: "You're offline" };

/**
 * A bill picked: here (stale: its refresh failed), gone (deleted, or not there at all), not loaded (why), or still coming
 * (asked for again once the batch is on screen), the last two with their number if this device has it.
 */
type Here = { id: number; bill: BillDetail; stale: ApiProblem | null };
type Unloaded = { id: number; failed: ApiProblem; number: string | null };
type Coming = { id: number; coming: true; number: string | null };
type Row = Here | Unloaded | Coming | { id: number; gone: true };

function rowOf(id: number, q: UseQueryResult<BillOutcome>, qc: QueryClient): Row {
  if (q.data?.kind === "bill") return { id, bill: q.data.bill, stale: q.isError ? problemOf(q.error) : null };
  if (q.data?.kind === "deleted") return { id, gone: true };
  if (q.isPending && !q.isPaused) return { id, coming: true, number: cachedBillNumber(qc, id) };
  // nothing came: asking failed, or it waits for the internet
  const p = q.isError ? problemOf(q.error) : OFFLINE;
  return p.kind === "notfound" ? { id, gone: true } : { id, failed: p, number: cachedBillNumber(qc, id) };
}

/** Why bills didn't load: offline only when every one waits for the internet, else the first other reason (Try again can help). */
function whyUnloaded(unloaded: Unloaded[]): ApiProblem | null {
  return unloaded.find((r) => r.failed.kind !== "offline")?.failed ?? unloaded[0]?.failed ?? null;
}

/** Bills by number where it's known, the rest counted: "KGH/2026-27/32 and MO/2026-27/7", "KGH/2026-27/32 and 1 more bill", "4 bills". */
function named(numbers: (string | null)[]): string {
  const known = numbers.filter((n): n is string => Boolean(n));
  if (known.length > 3) return plural(numbers.length, "bill");
  const rest = numbers.length - known.length;
  return andList([...known, rest ? plural(rest, known.length ? "more bill" : "bill") : ""]);
}

// a bill's paper and what it prints (whatPrints, Ruling 1E-8), worked out once per answer from the server and bank choice
const drawings = new WeakMap<BillDetail, Map<boolean, { paper: PrintBill; prints: string }>>();
function drawn(b: BillDetail, showBank: boolean): { paper: PrintBill; prints: string } {
  let byBank = drawings.get(b);
  if (!byBank) { byBank = new Map(); drawings.set(b, byBank); }
  let d = byBank.get(showBank);
  if (!d) {
    const paper = printBill(b, { showBank });
    d = { paper, prints: whatPrints(paper) };
    byBank.set(showBank, d);
  }
  return d;
}

export default function BatchPrint() {
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const picked = useMemo(() => [...new Set((params.get("ids") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0))], [params]);
  // the first MAX_BILLS picked make the batch; the rest wait for one of their own
  const asked = picked.slice(0, MAX_BILLS);
  const qs = useQueries({ queries: asked.map((id) => billQuery(id)) });
  const settings = useShopSettings();
  const ids = asked.join(",");
  // still coming (a bill or the settings held offline aren't: the bill is said below, the settings' choices are the
  // defaults'). Once the batch is on screen it stays there, choices and all: a bill asked for again waits in its place
  const coming = qs.some((q) => q.isPending && !q.isPaused) || (settings.isPending && !settings.isPaused);
  const [upFor, setUpFor] = useState<string | null>(null);
  const showing = qs.some((q) => q.data?.kind === "bill") && (!coming || upFor === ids);
  useEffect(() => { if (showing) setUpFor(ids); }, [showing, ids]);
  const over = picked.length - asked.length;
  const capNote = over ? (
    <Banner tone="brand" icon={Info} title={`Pick up to ${MAX_BILLS} bills`}>
      {`You picked ${plural(picked.length, "bill")}, so the first ${MAX_BILLS} are here, in the order you picked them. Print them, then tick the other ${plural(over, "bill")} in the sales list.`}
    </Banner>
  ) : null;
  const frame = (body: ReactNode) => <Page icon={Printer} title="Batch print" breadcrumbs={CRUMBS}>{capNote}{body}</Page>;
  const empty = (title: string) => frame(
    <Card><EmptyState icon={Printer} title={title} actions={<ButtonLink to="/sales" variant="primary">Go to Sales</ButtonLink>}>
      Tick bills in the sales list, then choose Print. They open here as one batch, in the order you ticked them.
    </EmptyState></Card>,
  );
  if (!asked.length) return empty("No bills picked");
  if (!showing && coming) {
    return frame(
      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-6" role="status" aria-label="Loading the bills">
        <div className="card p-8 flex flex-col gap-4 h-[700px]"><Skeleton w="40%" h={18} className="self-center" /><Skeleton h={90} /><Skeleton h={260} /></div>
        <div className="card p-5 flex flex-col gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={18} />)}</div>
      </div>,
    );
  }
  const rows = asked.map((id, i) => rowOf(id, qs[i], qc));
  // Try again asks again for those bills alone, through the client (Ruling 1B-11)
  const again = (which: number[]) => { for (const id of which) void qc.refetchQueries({ queryKey: billQuery(id).queryKey }); };
  const asking = new Set(asked.filter((_, i) => qs[i].isFetching));
  if (!rows.some((r) => "bill" in r)) {
    const unloaded = rows.filter((r): r is Unloaded => "failed" in r);
    if (!unloaded.length) return empty("These bills aren't here any more");
    // none came: why, with Try again (offline, they come by themselves once the internet is back)
    const p = whyUnloaded(unloaded) as ApiProblem;
    return frame(<LoadError problem={p} what="the bills" retry={p.kind === "offline" ? undefined : () => again(unloaded.map((r) => r.id))} />);
  }
  return <BatchScreen key={ids} rows={rows} capNote={capNote} settings={settings.data} again={again} asking={asking} />;
}

function BatchScreen({ rows, capNote, settings, again, asking }: { rows: Row[]; capNote: ReactNode; settings: ShopSettings | undefined; again: (ids: number[]) => void; asking: Set<number> }) {
  const { show } = useToast();
  const log = useLogPrint();
  const net = useNetwork();
  const [out, setOut] = useState<Set<number>>(new Set());
  // the shop's defaults until a choice is made here (held offline, Original only with bank details)
  const [chosen, setChosen] = useState<{ copies?: Copies; showBank?: boolean }>({});
  const copies: Copies = chosen.copies ?? (settings?.copies === "all" ? "all" : "original");
  const showBank = chosen.showBank ?? settings?.show_bank ?? true;
  const gone = rows.filter((r) => "gone" in r).length;
  const kept = rows.filter((r): r is Here | Unloaded | Coming => !("gone" in r) && !out.has(r.id));
  const here = kept.filter((r): r is Here => "bill" in r);
  const unloaded = kept.filter((r): r is Unloaded => "failed" in r);
  const still = kept.filter((r): r is Coming => "coming" in r);
  const stale = here.filter((r) => r.stale);
  const bills = here.map((r) => r.bill);
  const looks = bills.map((b) => drawn(b, showBank));
  const papers = looks.map((d) => d.paper);
  const copyList = copyPages(copies);
  const pageCount = papers.reduce((a, p) => a + p.pages.length, 0) * copyList.length;
  const what = billsAnd(bills);
  const total = bills.filter((b) => b.status !== "cancelled").reduce((a, b) => a + b.total_amount, 0);
  const anyCancelled = bills.some((b) => b.status === "cancelled");
  const fileName = `Sales_${bills.length}_bill${bills.length === 1 ? "" : "s"}_${dateShort(todayIST()).replace(" ", "")}.pdf`;
  // made once every bill kept is here, keyed on what it prints, so a refresh that changed nothing on paper keeps it
  // ponytail: a batch made while a firm's signature got no answer goes without it until the page opens again (makeBillPdf
  // drops draw's `again`). Upgrade: carry `again` out of makeBillPdf and make it again quietly, as the print page does.
  const key = bills.length > 0 && !unloaded.length && !still.length ? `${copies}|${looks.map((d) => d.prints).join("\n")}` : null;
  const made = useMade(key, () => makeBillPdf(papers, copies, { title: `Sales · ${what}` }));
  const making = key !== null && !made.value && !made.failed;
  const one = unloaded.length === 1;
  const them = one ? "it" : "them";
  const waitWhy = !kept.length ? "Every bill is left out"
    : unloaded.length ? (one ? "Waiting for the bill that didn't load" : `Waiting for the ${unloaded.length} bills that didn't load`)
      : still.length ? (still.length === 1 ? "Waiting for the bill still loading" : `Waiting for the ${still.length} bills still loading`)
        : made.failed ? "The PDF couldn't be made. Try again." : !made.value ? "Making the batch…" : undefined;
  // the bills that didn't load, by number where this device has it, Print and the PDF waiting for them (Ruling 2).
  // Offline they come by themselves once the internet is back, so there's no Try again then
  const p = whyUnloaded(unloaded);
  const notLoaded = p ? {
    title: `${named(unloaded.map((r) => r.number))} didn't load`,
    body: `${p.kind === "offline" ? `You're offline, so the batch waits for ${them}. ${one ? "It loads by itself" : "They load by themselves"} when the internet is back, or leave ${them} out`
      : p.kind === "unreachable" || p.kind === "server" ? `The app couldn't reach the shop's records just now, so the batch waits for ${them}. Try again, or leave ${them} out`
        : `${p.message} Try again, or leave ${them} out`}${bills.length ? " to print the rest" : ""}.`,
  } : null;
  // a Try again keeps the note on screen, busy, until the batch is made or fails again
  const pdfFail = made.failed || made.retrying ? {
    title: "The batch wasn't made",
    body: net === "offline" ? "You're offline, so the batch wasn't made. It needs the internet; try again when you're back."
      : pdfCodeMissing(made.error) ? "The part of the app that makes PDFs didn't load. Reload the page, then try again." : "Something stopped it part way. Try again.",
  } : null;
  const audit = (action: PrintLog["action"]) => log(batchLog(action, { what, span: billsSpan(bills, { numbers: true }), pages: pageCount, copies }));
  // nothing is awaited before the tab opens or the file downloads: the batch was made before the press
  const print = () => {
    if (!made.value) return;
    if (!printFile(made.value)) { show({ tone: "brand", title: "The batch didn't open", body: "The browser stopped the new tab. Allow pop-ups for this app to print from it, or use One combined PDF." }); return; }
    audit("printed");
  };
  const download = () => {
    if (!made.value) return;
    saveFile(made.value, fileName);
    audit("exported");
    show({ title: `Downloaded ${fileName}`, body: `${plural(pageCount, "A4 page")}, the bills in the order shown. Written to the audit log.` });
  };
  // × takes its bill out of the list, and the focus to the bill now in its place (else the one before, else the heading)
  const list = useRef<HTMLUListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [refocus, setRefocus] = useState<number | null>(null);
  useEffect(() => {
    if (refocus === null) return;
    const xs = list.current?.querySelectorAll<HTMLButtonElement>("li button");
    (xs?.length ? xs[Math.min(refocus, xs.length - 1)] : heading.current)?.focus();
    setRefocus(null);
  }, [refocus]);
  const leaveOut = (id: number) => { setRefocus(kept.findIndex((r) => r.id === id)); setOut((x) => new Set(x).add(id)); };
  const noBank = [...new Set(bills.filter((b) => !hasBank(b.firm)).map((b) => b.firm.name))];
  let n = 0;
  return (
    <Page icon={Printer} title={bills.length ? `Batch print · ${what}` : "Batch print"} breadcrumbs={CRUMBS}
      context={bills.length ? `${billsSpan(bills)} · ${plural(pageCount, "A4 page")} · ${inr(total)}${anyCancelled ? " (cancelled bills not in the total)" : ""}` : undefined}>
      {capNote}
      {gone ? <Banner tone="brand" icon={Info} title={`${plural(gone, "bill")} left out`}>{gone === 1 ? "It was" : "They were"} deleted after being picked.</Banner> : null}
      {stale.length ? <StaleNote problem={stale[0].stale as ApiProblem} what={named(stale.map((r) => r.bill.invoice_number))} retry={() => again(stale.map((r) => r.id))} busy={stale.some((r) => asking.has(r.id))} /> : null}
      <FailNote error={notLoaded} onRetry={p && p.kind !== "offline" ? () => again(unloaded.map((r) => r.id)) : undefined} busy={unloaded.some((r) => asking.has(r.id))} />
      <div className="grid gap-6 items-start lg:grid-cols-[minmax(0,1fr)_340px]">
        <div key={`${copies}-${showBank}-${bills.length}`} className="min-w-0 flex flex-col items-center gap-6 anim-rise">
          {papers.flatMap((pp, bi) => copyList.flatMap((cp) => pp.pages.map((pg) => {
            n += 1;
            return (
              <div key={`${pp.id}-${cp.value}-${pg.index}`} className="flex flex-col gap-2 items-center w-full">
                <p className="text-sm text-muted self-start">Page {n} of {pageCount} · bill {bi + 1} of {papers.length}, {pp.number}{copyList.length > 1 ? ` · ${cp.label.toLowerCase()} copy` : ""}{pp.pages.length > 1 ? ` · page ${pg.index + 1} of ${pp.pages.length}` : ""}</p>
                <ScaledPaper b={pp} copy={cp} page={pg} />
              </div>
            );
          })))}
          {!kept.length ? <Card className="w-full"><EmptyState icon={Printer} title="Every bill is left out" actions={<ButtonLink to="/sales" variant="primary">Go to Sales</ButtonLink>}>Tick bills in the sales list again, then choose Print.</EmptyState></Card> : null}
        </div>
        <aside aria-label="Batch print options" className="card p-5 lg:sticky lg:top-6 flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h2 ref={heading} tabIndex={-1} className="text-md font-semibold outline-none">Bills in this batch</h2>
            <ul ref={list} className="flex flex-col divide-y divide-rule rounded-ctl border border-line max-h-[260px] overflow-y-auto">
              {kept.map((r) => ("bill" in r ? (
                <li key={r.id} className="flex items-center gap-2 pl-3 pr-1 py-1.5">
                  <span className="flex-1 min-w-0"><Link to={`/sales/${r.id}`} className="block font-medium tnum hover:text-brand">{r.bill.invoice_number}</Link><span className="block text-sm text-muted truncate">{r.bill.customer.name} · {date(r.bill.invoice_date)}</span></span>
                  <Money value={r.bill.total_amount} className="text-sm" />
                  <Button size="sm" variant="ghost" icon={X} aria-label={`Leave ${r.bill.invoice_number} out`} onClick={() => leaveOut(r.id)} />
                </li>
              ) : (
                <li key={r.id} className="flex items-center gap-2 pl-3 pr-1 py-1.5">
                  <span className="flex-1 min-w-0">
                    {r.number ? <Link to={`/sales/${r.id}`} className="block font-medium tnum hover:text-brand">{r.number}</Link> : <span className="block font-medium">A bill</span>}
                    {"coming" in r ? <span className="block text-sm text-muted">Loading…</span> : <span className="block text-sm text-neg">Didn&apos;t load</span>}
                  </span>
                  <Button size="sm" variant="ghost" icon={X} aria-label={`Leave ${r.number ?? ("coming" in r ? "the bill still loading" : "the bill that didn't load")} out`} onClick={() => leaveOut(r.id)} />
                </li>
              )))}
            </ul>
          </div>
          <div className="flex flex-col gap-2">
            <h2 className="text-md font-semibold">Copies</h2>
            <Segmented label="Copies" options={COPIES} value={copies} onChange={(v) => setChosen((c) => ({ ...c, copies: v }))} />
            <p className="text-sm text-muted">{copyList.length > 1 ? `${COPY_MARKS.map((c) => c.label).join(", ")} of each bill.` : "One copy of each bill, marked ORIGINAL FOR RECIPIENT."}</p>
          </div>
          <Switch label="Bank details on the bills" checked={showBank} onChange={(v) => setChosen((c) => ({ ...c, showBank: v }))}
            description={noBank.length ? `Each firm's own bank. ${andList(noBank)} ${noBank.length === 1 ? "has" : "have"} no account saved, so ${noBank.length === 1 ? "its bills print" : "their bills print"} without one.` : "Each firm's own bank"} />
          <p className="text-sm text-fg2 rounded-ctl border border-line bg-field px-4 py-3">{what} · {plural(pageCount, "A4 page")} · {inr(total)}{anyCancelled ? " (cancelled bills not in the total)" : ""}</p>
          <FailNote error={pdfFail} onRetry={made.retry} busy={made.retrying} />
          <Button variant="primary" size="lg" full icon={Printer} disabled={!made.value} title={waitWhy} loading={making} onClick={print}>
            {making ? "Making the batch…" : pageCount === 1 ? "Print 1 page" : `Print all ${pageCount} pages`}
          </Button>
          <Button full icon={Download} disabled={!made.value} title={waitWhy} onClick={download}>One combined PDF</Button>
          <p className="text-sm text-muted border-t border-rule pt-4">One print dialog for the whole batch, in this order. Each bill keeps its own QR code and copy label.</p>
        </aside>
      </div>
      {papers.length ? <PrintCopy>{papers.flatMap((pp) => copyList.flatMap((cp) => pp.pages.map((pg) => <Paper key={`${pp.id}-${cp.value}-${pg.index}`} b={pp} copy={cp} page={pg} />)))}</PrintCopy> : null}
    </Page>
  );
}
