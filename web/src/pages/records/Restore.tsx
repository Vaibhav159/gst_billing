import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, FileJson, Lock, RotateCcw, SkipForward, Upload } from "lucide-react";
import { applyRestore, previewRestore, type RestoreKind, type RestorePlan, type RestorePreview } from "@/core/api/backup";
import { invalidateRecords } from "@/core/api/audit";
import { problemOf, saveFailure, type ApiProblem } from "@/core/api/errors";
import { useAuth } from "@/core/auth/AuthProvider";
import { date, plural } from "@/core/format";
import { dayOf, timeOf } from "@/core/sales/words";
import { useView } from "@/core/view";
import { Badge, Banner, Button, ButtonLink, Card, ConfirmDialog, SuccessMark, Table, Td, Th, Tr, cn } from "@/core/ui";

const KIND_ROWS: readonly [RestoreKind, string][] = [["firms", "Firms"], ["customers", "Customers"], ["products", "Products"], ["bills", "Sales bills"], ["purchases", "Purchase bills"]];
function PlanTable({ plan }: { plan: RestorePlan }) {
  return <Table label="What this restore would do"><thead><tr><Th>Records</Th><Th align="right">Adds</Th><Th align="right">On file, skipped</Th><Th align="right">Can't add</Th></tr></thead><tbody>
    {KIND_ROWS.map(([key, label]) => { const group = plan[key]; return group.add_count || group.skip_count || group.fail_count ? <Tr key={key}><Td>{label}</Td><Td align="right" className={group.add_count ? "text-brand font-semibold" : "text-muted"}>{group.add_count}</Td><Td align="right" className="text-fg2">{group.skip_count}</Td><Td align="right" className={group.fail_count ? "text-neg font-semibold" : "text-muted"}>{group.fail_count}</Td></Tr> : null; })}
  </tbody></Table>;
}
function PlanDetails({ plan, done = false }: { plan: RestorePlan; done?: boolean }) {
  const lists = [["add", done ? "Added" : "Adds"], ["fail", done ? "Couldn't add, and why" : "Can't add, and why"], ["skip", "On file, skipped"]] as const;
  return <div className="flex flex-col gap-3">{KIND_ROWS.flatMap(([kind, kindLabel]) => lists.map(([key, label]) => {
    const group = plan[kind]; const count = group[`${key}_count`]; const rows = group[key].slice(0, 200);
    return count ? <details key={`${kind}:${key}`} className="rounded-ctl border border-rule px-3 py-2" open={key === "fail"}>
      <summary className={cn("cursor-pointer text-sm font-medium", key === "fail" ? "text-neg" : "text-fg2")}>{kindLabel} · {label} · {count}</summary>
      <ul className="flex flex-col gap-1 max-h-[240px] overflow-y-auto" tabIndex={0} aria-label={`${kindLabel}: ${label}`}>{rows.map((row, i) => <li key={i} className="text-sm rounded-ctl bg-raised px-3 py-2"><span className="font-medium text-fg">{row.name}</span>{row.detail ? <span className="text-fg2"> · {row.detail}</span> : null}{row.why ? <span className="text-fg2"> · {row.why}</span> : null}</li>)}</ul>
      {count > rows.length ? <p className="text-sm text-muted">Showing the first {rows.length} of {count} records.</p> : null}
    </details> : null;
  }))}</div>;
}
export default function Restore() {
  const { can, whyNot } = useAuth();
  const { isPhone } = useView();
  const cache = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [checked, setChecked] = useState<RestorePreview | null>(null);
  const [fileError, setFileError] = useState("");
  const [failure, setFailure] = useState<ApiProblem | null>(null);
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [over, setOver] = useState(false);
  const preview = useMutation({ mutationFn: previewRestore, onSuccess: setChecked, onError: (error) => setFileError(problemOf(error).message) });
  const restore = useMutation({
    mutationFn: ({ selected, fingerprint }: { selected: File; fingerprint: string }) => applyRestore(selected, fingerprint),
    onSuccess: () => { setConfirm(false); setNotice(""); void invalidateRecords(cache); },
    onError: (error) => {
      const problem = problemOf(error); setConfirm(false);
      const changed = problem.kind === "conflict" && problem.code === "plan_changed" ? (problem.body as { plan?: RestorePlan })?.plan : undefined;
      if (changed && checked && file) {
        // §0.3 returns a replacement plan, without a fingerprint. Ask preview for this same File again.
        // Nothing applies until its new fingerprint arrives and the owner checks a fresh confirmation.
        setChecked({ ...checked, plan: changed, fingerprint: "" }); setNotice(problem.message); setFailure(null); preview.mutate(file);
      } else {
        if (problem.kind === "offline" || problem.kind === "unreachable" || problem.kind === "server") setChecked((current) => current ? { ...current, fingerprint: "" } : current);
        setFailure(problem);
      }
    },
  });
  const busy = preview.isPending || restore.isPending;
  const openFile = (selected?: File) => {
    if (!selected || busy || !can("backup.restore")) return;
    setChecked(null); setConfirm(false); setFile(selected); setFileError(""); setFailure(null); setNotice(""); restore.reset();
    if (!/\.json$/i.test(selected.name)) { setFileError(`${selected.name} isn't a backup file. Backups are .json files, named like gst-backup-2026-10-08.json.`); return; }
    if (selected.size > 25 * 1024 * 1024) { setFileError(`That file is ${Number((selected.size / 1024 / 1024).toFixed(1))} MB. A backup this app can restore is at most 25 MB.`); return; }
    preview.mutate(selected);
  };
  const reset = () => { setFile(null); setChecked(null); setFileError(""); setFailure(null); setNotice(""); setConfirm(false); preview.reset(); restore.reset(); };
  const doRestore = () => {
    if (!file || !checked?.fingerprint || busy || !can("backup.restore")) return;
    setFailure(null); restore.mutate({ selected: file, fingerprint: checked.fingerprint });
  };
  const chooser = <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); openFile(e.dataTransfer.files[0]); }} className={cn("rounded-card border-2 border-dashed px-4 py-5 flex flex-col items-center text-center gap-3 transition-colors", over ? "border-brand bg-brand-tint" : "border-line")}>
    <input ref={input} type="file" accept=".json,application/json" className="hidden" aria-label="Backup file to restore" onChange={(e) => { openFile(e.target.files?.[0]); e.target.value = ""; }} />
    <FileJson size={26} className={over ? "text-brand" : "text-muted"} aria-hidden="true" />
    <p className="text-fg2">{over ? "Drop the backup file here" : isPhone ? "Pick a backup file this app or the old app downloaded." : "Drop a backup file here, or choose one. This app's backups and the old app's (v3.0 and v4.0) both work."}</p>
    <Button icon={Upload} onClick={() => input.current?.click()} full={isPhone}>Choose a backup file</Button>
    <p className="text-sm text-muted">JSON · at most 25 MB</p>
  </div>;
  if (!can("backup.restore")) return <Card title="Restore from a backup" subtitle="Adds what's missing from a backup file. Nothing on file is deleted or changed."><p className="text-sm text-muted">{whyNot("backup.restore", "restore a backup")}</p></Card>;
  const plan = checked?.plan;
  const result = restore.isSuccess ? restore.data : null;
  const failed = failure ? failure.kind === "offline" || failure.kind === "unreachable" || failure.kind === "server"
    ? { title: "The restore answer didn't arrive", body: "The restore may have finished. Check the plan again before trying to restore." }
    : saveFailure(failure) : null;
  return <Card title="Restore from a backup" subtitle="Adds what's missing from a backup file. Nothing on file is deleted or changed." actions={<Badge tone="file" icon={Lock}>Owner only</Badge>}>
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">Restore adds firms, customers, products and bills. It does not restore people, passwords, settings, filing records or the audit log.</p>
      {notice ? <Banner tone="amber" title={notice} /> : null}
      {fileError ? <Banner tone="neg" title="That file can't be restored">{fileError}</Banner> : null}
      {preview.isPending ? <p role="status" aria-live="polite">Reading {file?.name}…</p> : null}
      {!checked && !preview.isPending ? chooser : null}
      {checked && plan && !result ? <div className="flex flex-col gap-4 anim-rise">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-ctl border border-line bg-field px-4 py-3">
          <span className="min-w-0"><span className="block font-medium truncate">{checked.file.name}</span><span className="block text-sm text-muted">{checked.file.kind_words} · {checked.file.size} · {checked.file.made ? `made ${date(dayOf(checked.file.made))}, ${timeOf(checked.file.made)}` : "Date not recorded"}{checked.file.by ? ` by ${checked.file.by}` : ""}</span></span>
          <Button size="sm" variant="ghost" onClick={reset} disabled={busy}>Choose another file</Button>
        </div>
        <PlanTable plan={plan} /><PlanDetails plan={plan} />
        {failed ? <Banner tone="neg" title={failed.title}>{failed.body}</Banner> : null}
        {!checked.fingerprint && !busy ? <Button onClick={() => { if (file) { setFileError(""); setFailure(null); preview.mutate(file); } }}>Check the plan again</Button> : null}
        {plan.adds ? <div className="flex flex-wrap items-center gap-3"><Button variant="outline" icon={RotateCcw} disabled={busy || !checked.fingerprint} onClick={() => setConfirm(true)}>Add {plan.words}</Button><span className="text-sm text-muted">Recorded in the Audit log</span></div>
          : <Banner tone={plan.fails ? "muted" : "sale"} icon={plan.fails ? SkipForward : Check} title="Nothing to add">{plan.fails ? "Everything this file could add is already on file; the rest can't be added, for the reasons above." : "Everything in this file is already on file, so a restore would change nothing."}</Banner>}
      </div> : null}
      {result ? <div className="flex flex-col gap-4 anim-rise">
        <div className="flex flex-col items-center text-center gap-2 py-2" role="status"><SuccessMark size={64} /><p className="font-semibold mt-1">Added {result.plan.words}</p><p className="text-sm text-muted">{result.plan.skips ? `${plural(result.plan.skips, "record")} already on file were skipped. ` : ""}{result.plan.fails ? `${plural(result.plan.fails, "record")} couldn't be added. ` : ""}Nothing was deleted or changed. Recorded in the Audit log.</p></div>
        <PlanTable plan={result.plan} /><PlanDetails plan={result.plan} done />
        <div className="flex flex-wrap justify-center gap-2">
          {result.added.bills[0] ? <ButtonLink size="sm" to={`/sales/${result.added.bills[0]}`} iconRight={ArrowRight}>Open the restored bill</ButtonLink> : result.added.customers[0] ? <ButtonLink size="sm" to={`/customers/${result.added.customers[0]}`} iconRight={ArrowRight}>Open the new customer</ButtonLink> : null}
          <ButtonLink size="sm" variant="ghost" to="/audit?kind=backup">Audit log</ButtonLink><Button size="sm" variant="ghost" onClick={reset}>Done</Button>
        </div>
      </div> : null}
    </div>
    <ConfirmDialog open={confirm} busy={restore.isPending} busyLabel="Restoring…" onClose={() => setConfirm(false)} onConfirm={doRestore} title="Restore from this backup?" confirmLabel={plan ? `Add ${plan.words}` : "Add"} confirmDisabled={!checked?.fingerprint}
      record={checked && plan ? [["File", checked.file.name], ["Made", checked.file.made ? date(dayOf(checked.file.made)) : "Date not recorded"], ["Adds", plan.words], ["Skips", plural(plan.skips, "record")], ["Can't add", plural(plan.fails, "record")], ["Deletes or changes", "Nothing"]] : null}
      ack={plan ? `I understand this adds ${plan.words} to what's on file now.` : undefined}>
      <p>Records that match what's on file are skipped. Sales need their sales month open, and purchases need their credit month open. A restored bill in an open month changes that month's GST figures.</p>
    </ConfirmDialog>
  </Card>;
}
