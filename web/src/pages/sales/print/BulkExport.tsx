// Bulk PDFs and batch print, /sales/export (PROTO sales/BulkExport.jsx, without the CA's month pack: part 3). Pick
// firms, a month or dates, which bills and a number range; tick single bills; see every file name first, with a check
// that no two files share a name. Making them shows progress and names the bills that couldn't be made.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { skipToken, useQueries, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2, Download, ExternalLink, Files, Printer, RotateCw, Square } from "lucide-react";
import { api } from "@/core/api/client";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { useNetwork } from "@/core/api/network";
import { billQuery, salesParams, useShopSettings, type BillOutcome, type SalesQuery } from "@/core/api/sales";
import { date, fyMonths, inr, monthLabel, monthOf, plural, todayIST } from "@/core/format";
import { printFile, saveFile } from "@/core/print/files";
import { batchLog, exportLog, useLogPrint } from "@/core/print/log";
import { makeBillPdf } from "@/core/print/make";
import { copyPages, printBill } from "@/core/print/model";
import { fileNames } from "@/core/sales/files";
import type { BillRow, Copies } from "@/core/sales/types";
import { toSalesPage } from "@/core/sales/wire";
import { andList, billsAnd } from "@/core/sales/words";
import { useFirms, useScope } from "@/core/scope";
import { Badge, Banner, Button, Card, Checkbox, EmptyState, FailNote, Input, LoadError, ListSkeleton, Money, Page, SearchInput, Segmented, Select, StaleNote, Table, Td, Th, Tr, useToast } from "@/core/ui";
import { useBoxWidth } from "@/core/useBoxWidth";
import { useDebounced } from "@/core/useDebounced";
import { billsSpan, byFirm, MAX_BILLS, named, notLoadedWords, unmade, useMade, whatPrints } from "./parts";
import { zipFiles } from "./zip";

const ZIP_CAP = 300;

type Which = "all" | "unsent" | "credit";
const WHICH: { value: Which; label: string }[] = [{ value: "all", label: "All bills" }, { value: "unsent", label: "Not sent yet" }, { value: "credit", label: "Udhaar" }];
const PRINT_COPIES: { value: Copies; label: string }[] = [{ value: "original", label: "Original only" }, { value: "all", label: "All three copies" }];

/** Every bill of the period that matches, all pages of them (200 at a time), in one answer. */
function useExportBills(query: SalesQuery | null) {
  return useQuery({
    queryKey: ["sales", "export", query],
    queryFn: query === null ? skipToken : async ({ signal }) => {
      const rows = new Map<number, BillRow>();
      for (let page = 1; ; page += 1) {
        const p = toSalesPage((await api.get("sales/", { params: salesParams("all", query, page, 200), signal })).data);
        for (const row of p.results) rows.set(row.id, row);
        if (!p.next) return [...rows.values()];
      }
    },
  });
}

/** Query's structurally shared answer keeps the papers steady as zip progress changes. */
function exportReads(qs: UseQueryResult<BillOutcome>[]) {
  return {
    bills: qs.map((d) => d.data?.kind === "bill" ? d.data.bill : null),
    failures: qs.map((d) => d.data?.kind === "deleted" ? { kind: "notfound", message: "Deleted" } as ApiProblem
      : !d.data && d.isError ? problemOf(d.error) : !d.data && d.isPaused ? OFFLINE : null),
    stale: qs.map((d) => d.data?.kind === "bill" && d.isError ? problemOf(d.error) : null),
    coming: qs.some((d) => d.isPending && !d.isPaused),
  };
}

const OFFLINE: ApiProblem = { kind: "offline", message: "You're offline" };
type Unread = { row: BillRow; problem: ApiProblem };
type Job = { papers: Map<number, ReturnType<typeof printBill>>; list: BillRow[]; unread: Unread[]; reading?: boolean; n: number; total: number; done: boolean; made: BillRow[]; failed: BillRow[]; offline?: boolean; stopped?: boolean; zip?: Blob; name: string; period: string; error?: unknown; saved?: boolean };

export default function BulkExport() {
  const [params] = useSearchParams();
  const { firms, loading: firmsLoading, error: firmsError, problem: firmsProblem } = useFirms();
  const { firmId: scope, fy } = useScope();
  const settings = useShopSettings();
  const net = useNetwork();
  const connection = useRef(net);
  connection.current = net;
  const qc = useQueryClient();
  const { show } = useToast();
  const log = useLogPrint();
  const today = todayIST();
  const cur = monthOf(today);
  const months = fyMonths(fy).filter((m) => m <= cur);
  const asked = params.get("firm");
  const [picked, setPicked] = useState<number[] | null>(null);
  const firmIds = picked ?? (asked === "all" ? firms.map((f) => f.id) : asked ? [Number(asked)] : typeof scope === "number" ? [scope] : firms.map((f) => f.id));
  const [mode, setMode] = useState<"month" | "range">("month");
  const askedMonth = params.get("month");
  const [month, setMonth] = useState(askedMonth && months.includes(askedMonth) ? askedMonth : months.includes(cur) ? cur : months[months.length - 1]);
  const [from, setFrom] = useState(`${months[0]}-01`);
  const [to, setTo] = useState(today);
  const [which, setWhich] = useState<Which>("all");
  const [nFrom, setNFrom] = useState("");
  const [nTo, setNTo] = useState("");
  const appliedFrom = useDebounced(nFrom, 300);
  const appliedTo = useDebounced(nTo, 300);
  const [withCancelled, setWithCancelled] = useState(false);
  const [copies, setCopies] = useState<Copies>("original");
  const [find, setFind] = useState("");
  const [ticked, setTicked] = useState<Set<number> | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const stop = useRef(false);
  const generation = useRef(0);
  const running = useRef(false);
  const cancelRead = useRef<(() => void) | null>(null);
  const [listBox, listW] = useBoxWidth();
  const compact = listW > 0 && listW + 40 < 760;
  // another FY picked in the top bar: a month from the old year becomes the new year's latest
  useEffect(() => { if (!months.includes(month)) setMonth(months.includes(cur) ? cur : months[months.length - 1]); }, [fy]); // eslint-disable-line react-hooks/exhaustive-deps

  const rangeErr = mode === "range" ? (!from || !to ? "Type both dates." : from > to ? "The first date is after the last one." : to > today ? `The last date is after today (${date(today)}).` : "") : "";
  const numErr = appliedFrom && appliedTo && Number(appliedFrom) > Number(appliedTo) ? "The first number is bigger than the last one." : "";
  const query: SalesQuery | null = rangeErr || scope === null || firmsLoading || firmsError ? null : {
    ...(mode === "month" ? { month } : { start_date: from, end_date: to }),
    ...(which === "unsent" ? { unsent: true } : which === "credit" ? { credit: true } : {}),
    ...(withCancelled ? {} : { status: "active" as const }), ordering: "number",
  };
  const q = useExportBills(query);
  const order = (id: number) => { const i = firms.findIndex((f) => f.id === id); return i < 0 ? firms.length : i; };
  const inPeriod = useMemo(() => [...(q.data ?? [])].sort((a, b) => order(a.business) - order(b.business) || (a.counter ?? 0) - (b.counter ?? 0) || a.invoice_date.localeCompare(b.invoice_date) || a.id - b.id), [q.data, firms]); // eslint-disable-line react-hooks/exhaustive-deps
  const firmKey = firmIds.join(",");
  const bills = useMemo(() => numErr || rangeErr || q.isError ? [] : inPeriod.filter((b) => firmIds.includes(b.business) && (!appliedFrom || (b.counter ?? 0) >= Number(appliedFrom)) && (!appliedTo || (b.counter ?? 0) <= Number(appliedTo))), [inPeriod, firmKey, appliedFrom, appliedTo, numErr, rangeErr, q.isError]); // eslint-disable-line react-hooks/exhaustive-deps -- firmKey is the selected IDs
  const key = bills.map((b) => b.id).join(",");
  useEffect(() => { setTicked(null); }, [key]);
  const isTicked = useCallback((id: number) => (ticked ? ticked.has(id) : true), [ticked]);
  const chosen = useMemo(() => bills.filter((b) => isTicked(b.id)), [bills, isTicked]);
  const words = find.trim().toLowerCase();
  const shown = useMemo(() => words ? bills.filter((b) => b.invoice_number.toLowerCase().includes(words) || b.customer.name.toLowerCase().includes(words) || b.customer.mobile_number.includes(words.replace(/\s/g, ""))) : bills, [bills, words]);
  const names = useMemo(() => fileNames(chosen.map((b) => ({ id: b.id, invoice_number: b.invoice_number, invoice_date: b.invoice_date, fy: b.fy, prefix: firms.find((f) => f.id === b.business)?.prefix ?? "", firmName: b.business_name }))), [chosen, firms]);
  const renamed = chosen.filter((b) => names.get(b.id)?.renamed);
  const total = chosen.filter((b) => b.status !== "cancelled").reduce((a, b) => a + b.total_amount, 0);
  const periodText = mode === "month" ? monthLabel(month, { long: true }) : `${date(from)} to ${date(to)}`;
  const firmText = firmIds.length === firms.length ? (firms.length > 1 ? "All firms" : firms[0]?.name ?? "") : firms.filter((f) => firmIds.includes(f.id)).map((f) => f.name).join(" and ") || "No firm";
  const zipName = `Sales_PDFs_${mode === "month" ? monthLabel(month).replace(" ", "") : `${from}_to_${to}`}_${firms.filter((f) => firmIds.includes(f.id)).map((f) => f.prefix || f.short).join("-")}.zip`;
  const showBank = settings.data?.show_bank ?? true;
  const countFor = (id: number) => inPeriod.filter((b) => b.business === id).length;
  const toggleFirm = (id: number, on: boolean) => setPicked(firms.map((f) => f.id).filter((x) => (x === id ? on : firmIds.includes(x))));
  const tick = useCallback((id: number, on: boolean) => setTicked((t) => { const n = new Set(t ?? bills.map((b) => b.id)); if (on) n.add(id); else n.delete(id); return n; }), [bills]);
  const allShown = shown.length > 0 && shown.every((b) => isTicked(b.id));
  const tickShown = useCallback((on: boolean) => setTicked((t) => { const n = new Set(t ?? bills.map((b) => b.id)); for (const b of shown) { if (on) n.add(b.id); else n.delete(b.id); } return n; }), [bills, shown]);
  const ticks = (list: BillRow[]) => { const a = list.filter((b) => b.status !== "cancelled"); const x = list.length - a.length; return { a: a.length, x }; };
  const all = ticks(bills);
  const some = ticks(chosen);
  const firmSplit = (list: BillRow[]) => { const g = byFirm(list); return g.length > 1 ? andList(g.map(({ name, list: l }) => `${name} ${l.length}`)) : ""; };

  // Only Print's first MAX_BILLS are read on opening. The rest wait for the ZIP press.
  const pickedBills = chosen.slice(0, ZIP_CAP);
  const printRows = pickedBills.slice(0, MAX_BILLS);
  const reads = useQueries({ queries: printRows.map((b) => billQuery(b.id)), combine: exportReads });
  const unread = printRows.flatMap((row, i) => reads.failures[i] ? [{ row, problem: reads.failures[i] }] : []);
  const stale = printRows.flatMap((row, i) => reads.stale[i] ? [{ row, problem: reads.stale[i] }] : []);
  const coming = reads.coming;
  const here = printRows.length > 0 && !unread.length && !coming && reads.bills.every(Boolean);
  const printPapers = useMemo(() => here ? reads.bills.flatMap((b) => b ? [printBill(b, { showBank })] : []) : [], [here, reads.bills, showBank]);
  const paperKey = useMemo(() => printPapers.map(whatPrints).join("\n"), [printPapers]);
  const pageCount = printPapers.reduce((n, p) => n + p.pages.length, 0) * copyPages(copies).length;
  const settingsReady = !settings.isPending || settings.isPaused;
  const printKey = here && settingsReady ? `${copies}|${paperKey}` : null;
  const printed = useMade(printKey, () => makeBillPdf(printPapers, copies, { title: `Sales · ${billsAnd(printRows)}` }));
  const printWhy = unmade(printed.error, net === "offline", "batch");
  const [retrying, setRetrying] = useState<Unread[] | null>(null);
  const retryReads = async (rows = unread) => {
    setRetrying(rows);
    try { for (const b of rows) if (b.problem.kind !== "notfound") await qc.refetchQueries({ queryKey: billQuery(b.row.id).queryKey }); }
    finally { setRetrying(null); }
  };
  const selection = useMemo(() => JSON.stringify([chosen, [...names], month, mode, from, to, which, withCancelled, copies, showBank, zipName]), [chosen, names, month, mode, from, to, which, withCancelled, copies, showBank, zipName]);
  useEffect(() => {
    setJob(null);
    return () => { generation.current += 1; stop.current = true; cancelRead.current?.(); running.current = false; };
  }, [selection]);
  useEffect(() => {
    if (!job?.zip) return;
    const papers = job.papers;
    const changed = (id: number) => {
      const value = qc.getQueryData(billQuery(id).queryKey);
      return value !== undefined && (value.kind !== "bill" || whatPrints(printBill(value.bill, { showBank })) !== whatPrints(papers.get(id)!));
    };
    // Check at completion too: an edit may have arrived while the PDF maker was working.
    if ([...papers.keys()].some(changed)) { setJob(null); return; }
    return qc.getQueryCache().subscribe((event) => {
      const id = event.query.queryKey[2];
      if (event.type === "updated" && typeof id === "number" && papers.has(id) && changed(id)) setJob(null);
    });
  }, [job, qc, showBank]);

  /** Read each detail on the press, then write each Original before making the next. No ZIP if any read failed. */
  const run = async (list: BillRow[] = pickedBills, retry: Unread[] = [], previous?: Job) => {
    if (running.current || !list.length) return;
    const papers = new Map([...previous?.papers ?? []].filter(([id]) => list.some((b) => b.id === id)));
    const initial: Job = { papers, list, unread: [], n: 0, total: list.length, done: false, made: [], failed: [], name: zipName, period: periodText };
    if (net === "offline") { setJob({ ...initial, done: true, failed: list, offline: true }); return; }
    if ((!here && !retry.length && !previous) || !settingsReady) return;
    stop.current = false;
    running.current = true;
    const token = ++generation.current;
    const live = () => token === generation.current;
    const offlineNow = () => connection.current === "offline";
    let activeRead: number | null = null;
    let ownRead = false;
    let interrupt!: () => void;
    const interrupted = new Promise<never>((_, reject) => { interrupt = () => {
      // Release this job's wait even if Query paused its retry offline. Cancel only an inactive read we started.
      if (activeRead !== null && ownRead) {
        const queryKey = billQuery(activeRead).queryKey;
        if (qc.getQueryCache().find({ queryKey })?.getObserversCount() === 0) void qc.cancelQueries({ queryKey });
      }
      if (activeRead !== null) reject(new Error("Stopped"));
    }; });
    cancelRead.current = interrupt;
    const made: BillRow[] = [];
    const failed: BillRow[] = [];
    const missing = previous?.unread.filter((r) => r.problem.kind === "notfound" && list.some((b) => b.id === r.row.id)) ?? [];
    let readN = 0;
    let error: unknown;
    let n = 0;
    let progressAt = performance.now();
    setJob({ ...initial, reading: true, unread: retry });
    try {
      for (const b of list) {
        if (!live() || stop.current || offlineNow()) break;
        activeRead = b.id;
        ownRead = (qc.getQueryState(billQuery(b.id).queryKey)?.fetchStatus ?? "idle") === "idle";
        try {
          if (missing.some((r) => r.row.id === b.id)) continue;
          // The job owns successful answers even after Query removes an inactive entry. Use any newer cached answer.
          if (papers.has(b.id)) {
            const cached = qc.getQueryData(billQuery(b.id).queryKey);
            if (cached?.kind === "deleted") { papers.delete(b.id); missing.push({ row: b, problem: { kind: "notfound", message: "Deleted" } }); }
            else if (cached?.kind === "bill") papers.set(b.id, printBill(cached.bill, { showBank }));
            continue;
          }
          let outcome: BillOutcome | undefined;
          if (retry.some((r) => r.row.id === b.id)) {
            await Promise.race([qc.refetchQueries({ queryKey: billQuery(b.id).queryKey }), interrupted]);
            const state = qc.getQueryState(billQuery(b.id).queryKey);
            if (state?.status === "error") throw state.error;
            if (state?.fetchStatus === "paused") { missing.push({ row: b, problem: OFFLINE }); break; }
            outcome = state?.data ?? await Promise.race([qc.fetchQuery(billQuery(b.id)), interrupted]);
          } else outcome = await Promise.race([qc.fetchQuery(billQuery(b.id)), interrupted]);
          if (!live()) return;
          if (outcome?.kind === "bill") papers.set(b.id, printBill(outcome.bill, { showBank }));
          else missing.push({ row: b, problem: outcome?.kind === "deleted" ? { kind: "notfound", message: "Deleted" } : OFFLINE });
        } catch (failure) { if (live() && !stop.current) missing.push({ row: b, problem: problemOf(failure) }); }
        finally {
          activeRead = null;
          if (live() && !stop.current) {
            readN += 1;
            setJob({ ...initial, reading: true, n: readN, unread: retry });
          }
        }
        // A deleted bill is collected; a failed connection stops here rather than asking for the unread tail.
        if (missing.some((r) => r.problem.kind !== "notfound")) break;
      }
      if (!live()) return;
      if (missing.length || stop.current || offlineNow()) {
        setJob({ ...initial, n: readN, done: true, unread: missing, stopped: stop.current, offline: offlineNow(), failed: list });
        return;
      }
      setJob(initial);
      async function* files() {
        for (const b of list) {
          // Yield between files so progress and Stop work even with an already-cached maker.
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
          if (!live() || stop.current || offlineNow()) return;
          const paper = papers.get(b.id)!;
          try {
            const blob = await makeBillPdf([paper], "original", { title: `Tax Invoice ${b.invoice_number}`, subject: paper.qr });
            if (!live()) return;
            made.push(b);
            yield { name: names.get(b.id)!.name, blob };
          } catch (failure) { failed.push(b); error ??= failure; }
          n += 1;
          if (live() && performance.now() - progressAt >= 100) {
            progressAt = performance.now();
            setJob({ ...initial, n, made: [...made], failed: [...failed] });
          }
        }
      }
      const zip = await zipFiles(files());
      if (live()) {
        const disconnected = offlineNow();
        setJob({ ...initial, n, done: true, made, failed: disconnected ? list : failed, stopped: stop.current, error,
          offline: disconnected, zip: !stop.current && !disconnected && made.length ? zip : undefined });
      }
    } catch (failure) {
      if (live()) setJob({ ...initial, n, done: true, made: [], failed: list, error: failure });
    } finally { if (cancelRead.current === interrupt) cancelRead.current = null; if (live()) running.current = false; }
  };
  useEffect(() => {
    // A failed offline ZIP read is inactive in Query's cache. Resume that job when the line comes back.
    if (net === "online" && job?.done && job.unread.some((r) => r.problem.kind === "offline")) void run(job.list, job.unread.filter((r) => r.problem.kind !== "notfound"), job);
  }, [net]); // eslint-disable-line react-hooks/exhaustive-deps -- only reconnect resumes these reads
  const printReady = () => {
    if (!printed.value) return;
    if (!printFile(printed.value)) { show({ tone: "brand", title: "The PDF didn't open", body: "The browser stopped the new tab. Allow pop-ups for this app to print from it." }); return; }
    log(batchLog("printed", { what: billsAnd(printRows), span: billsSpan(printRows, { numbers: "all" }), pages: pageCount, copies }));
  };
  const saveReady = () => {
    if (!job?.zip) return;
    saveFile(job.zip, job.name);
    log(exportLog({ what: billsAnd(job.made), span: billsSpan(job.made, { numbers: "all" }), period: job.period, name: job.name }));
    setJob({ ...job, saved: true });
  };
  const busy = Boolean(job && !job.done);

  const filesTable = useMemo(() => (bills.length ? (
    <Table label="Files that will be made">
      <thead><tr>
        <Th className="w-12"><Checkbox hideLabel label={`Tick all ${plural(shown.length, "bill")} shown`} checked={allShown} onChange={tickShown} /></Th>
        {compact ? <><Th>File and bill</Th><Th>Customer and date</Th></> : <><Th>File name</Th><Th>Bill</Th><Th>Customer</Th><Th>Date</Th></>}
        <Th align="right">Total</Th>
      </tr></thead>
      <tbody>
        {shown.map((b) => {
          const n = names.get(b.id);
          const on = isTicked(b.id);
          const file = <>{on && n ? n.name : <span className="text-muted">Not made</span>}{on && n?.renamed ? <Badge tone="brand" className="ml-2">renamed</Badge> : null}</>;
          const bill = <><Link to={`/sales/${b.id}`} className="hover:text-brand tnum">{b.invoice_number}</Link>{b.status === "cancelled" ? <Badge tone="neg" className="ml-2">Cancelled</Badge> : null}</>;
          return (
            <Tr key={b.id} className={on ? "" : "opacity-60"}>
              <Td><Checkbox hideLabel label={`Tick ${b.invoice_number}`} checked={on} onChange={(v) => tick(b.id, v)} /></Td>
              {compact ? (
                <>
                  <Td><span className="block tnum font-medium break-all">{file}</span><span className="block text-sm text-fg2 mt-0.5">{bill}</span></Td>
                  <Td><span className="block">{b.customer.name}</span><span className="block text-sm text-muted tnum mt-0.5">{date(b.invoice_date)}</span></Td>
                </>
              ) : (
                <>
                  <Td className="tnum font-medium whitespace-nowrap">{file}</Td>
                  <Td className="whitespace-nowrap">{bill}</Td>
                  <Td>{b.customer.name}</Td>
                  <Td className="tnum whitespace-nowrap text-fg2">{date(b.invoice_date)}</Td>
                </>
              )}
              <Td align="right"><Money value={b.total_amount} /></Td>
            </Tr>
          );
        })}
        {!shown.length ? <tr><td colSpan={compact ? 4 : 6} className="px-5 py-6 text-center text-muted">No bill in this list matches “{find.trim()}”.</td></tr> : null}
      </tbody>
    </Table>
  ) : null), [bills.length, shown, compact, allShown, tickShown, isTicked, names, tick, find]);

  return (
    <Page icon={Files} title="Bulk PDFs and batch print" breadcrumbs={[{ label: "Sales", to: "/sales" }]}
      context={`One PDF per bill, named by its number, so no file overwrites another · FY ${fy}`}>
      <div className="grid gap-5 items-start lg:grid-cols-[400px_minmax(0,1fr)]">
        <Card title="Which bills">
          <div className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-fg2 mb-1">Firms</legend>
              {firms.map((f) => (
                <Checkbox key={f.id} label={f.name} description={q.data ? `${plural(countFor(f.id), "bill")} in ${periodText}` : undefined} checked={firmIds.includes(f.id)} onChange={(on) => toggleFirm(f.id, on)} />
              ))}
            </fieldset>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-fg2">Period</span>
              <Segmented label="Period" value={mode} onChange={setMode} options={[{ value: "month", label: "A month" }, { value: "range", label: "Dates" }]} className="self-start" />
              {mode === "month" ? (
                <Select aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} className="anim-rise" options={[...months].reverse().map((m) => ({ value: m, label: monthLabel(m, { long: true }) }))} />
              ) : (
                <div className="grid grid-cols-2 gap-3 anim-rise">
                  <label className="flex flex-col gap-1.5"><span className="text-sm font-medium text-fg2">From</span><Input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} /></label>
                  <label className="flex flex-col gap-1.5"><span className="text-sm font-medium text-fg2">To</span><Input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} /></label>
                  {rangeErr ? <p className="col-span-2 text-sm text-neg">{rangeErr}</p> : null}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-fg2">Bill numbers</span>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <Input aria-label="From bill number" inputMode="numeric" value={nFrom} placeholder="From" inputClassName="tnum" onChange={(e) => setNFrom(e.target.value.replace(/\D/g, "").slice(0, 6))} />
                <span className="text-muted" aria-hidden="true">to</span>
                <Input aria-label="To bill number" inputMode="numeric" value={nTo} placeholder="To" inputClassName="tnum" onChange={(e) => setNTo(e.target.value.replace(/\D/g, "").slice(0, 6))} />
              </div>
              <p className={numErr ? "text-sm text-neg" : "text-sm text-muted"}>{numErr || "The number part, like 17 to 26. Leave empty for every number."}</p>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-fg2">Bills</span>
              <Segmented label="Bills" value={which} onChange={setWhich} options={WHICH} className="self-start" />
              <Checkbox label="Include cancelled bills" description="Their PDFs carry a CANCELLED stamp" checked={withCancelled} onChange={setWithCancelled} />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-fg2">Copies when printing</span>
              <Segmented label="Copies when printing" value={copies} onChange={setCopies} options={PRINT_COPIES} className="self-start" />
              <p className="text-sm text-muted">Each PDF in the zip is the Original, the copy the customer gets.</p>
            </div>
          </div>
        </Card>

        <Card title="Files that will be made" pad={false}
          subtitle={`${firmText} · ${periodText} · ${WHICH.find((w) => w.value === which)?.label.toLowerCase()}${appliedFrom || appliedTo ? ` · numbers ${appliedFrom || "first"} to ${appliedTo || "last"}` : ""}${withCancelled ? ", cancelled included" : ""}`}
          actions={<>
            <Button icon={Printer} disabled={!printed.value} onClick={printReady}>Print {printRows.length || ""}</Button>
            <Button variant="primary" icon={Download} disabled={!chosen.length || busy || ((!here || !settingsReady) && net !== "offline")} onClick={() => void run()}>Download as zip</Button>
          </>}>
          <div ref={listBox} className="px-5 pt-3 pb-4 flex flex-col gap-3">
            {chosen.length > MAX_BILLS ? <Banner tone="brand" title={`Print up to ${MAX_BILLS} bills`}>Print the first {MAX_BILLS}, through {printRows.at(-1)?.invoice_number}. {capNext(chosen[MAX_BILLS], chosen.length - MAX_BILLS, "print", firmIds.length > 1)}</Banner> : null}
            {chosen.length > ZIP_CAP ? <Banner tone="brand" title={`Export up to ${ZIP_CAP} bills`}>Export the first {ZIP_CAP}, through {pickedBills.at(-1)?.invoice_number}. {capNext(chosen[ZIP_CAP], chosen.length - ZIP_CAP, "export", firmIds.length > 1)}</Banner> : null}
            <ReadNote unread={job?.unread.length ? [] : retrying?.filter((r) => !reads.bills[printRows.findIndex((b) => b.id === r.row.id)]) ?? unread} offline={net === "offline"} busy={Boolean(retrying)} onRetry={() => void retryReads()} />
            {stale.length ? <StaleNote problem={stale[0].problem} what={named(stale.map((r) => r.row.invoice_number))} retry={() => void retryReads(stale)} busy={Boolean(retrying)} /> : null}
            {coming && !unread.length ? <p role="status" className="text-sm text-muted">Loading the picked bills…</p> : null}
            {printKey && !printed.value && !printed.failed ? <p role="status" className="text-sm text-muted">Getting the bills ready to print…</p> : null}
            <FailNote error={printed.failed || printed.retrying ? { title: "The batch wasn't made", body: printWhy.body } : null} onRetry={printWhy.again ? printed.retry : undefined} busy={printed.retrying} />
            {printed.failed && !printWhy.again ? <Button size="sm" onClick={() => window.location.reload()}>Reload the page</Button> : null}
            {job ? <JobPanel job={job} offline={net === "offline"} onReadRetry={() => void run(job.list, job.unread.filter((r) => r.problem.kind !== "notfound"), job)} onRetry={(list) => void run(list, [], job)} onStop={() => { stop.current = true; cancelRead.current?.(); }} onSave={saveReady} onClose={() => setJob(null)} /> : null}
            {firmsError ? <LoadError problem={firmsProblem!} what="the firms" retry={() => { void qc.refetchQueries({ queryKey: ["firms"] }); }} /> : q.isError ? <LoadError problem={problemOf(q.error)} what="the bills" retry={() => { void q.refetch(); }} />
              : q.isPending && (query || firmsLoading || scope === null) ? <ListSkeleton what="the bills" rows={4} />
                : bills.length ? (!job ? (
                  <div key={`${chosen.length}-${renamed.length}`} className="anim-rise flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-3 rounded-card border border-sale-line bg-sale-tint px-4 py-3" role="status">
                      <CheckCircle2 size={20} className="text-sale shrink-0" aria-hidden="true" />
                      <p className="font-semibold flex items-center gap-2 flex-wrap">{billsAnd(chosen)} <ArrowRight size={16} aria-hidden="true" /><span className="sr-only">make</span> {plural(new Set([...names.values()].map((x) => x.name)).size, "file")}, every name different</p>
                      <p className="text-sm text-fg2 w-full">Ticked bills total {inr(total)} · zip: <span className="tnum">{zipName}</span></p>
                    </div>
                    {renamed.length ? (
                      <Banner tone="brand" icon={AlertTriangle} title={`${renamed.length === 1 ? "One number is" : `${renamed.length} numbers are`} used twice, so a file was renamed`}
                        actions={<Link to={`/sales/${renamed[0].id}`} className="link inline-flex items-center gap-1">Open the bill <ExternalLink size={14} aria-hidden="true" /></Link>}>
                        {renamed.map((b) => `${b.invoice_number} (${b.customer.name}) is saved as ${names.get(b.id)?.name}`).join("; ")} instead of overwriting the first file. Give the bill a new number to fix the cause; GSTR-1 needs it too.
                      </Banner>
                    ) : null}
                  </div>
                ) : null) : (
                  <EmptyState icon={Files} title={rangeErr || numErr ? "Check the period and numbers" : firmIds.length ? "No bills match" : "Pick at least one firm"}>
                    {rangeErr || numErr || (firmIds.length ? `Nothing in ${firmText} for ${periodText} matches. Try another month, All bills, or a wider number range.` : "Tick a firm on the left to see its bills.")}
                  </EmptyState>
                )}
            {bills.length > 8 ? <SearchInput value={find} onChange={setFind} placeholder="Find a bill in this list: name, phone or number" label="Find a bill in this list" /> : null}
          </div>
          {filesTable}
          {bills.length ? (
            <p className="px-5 py-3 border-t border-rule text-sm text-muted">
              {some.a} of {plural(all.a, "bill")} ticked{all.x ? ` · ${some.x} of ${plural(all.x, "cancelled bill")}` : ""} · {inr(total)}{firmSplit(chosen) ? ` · ${firmSplit(chosen)}` : ""}
            </p>
          ) : null}
        </Card>
      </div>
    </Page>
  );
}

/** The next run starts within one firm's numbering; a bill without a numeric counter is identified by its number and date. */
function capNext(next: BillRow, rest: number, action: "print" | "export", severalFirms: boolean): string {
  if (next.counter === null) return `Continue with ${next.invoice_number}, dated ${date(next.invoice_date)}. Untick the bills already ${action === "print" ? "printed" : "exported"} to ${action} the remaining ${plural(rest, "bill")} in another run.`;
  return `Then ${severalFirms ? `pick ${next.business_name} and ` : ""}set the bill numbers from ${next.counter} to ${action} the remaining ${plural(rest, "bill")}${action === "export" ? " in another run" : ""}.${severalFirms ? " Clear the number range before picking any later firm." : ""}`;
}

function JobPanel({ job, offline, onReadRetry, onRetry, onStop, onSave, onClose }: { job: Job; offline: boolean; onReadRetry: () => void; onRetry: (list: BillRow[]) => void; onStop: () => void; onSave: () => void; onClose: () => void }) {
  if (job.stopped) return <Banner tone="brand" title={`Stopped after ${job.n} of ${job.total}`} actions={<Button size="sm" variant="ghost" onClick={onClose}>Close</Button>}>{job.made.length ? "The partial zip was discarded." : "The zip was stopped."} Start again to make every ticked bill.</Banner>;
  const readNote = <ReadNote zip unread={job.unread} offline={offline} busy={job.reading && !job.done} onRetry={onReadRetry} />;
  if (job.unread.length && job.done) return readNote;
  if (!job.done) {
    const pct = Math.round((job.n / Math.max(job.total, 1)) * 100);
    return (
      <>{readNote}<div className="rounded-card border border-line bg-field px-4 py-3 flex flex-col gap-2 anim-rise" role="status" aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold">{job.reading ? "Reading bills:" : "Making PDFs:"} <span className="tnum">{job.n} of {job.total}</span></p>
          <Button size="sm" variant="ghost" icon={Square} onClick={onStop}>Stop</Button>
        </div>
        <div className="h-2 rounded-full bg-raised overflow-hidden" aria-hidden="true"><div className="h-full bg-brand transition-[width] duration-150" style={{ width: `${pct}%` }} /></div>
      </div></>
    );
  }
  if (job.offline) {
    const title = job.n ? `You're offline, so the zip stopped after ${job.n} of ${job.total}` : "You're offline, so nothing was made";
    return <Banner tone="neg" title={title} actions={offline ? undefined : <Button size="sm" variant="primary" icon={RotateCw} onClick={() => onRetry(job.failed)}>Try again</Button>}>
      The PDFs are made from the shop&apos;s records, which need the internet. Try again when it&apos;s back to make the whole zip.
    </Banner>;
  }

  const save = job.zip ? <Button size="sm" variant="primary" icon={Download} onClick={onSave}>Save the zip</Button> : null;
  if (job.failed.length) {
    const why = unmade(job.error, false, "zip");
    return <Banner tone="neg" title={`Made ${job.made.length} of ${job.total}. ${plural(job.failed.length, "bill")} couldn't be made`}
      actions={<>{why.again ? <Button size="sm" variant="primary" icon={RotateCw} onClick={() => onRetry(job.failed)}>Try {job.failed.length === 1 ? "it" : `these ${job.failed.length}`} again</Button> : <Button size="sm" onClick={() => window.location.reload()}>Reload the page</Button>}{save}<Button size="sm" variant="ghost" onClick={onClose}>Close</Button></>}>
      These couldn&apos;t be made just now: {job.failed.map((b) => b.invoice_number).join(", ")}.{!why.again ? ` ${why.body}` : ""}{job.zip ? job.saved ? ` ${job.name} downloaded. Written to the audit log.` : ` ${job.name} has the other ${plural(job.made.length, "file")}. Save it before trying the failed bills again.` : ""}
    </Banner>;
  }
  return <Banner tone="sale" title={`${plural(job.made.length, "PDF")} made`} actions={<>{save}<Button size="sm" variant="ghost" onClick={onClose}>Close</Button></>}>
    {job.name}{job.saved ? " downloaded. Written to the audit log." : " is ready. Save the zip to download it."}
  </Banner>;
}


/** Print keeps the batch words; the zip names every failed bill and says where reading stopped. */
function ReadNote({ unread, offline, busy, onRetry, zip = false }: { unread: Unread[]; offline: boolean; busy?: boolean; onRetry: () => void; zip?: boolean }) {
  const gone = unread.filter((r) => r.problem.kind === "notfound");
  const failed = unread.filter((r) => r.problem.kind !== "notfound");
  const why = !failed.length ? null : offline ? OFFLINE : failed.find((r) => r.problem.kind !== "offline")?.problem ?? failed[0]?.problem;
  const numbers = (rows: Unread[]) => zip ? andList(rows.map((r) => r.row.invoice_number)) : named(rows.map((r) => r.row.invoice_number));
  const body = !why ? "" : !zip ? notLoadedWords(why, failed.length === 1, true)
    : why.kind === "offline" ? "You're offline, so the zip waits for this bill. It loads by itself when the internet is back, or untick it to make the zip without it."
      : why.kind === "unreachable" || why.kind === "server" ? "The app couldn't reach the shop's records just now, so reading the zip's bills stopped here. Try again, or untick this bill to make the zip without it."
        : `${why.message} Untick this bill to make the zip without it.`;
  return <>
    <FailNote error={gone.length ? { title: `${numbers(gone)} ${gone.length === 1 ? "was" : "were"} deleted after being picked`, body: gone.length === 1 ? "Untick it." : "Untick them." } : null} />
    <FailNote error={why ? { title: `${numbers(failed)} didn't load`, body } : null}
      onRetry={failed.length && why?.kind !== "offline" ? onRetry : undefined} busy={busy} />
  </>;
}
