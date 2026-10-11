import { useEffect, useRef, useState, type ComponentType } from "react";
import { Link } from "react-router";
import { ArrowRightLeft, Files, Gauge, Lock, Pencil, Plus, RefreshCw, RotateCcw, Upload, X } from "lucide-react";
import { ImportMobile } from "../ImportMobile";
import { CAPTURE_ACCEPT, isPdf, prepareFiles } from "@/core/captures/files";
import { PhotoViewer, ReadingChecks } from "@/core/captures/PhotoViewer";
import { bytesOf } from "@/core/files/zip";
import { useCustomerSearch } from "@/core/api/customers";
import { useAiReads } from "@/core/api/captures";
import { useAuth } from "@/core/auth/AuthProvider";
import { useIsPhone } from "@/core/device";
import { useUnsavedGuard } from "@/core/router/useUnsavedGuard";
import { problemOf } from "@/core/api/errors";
import { date, monthLabel, plural, toPaise } from "@/core/format";
import type { Firm } from "@/core/scope";
import { Badge, Banner, Button, ButtonLink, BusyText, Card, Checkbox, cn, Dialog, Money, Page, QueryView, Segmented, Select, Skeleton, SuccessMark, useToast } from "@/core/ui";
import { useBatchImport, useReadBill, type ImportKind, type Read } from "../batch";
import { useImportSession, type BatchReport } from "../session";
import { bodyFor, detect, fileProblem, localProblems, partyOf, statusOf, totalOf, type PhotoRow } from "./model";
export type PhotoEditorProps = { row: PhotoRow; onApply(next: PhotoRow): void; onClose(): void };
export type PhotoImportProps = { firms: Firm[]; Editor: ComponentType<PhotoEditorProps> };
export default function PhotoImport(props: PhotoImportProps) {
  const phone = useIsPhone(), auth = useAuth();
  if (phone) return <ImportMobile />;
  if (!auth.can("purchase.import") && !auth.can("bill.create")) return <Page icon={Files} title="Import bill photos" breadcrumbs={[{ label: "Purchases", to: "/purchases" }]}><Banner tone="muted" icon={Lock}>{auth.whyNot("purchase.import")}</Banner></Page>;
  return <PhotoImportDesk {...props} />;
}
function PhotoImportDesk({ firms, Editor }: PhotoImportProps) {
  const auth = useAuth(), toast = useToast();
  const meter = useAiReads(), { mutateAsync: readBill } = useReadBill(), session = useImportSession();
  const { mutateAsync: checkPurchases } = useBatchImport("purchases"), { mutateAsync: checkSales } = useBatchImport("sales");
  const [autoChecks, setAutoChecks] = useState<BatchReport[]>([]), [prechecking, setPrechecking] = useState(false), [precheckError, setPrecheckError] = useState("");
  const autoActive = useRef(false), autoPaused = useRef(false), autoVersion = useRef(0), autoAttempted = useRef<string | null>(null);
  const invalidatePrecheck = () => { autoVersion.current++; autoAttempted.current = null; autoPaused.current = false; setAutoChecks([]); setPrecheckError(""); };
  const busy = session.busy || prechecking;
  const [rows, setRows] = useState<PhotoRow[]>([]), [editing, setEditing] = useState<string | null>(null);
  const [over, setOver] = useState(false), [runError, setRunError] = useState<string | null>(null);
  // File metadata changes on reselect. Keep only content fingerprints, results and pending reads.
  const reads = useRef(new Map<string, Promise<Read>>());
  const input = useRef<HTMLInputElement>(null), more = useRef<HTMLInputElement>(null);
  const active = useRef(new Set<string>()), urls = useRef(new Set<string>()), serial = useRef(0);
  const may = { sales: auth.can("bill.create"), purchases: auth.can("purchase.import") };
  const leaveGuard = useUnsavedGuard(rows.some((r) => r.phase !== "imported"), "These photos and changes are still here. Leave without importing them?");
  const busyReading = rows.some((r) => r.phase === "reading" || r.phase === "queued");
  const reset = () => { invalidatePrecheck(); for (const url of urls.current) URL.revokeObjectURL(url); urls.current.clear(); setRows([]); setEditing(null); setRunError(null); session.reset(); };
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url); }, []);
  const patch = (id: string, next: Partial<PhotoRow>) => setRows((all) => all.map((r) => r.id === id ? { ...r, ...next, ...(next.partyId ? { partyResolved: true } : {}) } : r));
  const edit = (id: string, next: Partial<PhotoRow>) => { invalidatePrecheck(); patch(id, { ...next, problems: [], duplicate: null, credit: null }); session.reset(); setRunError(null); };
  const addFiles = (files: FileList | File[] | null) => {
    if (!files || busy) return;
    const list = [...files], bad = list.map(fileProblem).filter(Boolean);
    if (bad.length) toast.show({ tone: "neg", title: `${plural(bad.length, "file")} skipped`, body: bad.join(" ") });
    const good = list.filter((f) => !fileProblem(f));
    if (rows.length + good.length > 300) { setRunError("An import can hold at most 300 bills. Split the file."); return; }
    if (!good.length) return;
    invalidatePrecheck();
    const added: PhotoRow[] = good.map((file) => { const url = URL.createObjectURL(file); urls.current.add(url); return { id: `photo-${++serial.current}`, file, url, phase: "queued", kind: "purchase", firmId: null, buyerFirmId: null, partyId: null, read: null, include: false, buyerAck: false, itcEligible: true, itcMonth: null, problems: [], duplicate: null }; });
    setRows((all) => [...all, ...added]); session.reset(); setRunError(null);
  };
  useEffect(() => {
    if (session.busy) return;
    const next = rows.filter((r) => r.phase === "queued" && !active.current.has(r.id)).slice(0, Math.max(0, 2 - active.current.size));
    for (const row of next) {

      active.current.add(row.id); patch(row.id, { phase: "reading", fail: "" });
      void bytesOf(row.file).then(async (bytes) => {
        if (!globalThis.crypto?.subtle) throw new Error("This browser can't check this file safely. Open the app over HTTPS and try again.");
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return `${bytes.byteLength}:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
      }).then((key) => {
        const known = reads.current.get(key);
        if (known) return known;
        const result = prepareFiles([row.file], true).then(([pages]) => {
          const body = new FormData(); for (const page of pages) body.append("files", page); body.append("kind", "photos");
          return readBill(body);
        }).catch((error: unknown) => { reads.current.delete(key); throw error; });
        reads.current.set(key, result);
        return result;
      }).then((read) => { const detected = detect(read); patch(row.id, { read, ...detected, phase: "read", include: true, partyId: detected.kind === "purchase" ? read.supplier.id : null }); }).catch((error: unknown) => {
        const p = problemOf(error); const detail = (p.body as { detail?: unknown } | undefined)?.detail;
        patch(row.id, { phase: "failed", fail: error instanceof Error && !("isAxiosError" in error) ? error.message : typeof detail === "string" ? detail : p.kind === "offline" ? `You're offline, so the ${/\.pdf$/i.test(row.file.name) ? "PDF" : "photo"} wasn't sent to be read. It stays here; try again when the internet is back.` : p.message });
      }).finally(() => { active.current.delete(row.id); setRows((all) => [...all]); });
    }
  }, [rows, meter.data, readBill, session.busy]);
  useEffect(() => {
    setRows((all) => all.map((row) => {
      const report = [...session.reports, ...session.checks, ...autoChecks].find((p) => p.result.bills.some((b) => b.ref === row.id));
      const bill = report?.result.bills.find((b) => b.ref === row.id);
      if (!bill) return row;
      if (!report!.result.dry_run && report!.result.ok && bill.id) return { ...row, phase: "imported", credit: bill.credit, ...(report!.kind === "purchases" ? { purchaseId: bill.id } : { saleId: bill.id }) };
      return { ...row, problems: bill.problems, duplicate: bill.duplicate, credit: bill.credit };
    }));
  }, [session.reports, session.checks, autoChecks]);
  const chosen = rows.filter((r) => r.include && statusOf(r, may, firms) === "Ready");
  // Server problems change a row's badge, not its draft: never let a refusal trigger another check.
  const candidates = rows.filter((r) => r.phase === "read" && r.include && statusOf({ ...r, problems: [], duplicate: null }, may, firms) === "Ready");
  const automatic = (["purchases", "sales"] as ImportKind[]).map((kind) => ({ kind, body: bodyFor(candidates, kind, firms) })).filter((b) => b.body.bills.length);
  const automaticKey = JSON.stringify(automatic);
  const waitingForCustomer = rows.some((r) => r.phase === "read" && r.kind === "sale" && may.sales && !r.partyId && !r.partyResolved);
  useEffect(() => {
    if (busyReading || waitingForCustomer || session.busy || autoActive.current || autoPaused.current || !automatic.length || autoAttempted.current === automaticKey) return;
    const version = autoVersion.current;
    autoAttempted.current = automaticKey; autoActive.current = true; setPrechecking(true); setPrecheckError("");
    void (async () => {
      const reports: BatchReport[] = [];
      try {
        for (const batch of automatic) reports.push({ kind: batch.kind, result: await (batch.kind === "purchases" ? checkPurchases : checkSales)(batch.body) });
      } catch (error) {
        if (version === autoVersion.current) setPrecheckError(problemOf(error).message);
      } finally {
        if (version === autoVersion.current) setAutoChecks(reports);
        autoActive.current = false; setPrechecking(false);
      }
    })();
  }, [automaticKey, busyReading, waitingForCustomer, session.busy, prechecking, checkPurchases, checkSales]);
  const automaticPending = !autoPaused.current && !busyReading && !waitingForCustomer && automatic.length > 0 && autoAttempted.current !== automaticKey;
  const blocked = busy || automaticPending;
  const nP = chosen.filter((r) => r.kind !== "sale").length, nS = chosen.filter((r) => r.kind !== "purchase").length;
  const label = [nP ? plural(nP, "purchase bill") : "", nS ? plural(nS, "sales bill") : ""].filter(Boolean).join(" and ");
  const run = async () => {
    if (!chosen.length || blocked || autoActive.current) return;
    autoPaused.current = true; autoVersion.current++;
    const batches = (["purchases", "sales"] as ImportKind[]).map((kind) => ({ kind, body: bodyFor(chosen, kind, firms) })).filter((b) => b.body.bills.length);
    if (await session.check(batches)) await session.importChecked();
  };
  const retry = (ids: string[]) => { invalidatePrecheck(); setRows((all) => all.map((r) => ids.includes(r.id) ? { ...r, phase: "queued", fail: "" } : r)); };
  const remove = (row: PhotoRow) => { invalidatePrecheck(); URL.revokeObjectURL(row.url); urls.current.delete(row.url); setRows((all) => all.filter((r) => r.id !== row.id)); session.reset(); };
  const done = rows.filter((r) => !["reading", "queued"].includes(r.phase)).length, failed = rows.filter((r) => r.phase === "failed");
  const counts = new Map<string, number>(); for (const row of rows) { const s = statusOf(row, may, firms); counts.set(s, (counts.get(s) ?? 0) + 1); }
  const result = session.reports.filter((r) => !r.result.dry_run && r.result.ok);
  const madePairs = rows.filter((row) => row.kind === "interfirm" && result.some((r) => r.result.bills.some((b) => b.ref === row.id))).length;
  const madePurchases = result.filter((r) => r.kind === "purchases").reduce((n, r) => n + r.result.totals.bills, 0);
  const madeSales = result.filter((r) => r.kind === "sales").reduce((n, r) => n + r.result.totals.bills, 0) + madePairs;
  const resultLabel = [madePurchases ? plural(madePurchases, "purchase bill") : "", madeSales ? plural(madeSales, "sales bill") : ""].filter(Boolean).join(" and ");
  const editingRow = rows.find((r) => r.id === editing);
  const readCount = meter.data ? <span className="inline-flex items-center gap-2 text-sm text-fg2" title="Each photo read counts once; a photo that fails isn't counted"><Gauge size={16} aria-hidden="true" className="text-muted" />AI reads this month: <b className="font-semibold tnum text-fg">{meter.data.used.toLocaleString("en-IN")}</b></span> : null;
  return <Page icon={Files} title="Import bill photos" breadcrumbs={[{ label: "Purchases", to: "/purchases" }]} context="Photos and PDFs of bills. Supplier bills become purchases; your firms' own bills become sales; a bill between two of your firms becomes both. Nothing is added until you press Import." actions={<>{readCount}{rows.length ? <Button variant="ghost" icon={RotateCcw} disabled={blocked || busyReading} onClick={reset}>Start again</Button> : null}</>}>
    {leaveGuard}
    <QueryView query={meter} what="AI reads">{() => null}</QueryView>
    {result.length ? <div role="status" className="card px-5 py-5 flex flex-wrap items-center gap-5 anim-rise border-sale-line"><SuccessMark size={56} /><div className="flex-1 min-w-[260px] flex flex-col gap-1"><p className="text-lg font-semibold">Imported {resultLabel}</p>{result.map((r) => <div key={r.kind}><p className="text-fg2">{r.kind === "purchases" ? "Purchases" : "Sales"} <Money value={toPaise(r.result.totals.total_amount) ?? 0} strong />{r.kind === "purchases" ? <> · input tax credit <Money value={toPaise(r.result.totals.credit) ?? 0} /></> : null}</p></div>)}{rows.some((r) => r.kind === "interfirm" && r.phase === "imported") ? <p className="text-sm text-muted">Bills between your firms became a sale and a purchase, linked.</p> : null}</div><ButtonLink to="/purchases" variant="primary">Open purchases</ButtonLink><Button variant="ghost" icon={X} disabled={blocked || busyReading} onClick={reset}>Import more photos</Button></div> : null}
    {precheckError ? <Banner tone="neg" title="Couldn't check the bills">{precheckError}</Banner> : null}
    {runError || session.error ? <Banner tone="neg" title={session.error.includes("lost the answer") ? "Check the import" : result.length ? "Some bills were imported" : "Nothing was imported"}>{runError || session.error}</Banner> : null}

    {!rows.length ? <Card><div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }} onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }} className={cn("rounded-card border-2 border-dashed flex flex-col items-center text-center gap-3 transition-colors duration-150 px-6 py-9", over ? "border-brand bg-brand-tint" : "border-line bg-field")}><span aria-hidden="true" className="w-12 h-12 rounded-card grid place-items-center bg-raised text-fg2"><Upload size={22} /></span><p className="font-medium">{over ? "Drop to add them" : "Drop bill photos or PDFs here"}</p><p className="text-sm text-muted max-w-[56ch]">Photos (JPEG, PNG or HEIC) or PDFs, up to 20 MB each, one bill per file. Each is read for the parties' GSTINs, bill number, date, items and GST. Check what was read against the bill before importing.</p><Button onClick={() => input.current?.click()}>Choose files</Button><input ref={input} hidden type="file" multiple accept={CAPTURE_ACCEPT} aria-label="Choose files" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} /></div></Card> : <>
      <Card><div className="flex flex-wrap items-center gap-x-6 gap-y-3"><div className="flex-1 min-w-[260px] flex flex-col gap-2"><p className="font-medium">{busyReading ? <BusyText className="text-file">Reading {Math.min(done + 1, rows.length)} of {plural(rows.length, "bill")}…</BusyText> : <span role="status">All {plural(rows.length, "bill")} read</span>}</p><span className="h-1.5 rounded-full bg-line overflow-hidden" aria-hidden="true"><span className="block h-full bg-brand transition-[width] duration-300 ease-out" style={{ width: `${done / rows.length * 100}%` }} /></span></div><div className="flex flex-wrap gap-2">{[...counts].map(([status, count]) => <Badge key={status}>{status} · {count}</Badge>)}</div>{failed.length > 1 ? <Button size="sm" icon={RefreshCw} disabled={blocked} onClick={() => retry(failed.map((r) => r.id))}>Try again on all {failed.length}</Button> : null}</div></Card>
      <div className="flex flex-col gap-3">{rows.map((row) => { const read = row.read, status = statusOf(row, may, firms), problems = localProblems(row, may, firms), party = partyOf(row), pending = ["queued", "reading"].includes(row.phase); return <section key={row.id} aria-label={row.file.name} className={cn("card p-4 flex flex-col gap-3", row.phase === "imported" && "opacity-90")}>{row.kind === "sale" && may.sales && !row.partyId && !row.partyResolved && row.phase === "read" ? <MatchCustomer row={row} onMatch={(partyId) => patch(row.id, { partyId, partyResolved: true })} /> : null}<div className="flex flex-wrap items-start gap-3">{status === "Ready" ? <Checkbox hideLabel label={`Import ${read!.invoice_number} from ${row.file.name}`} checked={row.include} disabled={blocked} onChange={(include) => edit(row.id, { include })} className="mt-3" /> : <span className="w-[18px]" aria-hidden="true" />}<span aria-hidden="true" className="w-10 h-14 bg-field border border-line rounded"><Files className="m-2 w-6" /></span><div className="flex-1 min-w-[220px] flex flex-col gap-0.5"><p className="font-medium truncate max-w-[440px]" title={row.file.name}>{row.file.name}</p><p className="text-xs text-muted">{/\.pdf$/i.test(row.file.name) ? "PDF" : "Photo"} · {(row.file.size / 1024 / 1024).toFixed(1)} MB{read ? ` · ${plural(read.lines.length, "item")}` : ""}</p>{row.phase === "reading" ? <BusyText className="text-file font-medium text-sm mt-1">Reading…</BusyText> : <span className="mt-1 flex flex-wrap gap-1.5"><Badge tone={status === "Ready" || status === "Imported" ? "sale" : status === "Already entered" ? "amber" : problems.length || row.fail ? "neg" : "muted"}>{status}</Badge>{read?.source === "e-invoice" ? <Badge tone="file" title={`An IRN was read (${read.irn}…). Check the details against the bill before importing.`}>From the e-invoice</Badge> : null}</span>}</div>{read ? <div className="flex flex-wrap items-center gap-2">{row.kind === "interfirm" ? <Badge tone="file" icon={ArrowRightLeft}>Sale + purchase between your firms</Badge> : <Segmented label={`Sale or purchase: ${row.file.name}`} size="sm" value={row.kind} options={[{ value: "purchase", label: "Purchase", disabled: session.busy || row.phase !== "read" }, { value: "sale", label: "Sale", disabled: session.busy || row.phase !== "read" }]} onChange={(kind) => edit(row.id, { kind, partyId: null, partyResolved: false, buyerAck: false })} />}<Select aria-label={`Firm for ${row.file.name}`} className="w-[190px]" value={row.firmId ?? ""} placeholder="Choose the firm" disabled={blocked || row.phase !== "read"} onChange={(e) => edit(row.id, { firmId: Number(e.target.value) || null, buyerAck: false })} options={firms.map((f) => ({ value: String(f.id), label: f.name }))} /></div> : null}<div className="flex flex-wrap items-center gap-2 ml-auto">{row.phase === "read" ? <Button size="sm" icon={Pencil} disabled={blocked} onClick={() => setEditing(row.id)}>Check and edit</Button> : null}{row.phase === "failed" ? <Button size="sm" variant="primary" icon={RefreshCw} disabled={blocked} onClick={() => retry([row.id])}>Try again</Button> : null}{row.purchaseId ? <ButtonLink size="sm" to={`/purchases/${row.purchaseId}`}>Open purchase</ButtonLink> : null}{row.saleId ? <ButtonLink size="sm" to={`/sales/${row.saleId}`}>Open sale</ButtonLink> : null}{!pending && row.phase !== "imported" ? <Button size="sm" variant="ghost" icon={X} disabled={blocked} onClick={() => remove(row)}>Remove</Button> : null}</div></div>{pending ? <div className="pl-[78px] flex flex-col gap-1.5" aria-hidden="true"><Skeleton w={260} h={12} /><Skeleton w={180} h={12} /></div> : row.phase === "failed" ? <p className="pl-[78px] text-sm text-neg" role="alert">{row.fail}</p> : read ? <><div className="pl-[78px] grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] gap-x-5 gap-y-1 text-sm"><span className="min-w-0"><span className="caps block">{row.kind === "sale" ? "Customer" : row.kind === "interfirm" ? "Between" : "Supplier"}</span><span className="block font-medium truncate">{row.kind === "interfirm" ? `${firms.find((f) => f.id === row.firmId)?.name} → ${firms.find((f) => f.id === row.buyerFirmId)?.name}` : party?.name || "Not read"}</span><span className="block text-xs text-muted tnum">{party?.gst_number || "No GSTIN read"}</span></span><span><span className="caps block">Bill no. · date</span><span className="block tnum">{read.invoice_number}</span><span className="block text-xs text-muted">{read.invoice_date ? date(read.invoice_date) : "Not read"}</span></span><span className="min-w-0"><span className="caps block">Items</span><span className="block truncate">{read.lines.map((l) => l.product_name).join(", ")}</span><span className="block text-xs text-muted">{read.lines.some((l) => l.gst_percent === null) ? "GST rate to pick" : [...new Set(read.lines.map((l) => `${l.gst_percent}%`))].join(", ")}</span></span><span className="text-right"><span className="caps block">Total</span>{row.firmId ? <Money value={totalOf(row)} strong /> : <span className="text-muted">Pick the firm</span>}</span></div>{row.phase === "read" ? <ul className="pl-[78px] flex flex-col gap-2 text-sm">{row.duplicate ? <li className="text-amber">Already entered: {row.duplicate.invoice_number}. It will be skipped. <Link className="link" to={`/${row.kind === "sale" ? "sales" : "purchases"}/${row.duplicate.id}`}>Open it</Link></li> : null}{problems.map((p, i) => <li key={i} className="text-neg">{p}</li>)}{read.notes.map((p, i) => <li key={`note-${i}`} className="text-fg2">{p}</li>)}{row.kind === "purchase" && row.firmId && read.buyer.gst_number && read.buyer.gst_number !== firms.find((f) => f.id === row.firmId)?.gstin ? <li>{row.buyerAck ? <p className="text-fg2">Recorded anyway, as you chose.</p> : null}<Checkbox label="Record anyway" checked={row.buyerAck} disabled={blocked} onChange={(buyerAck) => edit(row.id, { buyerAck })} /></li> : null}</ul> : null}</> : null}<PhotoCredit row={row} firms={firms} /></section>; })}</div>
      <div className="sticky bottom-4 z-nav card shadow-pop px-5 py-4 flex flex-wrap items-center gap-4"><p className="flex-1 min-w-[240px] text-fg2">{chosen.length ? <>{label} ticked{nP ? <> · purchases <Money value={chosen.filter((r) => r.kind !== "sale").reduce((n, r) => n + totalOf(r), 0)} bump /></> : null}{nS ? <> · sales <Money value={chosen.filter((r) => r.kind !== "purchase").reduce((n, r) => n + totalOf(r), 0)} bump /></> : null}</> : busyReading ? "Still reading. Rows turn Ready as they're read." : "Fix or tick at least one row to import."}</p><Button icon={Plus} disabled={blocked} onClick={() => more.current?.click()}>Add more</Button><input ref={more} type="file" multiple accept={CAPTURE_ACCEPT} hidden aria-label="Add more bill photos or PDFs" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} /><Button variant="primary" size="lg" disabled={!chosen.length || blocked} loading={blocked} onClick={() => void run()}>{prechecking || automaticPending ? "Checking…" : session.busy ? "Importing…" : chosen.length ? `Import ${label}` : "Nothing ready yet"}</Button></div>
    </>}
    {editingRow ? <Dialog open onClose={() => setEditing(null)} title={`Check ${editingRow.kind === "purchase" ? "purchase bill" : editingRow.kind === "sale" ? "sales bill" : "bill between your firms"} · ${editingRow.file.name}`} description="The photo on the left, what was read on the right. Changes apply to this row only; nothing is saved until you import." size="xl"><div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-5 items-start"><div className="sticky top-0"><PhotoViewer pages={[{ page: 1, kind: isPdf(editingRow.file) ? "pdf" : "photo", url: editingRow.url, preview_url: null, size: editingRow.file.size }]} label={`Photo ${editingRow.file.name}`} /></div><div className="flex flex-col gap-4 min-w-0">{editingRow.read ? <ReadingChecks read={editingRow.read} confirmed={{}} /> : null}<Editor row={editingRow} onClose={() => setEditing(null)} onApply={(next) => { edit(editingRow.id, next); setEditing(null); }} /></div></div></Dialog> : null}
  </Page>;
}

function PhotoCredit({ row, firms }: { row: PhotoRow; firms: Firm[] }) {
  const credit = row.credit;
  if (!credit || row.kind === "sale") return null;
  const firm = firms.find((f) => f.id === (row.kind === "interfirm" ? row.buyerFirmId : row.firmId));
  const month = credit.month ? monthLabel(credit.month, { long: true }) : null;
  return <div role="group" aria-label={`Input tax credit for ${row.file.name}`} className="ml-[78px] rounded-ctl border border-file-line bg-file-tint px-4 py-3 flex flex-col gap-1">
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><span className="flex flex-col"><span className="caps">Input tax credit</span><span className="text-sm text-fg2">{credit.state === "outside" ? "This bill is before April 2025. Its credit is in the opening balance or lapsed." : !credit.eligible ? "Not claimed on this bill" : credit.lapsed ? `No credit${credit.late ? " (entered late)" : ""}` : `In ${firm?.short ?? "the firm"}'s GSTR-3B for ${month}${credit.late ? " (entered late)" : ""}`}</span></span><Money value={toPaise(credit.claimed) ?? 0} size="lg" tone="file" /></div>
    {month ? <p className="text-sm text-fg2">{month} · {credit.state === "filed" ? "GSTR-3B filed" : "not filed yet"} · net credit, 4(C){credit.filed_on ? <span className="block">Filed on {date(credit.filed_on)}</span> : null}</p> : null}
    {credit.lapsed ? <p className="text-sm text-fg2">Its credit had to be claimed in a return filed by {date(credit.deadline)}, so this bill carries no credit now. It still counts in purchases.</p> : null}
  </div>;
}

function MatchCustomer({ row, onMatch }: { row: PhotoRow; onMatch(id: number | null): void }) {
  const party = row.read!.buyer, term = party.gst_number || party.name;
  const query = useCustomerSearch(term, { figures: false });
  useEffect(() => {
    if (term.trim().length < 2) { onMatch(null); return; }
    if (!query.isSuccess) return;
    const found = query.data.find((c) => c.type !== "walkin" && (party.gst_number ? c.gst_number === party.gst_number : c.name.trim().toLocaleLowerCase() === party.name.trim().toLocaleLowerCase()));
    onMatch(found?.id ?? null);
  }, [term, query.isSuccess, query.data, party.gst_number, party.name, onMatch]);
  return query.isError ? <QueryView query={query} what="customer">{() => null}</QueryView> : null;
}
