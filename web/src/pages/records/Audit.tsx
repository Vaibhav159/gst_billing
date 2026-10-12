import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowRight, Check, ChevronDown, Download, History, Lock, RotateCcw, Search, Undo2 } from "lucide-react";
import { useAuditExport, useAuditLog, useAuditAction, useAuditRestoreEntry, type AuditEntry, type AuditFilters, type AuditRecord } from "@/core/api/audit";
import { AuditActionConfirm } from "./AuditActionConfirm";
import { problemOf, saveFailure } from "@/core/api/errors";
import { useAuth } from "@/core/auth/AuthProvider";
import { dateLong, plural, todayIST } from "@/core/format";
import { dayOf, timeOf } from "@/core/sales/words";
import { useDebounced } from "@/core/useDebounced";
import { useView } from "@/core/view";
import { Avatar, Badge, Button, ButtonLink, Card, Chip, EmptyState, FailNote, Page, QueryView, SearchInput, Select, cn } from "@/core/ui";

const KINDS = [
  { value: "all", label: "All changes" }, { value: "sales", label: "Sales bills" }, { value: "purchases", label: "Purchases" },
  { value: "records", label: "Customers, products, firms" }, { value: "filing", label: "GST filing" },
  { value: "admin", label: "People and settings" }, { value: "backup", label: "Backups and downloads" },
];
const ACTIONS = [
  { value: "all", label: "Every action" }, { value: "add", label: "Added or made" }, { value: "change", label: "Changed" },
  { value: "delete", label: "Deleted, cancelled or removed" }, { value: "restore", label: "Restored" }, { value: "merge", label: "Merged" },
  { value: "send", label: "Sent or downloaded" }, { value: "file", label: "Filed or unlocked" },
];
export default function Audit() {
  const { can, whyNot } = useAuth();
  if (!can("audit.view")) return <Page icon={History} title="Audit log" back="/more" context="Who changed what, and when" phoneSubtitle="Who changed what">
    <EmptyState icon={Lock} title="The audit log is for the owner and the accountant" actions={<ButtonLink to="/">Back to the start</ButtonLink>}>
      {whyNot("audit.view", "see the audit log")} Your own changes are recorded in it too, like everyone's.
    </EmptyState>
  </Page>;
  return <Log />;
}
function Changes({ entry }: { entry: AuditEntry }) {
  if (!entry.changes.length) return null;
  return <ul className="mt-1.5 flex flex-col gap-0.5">{entry.changes.map((change) => <li key={change.key} className="text-sm flex flex-wrap items-baseline gap-x-1.5">
    <span className="text-muted">{change.field}:</span><span className="text-fg2 line-through decoration-muted/60 break-words">{change.from}</span>
    <ArrowRight size={12} className="text-muted self-center shrink-0" aria-label="changed to" /><span className="text-fg break-words">{change.to}</span>
  </li>)}</ul>;
}
function sentence(entry: AuditEntry) {
  const { words } = entry;
  return <>{words.text ? <>{words.text} </> : null}{words.target ? entry.link ? <Link to={entry.link} className="font-medium text-brand hover:underline tnum">{words.target}</Link> : <span className="font-medium tnum">{words.target}</span> : null}{words.after ? <> {words.after}</> : null}</>;
}
function Log() {
  const { isPhone } = useView();
  const { can, whyNot } = useAuth();
  const [search, setSearch] = useSearchParams();
  const q = search.get("q") ?? "";
  const term = useDebounced(q);
  const kind = search.get("kind") ?? "all";
  const by = search.get("by") ?? "all";
  const group = search.get("group") ?? "all";
  const filters: AuditFilters = { kind, by, group, q: term,
    ...(search.get("entity") ? { entity: search.get("entity")! } : {}),
    ...(search.get("entity_id") ? { entity_id: Number(search.get("entity_id")) } : {}),
    ...(search.get("start_date") ? { start_date: search.get("start_date")! } : {}),
    ...(search.get("end_date") ? { end_date: search.get("end_date")! } : {}),
  };
  const query = useAuditLog(filters);
  const download = useAuditExport();
  const [exportError, setExportError] = useState<string | null>(null);
  const mutation = useAuditAction();
  const [pending, setPending] = useState<{ entry: AuditEntry; record?: AuditRecord } | null>(null);
  const [actionError, setActionError] = useState<{ id: number; error: unknown } | null>(null);
  const restoreText = search.get("restore");
  const restoreId = Number(restoreText);
  const restore = useAuditRestoreEntry(restoreId, Boolean(restoreText) && can("audit.undo"));
  const linked = useRef<string | null>(null);
  useEffect(() => {
    if (!restoreText || !restore.data || linked.current === restoreText) return;
    linked.current = restoreText;
    if (!restore.data.entry.can?.disabled) setPending(restore.data);
  }, [restoreText, restore.data]);
  async function run(entry: AuditEntry) {
    if (!can("audit.undo") || !entry.can || entry.can.disabled || mutation.isPending) return;
    setActionError(null);
    try { await mutation.mutateAsync({ id: entry.id, kind: entry.can.kind }); setPending(null); }
    catch (error) { setActionError({ id: entry.id, error }); }
  }
  function request(entry: AuditEntry) {
    setActionError(null);
    if (entry.can?.kind === "restore" && entry.kind === "records") void run(entry);
    else setPending({ entry });
  }
  const first = query.data?.pages[0];
  const filtered = kind !== "all" || by !== "all" || group !== "all" || Boolean(q.trim()) || Boolean(filters.entity || filters.entity_id || filters.start_date || filters.end_date);
  function pick(key: string, value: string) { setSearch((old) => { const next = new URLSearchParams(old); if (value && value !== "all") next.set(key, value); else next.delete(key); return next; }, { replace: true }); }
  function clear() { setSearch({}, { replace: true }); }
  async function exportLog() {
    setExportError(null);
    try { await download.mutateAsync({ ...filters, q }); } catch (error) { setExportError(problemOf(error).message); }
  }
  const person = <Select aria-label="Person" value={by} onChange={(e) => pick("by", e.target.value)} className={isPhone ? "" : "w-[200px]"} options={[{ value: "all", label: "Everyone" }, ...(first?.people ?? []).map((p) => ({ value: p.id === null ? "none" : String(p.id), label: p.name }))]} />;
  const action = <Select aria-label="Action" value={group} onChange={(e) => pick("group", e.target.value)} className={isPhone ? "" : "w-[260px]"} options={ACTIONS} />;
  const searchBox = <SearchInput value={q} onChange={(value) => pick("q", value)} placeholder="Bill number, name or change" label={isPhone ? "Search the audit log" : "Search the audit log (press /)"} className={isPhone ? "" : "w-[320px] max-w-full"} data-page-search />;
  const exportDisabled = !first || download.isPending || q !== term;
  return <Page icon={History} title="Audit log" back="/more"
    context={first ? `${plural(first.total ?? first.count, "change")} recorded, all financial years · newest first · nothing here can be edited` : "Who changed what, and when · nothing here can be edited"}
    phoneSubtitle={first ? `${plural(first.count, "change")}${filtered ? " · filtered" : " · newest first"}` : "Who changed what, and when"}
    actions={<Button icon={Download} onClick={() => void exportLog()} disabled={exportDisabled} loading={download.isPending}>Export {filtered && first ? plural(first.count, "entry", "entries") : "the log"}</Button>}
    phoneActions={<Button size="sm" variant="ghost" icon={Download} onClick={() => void exportLog()} disabled={exportDisabled} loading={download.isPending}>Export</Button>}>
    {!can("audit.undo") ? <p className="text-sm text-muted -mt-2">{whyNot("audit.undo", "undo, revert or restore changes")}</p> : null}
    {isPhone ? <div className="flex flex-col gap-3">{searchBox}<div className="grid grid-cols-2 gap-2">{person}<Select aria-label="Kind of change" value={kind} onChange={(e) => pick("kind", e.target.value)} options={KINDS.map((k) => ({ ...k, label: first?.counts ? `${k.label} · ${first.counts[k.value] ?? 0}` : k.label }))} /></div>{action}</div>
      : <Card pad={false}><div className="flex flex-col gap-3 px-5 py-4"><div className="flex flex-wrap items-center gap-3">{searchBox}{person}{action}</div><div className="flex flex-wrap gap-2" role="group" aria-label="Kind of change">{KINDS.map((k) => <Chip key={k.value} selected={kind === k.value} onClick={() => pick("kind", k.value)} count={first?.counts?.[k.value]}>{k.label}</Chip>)}</div></div></Card>}
    {!isPhone && filtered && first ? <p className="text-sm text-fg2 -mt-2">Showing {plural(first.count, "change")} of {first.total ?? first.count} · <button type="button" className="link" onClick={clear}>Show every change</button></p> : null}
    <FailNote error={exportError ? { title: "Not downloaded", body: exportError } : null} onRetry={() => void exportLog()} busy={download.isPending} />
    {restoreText && can("audit.undo") ? !Number.isSafeInteger(restoreId) || restoreId <= 0 ? <p role="alert">That restore link isn't valid. Open the deleted bill from the log.</p>
      : <QueryView query={restore} what="the deleted bill">{(linkedEntry) => linkedEntry?.entry.can?.disabled ? <p role="alert" className="text-sm text-muted">{linkedEntry.entry.can.disabled}</p> : linkedEntry ? null : <p role="alert">That deleted bill isn't in the bin any more.</p>}</QueryView> : null}
    <QueryView query={query} what="the audit log">{(data) => {
      const seen = new Set<number>();
      const entries = data.pages.flatMap((p) => p.results).filter(entry => { if (seen.has(entry.id)) return false; seen.add(entry.id); return true; });
      const groups = new Map<string, AuditEntry[]>();
      for (const entry of entries) { const day = dayOf(entry.at); groups.set(day, [...(groups.get(day) ?? []), entry]); }
      return entries.length ? <Card pad={false}>{[...groups].map(([day, rows], i) => <section key={day} aria-labelledby={`day-${day}`} className={cn(i > 0 && "border-t border-line")}>
        <h2 id={`day-${day}`} className={cn("flex flex-wrap items-baseline gap-x-2 bg-raised/40", isPhone ? "px-4 py-2.5" : "px-5 py-2.5", i === 0 && "rounded-t-card")}>
          <span className="font-semibold">{day === todayIST() ? "Today · " : day === todayIST(new Date(Date.now() - 86400000)) ? "Yesterday · " : ""}{dateLong(day)}</span><span className="text-sm text-muted">· {plural(rows.length, "change")}{i === groups.size - 1 && query.hasNextPage ? " so far" : ""}</span>
        </h2><ul>{rows.map((entry) => {
          const detail = [entry.details, entry.note].filter(Boolean).join(" · ");
          const result = entry.result ? <Badge tone="sale" icon={Check}>{({ undone: "Undone", reverted: "Reverted", restored: "Restored" })[entry.result]}</Badge>
            : !can("audit.undo") ? entry.can?.kind === "restore" && !entry.can.disabled ? <span className="text-sm text-muted">The owner can restore this</span> : null
              : entry.can ? <Button size="sm" variant={entry.can.kind === "restore" ? "secondary" : "ghost"} icon={entry.can.kind === "restore" ? RotateCcw : Undo2} full={isPhone}
                disabled={Boolean(entry.can.disabled) || mutation.isPending} loading={mutation.isPending && mutation.variables?.id === entry.id && !pending}
                title={entry.can.disabled || entry.can.hint} aria-label={`${entry.can.label.replace("…", "")} ${entry.words.target}`} onClick={() => request(entry)}>{entry.can.label}</Button> : null;
          const body = <><span className="block">{sentence(entry)}</span>{detail && !entry.changes.length ? <span className="block text-sm text-muted mt-0.5">{detail}</span> : null}<Changes entry={entry} />{!pending && actionError?.id === entry.id && !entry.can?.disabled ? <FailNote error={saveFailure(problemOf(actionError.error))} onRetry={problemOf(actionError.error).kind === "conflict" ? undefined : () => void run(entry)} busy={mutation.isPending} /> : null}{entry.can?.disabled ? <p className="text-sm text-muted mt-1">{entry.can.disabled}</p> : null}</>;
          return isPhone ? <li key={entry.id} className="px-4 py-3 border-t border-rule flex flex-col gap-1"><div className="flex items-baseline justify-between gap-3"><span className="font-medium truncate">{entry.by?.name ?? "Someone no longer here"}</span><span className="text-xs text-muted tnum shrink-0">{timeOf(entry.at)}</span></div><div className="text-fg2">{body}</div>{result ? <div className="mt-1">{result}</div> : null}</li>
            : <li key={entry.id} className="px-5 py-3 border-t border-rule"><div className="grid grid-cols-[56px_210px_minmax(0,1fr)_auto] items-start gap-4"><span className="text-sm text-muted tnum pt-0.5">{timeOf(entry.at)}</span><span className="flex items-center gap-2 min-w-0"><Avatar name={entry.by?.name ?? "?"} size={26} tone="muted" /><span className="truncate">{entry.by?.name ?? "Someone no longer here"}</span></span><div className="min-w-0">{body}</div><span className="flex justify-end min-w-[96px]">{result}</span></div></li>;
        })}</ul>
      </section>)}{query.hasNextPage ? <div className={cn("flex items-center gap-3 border-t border-line", isPhone ? "flex-col px-4 py-3" : "justify-between px-5 py-3")}><span className="text-sm text-muted tnum">Showing {entries.length} of {plural(data.pages[0].count, "change")}</span><Button icon={ChevronDown} onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage} full={isPhone}>Load {Math.min(30, data.pages[0].count - entries.length)} more</Button></div> : data.pages[0].count > 30 ? <p className="px-5 py-3 text-sm text-muted border-t border-line">That's all {plural(data.pages[0].count, "change")}.</p> : null}</Card>
        : <Card><EmptyState icon={Search} title="No changes match" actions={filtered ? <Button onClick={clear}>Show every change</Button> : null}>{filtered ? "Try Everyone, Every action and All changes, or a shorter search like a bill number." : "Changes show here as soon as someone makes one."}</EmptyState></Card>;
    }}</QueryView>
    {pending ? <AuditActionConfirm entry={pending.entry} record={pending.record} busy={mutation.isPending} error={actionError?.id === pending.entry.id ? actionError.error : null}
      onClose={() => { setPending(null); setActionError(null); }} onConfirm={() => void run(pending.entry)} /> : null}
  </Page>;
}
