import { useState } from "react";
import { date, todayIST } from "@/core/format";
import { useView } from "@/core/view";
import type { Firm, FirmId } from "@/core/scope";
import { Checkbox, Field, Input, Segmented, Select } from "@/core/ui";
import { EARLIEST_REPORT_DAY, periodChoices, rangeProblems, type ReportPeriod, type SavedPeriod } from "./period";

export function SplitToggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return <Checkbox label="Cash/bank split in downloads" description="Adds a summary by cash, UPI or bank, udhaar and not recorded" checked={value} onChange={onChange} />;
}
function CustomRange({ period, onChange }: { period: ReportPeriod; onChange: (period: SavedPeriod) => void }) {
  const { isPhone } = useView();
  const [draft, setDraft] = useState({ from: period.from, to: period.to });
  const errors = rangeProblems(draft.from, draft.to);
  const change = (key: "from" | "to", value: string) => { const next = { ...draft, [key]: value }; setDraft(next); if (!Object.keys(rangeProblems(next.from, next.to)).length) onChange({ p: "custom", ...next }); };
  return <div className={`grid gap-3 anim-rise ${isPhone ? "grid-cols-2" : "grid-cols-[190px_190px_minmax(0,1fr)] items-start"}`}>{(["from", "to"] as const).map(key => <Field key={key} label={key === "from" ? "From" : "To"} htmlFor={`rep-${key}`} error={errors[key]} hint={draft[key] && !errors[key] ? date(draft[key]) : undefined}><Input id={`rep-${key}`} type="date" value={draft[key]} min={EARLIEST_REPORT_DAY} max={todayIST()} onChange={e => change(key, e.target.value)} /></Field>)}{!isPhone ? <p className="text-sm text-muted self-center">A range can cross financial years: from 01 Apr 2022 to today.</p> : null}</div>;
}
export function PeriodBar({ period, fy, firmId, firms, setFirmId, onChange, split, setSplit }: { period: ReportPeriod; fy: string; firmId: FirmId | null; firms: Firm[]; setFirmId: (firm: FirmId) => void; onChange: (period: SavedPeriod) => void; split: boolean; setSplit: (value: boolean) => void }) {
  const { isPhone } = useView();
  const choices = periodChoices(fy);
  const pick = (p: SavedPeriod["p"]) => onChange(p === "custom" ? { ...period, p } : { p });
  return <section aria-label="Period and firm" className={isPhone ? "flex flex-col gap-3" : "card px-5 py-3 flex flex-wrap items-center gap-x-5 gap-y-3"}>{isPhone ? <Field label={`Period · FY ${fy}`} htmlFor="rep-period"><Select id="rep-period" value={period.p} options={choices} onChange={e => pick(e.target.value as SavedPeriod["p"])} /></Field> : <div className="flex items-center gap-3 min-w-0"><span className="caps">Period</span><Segmented label="Period" value={period.p} onChange={pick} options={choices} /></div>}<Field label="Firm" htmlFor="rep-firm" className={isPhone ? "" : "ml-auto w-[210px]"}><Select id="rep-firm" value={firmId ?? ""} placeholder={firmId === null ? "Loading firms" : undefined} options={[{ value: "all", label: "All firms" }, ...firms.map(f => ({ value: String(f.id), label: f.name }))]} onChange={e => setFirmId(e.target.value === "all" ? "all" : Number(e.target.value))} /></Field>{period.p === "custom" ? <div className="basis-full"><CustomRange key={fy} period={period} onChange={onChange} /></div> : null}<div className="basis-full pt-1 border-t border-rule flex flex-wrap items-center justify-between gap-3"><SplitToggle value={split} onChange={setSplit} />{!isPhone ? <span className="text-sm text-muted">FY {fy} is picked in the top bar; a past year offers its quarters.</span> : null}</div></section>;
}
