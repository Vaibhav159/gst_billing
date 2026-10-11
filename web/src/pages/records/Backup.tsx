import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DatabaseBackup, Download, FileSpreadsheet, History, RotateCcw } from "lucide-react";
import { useAuth } from "@/core/auth/AuthProvider";
import { downloadBackupFile, useBackupSummary, type BackupSummary, type ExportKind } from "@/core/api/backup";
import { problemOf } from "@/core/api/errors";
import { saveFile } from "@/core/print/files";
import { date, plural, rangeLabel, todayIST } from "@/core/format";
import { dayOf, timeOf } from "@/core/sales/words";
import { useFirms, useScope } from "@/core/scope";
import { useView } from "@/core/view";
import { Avatar, Banner, Button, ButtonLink, Card, Field, Input, Page, QueryView, Select, SuccessMark, cn } from "@/core/ui";

import Restore from "./Restore";

const KINDS = [["firms", "Firms"], ["customers", "Customers"], ["suppliers", "Suppliers"], ["products", "Products"], ["sales", "Sales bills"], ["purchases", "Purchase bills"]] as const;
const when = (at: string | null) => at ? `${date(dayOf(at))}, ${timeOf(at)}` : "None yet";
export default function Backup() {
  const query = useBackupSummary();
  const { isPhone } = useView();
  return <Page icon={DatabaseBackup} title="Backup and restore" back="/more" context="Everything on file, all years and all firms" phoneSubtitle="All years, all firms">
    <QueryView query={query} what="the backup counts">{(summary) => <>
      <FullBackup summary={summary} />
      <RecentBackups summary={summary} />
    </>}</QueryView>
    <div className={cn("grid gap-5 items-start", isPhone ? "grid-cols-1 gap-4" : "grid-cols-2")}>
      <QueryView query={query} what="the export counts">{(summary) => <Exports summary={summary} />}</QueryView>
      <Restore />
    </div>
    <Card><p className="text-sm text-fg2">Keep your own copy somewhere else too: download the full backup every week and save it to a pen drive or Google Drive.</p></Card>
  </Page>;
}
function FullBackup({ summary }: { summary: BackupSummary }) {
  const { isPhone } = useView();
  const { can, whyNot } = useAuth();
  const cache = useQueryClient();
  const [loaded, setLoaded] = useState(0);
  const fallback = `gst-backup-${todayIST()}.json`;
  const download = useMutation({
    mutationFn: () => downloadBackupFile("backup/full/", {}, fallback, setLoaded),
    onSuccess: (file) => { saveFile(file.blob, file.name); void cache.invalidateQueries({ queryKey: ["backup", "summary"] }); void cache.invalidateQueries({ queryKey: ["audit"] }); void cache.invalidateQueries({ queryKey: ["setup"] }); },
  });
  const n = summary.counts;
  const body = <div className="flex flex-col gap-4 min-w-0">
    <div><h2 className="text-md font-semibold">Full backup</h2><p className="text-fg2 mt-0.5">One file with everything on file, every year and every firm. Use it to restore, or keep it as your own copy.</p></div>
    <div className="border-y border-rule py-4"><dl className={cn("grid", isPhone ? "grid-cols-3 gap-y-4" : "grid-cols-6 divide-x divide-rule")}>
      {KINDS.map(([key, label], i) => <div key={key} className={cn("flex flex-col-reverse gap-0.5 min-w-0", !isPhone && (i ? "px-4" : "pr-4"))}>
        <dt className="text-sm text-muted">{label}{key === "sales" && n.cancelled ? <span className="block text-xs">{n.cancelled} cancelled not counted</span> : null}</dt>
        <dd className={cn("text-2xl font-semibold tnum", key === "sales" && "text-sale", key === "purchases" && "text-amber")}>{n[key]}</dd>
      </div>)}
    </dl></div>
    <div className="flex flex-col gap-1 text-sm text-fg2">
      {summary.years.map((year) => <p key={year.fy}>FY {year.fy}: {plural(year.sales, "sales bill")}{year.cancelled ? ` (${year.cancelled} cancelled not counted)` : ""} and {plural(year.purchases, "purchase bill")}</p>)}
      <p>Also in the file: {plural(n.people, "person", "people")} and their roles, settings, filing records, {plural(n.audit, "audit entry", "audit entries")} and {plural(n.bin, "deleted bill")} in the bin{n.cancelled ? ` and ${plural(n.cancelled, "cancelled bill")}, kept for GSTR-1` : ""}.</p>
      <p className="text-muted">Not in the file: photos of captured bills, signature pictures, passwords and PDFs. The audit log excludes snapshots. The app makes PDFs again from the bills.</p>
    </div>
  </div>;
  const panel = <div className="flex flex-col gap-3">
    {download.isSuccess ? <div className="flex flex-col items-center text-center gap-2 py-2 anim-rise" role="status"><SuccessMark size={64} /><p className="font-semibold mt-1">{download.data.name} is ready</p><Button variant="link" icon={RotateCcw} onClick={() => download.reset()}>Make another</Button></div>
      : download.isPending ? <div role="status" aria-live="polite"><p className="font-semibold">Packing everything on file…</p><p className="text-sm text-muted">{loaded ? `${Math.ceil(loaded / 1024)} KB received` : "Waiting for the server…"}</p></div>
        : <><Button variant="primary" size="lg" icon={Download} full disabled={!can("backup.download")} title={whyNot("backup.download", "download a full backup") || undefined} onClick={() => { setLoaded(0); download.mutate(); }}>Download full backup</Button><p className="text-sm text-muted text-center tnum">{fallback} · JSON · about {summary.estimated_size}</p></>}
    <p className="text-sm text-muted text-center">Last full backup: {when(summary.last_backup_at)}</p>
    {!can("backup.download") ? <p className="text-sm text-muted">{whyNot("backup.download", "download a full backup")}</p> : null}
    {download.isError ? <Banner tone="neg" title="Couldn't download the backup">{problemOf(download.error).message}</Banner> : null}
  </div>;
  return <Card pad={false}>{isPhone ? <div className="p-4 flex flex-col gap-4">{body}{panel}</div> : <div className="grid grid-cols-[minmax(0,1fr)_340px]"><div className="p-5">{body}</div><div className="p-6 border-l border-rule flex"><div className="w-full self-center">{panel}</div></div></div>}</Card>;
}
function RecentBackups({ summary }: { summary: BackupSummary }) {
  const { can } = useAuth();
  const { isPhone } = useView();
  if (!can("audit.view") || !summary.recent.length) return null;
  return <Card title="Recent backups" subtitle="The last five full backups, newest first" pad={false} actions={<ButtonLink size="sm" variant="ghost" icon={History} to="/audit?kind=backup">All in the Audit log</ButtonLink>}>
    <ul className="mt-2">{summary.recent.map((entry) => <li key={entry.audit_id} className={cn("flex items-center gap-3 border-t border-rule", isPhone ? "px-4 py-3" : "px-5 py-2.5")}>
      <Avatar name={entry.by?.name ?? "?"} size={30} tone="muted" /><span className="flex-1 min-w-0"><span className="block font-medium">{when(entry.at)}</span><span className="block text-sm text-muted break-words">{entry.by?.name ?? "Someone no longer here"} · <span className="tnum break-all">{entry.file}</span></span></span><span className="text-sm text-fg2 tnum shrink-0">{entry.size}</span>
    </li>)}</ul>
  </Card>;
}
function Exports({ summary }: { summary: BackupSummary }) {
  const { firmId, fy } = useScope();
  // Wait for scope before mounting a chooser whose own selections can diverge from the header.
  return firmId === null ? <p role="status">Loading the export scope…</p> : <ExportChoices key={`${firmId}:${fy}`} summary={summary} initialFirm={String(firmId)} initialYear={fy} />;
}
function ExportChoices({ summary, initialFirm, initialYear }: { summary: BackupSummary; initialFirm: string; initialYear: string }) {
  const { firms, error: firmsError, problem: firmsProblem } = useFirms();
  const { can, whyNot } = useAuth();
  const { isPhone } = useView();
  const [firm, setFirm] = useState(initialFirm);
  const [year, setYear] = useState(initialYear);
  const [from, setFrom] = useState(`${todayIST().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayIST());
  const custom = year === "dates";
  const badDates = custom && (!from || !to || from > to);
  const period = custom ? badDates ? "Dates to fix" : rangeLabel(from, to) : year === "all" ? "All years" : `FY ${year}`;
  const firmName = firm === "all" ? "All firms" : firms.find((f) => String(f.id) === firm)?.name ?? "Loading firm…";
  const years = [...new Set([initialYear, ...summary.years.map((y) => y.fy)])].sort().reverse();
  const exportFile = useMutation({ mutationFn: async ({ kind, format }: { kind: ExportKind; format: "xlsx" | "csv" }) => {
    const params: Record<string, string | number> = { format };
    if (kind === "sales" || kind === "purchases") {
      if (badDates) throw new Error("Fix the dates first.");
      if (firm !== "all") params.business_id = Number(firm);
      if (custom) { params.start_date = from; params.end_date = to; } else params.fy = year;
    }
    return downloadBackupFile(`exports/${kind}/`, params, `${kind}.${format}`);
  }, onSuccess: (file) => saveFile(file.blob, file.name) });
  const rows: { key: ExportKind; title: string; sub: string; bills?: boolean }[] = [
    { key: "sales", title: "Sales bills", sub: `${period} · ${firmName} · Cancelled bills are listed and marked, not added up`, bills: true },
    { key: "purchases", title: "Purchase bills", sub: `${period} · ${firmName}`, bills: true },
    { key: "customers", title: "Customers", sub: `Not split by year or firm · ${plural(summary.counts.customers, "customer")}` },
    { key: "products", title: "Products", sub: `HSN, GST rate, unit and usual rate · ${plural(summary.counts.products, "product")}` },
    { key: "firms", title: "Firms", sub: `GSTIN, address and bank details · ${plural(summary.counts.firms, "firm")}` },
  ];
  return <Card title="Exports for a spreadsheet or your CA" subtitle="These follow the period and firm picked here. The full backup above doesn't.">
    <div className="flex flex-col gap-4">
      <div className={cn("grid gap-3", isPhone ? "grid-cols-2" : "grid-cols-[190px_200px]")}>
        <Field label="Period" htmlFor="ex-year"><Select id="ex-year" value={year} onChange={(e) => setYear(e.target.value)} options={[...years.map((y) => ({ value: y, label: `FY ${y}` })), { value: "all", label: "All years" }, { value: "dates", label: "Choose dates" }]} /></Field>
        <Field label="Firm" htmlFor="ex-firm"><Select id="ex-firm" value={firm} onChange={(e) => setFirm(e.target.value)} options={[{ value: "all", label: "All firms" }, ...firms.map((f) => ({ value: String(f.id), label: f.name }))]} /></Field>
      </div>
      {custom ? <div className="grid gap-3 grid-cols-2">
        <Field label="From" htmlFor="ex-from" error={!from ? "Pick a start date." : badDates && to ? "The start is after the end." : ""}><Input id="ex-from" type="date" max={todayIST()} value={from} onChange={(e) => setFrom(e.target.value)} invalid={badDates} /></Field>
        <Field label="To" htmlFor="ex-to" error={!to ? "Pick an end date." : ""}><Input id="ex-to" type="date" max={todayIST()} value={to} onChange={(e) => setTo(e.target.value)} invalid={!to} /></Field>
      </div> : null}
      {firmsError ? <Banner tone="neg" title="Couldn't load firms">{firmsProblem?.message}</Banner> : null}
      <ul className="flex flex-col">{rows.map((row) => <li key={row.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 border-t border-rule">
        <span className="min-w-0 flex-1"><span className="block font-medium">{row.title}</span><span className="block text-sm text-muted tnum">{row.sub}</span></span><span className="flex gap-2">{(row.bills ? ["xlsx", "csv"] as const : ["csv"] as const).map((format) => <Button key={format} size="sm" icon={format === "xlsx" ? FileSpreadsheet : Download} disabled={!can("reports.export") || exportFile.isPending || Boolean(row.bills && (badDates || firmsError))} title={whyNot("reports.export", "download exports") || undefined} aria-label={`${row.title} as ${format === "xlsx" ? "Excel" : "CSV"}`} onClick={() => exportFile.mutate({ kind: row.key, format })}>{format === "xlsx" ? "Excel" : "CSV"}</Button>)}</span>
      </li>)}</ul>
      {exportFile.isPending ? <p role="status">Making the export…</p> : null}
      {exportFile.isError ? <Banner tone="neg" title="Couldn't download the export">{problemOf(exportFile.error).message}</Banner> : null}
    </div>
  </Card>;
}
