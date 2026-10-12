import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { CircleAlert, CircleCheck, Clock, FileSpreadsheet, XCircle } from "lucide-react";
import { useReconciliation } from "@/core/api/gstReports";
import { useAuth } from "@/core/auth/AuthProvider";
import { date, inr, monthLabel, plural, todayIST } from "@/core/format";
import type { Reconciliation, ReconCheck, ReconMonth, ReconPeriod, ReportStage } from "@/core/gst/reportTypes";
import { STATE_META } from "@/core/gst/stages";
import { reconciliationSheet } from "@/core/excel/reconciliation";
import { useFirms, useScope } from "@/core/scope";
import { PAY } from "@/core/sales/words";
import { useView } from "@/core/view";
import { Badge, Button, Card, DL, Disclosure, EmptyState, Money, QueryView, Segmented, Table, Td, Th, Tr, cn } from "@/core/ui";
import { SplitToggle } from "@/pages/reports/PeriodBar";
import { useSplitPreference } from "@/pages/reports/period";
import { WorkbookDialog } from "./WorkbookDialog";

const MEASURES = [{ value: "taxable", label: "Taxable value" }, { value: "igst", label: "IGST" }, { value: "cgst", label: "CGST" }, { value: "sgst", label: "SGST" }] as const;
type Measure = typeof MEASURES[number]["value"];
const missing = (stage: ReportStage) => ["filed", "gstr1", "unlocked"].includes(stage) ? "As-filed figures unavailable" : stage === "future" ? "Not started" : "not filed";
const periodName = (p: ReconPeriod) => `${p.label}${p.so_far ? ` · ${date(p.so_far.from)} to ${date(p.so_far.to)}` : ""}`;
const pay = (mode: string | null) => PAY[(mode ?? "") as keyof typeof PAY] ?? mode ?? "Not recorded";
export function ReconView({ businessId, fy }: { businessId: number; fy: string }) {
  const [split, setSplit] = useSplitPreference();
  const [measure, setMeasure] = useState<Measure>("taxable");
  const q = useReconciliation(businessId, fy, split);
  return <QueryView query={q} what="the reconciliation">{data => <ReconciliationBody key={`${businessId}-${fy}`} data={data} split={split} setSplit={setSplit} measure={measure} setMeasure={setMeasure} />}</QueryView>;
}
function ReconciliationBody({ data: r, split, setSplit, measure, setMeasure }: { data: Reconciliation; split: boolean; setSplit: (value: boolean) => void; measure: Measure; setMeasure: (value: Measure) => void }) {
  const { isPhone } = useView();
  const { firms } = useFirms();
  const firm = firms.find(f => f.id === r.business);
  const { can, whyNot, me } = useAuth();
  const visible = (action: "gst.download") => can(action) || (me !== null && me.role !== "viewer");
  const [excel, setExcel] = useState(false);
  const sheets = useMemo(() => [reconciliationSheet(r, { name: firm?.name ?? "Firm", gstin: firm?.gstin ?? "" }, split)], [r, firm?.name, firm?.gstin, split]);
  const filedCount = r.filed.filter(m => m.gstr1).length;
  const hasSales = r.filed.some(m => m.books.bills > 0 || (m.gstr1?.bills ?? 0) > 0);
  if (!hasSales) return <Card><EmptyState title={`No sales for ${firm?.name ?? "this firm"} in FY ${r.fy}`}>The reconciliation fills in as bills are made: the books against the returns as filed, month by month.</EmptyState></Card>;
  const unavailable = r.filed.filter(m => !m.gstr1 && ["filed", "gstr1", "unlocked"].includes(m.stage)).length;
  const exportButton = visible("gst.download") ? <Button variant={isPhone ? "secondary" : "primary"} size={isPhone ? "lg" : "md"} full={isPhone} icon={FileSpreadsheet} disabled={!can("gst.download")} title={!can("gst.download") ? whyNot("gst.download") : undefined} onClick={() => setExcel(true)}>Excel with the working</Button> : null;
  const file = `Reconciliation_FY${r.fy}_${(firm?.name ?? "Firm").replace(/[^A-Za-z0-9]+/g, "_")}${split ? "_with_split" : ""}.xlsx`;
  return <><Card title={`Reconciliation · FY ${r.fy}`} subtitle={`${firm?.name ?? ""} · the books against the returns as filed, the CA's year-end working`} actions={isPhone ? undefined : exportButton}><div className="flex flex-col gap-4"><div className="flex flex-wrap items-center gap-2">{r.differs.length ? <Badge tone="neg" icon={XCircle}>{plural(r.differs.length, "month")} {r.differs.length === 1 ? "differs" : "differ"} from the return as filed</Badge> : filedCount ? <Badge tone="sale" icon={CircleCheck}>Books match the {plural(filedCount, "return")} as filed</Badge> : <Badge tone="muted" icon={Clock}>{unavailable ? "As-filed figures unavailable" : "Nothing filed yet this year"}</Badge>}{r.failing ? <Badge tone="neg" icon={XCircle}>{plural(r.failing, "arithmetic check")} failing</Badge> : null}</div>{unavailable && filedCount ? <p className="text-sm text-muted">{plural(unavailable, "filed month")} has no as-filed figures to compare.</p> : null}<div className={cn("flex gap-3", isPhone ? "flex-col" : "flex-wrap items-center justify-between")}><Segmented label="Figure to compare" value={measure} onChange={setMeasure} options={MEASURES} full={isPhone} /><SplitToggle value={split} onChange={setSplit} /></div></div></Card><FiledFigures r={r} measure={measure} /><Sections r={r} measure={measure} /><Checks r={r} />{r.split.length ? <PaymentSplit r={r} /> : null}{isPhone ? exportButton : null}<WorkbookDialog open={excel} onClose={() => setExcel(false)} file={file} sheets={sheets} audit={`Reconciliation, ${firm?.name ?? "Firm"}, FY ${r.fy}`} permission="gst.download" description={`One sheet for ${firm?.name ?? "this firm"}: the books against the returns as filed, month by month; the books by buyer class by quarter, nil supplies included; ${split ? "the cash/bank split; " : ""}and all ${r.checks.length} arithmetic checks. Amounts in Indian format.`} /></>;
}
function FiledFigures({ r, measure }: { r: Reconciliation; measure: Measure }) {
  const { isPhone } = useView();
  const label = MEASURES.find(m => m.value === measure)!.label, three = measure !== "taxable";
  const link = (month: string, text: string) => <Link className="link" to={`/gst?firm=${r.business}&month=${month}`}>{text}</Link>;
  const money = (value: number | null | undefined) => <Money value={value ?? null} />;
  const monthCells = (m: ReconMonth): ReactNode[] => [<>{monthLabel(m.month, { long: true })}<span className="block text-xs text-muted">{STATE_META[m.stage].label}</span></>, <>{money(m.books[measure])}<span className="block text-xs text-muted">{plural(m.books.bills, "bill")}</span></>, m.gstr1 ? <>{money(m.gstr1[measure])}<span className="block text-xs text-muted">{plural(m.gstr1.bills, "bill")}</span></> : missing(m.stage), ...(three ? [m.gstr3b ? money(m.gstr3b[measure]) : "not filed"] : []), m.diff ? inr(m.diff[measure], { sign: true }) : "—", <>{m.differs ? link(m.month, `Open ${monthLabel(m.month, { year: false })}`) : null}{m.amended_in ? <span className="block">{link(m.amended_in, `Amended in ${monthLabel(m.amended_in)}`)}</span> : null}</>];
  const periodCells = (p: ReconPeriod): ReactNode[] => [periodName(p), money(p.books[measure]), p.filed_months ? money(p.gstr1?.[measure]) : "not filed", ...(three ? [r.filed.some(m => p.months.includes(m.month) && m.gstr3b) && p.gstr3b ? money(p.gstr3b[measure]) : "not filed"] : []), p.filed_months && p.diff ? inr(p.diff[measure], { sign: true }) : "—", `difference on the ${plural(p.filed_months, "month")} filed`];
  const headers = ["Period", "Books", "GSTR-1 as filed", ...(three ? ["GSTR-3B as filed"] : []), "Books − filed"];
  const row = (key: string, cells: ReactNode[], differs = false, total = false) => isPhone ? <div key={key} className={cn("px-4 py-3 border-t border-rule", differs && "bg-neg-tint")}><p className="font-medium">{cells[0]}</p><DL rows={cells.slice(1, -1).map((value, i) => [headers[i + 1], value] as const)} /><div className="text-sm mt-1">{cells.at(-1)}</div></div> : <Tr key={key} className={cn(differs && "bg-neg-tint", total && "font-semibold border-t-2 border-line")}>{cells.map((cell, i) => <Td key={i} align={i > 0 && i < cells.length - 1 ? "right" : undefined}>{cell}</Td>)}</Tr>;
  const content = <>{r.filed.map(m => row(m.month, monthCells(m), m.differs))}{r.periods.map(p => row(p.key, periodCells(p), Boolean(p.differs.length), true))}</>;
  return <Card pad={false} title={`${label}: books against the returns as filed`} subtitle={`Month by month; each return as it stood when it was marked filed${three ? "; GSTR-3B also carries amendments to earlier months" : ""}`}>{isPhone ? content : <Table label={`${label}, books against the returns as filed`}><thead><tr>{headers.map((h, i) => <Th key={h} align={i > 0 ? "right" : undefined}>{h}</Th>)}<Th><span className="sr-only">Notes</span></Th></tr></thead><tbody>{content}</tbody></Table>}<p className="px-5 py-3 border-t border-rule text-sm text-muted">Books − filed compares the month's bills now with GSTR-1 as it was filed, for the months filed so far; a difference means a bill changed after filing and goes in a later return as an amendment. GSTR-2B (what suppliers filed) isn't matched here yet.</p></Card>;
}
function Sections({ r, measure }: { r: Reconciliation; measure: Measure }) {
  const { isPhone } = useView();
  const sections = [["all", "All sales"], ["b2b", "B2B"], ["b2cl", "B2CL"], ["b2c", "B2C"]] as const;
  const rows = r.sections.map(s => {
    const p = r.periods.find(p => p.key === s.key), future = Boolean(p?.months.length && p.months.every(m => m > todayIST().slice(0, 7)));
    const status = future ? <span className="text-muted">Not started</span> : <Badge tone={s.adds_up ? "sale" : "neg"}>{s.adds_up ? "Pass" : "Fail"}</Badge>;
    return isPhone ? <div key={s.key} className="px-4 py-3 border-t border-rule"><div className="flex items-center justify-between gap-3"><span className="font-medium">{p ? periodName(p) : s.key}</span>{status}</div><DL rows={sections.map(([k, name]) => [`${name} · ${plural(s[k].bills, "bill")}`, <Money value={s[k][measure]} />] as const)} /></div> : <Tr key={s.key} className={s.key === "fy" ? "font-semibold border-t-2 border-line" : ""}><Td>{p ? periodName(p) : s.key}</Td>{sections.map(([k]) => <Td key={k} align="right"><Money value={s[k][measure]} /><span className="block text-xs text-muted">{plural(s[k].bills, "bill")}</span></Td>)}<Td>{status}</Td></Tr>;
  });
  return <Card pad={false} title={`${MEASURES.find(m => m.value === measure)!.label} by buyer class`} subtitle="The books grouped by buyer class, nil supplies included; B2B + B2CL + B2C make the whole">{isPhone ? rows : <Table label="Books by buyer class"><thead><tr><Th>Period</Th>{sections.map(([k, label]) => <Th key={k} align="right">{label}</Th>)}<Th>Adds up</Th></tr></thead><tbody>{rows}</tbody></Table>}<p className="px-5 py-3 border-t border-rule text-sm text-muted">B2B is buyers with a valid GSTIN; B2CL is inter-state sales over ₹1,00,000 to buyers without one; B2C is the rest. Bills with no items are counted but carry nothing.</p></Card>;
}
function CheckStatus({ check: c }: { check: ReconCheck }) {
  const label = { pass: "Pass", rounding: "Rounding", fail: "Fail" }[c.status];
  return <Badge tone={c.status === "fail" ? "neg" : c.status === "pass" ? "sale" : "muted"} icon={c.status === "fail" ? XCircle : c.status === "pass" ? CircleCheck : CircleAlert}>{label}{c.status === "pass" ? "" : ` · ${c.id.startsWith("coverage") ? plural(Math.abs(c.diff), "bill") : inr(Math.abs(c.diff))}`}</Badge>;
}
function Checks({ r }: { r: Reconciliation }) {
  const { isPhone } = useView(), { setFirmId, setFy } = useScope();
  const order = { fail: 0, rounding: 1, pass: 2 }, checks = [...r.checks].sort((a, b) => order[a.status] - order[b.status]);
  const value = (c: ReconCheck, n: number, sign = false) => c.id.startsWith("coverage") ? plural(n, "bill") : inr(n, { sign });
  const link = (c: ReconCheck) => c.link ? <Link className="link" to={c.link.to} onClick={() => { setFirmId(r.business); setFy(r.fy); }}>{c.link.label}</Link> : null;
  return <Card pad={false}><Disclosure className="px-5" defaultOpen={r.failing > 0} title="Arithmetic checks" summary={`${plural(r.checks.length, "check")} · ${r.failing ? `${r.failing} failing` : "none failing"}${r.roundings ? ` · ${plural(r.roundings, "rounding")}` : ""}. The books checked against themselves: sections add up, tax matches its rate, every bill is counted, quarters make the year.`}>{isPhone ? <ul>{checks.map(c => <li key={`${c.id}-${c.period}`} className="py-2.5 border-t border-rule"><div className="flex justify-between gap-3"><span>{c.label}<span className="block text-xs text-muted">{c.period}</span></span><CheckStatus check={c} /></div><p className="text-sm text-fg2 tnum mt-1">Expected {value(c, c.expected)} · actual {value(c, c.actual)}</p>{link(c)}</li>)}</ul> : <Table label="All arithmetic checks"><thead><tr><Th>Check</Th><Th>Period</Th>{["Expected", "Actual", "Difference"].map(h => <Th key={h} align="right">{h}</Th>)}<Th>Status</Th><Th><span className="sr-only">Bills to open</span></Th></tr></thead><tbody>{checks.map(c => <Tr key={`${c.id}-${c.period}`} className={c.status === "fail" ? "bg-neg-tint" : ""}><Td>{c.label}</Td><Td>{c.period}</Td><Td align="right">{value(c, c.expected)}</Td><Td align="right">{value(c, c.actual)}</Td><Td align="right">{value(c, c.diff, true)}</Td><Td><CheckStatus check={c} /></Td><Td>{link(c)}</Td></Tr>)}</tbody></Table>}<p className="text-sm text-muted">Rate checks allow one paisa per line, with a minimum of ₹1; other money checks allow ₹1.</p></Disclosure></Card>;
}
function PaymentSplit({ r }: { r: Reconciliation }) {
  const { isPhone } = useView();
  return <Card pad={false} title="Payment split" subtitle={`Every sales bill of FY ${r.fy} by how it was paid`}>{isPhone ? <div className="px-4 pb-2">{r.split.map(m => <div key={m.mode ?? "none"} className="py-2.5 border-t border-rule first:border-t-0 flex items-baseline justify-between gap-3"><span>{pay(m.mode)}<span className="block text-xs text-muted">{plural(m.bills, "bill")} · {m.share}%</span></span><Money value={m.value} tone="sale" /></div>)}</div> : <Table label="Sales by payment mode"><thead><tr>{["Payment mode", "Bills", "Bill value", "Taxable value", "IGST", "CGST", "SGST", "Share"].map(h => <Th key={h}>{h}</Th>)}</tr></thead><tbody>{r.split.map(m => <Tr key={m.mode ?? "none"}><Td>{pay(m.mode)}</Td><Td align="right">{m.bills}</Td>{[m.value, m.taxable, m.igst, m.cgst, m.sgst].map((v, i) => <Td key={i} align="right"><Money value={v} /></Td>)}<Td align="right">{m.share}%</Td></Tr>)}</tbody></Table>}<p className="px-5 py-3 border-t border-rule text-sm text-muted">Each bill counts once, under its own mode, so the modes add up to the whole exactly; shares are of bill value and total 100.00%.{r.split.some(m => !m.mode) ? ' "Not recorded" is bills brought in from Tally or Excel without a payment mode; new bills always carry theirs.' : ""}</p></Card>;
}
